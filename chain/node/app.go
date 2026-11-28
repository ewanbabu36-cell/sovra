package node

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"cosmossdk.io/math"
	"github.com/sovra/chain/store"
	"github.com/sovra/chain/x/auth"
	"github.com/sovra/chain/x/bank"
	issuancekeeper "github.com/sovra/chain/x/issuance/keeper"
	issuancetypes "github.com/sovra/chain/x/issuance/types"
	wasmkeeper "github.com/sovra/chain/x/wasm/keeper"
	wasmtypes "github.com/sovra/chain/x/wasm/types"
)

var (
	KeyPrefixHeight      = []byte{0x30}
	KeyPrefixAppHash     = []byte{0x31}
	KeyPrefixChainID     = []byte{0x32}
	KeyPrefixGenesisTime = []byte{0x33}
	KeyPrefixInitialized = []byte{0x34}
	KeyPrefixBlock       = []byte{0x35}
	KeyPrefixValidators          = []byte{0x36}
	KeyPrefixValidatorTransitions = []byte{0x37}
	KeyPrefixDelegation          = []byte{0x40}
	KeyPrefixSigningInfo = []byte{0x41}
)

func SigningInfoKey(validator string) []byte {
	return append(KeyPrefixSigningInfo, []byte(validator)...)
}

func BlockKey(height int64) []byte {
	k := make([]byte, 9)
	k[0] = 0x35
	binary.BigEndian.PutUint64(k[1:], uint64(height))
	return k
}

func DelegationKey(delegator, validator string) []byte {
	k := append(KeyPrefixDelegation, []byte(delegator)...)
	k = append(k, byte(':'))
	return append(k, []byte(validator)...)
}

// SovraApp is the complete Sovra blockchain state machine
type SovraApp struct {
	mu             sync.RWMutex
	store          store.KVStore
	bankKeeper     *bank.Keeper
	authKeeper     *auth.Keeper
	issuanceKeeper *issuancekeeper.Keeper
	wasmKeeper     *wasmkeeper.Keeper

	height                   int64
	appHash                  []byte
	chainID                  string
	genesisTime              int64
	validators               []GenesisValidator
	lastInstantiatedContract string
}

// NewSovraApp creates an instance of the Sovra application
func NewSovraApp(s store.KVStore, genesisTime int64) *SovraApp {
	bk := bank.NewKeeper()
	ak := auth.NewKeeper()
	ik := issuancekeeper.NewKeeper(s, genesisTime)
	wk := wasmkeeper.NewKeeper(wasmtypes.DefaultWasmConfig())

	wk.SetBurnHandler(func(kv store.KVStore, contractAddr string, amount math.Int) error {
		burnHandler := func(burner string, amt math.Int) error {
			if err := bk.SendCoinsFromAccountToModule(kv, burner, issuancetypes.ModuleName, amt); err != nil {
				return err
			}
			return bk.BurnCoins(kv, issuancetypes.ModuleName, amt)
		}
		return ik.ExecuteBurn(kv, contractAddr, amount, burnHandler)
	})

	app := &SovraApp{
		store:          s,
		bankKeeper:     bk,
		authKeeper:     ak,
		issuanceKeeper: ik,
		wasmKeeper:     wk,
		genesisTime:    genesisTime,
	}

	// Restore persistent state if already initialized on disk
	_, _, _ = app.LoadLastState()
	return app
}

// InitChain sets up the genesis state at height 0
func (app *SovraApp) InitChain(gen GenesisState) error {
	app.mu.Lock()
	defer app.mu.Unlock()

	// Prevent re-initialization if already initialized on disk
	initBz := app.store.Get(KeyPrefixInitialized)
	if len(initBz) > 0 && initBz[0] == 0x01 {
		return fmt.Errorf("chain is already initialized")
	}

	app.chainID = gen.ChainID
	app.genesisTime = gen.GenesisTime
	app.validators = gen.Validators

	var totalGenesisAllocated math.Int = math.ZeroInt()
	for addr, amtStr := range gen.Accounts {
		amt, ok := math.NewIntFromString(amtStr)
		if !ok || !amt.IsPositive() {
			return fmt.Errorf("invalid genesis allocation for address %s: %s", addr, amtStr)
		}
		app.bankKeeper.SetBalance(app.store, addr, amt)
		totalGenesisAllocated = totalGenesisAllocated.Add(amt)
	}

	// Initialize total bank supply to match total genesis allocations
	app.bankKeeper.SetTotalSupply(app.store, totalGenesisAllocated)

	// Initialize issuance module counters ($30M GenesisCap check)
	if err := app.issuanceKeeper.InitGenesis(app.store, totalGenesisAllocated); err != nil {
		return fmt.Errorf("issuance InitGenesis failed: %w", err)
	}

	// Master supply invariant assertion
	if err := app.issuanceKeeper.VerifySupplyInvariant(app.store, totalGenesisAllocated); err != nil {
		return fmt.Errorf("genesis supply invariant check failed: %w", err)
	}

	app.height = 0
	app.appHash = app.computeStateRoot()

	// Persist EconomicParams, Genesis Vesting Schedules, SecurityCouncil sunset, and initial block time
	ep := DefaultEconomicParams()
	if gen.EconomicParams != nil {
		ep = *gen.EconomicParams
	}
	app.setEconomicParams(app.store, ep)
	app.setBlockTime(app.store, gen.GenesisTime)

	for _, va := range gen.VestingAccounts {
		origAmt, ok := math.NewIntFromString(va.OriginalAmount)
		if !ok || !origAmt.IsPositive() {
			return fmt.Errorf("invalid vesting original_amount for %s", va.Address)
		}
		bal := app.bankKeeper.GetBalance(app.store, va.Address)
		if bal.LT(origAmt) {
			return fmt.Errorf("vesting account %s balance %s < vesting amount %s", va.Address, bal, origAmt)
		}
		cliffSec := va.CliffSeconds
		if cliffSec < 0 {
			cliffSec = issuancetypes.DefaultGenesisCliffSeconds
		}
		vestSec := va.VestingDurationSeconds
		if vestSec <= 0 {
			vestSec = issuancetypes.DefaultGenesisVestingSeconds
		}
		sched := VestingSchedule{
			Address:        va.Address,
			OriginalAmount: origAmt.String(),
			StartTime:      gen.GenesisTime,
			CliffTime:      gen.GenesisTime + cliffSec,
			EndTime:        gen.GenesisTime + cliffSec + vestSec,
			Label:          va.Label,
		}
		sbz, _ := json.Marshal(sched)
		app.store.Set(vestingKey(va.Address), sbz)
	}

	if gen.SecurityCouncil != nil {
		scBz, _ := json.Marshal(gen.SecurityCouncil)
		app.store.Set(KeySecurityCouncil, scBz)
	} else if ep.SecurityCouncilSunsetHeight > 0 || ep.SecurityCouncilSunsetTime > 0 {
		sc := SecurityCouncilGenesis{
			SunsetHeight:    ep.SecurityCouncilSunsetHeight,
			SunsetTimestamp: ep.SecurityCouncilSunsetTime,
		}
		scBz, _ := json.Marshal(sc)
		app.store.Set(KeySecurityCouncil, scBz)
	}

	// Persist initial genesis state markers to store
	heightBz := make([]byte, 8)
	binary.BigEndian.PutUint64(heightBz, 0)
	app.store.Set(KeyPrefixHeight, heightBz)
	app.store.Set(KeyPrefixAppHash, app.appHash)
	app.store.Set(KeyPrefixChainID, []byte(gen.ChainID))
	genTimeBz := make([]byte, 8)
	binary.BigEndian.PutUint64(genTimeBz, uint64(gen.GenesisTime))
	app.store.Set(KeyPrefixGenesisTime, genTimeBz)
	valBz, _ := json.Marshal(gen.Validators)
	app.store.Set(KeyPrefixValidators, valBz)
	app.store.Set(KeyPrefixInitialized, []byte{0x01})

	return nil
}

