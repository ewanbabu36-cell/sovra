package node

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"cosmossdk.io/math"
	"github.com/sovra/chain/store"
	"github.com/sovra/chain/x/bank"
	issuancetypes "github.com/sovra/chain/x/issuance/types"
)

// Dedicated KVStore prefixes (0x50..0x6F) avoiding all existing bank/auth/issuance/wasm keys.
var (
	KeyEconomicParams       = []byte{0x50}
	KeyLastBlockTime        = []byte{0x51}
	KeySecurityCouncil      = []byte{0x52}
	KeyUnbondingSeq         = []byte{0x53}
	KeyPrefixVesting        = []byte{0x54}
	KeyPrefixDelegationRec  = []byte{0x55}
	KeyPrefixUnbonding      = []byte{0x56}
	KeyPrefixSeederBond     = []byte{0x57}
	KeyPrefixPatronStake    = []byte{0x58}
	KeyPrefixClaimableRew   = []byte{0x59}
	KeyPrefixHandle         = []byte{0x5A}
	KeyPrefixStorageRentLog = []byte{0x5B}
	KeyPrefixPoolTotals     = []byte{0x5C}
)

var validHandleRegex = regexp.MustCompile(`^[a-z0-9_]{3,32}$`)

func vestingKey(addr string) []byte {
	return append(KeyPrefixVesting, []byte(addr)...)
}

func delegationRecKey(delegator, validator string) []byte {
	return append(KeyPrefixDelegationRec, []byte(delegator+":"+validator)...)
}

func seederBondKey(addr string) []byte {
	return append(KeyPrefixSeederBond, []byte(addr)...)
}

func patronStakeKey(fan, creator string) []byte {
	return append(KeyPrefixPatronStake, []byte(fan+":"+creator)...)
}

func claimableRewardKey(addr string) []byte {
	return append(KeyPrefixClaimableRew, []byte(addr)...)
}

func handleRegistryKey(handle string) []byte {
	return append(KeyPrefixHandle, []byte(strings.ToLower(strings.TrimPrefix(strings.TrimSpace(handle), "@")))...)
}

func poolTotalKey(name string) []byte {
	return append(KeyPrefixPoolTotals, []byte(name)...)
}

func DefaultEconomicParams() EconomicParams {
	return EconomicParams{
		MinTxFeeUsov:           issuancetypes.DefaultMinTxFeeUsov,
		FeeBurnBps:             issuancetypes.DefaultFeeBurnBps,
		UnbondingPeriodSeconds: issuancetypes.DefaultUnbondingPeriodSeconds,
	}
}

// ResolveLockTier validates requested veSOV lock days and returns (tierName, lockSeconds, multiplierBps).
func ResolveLockTier(lockDays int64) (string, int64, int64, error) {
	switch lockDays {
	case 0:
		return "flexible", 0, 10000, nil // 1.0x
	case 90:
		return "90d", 90 * 86400, 15000, nil // 1.5x
	case 365:
		return "365d", 365 * 86400, 25000, nil // 2.5x
	case 730:
		return "730d", 730 * 86400, 30000, nil // 3.0x
	default:
		return "", 0, 0, fmt.Errorf("unsupported lock_days %d (allowed: 0=flexible, 90=1.5x, 365=2.5x, 730=3.0x)", lockDays)
	}
}

func (app *SovraApp) getEconomicParams(s store.KVStore) EconomicParams {
	bz := s.Get(KeyEconomicParams)
	if len(bz) == 0 {
		return DefaultEconomicParams()
	}
	var p EconomicParams
	if err := json.Unmarshal(bz, &p); err != nil {
		return DefaultEconomicParams()
	}
	if p.MinTxFeeUsov <= 0 {
		p.MinTxFeeUsov = issuancetypes.DefaultMinTxFeeUsov
	}
	if p.FeeBurnBps < issuancetypes.MinFeeBurnBps || p.FeeBurnBps > issuancetypes.MaxFeeBurnBps {
		p.FeeBurnBps = issuancetypes.DefaultFeeBurnBps
	}
	if p.UnbondingPeriodSeconds < issuancetypes.MinUnbondingPeriodSeconds || p.UnbondingPeriodSeconds > issuancetypes.MaxUnbondingPeriodSeconds {
		p.UnbondingPeriodSeconds = issuancetypes.DefaultUnbondingPeriodSeconds
	}
	return p
}

