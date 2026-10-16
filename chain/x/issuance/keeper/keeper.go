package keeper

import (
	"encoding/binary"
	"fmt"
	"sync"

	"cosmossdk.io/math"
	"github.com/sovra/chain/store"
	"github.com/sovra/chain/x/issuance/types"
)

// Keeper manages issuance state, caps, and emission lifecycles
type Keeper struct {
	mu          sync.RWMutex
	store       store.KVStore
	genesisTime int64
}

// NewKeeper creates an issuance keeper
func NewKeeper(s store.KVStore, genesisTimeUnix int64) *Keeper {
	return &Keeper{
		store:       s,
		genesisTime: genesisTimeUnix,
	}
}

// Helper methods to read/write math.Int in KVStore
func (k *Keeper) getInt(s store.KVStore, key []byte) math.Int {
	bz := s.Get(key)
	if len(bz) == 0 {
		return math.ZeroInt()
	}
	var val math.Int
	if err := val.Unmarshal(bz); err != nil {
		return math.ZeroInt()
	}
	return val
}

func (k *Keeper) setInt(s store.KVStore, key []byte, val math.Int) {
	bz, err := val.Marshal()
	if err != nil {
		panic(err)
	}
	s.Set(key, bz)
}

func (k *Keeper) getUint64(s store.KVStore, key []byte) uint64 {
	bz := s.Get(key)
	if len(bz) < 8 {
		return 0
	}
	return binary.BigEndian.Uint64(bz)
}

func (k *Keeper) setUint64(s store.KVStore, key []byte, val uint64) {
	bz := make([]byte, 8)
	binary.BigEndian.PutUint64(bz, val)
	s.Set(key, bz)
}

// State Accessors
func (k *Keeper) GetLifetimeMinted(s store.KVStore) math.Int {
	return k.getInt(s, types.KeyPrefixLifetimeMinted)
}

func (k *Keeper) SetLifetimeMinted(s store.KVStore, val math.Int) {
	k.setInt(s, types.KeyPrefixLifetimeMinted, val)
}

func (k *Keeper) GetLifetimeBurned(s store.KVStore) math.Int {
	return k.getInt(s, types.KeyPrefixLifetimeBurned)
}

func (k *Keeper) SetLifetimeBurned(s store.KVStore, val math.Int) {
	k.setInt(s, types.KeyPrefixLifetimeBurned, val)
}

func (k *Keeper) GetPoolMinted(s store.KVStore, pool types.PoolID) math.Int {
	return k.getInt(s, types.PoolMintedKey(pool))
}

func (k *Keeper) SetPoolMinted(s store.KVStore, pool types.PoolID, val math.Int) {
	k.setInt(s, types.PoolMintedKey(pool), val)
}

func (k *Keeper) GetPoolCap(s store.KVStore, pool types.PoolID) math.Int {
	return k.getInt(s, types.PoolCapKey(pool))
}

func (k *Keeper) SetPoolCap(s store.KVStore, pool types.PoolID, val math.Int) {
	k.setInt(s, types.PoolCapKey(pool), val)
}

func (k *Keeper) GetEpochMinted(s store.KVStore, pool types.PoolID, epoch uint64) math.Int {
	return k.getInt(s, types.EpochMintedKey(pool, epoch))
}

func (k *Keeper) SetEpochMinted(s store.KVStore, pool types.PoolID, epoch uint64, val math.Int) {
	k.setInt(s, types.EpochMintedKey(pool, epoch), val)
}

func (k *Keeper) GetEpochAllowance(s store.KVStore, pool types.PoolID, epoch uint64) math.Int {
	return k.getInt(s, types.EpochAllowanceKey(pool, epoch))
}

func (k *Keeper) SetEpochAllowance(s store.KVStore, pool types.PoolID, epoch uint64, val math.Int) {
	k.setInt(s, types.EpochAllowanceKey(pool, epoch), val)
}

func (k *Keeper) GetLastProcessedEpoch(s store.KVStore) uint64 {
	return k.getUint64(s, types.KeyPrefixLastProcessedEpoch)
}

func (k *Keeper) SetLastProcessedEpoch(s store.KVStore, epoch uint64) {
	k.setUint64(s, types.KeyPrefixLastProcessedEpoch, epoch)
}