// CheckTx verifies transaction validity before inclusion in mempool / proposal
func (app *SovraApp) CheckTx(tx SignedTransaction) error {
	app.mu.RLock()
	defer app.mu.RUnlock()

	return app.validateTx(app.store, tx, false)
}

// BeginBlock executes at the start of every block
func (app *SovraApp) BeginBlock(height int64, blockTimeUnix int64) error {
	app.mu.Lock()
	defer app.mu.Unlock()

	app.height = height
	app.setBlockTime(app.store, blockTimeUnix)

	// Mint callback wiring to bank keeper
	mintHandler := func(pool issuancetypes.PoolID, dest string, amount math.Int) error {
		// Mint to issuance module, then transfer to target module account
		if err := app.bankKeeper.MintCoins(app.store, issuancetypes.ModuleName, amount); err != nil {
			return err
		}
		return app.bankKeeper.SendCoinsFromModuleToModule(app.store, issuancetypes.ModuleName, dest, amount)
	}

	// Run issuance BeginBlocker (triggers new epoch allocations on day boundaries)
	if err := app.issuanceKeeper.BeginBlocker(app.store, blockTimeUnix, mintHandler); err != nil {
		return err
	}

	// Distribute available fee_collector yield to veSOV stakers & patron creators
	if err := app.distributeFeeRewards(app.store); err != nil {
		return err
	}

	// Release only matured 14-21 day unbonding entries
	return app.processMaturedUnbondings(app.store, blockTimeUnix)
}