func (app *SovraApp) setEconomicParams(s store.KVStore, p EconomicParams) {
	if p.MinTxFeeUsov <= 0 {
		p.MinTxFeeUsov = issuancetypes.DefaultMinTxFeeUsov
	}
	if p.FeeBurnBps < issuancetypes.MinFeeBurnBps || p.FeeBurnBps > issuancetypes.MaxFeeBurnBps {
		p.FeeBurnBps = issuancetypes.DefaultFeeBurnBps
	}
	if p.UnbondingPeriodSeconds < issuancetypes.MinUnbondingPeriodSeconds || p.UnbondingPeriodSeconds > issuancetypes.MaxUnbondingPeriodSeconds {
		p.UnbondingPeriodSeconds = issuancetypes.DefaultUnbondingPeriodSeconds
	}
	bz, _ := json.Marshal(p)
	s.Set(KeyEconomicParams, bz)
}

func (app *SovraApp) getBlockTime(s store.KVStore) int64 {
	bz := s.Get(KeyLastBlockTime)
	if len(bz) >= 8 {
		return int64(binary.BigEndian.Uint64(bz))
	}
	if app.genesisTime > 0 {
		return app.genesisTime
	}
	return time.Now().Unix()
}

func (app *SovraApp) setBlockTime(s store.KVStore, t int64) {
	bz := make([]byte, 8)
	binary.BigEndian.PutUint64(bz, uint64(t))
	s.Set(KeyLastBlockTime, bz)
}

func (app *SovraApp) getPoolTotal(s store.KVStore, name string) math.Int {
	bz := s.Get(poolTotalKey(name))
	if len(bz) == 0 {
		return math.ZeroInt()
	}
	var val math.Int
	if err := val.Unmarshal(bz); err != nil {
		return math.ZeroInt()
	}
	return val
}

func (app *SovraApp) setPoolTotal(s store.KVStore, name string, amt math.Int) {
	if amt.IsNegative() {
		amt = math.ZeroInt()
	}
	bz, _ := amt.Marshal()
	s.Set(poolTotalKey(name), bz)
}

func (app *SovraApp) addPoolTotal(s store.KVStore, name string, delta math.Int) {
	cur := app.getPoolTotal(s, name)
	app.setPoolTotal(s, name, cur.Add(delta))
}

func (app *SovraApp) subPoolTotal(s store.KVStore, name string, delta math.Int) {
	cur := app.getPoolTotal(s, name)
	if delta.GTE(cur) {
		app.setPoolTotal(s, name, math.ZeroInt())
		return
	}
	app.setPoolTotal(s, name, cur.Sub(delta))
}

// CalculateVestingLocked returns unvested uSOV locked for a schedule at unix timestamp now.
func CalculateVestingLocked(sched VestingSchedule, now int64) math.Int {
	orig, ok := math.NewIntFromString(sched.OriginalAmount)
	if !ok || !orig.IsPositive() {
		return math.ZeroInt()
	}
	if now < sched.CliffTime {
		return orig
	}
	if sched.EndTime <= sched.CliffTime || now >= sched.EndTime {
		return math.ZeroInt()
	}
	elapsed := now - sched.CliffTime
	duration := sched.EndTime - sched.CliffTime
	vested := orig.Mul(math.NewInt(elapsed)).Quo(math.NewInt(duration))
	if vested.GT(orig) {
		return math.ZeroInt()
	}
	return orig.Sub(vested)
}

