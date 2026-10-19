package node

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
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
	KeyPrefixValidators  = []byte{0x36}
	KeyPrefixDelegation  = []byte{0x40}
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

	// Mint callback wiring to bank keeper
	mintHandler := func(pool issuancetypes.PoolID, dest string, amount math.Int) error {
		// Mint to issuance module, then transfer to target module account
		if err := app.bankKeeper.MintCoins(app.store, issuancetypes.ModuleName, amount); err != nil {
			return err
		}
		return app.bankKeeper.SendCoinsFromModuleToModule(app.store, issuancetypes.ModuleName, dest, amount)
	}

	// Run issuance BeginBlocker (triggers new epoch allocations on day boundaries)
	return app.issuanceKeeper.BeginBlocker(app.store, blockTimeUnix, mintHandler)
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

	// Deduct fee and credit to fee_collector
	if fee.IsPositive() {
		if err := app.bankKeeper.SendCoinsFromAccountToModule(cacheStore, tx.Sender, issuancetypes.FeeCollectorName, fee); err != nil {
			return fmt.Errorf("fee deduction failed: %w", err)
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

	env := wasmtypes.Env{
		Block: wasmtypes.BlockInfo{
			Height:  app.height,
			Time:    time.Now().Unix(),
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
		if err := app.bankKeeper.SendCoinsFromAccountToModule(cacheStore, tx.Sender, "bonded_tokens_pool", amt); err != nil {
			return fmt.Errorf("delegation transfer failed: %w", err)
		}
		curDel := app.GetDelegation(cacheStore, tx.Sender, targetVal)
		app.SetDelegation(cacheStore, tx.Sender, targetVal, curDel.Add(amt))

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
		app.SetDelegation(cacheStore, tx.Sender, targetVal, curDel.Sub(amt))
		if err := app.bankKeeper.SendCoinsFromModuleToAccount(cacheStore, "bonded_tokens_pool", tx.Sender, amt); err != nil {
			return fmt.Errorf("undelegation refund failed: %w", err)
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

	// 4. Verify balance covers amount (or attached funds) + fee
	totalRequired := amt.Add(fee)
	senderBal := app.bankKeeper.GetBalance(s, tx.Sender)
	if senderBal.LT(totalRequired) {
		return fmt.Errorf("insufficient funds: balance %s < required %s", senderBal, totalRequired)
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

// GetBlock retrieves serialized block data for a given height
func (app *SovraApp) GetBlock(height int64) []byte {
	app.mu.RLock()
	defer app.mu.RUnlock()
	return app.store.Get(BlockKey(height))
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