// DeliverTx executes a committed transaction inside a state cache sandbox
func (app *SovraApp) DeliverTx(tx SignedTransaction) error {
	app.mu.Lock()
	defer app.mu.Unlock()

	// Use CacheWrap for atomic execution
	cacheStore, commit := app.store.CacheWrap()

	if err := app.validateTx(cacheStore, tx, true); err != nil {
		return err // Discard cacheStore!
	}

	fee := math.ZeroInt()
	if tx.Fee != "" {
		if f, ok := math.NewIntFromString(tx.Fee); ok {
			fee = f
		}
	}

	// Apply EIP-1559 Fee Sink: FeeBurnBps% permanently burned via ExecuteBurn, remainder -> fee_collector
	if fee.IsPositive() {
		if _, _, err := app.applyProtocolFee(cacheStore, tx.Sender, fee); err != nil {
			return err
		}
	}

	var fundsAttached math.Int = math.ZeroInt()
	if tx.Funds != "" {
		if f, ok := math.NewIntFromString(tx.Funds); ok && f.IsPositive() {
			fundsAttached = f
		}
	} else if tx.Amount != "" {
		if a, ok := math.NewIntFromString(tx.Amount); ok && a.IsPositive() {
			fundsAttached = a
		}
	}

	now := app.getBlockTime(cacheStore)
	env := wasmtypes.Env{
		Block: wasmtypes.BlockInfo{
			Height:  app.height,
			Time:    now,
			ChainID: app.chainID,
		},
	}

	// Execute operation
	switch tx.Type {
	case TxTypeSend:
		amt, _ := math.NewIntFromString(tx.Amount)
		if err := app.bankKeeper.SendCoins(cacheStore, tx.Sender, tx.Recipient, amt); err != nil {
			return fmt.Errorf("transfer failed: %w", err)
		}

	case TxTypeBurn:
		amt, _ := math.NewIntFromString(tx.Amount)
		burnHandler := func(burner string, burnAmt math.Int) error {
			// Send to issuance module then burn from bank supply
			if err := app.bankKeeper.SendCoinsFromAccountToModule(cacheStore, burner, issuancetypes.ModuleName, burnAmt); err != nil {
				return err
			}
			return app.bankKeeper.BurnCoins(cacheStore, issuancetypes.ModuleName, burnAmt)
		}

		if err := app.issuanceKeeper.ExecuteBurn(cacheStore, tx.Sender, amt, burnHandler); err != nil {
			return fmt.Errorf("burn failed: %w", err)
		}

	case TxTypeStoreCode:
		bytecode, err := hex.DecodeString(tx.WASMBytecodeHex)
		if err != nil {
			return fmt.Errorf("invalid wasm bytecode: %w", err)
		}
		if _, _, err := app.wasmKeeper.StoreCode(cacheStore, tx.Sender, bytecode); err != nil {
			return fmt.Errorf("store code failed: %w", err)
		}

	case TxTypeInstantiateContract:
		addr, _, err := app.wasmKeeper.InstantiateContract(cacheStore, app.bankKeeper, tx.Sender, tx.Admin, tx.CodeID, tx.Label, []byte(tx.Msg), fundsAttached, env)
		if err != nil {
			return fmt.Errorf("instantiate contract failed: %w", err)
		}
		app.lastInstantiatedContract = addr

	case TxTypeExecuteContract:
		if _, err := app.wasmKeeper.ExecuteContract(cacheStore, app.bankKeeper, tx.Sender, tx.Contract, []byte(tx.Msg), fundsAttached, env); err != nil {
			return fmt.Errorf("execute contract failed: %w", err)
		}

	case TxTypeDelegate:
		amt, _ := math.NewIntFromString(tx.Amount)
		targetVal := tx.Validator
		if targetVal == "" {
			targetVal = tx.Recipient
		}
		tierName, lockSecs, multBps, err := ResolveLockTier(tx.LockDays)
		if err != nil {
			return err
		}
		if err := app.bankKeeper.SendCoinsFromAccountToModule(cacheStore, tx.Sender, issuancetypes.BondedTokensPoolName, amt); err != nil {
			return fmt.Errorf("delegation transfer failed: %w", err)
		}
		curDel := app.GetDelegation(cacheStore, tx.Sender, targetVal)
		newTotal := curDel.Add(amt)
		app.SetDelegation(cacheStore, tx.Sender, targetVal, newTotal)

		rec := DelegationRecord{
			Delegator:     tx.Sender,
			Validator:     targetVal,
			Amount:        newTotal.String(),
			LockTier:      tierName,
			LockSeconds:   lockSecs,
			LockedAt:      now,
			UnlockAt:      now + lockSecs,
			MultiplierBps: multBps,
		}
		if existingBz := cacheStore.Get(delegationRecKey(tx.Sender, targetVal)); len(existingBz) > 0 {
			var existing DelegationRecord
			if json.Unmarshal(existingBz, &existing) == nil {
				if existing.UnlockAt > rec.UnlockAt {
					rec.UnlockAt = existing.UnlockAt
				}
				if existing.MultiplierBps > rec.MultiplierBps {
					rec.MultiplierBps = existing.MultiplierBps
					rec.LockTier = existing.LockTier
				}
			}
		}
		rBz, _ := json.Marshal(rec)
		cacheStore.Set(delegationRecKey(tx.Sender, targetVal), rBz)

	case TxTypeUndelegate:
		amt, _ := math.NewIntFromString(tx.Amount)
		targetVal := tx.Validator
		if targetVal == "" {
			targetVal = tx.Recipient
		}
		curDel := app.GetDelegation(cacheStore, tx.Sender, targetVal)
		if curDel.LT(amt) {
			return fmt.Errorf("insufficient delegated balance to undelegate")
		}
		if existingBz := cacheStore.Get(delegationRecKey(tx.Sender, targetVal)); len(existingBz) > 0 {
			var existing DelegationRecord
			if json.Unmarshal(existingBz, &existing) == nil && existing.UnlockAt > now {
				return fmt.Errorf("delegation locked until %d (current time %d)", existing.UnlockAt, now)
			}
		}
		remainingDel := curDel.Sub(amt)
		app.SetDelegation(cacheStore, tx.Sender, targetVal, remainingDel)
		if existingBz := cacheStore.Get(delegationRecKey(tx.Sender, targetVal)); len(existingBz) > 0 {
			var existing DelegationRecord
			if json.Unmarshal(existingBz, &existing) == nil {
				if remainingDel.IsZero() {
					cacheStore.Delete(delegationRecKey(tx.Sender, targetVal))
				} else {
					existing.Amount = remainingDel.String()
					rBz, _ := json.Marshal(existing)
					cacheStore.Set(delegationRecKey(tx.Sender, targetVal), rBz)
				}
			}
		}

		// Move bonded funds to UnbondingTokensPool with 14-21 day cooldown queue
		if err := app.bankKeeper.SendCoinsFromModuleToModule(cacheStore, issuancetypes.BondedTokensPoolName, issuancetypes.UnbondingTokensPoolName, amt); err != nil {
			return fmt.Errorf("unbonding pool escrow failed: %w", err)
		}
		params := app.getEconomicParams(cacheStore)
		app.enqueueUnbonding(cacheStore, tx.Sender, targetVal, "delegation", amt, now, now+params.UnbondingPeriodSeconds)

	case TxTypeBondSeeder:
		amt, _ := math.NewIntFromString(tx.Amount)
		if err := app.bankKeeper.SendCoinsFromAccountToModule(cacheStore, tx.Sender, issuancetypes.SeederCollateralPoolName, amt); err != nil {
			return fmt.Errorf("seeder collateral transfer failed: %w", err)
		}
		rec := SeederBondRecord{
			Address:           tx.Sender,
			BondedUsov:        "0",
			StorageCapacityGb: tx.StorageGb,
			SlashedUsov:       "0",
			EarnedRewardsUsov: "0",
			BondedAt:          now,
		}
		if bz := cacheStore.Get(seederBondKey(tx.Sender)); len(bz) > 0 {
			_ = json.Unmarshal(bz, &rec)
		}
		prev, _ := math.NewIntFromString(rec.BondedUsov)
		rec.BondedUsov = prev.Add(amt).String()
		if tx.StorageGb > rec.StorageCapacityGb {
			rec.StorageCapacityGb = tx.StorageGb
		}
		if rec.StorageCapacityGb == 0 {
			rec.StorageCapacityGb = 10
		}
		rBz, _ := json.Marshal(rec)
		cacheStore.Set(seederBondKey(tx.Sender), rBz)
		app.addPoolTotal(cacheStore, "seeder_collateral", amt)

	case TxTypeUnbondSeeder:
		amt, _ := math.NewIntFromString(tx.Amount)
		bz := cacheStore.Get(seederBondKey(tx.Sender))
		if len(bz) == 0 {
			return fmt.Errorf("no active seeder collateral bond found")
		}
		var rec SeederBondRecord
		if err := json.Unmarshal(bz, &rec); err != nil {
			return err
		}
		bonded, _ := math.NewIntFromString(rec.BondedUsov)
		if bonded.LT(amt) {
			return fmt.Errorf("insufficient bonded seeder collateral: have %s, want %s", bonded, amt)
		}
		rec.BondedUsov = bonded.Sub(amt).String()
		rBz, _ := json.Marshal(rec)
		cacheStore.Set(seederBondKey(tx.Sender), rBz)
		if err := app.bankKeeper.SendCoinsFromModuleToModule(cacheStore, issuancetypes.SeederCollateralPoolName, issuancetypes.UnbondingTokensPoolName, amt); err != nil {
			return err
		}
		app.subPoolTotal(cacheStore, "seeder_collateral", amt)
		params := app.getEconomicParams(cacheStore)
		app.enqueueUnbonding(cacheStore, tx.Sender, tx.Sender, "seeder", amt, now, now+params.UnbondingPeriodSeconds)

	case TxTypePatronStake:
		amt, _ := math.NewIntFromString(tx.Amount)
		creator := tx.Creator
		if creator == "" {
			creator = tx.Recipient
		}
		_, lockSecs, multBps, err := ResolveLockTier(tx.LockDays)
		if err != nil {
			return err
		}
		if err := app.bankKeeper.SendCoinsFromAccountToModule(cacheStore, tx.Sender, issuancetypes.PatronStakingPoolName, amt); err != nil {
			return fmt.Errorf("patron stake transfer failed: %w", err)
		}
		rec := PatronStakeRecord{
			Fan:           tx.Sender,
			Creator:       creator,
			AmountUsov:    "0",
			LockDays:      tx.LockDays,
			UnlockAt:      now + lockSecs,
			MultiplierBps: multBps,
			StakedAt:      now,
		}
		if bz := cacheStore.Get(patronStakeKey(tx.Sender, creator)); len(bz) > 0 {
			var existing PatronStakeRecord
			if json.Unmarshal(bz, &existing) == nil {
				prev, _ := math.NewIntFromString(existing.AmountUsov)
				rec.AmountUsov = prev.String()
				if existing.UnlockAt > rec.UnlockAt {
					rec.UnlockAt = existing.UnlockAt
				}
				if existing.MultiplierBps > rec.MultiplierBps {
					rec.MultiplierBps = existing.MultiplierBps
				}
			}
		}
		prev, _ := math.NewIntFromString(rec.AmountUsov)
		rec.AmountUsov = prev.Add(amt).String()
		rBz, _ := json.Marshal(rec)
		cacheStore.Set(patronStakeKey(tx.Sender, creator), rBz)
		app.addPoolTotal(cacheStore, "patron", amt)

	case TxTypePatronUnstake:
		amt, _ := math.NewIntFromString(tx.Amount)
		creator := tx.Creator
		if creator == "" {
			creator = tx.Recipient
		}
		bz := cacheStore.Get(patronStakeKey(tx.Sender, creator))
		if len(bz) == 0 {
			return fmt.Errorf("no active patron stake found for fan %s -> creator %s", tx.Sender, creator)
		}
		var rec PatronStakeRecord
		if err := json.Unmarshal(bz, &rec); err != nil {
			return err
		}
		if rec.UnlockAt > now {
			return fmt.Errorf("patron stake locked until %d (current time %d)", rec.UnlockAt, now)
		}
		cur, _ := math.NewIntFromString(rec.AmountUsov)
		if cur.LT(amt) {
			return fmt.Errorf("insufficient patron stake: have %s, want %s", cur, amt)
		}
		rem := cur.Sub(amt)
		if rem.IsZero() {
			cacheStore.Delete(patronStakeKey(tx.Sender, creator))
		} else {
			rec.AmountUsov = rem.String()
			rBz, _ := json.Marshal(rec)
			cacheStore.Set(patronStakeKey(tx.Sender, creator), rBz)
		}
		if err := app.bankKeeper.SendCoinsFromModuleToModule(cacheStore, issuancetypes.PatronStakingPoolName, issuancetypes.UnbondingTokensPoolName, amt); err != nil {
			return err
		}
		app.subPoolTotal(cacheStore, "patron", amt)
		params := app.getEconomicParams(cacheStore)
		app.enqueueUnbonding(cacheStore, tx.Sender, creator, "patron", amt, now, now+params.UnbondingPeriodSeconds)

	case TxTypeClaimRewards:
		_ = app.distributeFeeRewards(cacheStore)
		claimable := app.getClaimableReward(cacheStore, tx.Sender)
		if !claimable.IsPositive() {
			return fmt.Errorf("no claimable staking rewards available for %s", tx.Sender)
		}
		if err := app.bankKeeper.SendCoinsFromModuleToAccount(cacheStore, issuancetypes.RewardYieldPoolName, tx.Sender, claimable); err != nil {
			return fmt.Errorf("reward payout failed: %w", err)
		}
		app.setClaimableReward(cacheStore, tx.Sender, math.ZeroInt())
		app.subPoolTotal(cacheStore, "reward_pool", claimable)
		lockedReward := claimable.Mul(math.NewInt(issuancetypes.ValidatorRewardVestingShareBps)).Quo(math.NewInt(10000))
		if lockedReward.IsPositive() {
			app.addRollingRewardVesting(cacheStore, tx.Sender, lockedReward, now, issuancetypes.ValidatorRewardVestingSeconds, "Validator/Staking Yield Linear Vest (14d)")
		}

	case TxTypeRegisterHandle:
		amt, _ := math.NewIntFromString(tx.Amount)
		cleanHandle := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(tx.Handle), "@"))
		if existingBz := cacheStore.Get(handleRegistryKey(cleanHandle)); len(existingBz) > 0 {
			var existing HandleRecord
			if json.Unmarshal(existingBz, &existing) == nil && existing.Owner != tx.Sender && existing.ExpiresAt > now {
				return fmt.Errorf("handle @%s is already leased by %s until %d", cleanHandle, existing.Owner, existing.ExpiresAt)
			}
		}
		burnedAmt, _, err := app.burnPercentOfSpend(cacheStore, tx.Sender, issuancetypes.CommunityPoolName, true, amt, issuancetypes.HandleBurnShareBps)
		if err != nil {
			return fmt.Errorf("handle registration sink failed: %w", err)
		}
		hRec := HandleRecord{
			Handle:      cleanHandle,
			Owner:       tx.Sender,
			ExpiresAt:   now + issuancetypes.HandleRegistrationDurationSec,
			FeePaidUsov: amt.String(),
			BurnedUsov:  burnedAmt.String(),
		}
		hBz, _ := json.Marshal(hRec)
		cacheStore.Set(handleRegistryKey(cleanHandle), hBz)

	case TxTypePayStorageRent:
		amt, _ := math.NewIntFromString(tx.Amount)
		target := issuancetypes.SeederEscrowPoolName
		targetIsMod := true
		if tx.Recipient != "" {
			// Verify target seeder has active collateral bond before direct payout
			sbz := cacheStore.Get(seederBondKey(tx.Recipient))
			if len(sbz) == 0 {
				return fmt.Errorf("storage rent target %s must be a collateral-bonded seeder", tx.Recipient)
			}
			target = tx.Recipient
			targetIsMod = false
		}
		if _, _, err := app.burnPercentOfSpend(cacheStore, tx.Sender, target, targetIsMod, amt, issuancetypes.StorageRentBurnShareBps); err != nil {
			return fmt.Errorf("storage rent burn split failed: %w", err)
		}

	case TxTypeBoostBurn:
		amt, _ := math.NewIntFromString(tx.Amount)
		if _, _, err := app.burnPercentOfSpend(cacheStore, tx.Sender, issuancetypes.FeeCollectorName, true, amt, issuancetypes.BoostBurnShareBps); err != nil {
			return fmt.Errorf("boost burn failed: %w", err)
		}

	default:
		return fmt.Errorf("unsupported transaction type: %s", tx.Type)
	}

	// Invariant check on cacheStore before committing
	curSupply := app.bankKeeper.GetTotalSupply(cacheStore)
	if err := app.issuanceKeeper.VerifySupplyInvariant(cacheStore, curSupply); err != nil {
		return fmt.Errorf("post-tx supply invariant violated: %w", err)
	}

	// Commit state changes atomically
	commit()
	return nil
}