func (app *SovraApp) getVestingLocked(s store.KVStore, addr string, now int64) math.Int {
	bz := s.Get(vestingKey(addr))
	if len(bz) == 0 {
		return math.ZeroInt()
	}
	var sched VestingSchedule
	if err := json.Unmarshal(bz, &sched); err != nil {
		return math.ZeroInt()
	}
	return CalculateVestingLocked(sched, now)
}

// addRollingRewardVesting merges newly locked emission/yield rewards into a rolling linear vesting lock.
func (app *SovraApp) addRollingRewardVesting(s store.KVStore, addr string, newlyLocked math.Int, now, durationSec int64, label string) {
	if !newlyLocked.IsPositive() || durationSec <= 0 {
		return
	}
	existingLocked := app.getVestingLocked(s, addr, now)
	newTotalLocked := existingLocked.Add(newlyLocked)
	cliffTime := now
	endTime := now + durationSec
	if existingBz := s.Get(vestingKey(addr)); len(existingBz) > 0 {
		var existing VestingSchedule
		if json.Unmarshal(existingBz, &existing) == nil {
			if existing.CliffTime > cliffTime {
				cliffTime = existing.CliffTime
			}
			if existing.EndTime > endTime {
				endTime = existing.EndTime
			}
		}
	}
	sched := VestingSchedule{
		Address:        addr,
		OriginalAmount: newTotalLocked.String(),
		StartTime:      now,
		CliffTime:      cliffTime,
		EndTime:        endTime,
		Label:          label,
	}
	sbz, _ := json.Marshal(sched)
	s.Set(vestingKey(addr), sbz)
}

func (app *SovraApp) getSpendableBalance(s store.KVStore, addr string, now int64) math.Int {
	bal := app.bankKeeper.GetBalance(s, addr)
	locked := app.getVestingLocked(s, addr, now)
	if locked.IsZero() {
		return bal
	}
	if bal.LTE(locked) {
		return math.ZeroInt()
	}
	return bal.Sub(locked)
}

func (app *SovraApp) getClaimableReward(s store.KVStore, addr string) math.Int {
	bz := s.Get(claimableRewardKey(addr))
	if len(bz) == 0 {
		return math.ZeroInt()
	}
	var val math.Int
	if err := val.Unmarshal(bz); err != nil {
		return math.ZeroInt()
	}
	return val
}

func (app *SovraApp) setClaimableReward(s store.KVStore, addr string, amt math.Int) {
	if amt.IsNegative() {
		amt = math.ZeroInt()
	}
	bz, _ := amt.Marshal()
	s.Set(claimableRewardKey(addr), bz)
}

// applyProtocolFee debits fee from sender, burns FeeBurnBps% via ExecuteBurn, and credits remainder to fee_collector.
func (app *SovraApp) applyProtocolFee(s store.KVStore, sender string, fee math.Int) (burned math.Int, validatorYield math.Int, err error) {
	if !fee.IsPositive() {
		return math.ZeroInt(), math.ZeroInt(), fmt.Errorf("transaction fee must be positive")
	}
	params := app.getEconomicParams(s)
	burnAmt := fee.Mul(math.NewInt(params.FeeBurnBps)).Quo(math.NewInt(10000))
	yieldAmt := fee.Sub(burnAmt)

	if yieldAmt.IsPositive() {
		if err := app.bankKeeper.SendCoinsFromAccountToModule(s, sender, issuancetypes.FeeCollectorName, yieldAmt); err != nil {
			return math.ZeroInt(), math.ZeroInt(), fmt.Errorf("fee collector deduction failed: %w", err)
		}
	}

	if burnAmt.IsPositive() {
		burnHandler := func(burner string, amt math.Int) error {
			if err := app.bankKeeper.SendCoinsFromAccountToModule(s, burner, issuancetypes.ModuleName, amt); err != nil {
				return err
			}
			return app.bankKeeper.BurnCoins(s, issuancetypes.ModuleName, amt)
		}
		if err := app.issuanceKeeper.ExecuteBurn(s, sender, burnAmt, burnHandler); err != nil {
			return math.ZeroInt(), math.ZeroInt(), fmt.Errorf("eip1559 fee burn failed: %w", err)
		}
	}
	return burnAmt, yieldAmt, nil
}