func (k *Keeper) IsTerminalPhase(s store.KVStore) bool {
	bz := s.Get(types.KeyPrefixTerminalPhase)
	return len(bz) > 0 && bz[0] == 0x01
}

func (k *Keeper) SetTerminalPhase(s store.KVStore, isTerminal bool) {
	val := byte(0x00)
	if isTerminal {
		val = byte(0x01)
	}
	s.Set(types.KeyPrefixTerminalPhase, []byte{val})
}

// InitGenesis sets up the formal supply counters and pool caps at block 0
func (k *Keeper) InitGenesis(s store.KVStore, genesisAllocatedTotal math.Int) error {
	if !genesisAllocatedTotal.Equal(types.GenesisCap) {
		return fmt.Errorf("genesis allocated total %s != GenesisCap %s", genesisAllocatedTotal, types.GenesisCap)
	}

	// 1. Initialize caps
	k.SetPoolCap(s, types.PoolGenesis, types.GenesisCap)
	k.SetPoolCap(s, types.PoolValidator, types.ValidatorCap)
	k.SetPoolCap(s, types.PoolCommunity, types.CommunityCap)
	k.SetPoolCap(s, types.PoolSeeder, types.SeederCap)

	// 2. Initialize lifetime counters
	k.SetLifetimeMinted(s, genesisAllocatedTotal)
	k.SetLifetimeBurned(s, math.ZeroInt())

	// 3. Mark Genesis pool fully minted
	k.SetPoolMinted(s, types.PoolGenesis, genesisAllocatedTotal)
	k.SetPoolMinted(s, types.PoolValidator, math.ZeroInt())
	k.SetPoolMinted(s, types.PoolCommunity, math.ZeroInt())
	k.SetPoolMinted(s, types.PoolSeeder, math.ZeroInt())

	k.SetLastProcessedEpoch(s, 0)
	k.SetTerminalPhase(s, false)

	return nil
}

// BeginBlocker processes epoch transitions and triggers scheduled emissions in BeginBlock
func (k *Keeper) BeginBlocker(s store.KVStore, blockTimeUnix int64, mintHandler func(pool types.PoolID, dest string, amount math.Int) error) error {
	epoch, phase := types.ResolveEpoch(blockTimeUnix, k.genesisTime)

	if phase == types.PhasePreGenesis {
		return nil
	}

	if phase == types.PhaseTerminal {
		if !k.IsTerminalPhase(s) {
			k.SetTerminalPhase(s, true)
			k.SetLastProcessedEpoch(s, types.TotalPolicyEpochs)
		}
		return nil
	}

	lastProcessed := k.GetLastProcessedEpoch(s)
	if epoch < lastProcessed {
		return fmt.Errorf("consensus error: BFT time regression (epoch %d < lastProcessed %d)", epoch, lastProcessed)
	}

	// Idempotent for subsequent blocks in the same epoch
	if epoch == lastProcessed {
		return nil
	}

	// --- ACTIVATE NEW EPOCH (Block 1 of Epoch 'epoch') ---
	vAllow, cAllow, sAllow := types.ComputeEpochAllowance(epoch)

	// Set epoch allowances
	k.SetEpochAllowance(s, types.PoolValidator, epoch, vAllow)
	k.SetEpochAllowance(s, types.PoolCommunity, epoch, cAllow)
	k.SetEpochAllowance(s, types.PoolSeeder, epoch, sAllow)

	// Reset minted counters for this epoch
	k.SetEpochMinted(s, types.PoolValidator, epoch, math.ZeroInt())
	k.SetEpochMinted(s, types.PoolCommunity, epoch, math.ZeroInt())
	k.SetEpochMinted(s, types.PoolSeeder, epoch, math.ZeroInt())

	k.SetLastProcessedEpoch(s, epoch)

	// Atomic issuance of scheduled allowances:
	// 1. Validator Pool -> fee_collector
	if err := k.ExecuteMint(s, types.PoolValidator, types.FeeCollectorName, vAllow, epoch, mintHandler); err != nil {
		return fmt.Errorf("failed to mint validator epoch allowance: %w", err)
	}

	// 2. Community Pool -> community_pool
	if err := k.ExecuteMint(s, types.PoolCommunity, types.CommunityPoolName, cAllow, epoch, mintHandler); err != nil {
		return fmt.Errorf("failed to mint community epoch allowance: %w", err)
	}

	// 3. Seeder Pool -> seeder_escrow
	if err := k.ExecuteMint(s, types.PoolSeeder, types.SeederEscrowPoolName, sAllow, epoch, mintHandler); err != nil {
		return fmt.Errorf("failed to mint seeder epoch allowance: %w", err)
	}

	return nil
}