// Commit finalizes the block, increments height, and computes the state root
func (app *SovraApp) Commit() []byte {
	app.mu.Lock()
	defer app.mu.Unlock()

	app.appHash = app.computeStateRoot()

	// Persist height and appHash to store
	heightBz := make([]byte, 8)
	binary.BigEndian.PutUint64(heightBz, uint64(app.height))
	app.store.Set(KeyPrefixHeight, heightBz)
	app.store.Set(KeyPrefixAppHash, app.appHash)

	return app.appHash
}

func (app *SovraApp) validateTx(s store.KVStore, tx SignedTransaction, isDeliverTx bool) error {
	var amt math.Int = math.ZeroInt()
	var fee math.Int = math.ZeroInt()
	if tx.Fee != "" {
		f, ok := math.NewIntFromString(tx.Fee)
		if !ok || f.IsNegative() {
			return fmt.Errorf("invalid transaction fee: %s", tx.Fee)
		}
		fee = f
	}
	params := app.getEconomicParams(s)
	if fee.LT(math.NewInt(params.MinTxFeeUsov)) {
		return fmt.Errorf("transaction fee %s uSOV below protocol minimum %d uSOV", fee, params.MinTxFeeUsov)
	}
	now := app.getBlockTime(s)

	// 1. Transaction Type specific validation
	switch tx.Type {
	case TxTypeSend:
		a, ok := math.NewIntFromString(tx.Amount)
		if !ok || !a.IsPositive() {
			return fmt.Errorf("invalid transaction amount: %s", tx.Amount)
		}
		if tx.Recipient == "" {
			return fmt.Errorf("recipient address required for send")
		}
		amt = a

	case TxTypeBurn:
		a, ok := math.NewIntFromString(tx.Amount)
		if !ok || !a.IsPositive() {
			return fmt.Errorf("invalid transaction amount: %s", tx.Amount)
		}
		amt = a

	case TxTypeStoreCode:
		if tx.WASMBytecodeHex == "" {
			return fmt.Errorf("missing wasm bytecode for store_code")
		}
		bz, err := hex.DecodeString(tx.WASMBytecodeHex)
		if err != nil || len(bz) == 0 {
			return fmt.Errorf("invalid wasm bytecode hex")
		}

	case TxTypeInstantiateContract:
		if tx.CodeID == 0 {
			return fmt.Errorf("invalid code_id for instantiate")
		}
		if tx.Msg == "" {
			return fmt.Errorf("missing instantiate msg")
		}
		if tx.Funds != "" {
			f, ok := math.NewIntFromString(tx.Funds)
			if !ok || f.IsNegative() {
				return fmt.Errorf("invalid attached funds: %s", tx.Funds)
			}
			amt = f
		} else if tx.Amount != "" {
			f, ok := math.NewIntFromString(tx.Amount)
			if ok && f.IsPositive() {
				amt = f
			}
		}

	case TxTypeExecuteContract:
		if tx.Contract == "" {
			return fmt.Errorf("contract address required for execute")
		}
		if tx.Msg == "" {
			return fmt.Errorf("missing execute msg")
		}
		if tx.Funds != "" {
			f, ok := math.NewIntFromString(tx.Funds)
			if !ok || f.IsNegative() {
				return fmt.Errorf("invalid attached funds: %s", tx.Funds)
			}
			amt = f
		} else if tx.Amount != "" {
			f, ok := math.NewIntFromString(tx.Amount)
			if ok && f.IsPositive() {
				amt = f
			}
		}

	case TxTypeDelegate:
		a, ok := math.NewIntFromString(tx.Amount)
		if !ok || !a.IsPositive() {
			return fmt.Errorf("invalid delegation amount: %s", tx.Amount)
		}
		if _, _, _, err := ResolveLockTier(tx.LockDays); err != nil {
			return err
		}
		val := tx.Validator
		if val == "" {
			val = tx.Recipient
		}
		if val == "" {
			return fmt.Errorf("validator address required for delegation")
		}
		amt = a

	case TxTypeUndelegate:
		a, ok := math.NewIntFromString(tx.Amount)
		if !ok || !a.IsPositive() {
			return fmt.Errorf("invalid undelegation amount: %s", tx.Amount)
		}
		val := tx.Validator
		if val == "" {
			val = tx.Recipient
		}
		if val == "" {
			return fmt.Errorf("validator address required for undelegation")
		}
		curDel := app.GetDelegation(s, tx.Sender, val)
		if curDel.LT(a) {
			return fmt.Errorf("insufficient delegated balance: have %s, requested %s", curDel, a)
		}
		if existingBz := s.Get(delegationRecKey(tx.Sender, val)); len(existingBz) > 0 {
			var existing DelegationRecord
			if json.Unmarshal(existingBz, &existing) == nil && existing.UnlockAt > now {
				return fmt.Errorf("delegation locked until %d (current time %d)", existing.UnlockAt, now)
			}
		}

	case TxTypeBondSeeder:
		a, ok := math.NewIntFromString(tx.Amount)
		if !ok || !a.IsPositive() {
			return fmt.Errorf("invalid seeder bond amount: %s", tx.Amount)
		}
		existingBonded := math.ZeroInt()
		if bz := s.Get(seederBondKey(tx.Sender)); len(bz) > 0 {
			var existing SeederBondRecord
			if json.Unmarshal(bz, &existing) == nil {
				existingBonded, _ = math.NewIntFromString(existing.BondedUsov)
			}
		}
		totalAfter := existingBonded.Add(a)
		required := math.NewInt(issuancetypes.MinSeederBondUsov)
		if tx.StorageGb > 0 {
			capReq := math.NewInt(int64(tx.StorageGb)).Mul(math.NewInt(issuancetypes.MinSeederBondPerGbUsov))
			if capReq.GT(required) {
				required = capReq
			}
		}
		if totalAfter.LT(required) {
			return fmt.Errorf("seeder bond %s uSOV below minimum collateral requirement %s uSOV", totalAfter, required)
		}
		amt = a

	case TxTypeUnbondSeeder:
		a, ok := math.NewIntFromString(tx.Amount)
		if !ok || !a.IsPositive() {
			return fmt.Errorf("invalid seeder unbond amount: %s", tx.Amount)
		}
		bz := s.Get(seederBondKey(tx.Sender))
		if len(bz) == 0 {
			return fmt.Errorf("no active seeder bond found")
		}
		var rec SeederBondRecord
		if err := json.Unmarshal(bz, &rec); err != nil {
			return err
		}
		bonded, _ := math.NewIntFromString(rec.BondedUsov)
		if bonded.LT(a) {
			return fmt.Errorf("insufficient seeder bond: have %s, want %s", bonded, a)
		}

	case TxTypePatronStake:
		a, ok := math.NewIntFromString(tx.Amount)
		if !ok || !a.IsPositive() {
			return fmt.Errorf("invalid patron stake amount: %s", tx.Amount)
		}
		creator := tx.Creator
		if creator == "" {
			creator = tx.Recipient
		}
		if creator == "" {
			return fmt.Errorf("creator address required for patron_stake")
		}
		if _, _, _, err := ResolveLockTier(tx.LockDays); err != nil {
			return err
		}
		amt = a

	case TxTypePatronUnstake:
		a, ok := math.NewIntFromString(tx.Amount)
		if !ok || !a.IsPositive() {
			return fmt.Errorf("invalid patron unstake amount: %s", tx.Amount)
		}
		creator := tx.Creator
		if creator == "" {
			creator = tx.Recipient
		}
		if creator == "" {
			return fmt.Errorf("creator address required for patron_unstake")
		}
		bz := s.Get(patronStakeKey(tx.Sender, creator))
		if len(bz) == 0 {
			return fmt.Errorf("no active patron stake found")
		}
		var rec PatronStakeRecord
		if err := json.Unmarshal(bz, &rec); err != nil {
			return err
		}
		if rec.UnlockAt > now {
			return fmt.Errorf("patron stake locked until %d (current time %d)", rec.UnlockAt, now)
		}
		cur, _ := math.NewIntFromString(rec.AmountUsov)
		if cur.LT(a) {
			return fmt.Errorf("insufficient patron stake: have %s, requested %s", cur, a)
		}

	case TxTypeClaimRewards:
		// No extra principal amount required beyond minimum gas fee

	case TxTypeRegisterHandle:
		a, ok := math.NewIntFromString(tx.Amount)
		if !ok || a.LT(math.NewInt(issuancetypes.HandleRegistrationMinFeeUsov)) {
			return fmt.Errorf("handle registration requires >= %d uSOV", issuancetypes.HandleRegistrationMinFeeUsov)
		}
		cleanHandle := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(tx.Handle), "@"))
		if !validHandleRegex.MatchString(cleanHandle) {
			return fmt.Errorf("invalid handle %q: must match 3-32 lowercase alphanumeric/underscore", tx.Handle)
		}
		if existingBz := s.Get(handleRegistryKey(cleanHandle)); len(existingBz) > 0 {
			var existing HandleRecord
			if json.Unmarshal(existingBz, &existing) == nil && existing.Owner != tx.Sender && existing.ExpiresAt > now {
				return fmt.Errorf("handle @%s already registered until %d", cleanHandle, existing.ExpiresAt)
			}
		}
		amt = a

	case TxTypePayStorageRent:
		a, ok := math.NewIntFromString(tx.Amount)
		if !ok || !a.IsPositive() {
			return fmt.Errorf("invalid storage rent amount")
		}
		gb := tx.StorageGb
		if gb == 0 {
			gb = 1
		}
		months := tx.DurationMonths
		if months == 0 {
			months = 1
		}
		minRent := math.NewInt(int64(gb * months)).Mul(math.NewInt(issuancetypes.StorageRentMinUsovPerGbMonth))
		if a.LT(minRent) {
			return fmt.Errorf("storage rent %s uSOV below minimum %s uSOV for %dGB x %dm", a, minRent, gb, months)
		}
		if tx.Recipient != "" && len(s.Get(seederBondKey(tx.Recipient))) == 0 {
			return fmt.Errorf("storage rent recipient %s must be a bonded seeder", tx.Recipient)
		}
		amt = a

	case TxTypeBoostBurn:
		a, ok := math.NewIntFromString(tx.Amount)
		if !ok || !a.IsPositive() {
			return fmt.Errorf("invalid boost burn amount")
		}
		amt = a

	default:
		return fmt.Errorf("unsupported transaction type: %s", tx.Type)
	}

	// 2. Validate cryptographic signature
	pubKeyBz, err := hex.DecodeString(tx.PubKeyHex)
	if err != nil || len(pubKeyBz) != ed25519.PublicKeySize {
		return fmt.Errorf("invalid public key hex")
	}
	sigBz, err := hex.DecodeString(tx.SigHex)
	if err != nil || len(sigBz) != ed25519.SignatureSize {
		return fmt.Errorf("invalid signature hex")
	}

	derivedAddr := auth.ComputeAddressFromPubKey(pubKeyBz)
	if derivedAddr != tx.Sender {
		return fmt.Errorf("public key does not match sender address: %s != %s", derivedAddr, tx.Sender)
	}

	signBytes := tx.GetSignBytes()
	if !auth.VerifySignature(pubKeyBz, signBytes, sigBz) {
		return fmt.Errorf("cryptographic signature verification failed")
	}

	// 3. Replay Protection: Check Nonce
	expectedNonce := app.authKeeper.GetNonce(s, tx.Sender)
	if tx.Nonce != expectedNonce {
		return fmt.Errorf("account sequence mismatch: expected %d, got %d", expectedNonce, tx.Nonce)
	}

	// 4. Verify spendable balance (excluding locked cliff/linear vesting tokens) covers amount (or attached funds) + fee
	totalRequired := amt.Add(fee)
	spendableBal := app.getSpendableBalance(s, tx.Sender, now)
	if spendableBal.LT(totalRequired) {
		return fmt.Errorf("insufficient spendable funds (after vesting lock): spendable %s < required %s", spendableBal, totalRequired)
	}

	// Only in DeliverTx do we mutate the nonce
	if isDeliverTx {
		app.authKeeper.IncrementNonce(s, tx.Sender)
	}

	return nil
}