// burnPercentOfSpend splits a paid utility spend: burnShareBps permanently burned, remainder sent to target module/account.
func (app *SovraApp) burnPercentOfSpend(s store.KVStore, sender, target string, targetIsModule bool, total math.Int, burnShareBps int64) (math.Int, math.Int, error) {
	burnAmt := total.Mul(math.NewInt(burnShareBps)).Quo(math.NewInt(10000))
	remAmt := total.Sub(burnAmt)

	if burnAmt.IsPositive() {
		burnHandler := func(burner string, amt math.Int) error {
			if err := app.bankKeeper.SendCoinsFromAccountToModule(s, burner, issuancetypes.ModuleName, amt); err != nil {
				return err
			}
			return app.bankKeeper.BurnCoins(s, issuancetypes.ModuleName, amt)
		}
		if err := app.issuanceKeeper.ExecuteBurn(s, sender, burnAmt, burnHandler); err != nil {
			return math.ZeroInt(), math.ZeroInt(), err
		}
	}
	if remAmt.IsPositive() {
		if targetIsModule {
			if err := app.bankKeeper.SendCoinsFromAccountToModule(s, sender, target, remAmt); err != nil {
				return math.ZeroInt(), math.ZeroInt(), err
			}
		} else {
			if err := app.bankKeeper.SendCoins(s, sender, target, remAmt); err != nil {
				return math.ZeroInt(), math.ZeroInt(), err
			}
		}
	}
	return burnAmt, remAmt, nil
}

func (app *SovraApp) enqueueUnbonding(s store.KVStore, owner, target, poolKind string, amt math.Int, now, completionTime int64) UnbondingEntry {
	var seq uint64 = 1
	seqBz := s.Get(KeyUnbondingSeq)
	if len(seqBz) >= 8 {
		seq = binary.BigEndian.Uint64(seqBz) + 1
	}
	newSeqBz := make([]byte, 8)
	binary.BigEndian.PutUint64(newSeqBz, seq)
	s.Set(KeyUnbondingSeq, newSeqBz)

	entry := UnbondingEntry{
		ID:             fmt.Sprintf("unbond-%d", seq),
		Owner:          owner,
		Target:         target,
		PoolKind:       poolKind,
		Amount:         amt.String(),
		CreatedAt:      now,
		CompletionTime: completionTime,
	}
	bz, _ := json.Marshal(entry)
	s.Set(append(KeyPrefixUnbonding, newSeqBz...), bz)
	app.addPoolTotal(s, "unbonding", amt)
	return entry
}

// processMaturedUnbondings releases unbonded tokens only after the 14-21 day cooldown finishes.
func (app *SovraApp) processMaturedUnbondings(s store.KVStore, blockTime int64) error {
	iter := s.Iterator(KeyPrefixUnbonding)
	var keysToDelete [][]byte
	var entriesToRelease []UnbondingEntry

	for ; iter.Valid(); iter.Next() {
		var entry UnbondingEntry
		if err := json.Unmarshal(iter.Value(), &entry); err != nil {
			continue
		}
		if blockTime >= entry.CompletionTime {
			keysToDelete = append(keysToDelete, append([]byte(nil), iter.Key()...))
			entriesToRelease = append(entriesToRelease, entry)
		}
	}
	iter.Close()

	for i, entry := range entriesToRelease {
		amt, ok := math.NewIntFromString(entry.Amount)
		if !ok || !amt.IsPositive() {
			s.Delete(keysToDelete[i])
			continue
		}
		if err := app.bankKeeper.SendCoinsFromModuleToAccount(s, issuancetypes.UnbondingTokensPoolName, entry.Owner, amt); err != nil {
			return fmt.Errorf("failed releasing matured unbonding %s: %w", entry.ID, err)
		}
		app.subPoolTotal(s, "unbonding", amt)
		s.Delete(keysToDelete[i])
	}
	return nil
}