// ExecuteMint executes an atomic mint operation inside a CacheWrap boundary
func (k *Keeper) ExecuteMint(
	s store.KVStore,
	pool types.PoolID,
	dest string,
	amount math.Int,
	epoch uint64,
	mintHandler func(pool types.PoolID, dest string, amount math.Int) error,
) error {
	if !amount.IsPositive() {
		return types.ErrInvalidCoin
	}

	// CacheWrap creates an isolated write-back sandbox
	cacheStore, commit := s.CacheWrap()

	// 1. Invariant: Epoch Allowance Check
	epochAllowance := k.GetEpochAllowance(cacheStore, pool, epoch)
	epochMinted := k.GetEpochMinted(cacheStore, pool, epoch)
	newEpochMinted := epochMinted.Add(amount)
	if newEpochMinted.GT(epochAllowance) {
		return types.ErrEpochAllowanceExceeded
	}

	// 2. Invariant: Pool Lifetime Cap Check
	poolCap := k.GetPoolCap(cacheStore, pool)
	poolMinted := k.GetPoolMinted(cacheStore, pool)
	newPoolMinted := poolMinted.Add(amount)
	if newPoolMinted.GT(poolCap) {
		return types.ErrPoolCapExceeded
	}

	// 3. Invariant: Global Lifetime Cap Check (100M SOV)
	lifetimeMinted := k.GetLifetimeMinted(cacheStore)
	newLifetimeMinted := lifetimeMinted.Add(amount)
	if newLifetimeMinted.GT(types.GlobalLifetimeCap) {
		return types.ErrGlobalCapExceeded
	}

	// Mutate counters in cacheStore
	k.SetEpochMinted(cacheStore, pool, epoch, newEpochMinted)
	k.SetPoolMinted(cacheStore, pool, newPoolMinted)
	k.SetLifetimeMinted(cacheStore, newLifetimeMinted)

	// Call underlying bank mint callback (if it errors, commit() is never called!)
	if mintHandler != nil {
		if err := mintHandler(pool, dest, amount); err != nil {
			return err // Rollback! Zero changes written to parent store s
		}
	}

	// Commit cacheStore writes to s atomically
	commit()
	return nil
}

// ExecuteBurn burns tokens from an authenticated account, incrementing LifetimeBurned
func (k *Keeper) ExecuteBurn(
	s store.KVStore,
	burner string,
	amount math.Int,
	burnHandler func(burner string, amount math.Int) error,
) error {
	if !amount.IsPositive() {
		return types.ErrInvalidCoin
	}

	cacheStore, commit := s.CacheWrap()

	// Update LifetimeBurned (LifetimeMinted is NEVER decremented)
	lifetimeBurned := k.GetLifetimeBurned(cacheStore).Add(amount)
	k.SetLifetimeBurned(cacheStore, lifetimeBurned)

	// Debit balance & burn from bank
	if burnHandler != nil {
		if err := burnHandler(burner, amount); err != nil {
			return err // Rollback!
		}
	}

	commit()
	return nil
}

// VerifySupplyInvariant verifies that BankSupply == LifetimeMinted - LifetimeBurned
func (k *Keeper) VerifySupplyInvariant(s store.KVStore, currentBankSupply math.Int) error {
	lifetimeMinted := k.GetLifetimeMinted(s)
	lifetimeBurned := k.GetLifetimeBurned(s)

	expectedSupply := lifetimeMinted.Sub(lifetimeBurned)
	if !currentBankSupply.Equal(expectedSupply) {
		return fmt.Errorf("%w: bankSupply (%s) != expected (%s) [lifetimeMinted=%s, lifetimeBurned=%s]",
			types.ErrSupplyInvariantBroken, currentBankSupply, expectedSupply, lifetimeMinted, lifetimeBurned)
	}
	return nil
}