func (app *SovraApp) computeStateRoot() []byte {
	// Deterministic state root hash
	h := sha256.New()
	supply := app.bankKeeper.GetTotalSupply(app.store).String()
	minted := app.issuanceKeeper.GetLifetimeMinted(app.store).String()
	burned := app.issuanceKeeper.GetLifetimeBurned(app.store).String()

	h.Write([]byte(fmt.Sprintf("%d:%s:%s:%s", app.height, supply, minted, burned)))
	return h.Sum(nil)
}

// ComputeCandidateAppHash calculates candidate state root for a proposal without committing
func (app *SovraApp) ComputeCandidateAppHash(height int64) []byte {
	app.mu.RLock()
	defer app.mu.RUnlock()

	h := sha256.New()
	supply := app.bankKeeper.GetTotalSupply(app.store).String()
	minted := app.issuanceKeeper.GetLifetimeMinted(app.store).String()
	burned := app.issuanceKeeper.GetLifetimeBurned(app.store).String()

	h.Write([]byte(fmt.Sprintf("%d:%s:%s:%s", height, supply, minted, burned)))
	return h.Sum(nil)
}

// Read-only Queries
func (app *SovraApp) QueryBalance(addr string) math.Int {
	app.mu.RLock()
	defer app.mu.RUnlock()
	return app.bankKeeper.GetBalance(app.store, addr)
}