// distributeFeeRewards allocates accumulated fee_collector funds pro-rata by veSOV weight & patron stakes.
func (app *SovraApp) distributeFeeRewards(s store.KVStore) error {
	feeCollectorAddr := bank.ModuleAccountAddress(issuancetypes.FeeCollectorName)
	distributable := app.bankKeeper.GetBalance(s, feeCollectorAddr)
	if !distributable.IsPositive() {
		return nil
	}

	type weightRecipient struct {
		beneficiary string
		weight      math.Int
	}
	var weights []weightRecipient
	totalWeight := math.ZeroInt()

	delIter := s.Iterator(KeyPrefixDelegationRec)
	for ; delIter.Valid(); delIter.Next() {
		var rec DelegationRecord
		if err := json.Unmarshal(delIter.Value(), &rec); err != nil {
			continue
		}
		amt, ok := math.NewIntFromString(rec.Amount)
		if !ok || !amt.IsPositive() {
			continue
		}
		eff := amt.Mul(math.NewInt(rec.MultiplierBps)).Quo(math.NewInt(10000))
		if eff.IsPositive() {
			weights = append(weights, weightRecipient{beneficiary: rec.Delegator, weight: eff})
			totalWeight = totalWeight.Add(eff)
		}
	}
	delIter.Close()

	patIter := s.Iterator(KeyPrefixPatronStake)
	for ; patIter.Valid(); patIter.Next() {
		var rec PatronStakeRecord
		if err := json.Unmarshal(patIter.Value(), &rec); err != nil {
			continue
		}
		amt, ok := math.NewIntFromString(rec.AmountUsov)
		if !ok || !amt.IsPositive() {
			continue
		}
		eff := amt.Mul(math.NewInt(rec.MultiplierBps)).Quo(math.NewInt(10000))
		if eff.IsPositive() {
			// Patron yield goes to creator while fan's principal stays intact.
			weights = append(weights, weightRecipient{beneficiary: rec.Creator, weight: eff})
			totalWeight = totalWeight.Add(eff)
		}
	}
	patIter.Close()

	if !totalWeight.IsPositive() || len(weights) == 0 {
		return nil
	}

	distributed := math.ZeroInt()
	for _, w := range weights {
		share := distributable.Mul(w.weight).Quo(totalWeight)
		if share.IsPositive() {
			cur := app.getClaimableReward(s, w.beneficiary)
			app.setClaimableReward(s, w.beneficiary, cur.Add(share))
			distributed = distributed.Add(share)
		}
	}
	if distributed.IsPositive() {
		if err := app.bankKeeper.SendCoinsFromModuleToModule(s, issuancetypes.FeeCollectorName, issuancetypes.RewardYieldPoolName, distributed); err != nil {
			return err
		}
		app.addPoolTotal(s, "reward_pool", distributed)
	}
	return nil
}

// DistributeEpochRewards exposes pro-rata veSOV & Patron Staking reward distribution cleanly.
func (app *SovraApp) DistributeEpochRewards() error {
	app.mu.Lock()
	defer app.mu.Unlock()
	return app.distributeFeeRewards(app.store)
}

// ClaimSeederEpochReward verifies DePIN collateral before releasing seeder rewards from seeder_escrow.
func (app *SovraApp) ClaimSeederEpochReward(seederAddr string, requestedUsov math.Int, porVerified bool) (math.Int, error) {
	app.mu.Lock()
	defer app.mu.Unlock()

	if !porVerified {
		return math.ZeroInt(), fmt.Errorf("seeder PoR verification failed")
	}
	if !requestedUsov.IsPositive() {
		return math.ZeroInt(), fmt.Errorf("requested seeder reward must be positive")
	}

	bz := app.store.Get(seederBondKey(seederAddr))
	if len(bz) == 0 {
		return math.ZeroInt(), fmt.Errorf("stake-to-work enforced: seeder %s has no active collateral bond", seederAddr)
	}
	var rec SeederBondRecord
	if err := json.Unmarshal(bz, &rec); err != nil {
		return math.ZeroInt(), err
	}
	bonded, _ := math.NewIntFromString(rec.BondedUsov)
	required := math.NewInt(issuancetypes.MinSeederBondUsov)
	capReq := math.NewInt(int64(rec.StorageCapacityGb)).Mul(math.NewInt(issuancetypes.MinSeederBondPerGbUsov))
	if capReq.GT(required) {
		required = capReq
	}
	if bonded.LT(required) {
		return math.ZeroInt(), fmt.Errorf("stake-to-work enforced: bonded %s uSOV < required %s uSOV", bonded, required)
	}

	escrowAddr := bank.ModuleAccountAddress(issuancetypes.SeederEscrowPoolName)
	escrowBal := app.bankKeeper.GetBalance(app.store, escrowAddr)
	payout := requestedUsov
	if payout.GT(escrowBal) {
		payout = escrowBal
	}
	if !payout.IsPositive() {
		return math.ZeroInt(), fmt.Errorf("seeder_escrow has insufficient balance")
	}

	if err := app.bankKeeper.SendCoinsFromModuleToAccount(app.store, issuancetypes.SeederEscrowPoolName, seederAddr, payout); err != nil {
		return math.ZeroInt(), err
	}

	rec.PorPassedCount++
	prevEarned, _ := math.NewIntFromString(rec.EarnedRewardsUsov)
	rec.EarnedRewardsUsov = prevEarned.Add(payout).String()
	newBz, _ := json.Marshal(rec)
	app.store.Set(seederBondKey(seederAddr), newBz)

	// Lock 50% of daily Seeder emissions over a 30-day rolling linear vest to prevent immediate sell pressure.
	lockedReward := payout.Mul(math.NewInt(issuancetypes.SeederRewardVestingShareBps)).Quo(math.NewInt(10000))
	if lockedReward.IsPositive() {
		app.addRollingRewardVesting(app.store, seederAddr, lockedReward, app.getBlockTime(app.store), issuancetypes.SeederRewardVestingSeconds, "Seeder Emission Linear Lock (30d)")
	}
	return payout, nil
}

// SlashSeederCollateral permanently burns part of a seeder's locked collateral on PoR failure.
func (app *SovraApp) SlashSeederCollateral(seederAddr string, fractionBps int64, reason string) (math.Int, error) {
	app.mu.Lock()
	defer app.mu.Unlock()

	if fractionBps <= 0 || fractionBps > 10000 {
		return math.ZeroInt(), fmt.Errorf("invalid slash fraction bps: %d", fractionBps)
	}
	bz := app.store.Get(seederBondKey(seederAddr))
	if len(bz) == 0 {
		return math.ZeroInt(), fmt.Errorf("seeder %s has no active collateral bond", seederAddr)
	}
	var rec SeederBondRecord
	if err := json.Unmarshal(bz, &rec); err != nil {
		return math.ZeroInt(), err
	}
	bonded, _ := math.NewIntFromString(rec.BondedUsov)
	slashAmt := bonded.Mul(math.NewInt(fractionBps)).Quo(math.NewInt(10000))
	if !slashAmt.IsPositive() {
		return math.ZeroInt(), nil
	}

	burnHandler := func(burner string, amt math.Int) error {
		if err := app.bankKeeper.SendCoinsFromModuleToModule(app.store, issuancetypes.SeederCollateralPoolName, issuancetypes.ModuleName, amt); err != nil {
			return err
		}
		return app.bankKeeper.BurnCoins(app.store, issuancetypes.ModuleName, amt)
	}
	if err := app.issuanceKeeper.ExecuteBurn(app.store, issuancetypes.SeederCollateralPoolName, slashAmt, burnHandler); err != nil {
		return math.ZeroInt(), err
	}

	rec.BondedUsov = bonded.Sub(slashAmt).String()
	rec.PorFailedCount++
	prevSlashed, _ := math.NewIntFromString(rec.SlashedUsov)
	rec.SlashedUsov = prevSlashed.Add(slashAmt).String()
	newBz, _ := json.Marshal(rec)
	app.store.Set(seederBondKey(seederAddr), newBz)
	app.subPoolTotal(app.store, "seeder_collateral", slashAmt)
	return slashAmt, nil
}