func (app *SovraApp) QueryTotalSupply() math.Int {
	app.mu.RLock()
	defer app.mu.RUnlock()
	return app.bankKeeper.GetTotalSupply(app.store)
}

func (app *SovraApp) QueryLifetimeMinted() math.Int {
	app.mu.RLock()
	defer app.mu.RUnlock()
	return app.issuanceKeeper.GetLifetimeMinted(app.store)
}

func (app *SovraApp) QueryLifetimeBurned() math.Int {
	app.mu.RLock()
	defer app.mu.RUnlock()
	return app.issuanceKeeper.GetLifetimeBurned(app.store)
}

func (app *SovraApp) QueryNonce(addr string) uint64 {
	app.mu.RLock()
	defer app.mu.RUnlock()
	return app.authKeeper.GetNonce(app.store, addr)
}

func (app *SovraApp) GetHeight() int64 {
	app.mu.RLock()
	defer app.mu.RUnlock()
	return app.height
}

func (app *SovraApp) GetAppHash() []byte {
	app.mu.RLock()
	defer app.mu.RUnlock()
	return app.appHash
}

func (app *SovraApp) GetLastInstantiatedContract() string {
	app.mu.RLock()
	defer app.mu.RUnlock()
	return app.lastInstantiatedContract
}

// IsChainInitialized returns true if the chain has executed InitChain in this store
func (app *SovraApp) IsChainInitialized() bool {
	app.mu.RLock()
	defer app.mu.RUnlock()
	bz := app.store.Get(KeyPrefixInitialized)
	return len(bz) > 0 && bz[0] == 0x01
}