// IsSecurityCouncilActive returns false automatically once SunsetHeight or SunsetTimestamp elapses.
func (app *SovraApp) IsSecurityCouncilActive(height int64, blockTime int64) bool {
	app.mu.RLock()
	defer app.mu.RUnlock()

	bz := app.store.Get(KeySecurityCouncil)
	if len(bz) == 0 {
		return false
	}
	var sc SecurityCouncilGenesis
	if err := json.Unmarshal(bz, &sc); err != nil {
		return false
	}
	if sc.SunsetHeight > 0 && height >= sc.SunsetHeight {
		return false
	}
	if sc.SunsetTimestamp > 0 && blockTime >= sc.SunsetTimestamp {
		return false
	}
	return true
}

func (app *SovraApp) QueryVestingSchedule(addr string, atTime int64) (*VestingSchedule, math.Int, math.Int) {
	app.mu.RLock()
	defer app.mu.RUnlock()
	bz := app.store.Get(vestingKey(addr))
	if len(bz) == 0 {
		bal := app.bankKeeper.GetBalance(app.store, addr)
		return nil, math.ZeroInt(), bal
	}
	var sched VestingSchedule
	if err := json.Unmarshal(bz, &sched); err != nil {
		return nil, math.ZeroInt(), math.ZeroInt()
	}
	if atTime <= 0 {
		atTime = app.getBlockTime(app.store)
	}
	locked := CalculateVestingLocked(sched, atTime)
	bal := app.bankKeeper.GetBalance(app.store, addr)
	spendable := math.ZeroInt()
	if bal.GT(locked) {
		spendable = bal.Sub(locked)
	}
	return &sched, locked, spendable
}

func (app *SovraApp) QueryDelegationRecord(delegator, validator string) *DelegationRecord {
	app.mu.RLock()
	defer app.mu.RUnlock()
	bz := app.store.Get(delegationRecKey(delegator, validator))
	if len(bz) == 0 {
		return nil
	}
	var rec DelegationRecord
	if err := json.Unmarshal(bz, &rec); err != nil {
		return nil
	}
	return &rec
}

func (app *SovraApp) QuerySeederBond(addr string) *SeederBondRecord {
	app.mu.RLock()
	defer app.mu.RUnlock()
	bz := app.store.Get(seederBondKey(addr))
	if len(bz) == 0 {
		return nil
	}
	var rec SeederBondRecord
	if err := json.Unmarshal(bz, &rec); err != nil {
		return nil
	}
	return &rec
}

func (app *SovraApp) QueryPatronStake(fan, creator string) *PatronStakeRecord {
	app.mu.RLock()
	defer app.mu.RUnlock()
	bz := app.store.Get(patronStakeKey(fan, creator))
	if len(bz) == 0 {
		return nil
	}
	var rec PatronStakeRecord
	if err := json.Unmarshal(bz, &rec); err != nil {
		return nil
	}
	return &rec
}

func (app *SovraApp) QueryHandle(handle string) *HandleRecord {
	app.mu.RLock()
	defer app.mu.RUnlock()
	bz := app.store.Get(handleRegistryKey(handle))
	if len(bz) == 0 {
		return nil
	}
	var rec HandleRecord
	if err := json.Unmarshal(bz, &rec); err != nil {
		return nil
	}
	return &rec
}

func (app *SovraApp) QueryClaimableRewards(addr string) math.Int {
	app.mu.RLock()
	defer app.mu.RUnlock()
	return app.getClaimableReward(app.store, addr)
}