// LoadLastState checks if store has an existing initialized chain and restores height, appHash, chainID, genesisTime
func (app *SovraApp) LoadLastState() (int64, []byte, error) {
	app.mu.Lock()
	defer app.mu.Unlock()

	heightBz := app.store.Get(KeyPrefixHeight)
	if len(heightBz) >= 8 {
		app.height = int64(binary.BigEndian.Uint64(heightBz))
	}

	appHash := app.store.Get(KeyPrefixAppHash)
	if len(appHash) > 0 {
		app.appHash = appHash
	}

	chainID := app.store.Get(KeyPrefixChainID)
	if len(chainID) > 0 {
		app.chainID = string(chainID)
	}

	genTimeBz := app.store.Get(KeyPrefixGenesisTime)
	if len(genTimeBz) >= 8 {
		app.genesisTime = int64(binary.BigEndian.Uint64(genTimeBz))
	}

	valBz := app.store.Get(KeyPrefixValidators)
	if len(valBz) > 0 {
		var vals []GenesisValidator
		if err := json.Unmarshal(valBz, &vals); err == nil {
			app.validators = vals
		}
	}

	return app.height, app.appHash, nil
}

// SaveBlock stores serialized block data under block height key
func (app *SovraApp) SaveBlock(height int64, data []byte) {
	app.mu.Lock()
	defer app.mu.Unlock()
	app.store.Set(BlockKey(height), data)
}

// HealIncompleteBlock detects if KeyPrefixHeight advanced ahead of persisted BlockKey(height)
// (e.g. ungraceful termination between Commit and SaveBlock) and rolls height back by 1.
func (app *SovraApp) HealIncompleteBlock() (int64, bool) {
	app.mu.Lock()
	defer app.mu.Unlock()
	if app.height > 1 && len(app.store.Get(BlockKey(app.height))) == 0 && len(app.store.Get(BlockKey(app.height-1))) > 0 {
		app.height = app.height - 1
		heightBz := make([]byte, 8)
		binary.BigEndian.PutUint64(heightBz, uint64(app.height))
		app.store.Set(KeyPrefixHeight, heightBz)
		app.appHash = app.computeStateRoot()
		app.store.Set(KeyPrefixAppHash, app.appHash)
		return app.height, true
	}
	return app.height, false
}

// GetBlock retrieves serialized block data for a given height
func (app *SovraApp) GetBlock(height int64) []byte {
	app.mu.RLock()
	defer app.mu.RUnlock()
	return app.store.Get(BlockKey(height))
}

// GetValidators returns a copy of current active consensus validators
func (app *SovraApp) GetValidators() []GenesisValidator {
	app.mu.RLock()
	defer app.mu.RUnlock()
	res := make([]GenesisValidator, len(app.validators))
	copy(res, app.validators)
	return res
}

// RecordValidatorTransition persists an authorized validator set transition
func (app *SovraApp) RecordValidatorTransition(t ValidatorSetTransition) error {
	app.mu.Lock()
	defer app.mu.Unlock()

	app.validators = t.NewValidators
	valBz, err := json.Marshal(app.validators)
	if err != nil {
		return fmt.Errorf("failed to marshal new validators: %w", err)
	}
	app.store.Set(KeyPrefixValidators, valBz)

	var transitions []ValidatorSetTransition
	transBz := app.store.Get(KeyPrefixValidatorTransitions)
	if len(transBz) > 0 {
		_ = json.Unmarshal(transBz, &transitions)
	}
	transitions = append(transitions, t)
	newTransBz, err := json.Marshal(transitions)
	if err != nil {
		return fmt.Errorf("failed to marshal validator transitions: %w", err)
	}
	app.store.Set(KeyPrefixValidatorTransitions, newTransBz)
	return nil
}

// GetValidatorTransitions returns all recorded validator transitions
func (app *SovraApp) GetValidatorTransitions() []ValidatorSetTransition {
	app.mu.RLock()
	defer app.mu.RUnlock()

	transBz := app.store.Get(KeyPrefixValidatorTransitions)
	if len(transBz) == 0 {
		return nil
	}
	var transitions []ValidatorSetTransition
	_ = json.Unmarshal(transBz, &transitions)
	return transitions
}

// CosmWasm Queries
func (app *SovraApp) QueryWasmSmart(contractAddr string, queryBz []byte) ([]byte, error) {
	app.mu.RLock()
	defer app.mu.RUnlock()
	env := wasmtypes.Env{
		Block: wasmtypes.BlockInfo{
			Height:  app.height,
			Time:    time.Now().Unix(),
			ChainID: app.chainID,
		},
		Contract: wasmtypes.ContractInfoSummary{
			Address: contractAddr,
		},
	}
	return app.wasmKeeper.QuerySmartContract(app.store, contractAddr, queryBz, env)
}

func (app *SovraApp) QueryWasmContractInfo(contractAddr string) (*wasmtypes.ContractInfo, error) {
	app.mu.RLock()
	defer app.mu.RUnlock()
	return app.wasmKeeper.GetContractInfo(app.store, contractAddr)
}

func (app *SovraApp) QueryWasmCode(codeID uint64) (*wasmtypes.CodeInfo, error) {
	app.mu.RLock()
	defer app.mu.RUnlock()
	return app.wasmKeeper.GetCode(app.store, codeID)
}

func (app *SovraApp) WasmKeeper() *wasmkeeper.Keeper {
	return app.wasmKeeper
}

// Delegation & PoS Staking Methods
func (app *SovraApp) GetDelegation(s store.KVStore, delegator, validator string) math.Int {
	bz := s.Get(DelegationKey(delegator, validator))
	if len(bz) == 0 {
		return math.ZeroInt()
	}
	var val math.Int
	if err := val.Unmarshal(bz); err != nil {
		return math.ZeroInt()
	}
	return val
}

func (app *SovraApp) SetDelegation(s store.KVStore, delegator, validator string, amt math.Int) {
	bz, err := amt.Marshal()
	if err != nil {
		panic(err)
	}
	s.Set(DelegationKey(delegator, validator), bz)
}

// ExportGenesis dumps the current persistent chain state as GenesisState
func (app *SovraApp) ExportGenesis() (GenesisState, error) {
	app.mu.RLock()
	defer app.mu.RUnlock()

	accounts := make(map[string]string)
	iter := app.store.Iterator(bank.KeyPrefixBalance)
	defer iter.Close()
	for ; iter.Valid(); iter.Next() {
		rawKey := iter.Key()
		if len(rawKey) <= 1 {
			continue
		}
		addr := string(rawKey[1:])
		var val math.Int
		if err := val.Unmarshal(iter.Value()); err == nil && val.IsPositive() {
			accounts[addr] = val.String()
		}
	}

	return GenesisState{
		ChainID:     app.chainID,
		GenesisTime: app.genesisTime,
		Accounts:    accounts,
		Validators:  app.validators,
	}, nil
}

// Validator Signing Info & Slashing
func (app *SovraApp) GetValidatorSigningInfo(validator string) ValidatorSigningInfo {
	app.mu.RLock()
	defer app.mu.RUnlock()

	bz := app.store.Get(SigningInfoKey(validator))
	if len(bz) == 0 {
		return ValidatorSigningInfo{Address: validator}
	}
	var info ValidatorSigningInfo
	if err := json.Unmarshal(bz, &info); err != nil {
		return ValidatorSigningInfo{Address: validator}
	}
	return info
}

func (app *SovraApp) SetValidatorSigningInfo(info ValidatorSigningInfo) error {
	app.mu.Lock()
	defer app.mu.Unlock()

	bz, err := json.Marshal(info)
	if err != nil {
		return err
	}
	app.store.Set(SigningInfoKey(info.Address), bz)
	return nil
}

// SlashValidator slashes a validator's bonded stake or account balance and jails them
func (app *SovraApp) SlashValidator(validatorAddr string, fractionBps int64, jailDurationSeconds int64, misbehavior MisbehaviorType) (math.Int, error) {
	app.mu.Lock()
	defer app.mu.Unlock()

	infoBz := app.store.Get(SigningInfoKey(validatorAddr))
	var info ValidatorSigningInfo
	if len(infoBz) > 0 {
		_ = json.Unmarshal(infoBz, &info)
	}
	info.Address = validatorAddr

	// Determine amount to slash from balance or bonded pool
	balance := app.bankKeeper.GetBalance(app.store, validatorAddr)
	if balance.IsZero() {
		bondedPoolAddr := bank.ModuleAccountAddress("bonded_tokens_pool")
		balance = app.bankKeeper.GetBalance(app.store, bondedPoolAddr)
	}

	// Slashed amount = balance * fractionBps / 10000
	slashAmount := balance.Mul(math.NewInt(fractionBps)).Quo(math.NewInt(10000))
	if slashAmount.IsPositive() {
		if app.bankKeeper.GetBalance(app.store, validatorAddr).GTE(slashAmount) {
			_ = app.bankKeeper.SendCoinsFromAccountToModule(app.store, validatorAddr, issuancetypes.ModuleName, slashAmount)
		} else {
			bondedPoolAddr := bank.ModuleAccountAddress("bonded_tokens_pool")
			if app.bankKeeper.GetBalance(app.store, bondedPoolAddr).GTE(slashAmount) {
				_ = app.bankKeeper.SendCoinsFromModuleToModule(app.store, "bonded_tokens_pool", issuancetypes.ModuleName, slashAmount)
			}
		}
		// Burn slashed tokens to punish Byzantine fault
		burnHandler := func(burner string, burnAmt math.Int) error {
			return app.bankKeeper.BurnCoins(app.store, issuancetypes.ModuleName, burnAmt)
		}
		_ = app.issuanceKeeper.ExecuteBurn(app.store, issuancetypes.ModuleName, slashAmount, burnHandler)
	}

	now := time.Now().Unix()
	info.JailedUntil = now + jailDurationSeconds
	if misbehavior == MisbehaviorDoubleSign {
		info.Tombstoned = true
	}

	bz, _ := json.Marshal(info)
	app.store.Set(SigningInfoKey(validatorAddr), bz)

	return slashAmount, nil
}

// IsValidatorJailed returns true if the validator is currently jailed or tombstoned
func (app *SovraApp) IsValidatorJailed(validatorAddr string, currentTime int64) bool {
	info := app.GetValidatorSigningInfo(validatorAddr)
	if info.Tombstoned {
		return true
	}
	return info.JailedUntil > currentTime
}

// UnjailValidator clears the jail status if jail duration has passed and validator is not tombstoned
func (app *SovraApp) UnjailValidator(validatorAddr string, currentTime int64) error {
	app.mu.Lock()
	defer app.mu.Unlock()

	infoBz := app.store.Get(SigningInfoKey(validatorAddr))
	if len(infoBz) == 0 {
		return fmt.Errorf("validator %s signing info not found", validatorAddr)
	}
	var info ValidatorSigningInfo
	if err := json.Unmarshal(infoBz, &info); err != nil {
		return err
	}

	if info.Tombstoned {
		return fmt.Errorf("validator %s is permanently tombstoned for double-signing", validatorAddr)
	}
	if info.JailedUntil > currentTime {
		return fmt.Errorf("validator %s jail time not expired yet: remaining %d seconds", validatorAddr, info.JailedUntil-currentTime)
	}

	info.JailedUntil = 0
	info.MissedBlocksCounter = 0
	bz, _ := json.Marshal(info)
	app.store.Set(SigningInfoKey(validatorAddr), bz)
	return nil
}

// RecordValidatorBlockActivity tracks liveness and triggers slashing if downtime threshold exceeded
func (app *SovraApp) RecordValidatorBlockActivity(validatorAddr string, signed bool, currentTime int64, maxMissedBlocks int64) (bool, error) {
	app.mu.Lock()
	defer app.mu.Unlock()

	infoBz := app.store.Get(SigningInfoKey(validatorAddr))
	var info ValidatorSigningInfo
	if len(infoBz) > 0 {
		_ = json.Unmarshal(infoBz, &info)
	}
	info.Address = validatorAddr

	if info.Tombstoned || info.JailedUntil > currentTime {
		return false, nil // already jailed
	}

	if signed {
		if info.MissedBlocksCounter > 0 {
			info.MissedBlocksCounter--
		}
		bz, _ := json.Marshal(info)
		app.store.Set(SigningInfoKey(validatorAddr), bz)
		return false, nil
	}

	// Missed block
	info.MissedBlocksCounter++
	if info.MissedBlocksCounter >= maxMissedBlocks {
		// Slash 1% (100 bps) and jail for 10 minutes (600s)
		info.JailedUntil = currentTime + 600
		bz, _ := json.Marshal(info)
		app.store.Set(SigningInfoKey(validatorAddr), bz)
		return true, nil
	}

	bz, _ := json.Marshal(info)
	app.store.Set(SigningInfoKey(validatorAddr), bz)
	return false, nil
}