func (app *SovraApp) QueryPendingUnbondings(owner string) []UnbondingEntry {
	app.mu.RLock()
	defer app.mu.RUnlock()
	iter := app.store.Iterator(KeyPrefixUnbonding)
	defer iter.Close()
	var list []UnbondingEntry
	for ; iter.Valid(); iter.Next() {
		var e UnbondingEntry
		if err := json.Unmarshal(iter.Value(), &e); err == nil {
			if owner == "" || e.Owner == owner {
				list = append(list, e)
			}
		}
	}
	return list
}

func (app *SovraApp) QueryEconomyStats() EconomyStats {
	app.mu.RLock()
	height := app.height
	chainID := app.chainID
	now := app.getBlockTime(app.store)
	params := app.getEconomicParams(app.store)

	totalSupply := app.bankKeeper.GetTotalSupply(app.store)
	minted := app.issuanceKeeper.GetLifetimeMinted(app.store)
	burned := app.issuanceKeeper.GetLifetimeBurned(app.store)

	bonded := app.bankKeeper.GetBalance(app.store, bank.ModuleAccountAddress(issuancetypes.BondedTokensPoolName))
	unbonding := app.bankKeeper.GetBalance(app.store, bank.ModuleAccountAddress(issuancetypes.UnbondingTokensPoolName))
	seederColl := app.bankKeeper.GetBalance(app.store, bank.ModuleAccountAddress(issuancetypes.SeederCollateralPoolName))
	patron := app.bankKeeper.GetBalance(app.store, bank.ModuleAccountAddress(issuancetypes.PatronStakingPoolName))
	rewardPool := app.bankKeeper.GetBalance(app.store, bank.ModuleAccountAddress(issuancetypes.RewardYieldPoolName))
	feeColl := app.bankKeeper.GetBalance(app.store, bank.ModuleAccountAddress(issuancetypes.FeeCollectorName))
	seederEscrow := app.bankKeeper.GetBalance(app.store, bank.ModuleAccountAddress(issuancetypes.SeederEscrowPoolName))
	commPool := app.bankKeeper.GetBalance(app.store, bank.ModuleAccountAddress(issuancetypes.CommunityPoolName))

	vestingLocked := math.ZeroInt()
	vIter := app.store.Iterator(KeyPrefixVesting)
	for ; vIter.Valid(); vIter.Next() {
		var sched VestingSchedule
		if err := json.Unmarshal(vIter.Value(), &sched); err == nil {
			vestingLocked = vestingLocked.Add(CalculateVestingLocked(sched, now))
		}
	}
	vIter.Close()
	app.mu.RUnlock()

	scActive := app.IsSecurityCouncilActive(height, now)
	nonLiquid := bonded.Add(unbonding).Add(seederColl).Add(patron).Add(vestingLocked).Add(seederEscrow).Add(commPool)
	liquid := math.ZeroInt()
	if totalSupply.GT(nonLiquid) {
		liquid = totalSupply.Sub(nonLiquid)
	}

	return EconomyStats{
		Height:                height,
		CurrentTime:           now,
		ChainID:               chainID,
		GlobalLifetimeCap:     issuancetypes.GlobalLifetimeCap.String(),
		LifetimeMinted:        minted.String(),
		LifetimeBurned:        burned.String(),
		TotalSupply:           totalSupply.String(),
		BondedStake:           bonded.String(),
		UnbondingTotal:        unbonding.String(),
		VestingLocked:         vestingLocked.String(),
		SeederCollateral:      seederColl.String(),
		PatronStaked:          patron.String(),
		RewardPoolUsov:        rewardPool.String(),
		FeeCollectorUsov:      feeColl.String(),
		SeederEscrowUsov:      seederEscrow.String(),
		CommunityPoolUsov:     commPool.String(),
		LiquidCirculating:     liquid.String(),
		FeeBurnBps:            params.FeeBurnBps,
		MinTxFeeUsov:          params.MinTxFeeUsov,
		UnbondingPeriodSec:    params.UnbondingPeriodSeconds,
		SecurityCouncilActive: scActive,
		SupplyInvariantHolds:  totalSupply.Equal(minted.Sub(burned)),
	}
}
