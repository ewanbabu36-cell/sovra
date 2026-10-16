package keeper_test

import (
	"errors"
	"testing"

	"cosmossdk.io/math"
	"github.com/sovra/chain/store"
	"github.com/sovra/chain/x/issuance/keeper"
	"github.com/sovra/chain/x/issuance/types"
)

func setupTestKeeper(t *testing.T) (*keeper.Keeper, store.KVStore, int64) {
	memStore := store.NewMemoryStore()
	genesisTime := int64(1_700_000_000)
	k := keeper.NewKeeper(memStore, genesisTime)

	// Initialize genesis state
	err := k.InitGenesis(memStore, types.GenesisCap)
	if err != nil {
		t.Fatalf("InitGenesis failed: %v", err)
	}

	return k, memStore, genesisTime
}

func TestGenesisSupplyInitialization(t *testing.T) {
	k, s, _ := setupTestKeeper(t)

	lifetimeMinted := k.GetLifetimeMinted(s)
	lifetimeBurned := k.GetLifetimeBurned(s)

	if !lifetimeMinted.Equal(types.GenesisCap) {
		t.Fatalf("LifetimeMinted %s != %s", lifetimeMinted, types.GenesisCap)
	}
	if !lifetimeBurned.IsZero() {
		t.Fatalf("LifetimeBurned %s != 0", lifetimeBurned)
	}

	// Verify supply invariant holds at genesis
	currentBankSupply := types.GenesisCap
	if err := k.VerifySupplyInvariant(s, currentBankSupply); err != nil {
		t.Fatalf("Supply invariant failed at genesis: %v", err)
	}
}

// TC-01A: Epoch Allowance Rejection
func TestTC01A_EpochAllowanceRejection(t *testing.T) {
	k, s, _ := setupTestKeeper(t)

	// Set epoch 1 allowance = 1,000 uSOV, minted = 900 uSOV
	epoch := uint64(1)
	allowance := math.NewInt(1000)
	k.SetEpochAllowance(s, types.PoolValidator, epoch, allowance)
	k.SetEpochMinted(s, types.PoolValidator, epoch, math.NewInt(900))

	// Attempt to mint 101 uSOV (900 + 101 = 1001 > 1000)
	err := k.ExecuteMint(s, types.PoolValidator, "dest", math.NewInt(101), epoch, nil)
	if !errors.Is(err, types.ErrEpochAllowanceExceeded) {
		t.Fatalf("expected ErrEpochAllowanceExceeded, got: %v", err)
	}

	// Verify state counters remain unchanged
	if !k.GetEpochMinted(s, types.PoolValidator, epoch).Equal(math.NewInt(900)) {
		t.Fatalf("epoch minted mutated on failure")
	}
}

// TC-01B: Pool Lifetime Cap Rejection (Isolated Mock State)
func TestTC01B_PoolCapRejection(t *testing.T) {
	k, s, _ := setupTestKeeper(t)

	epoch := uint64(1)
	// Set huge epoch allowance so allowance check easily passes
	k.SetEpochAllowance(s, types.PoolValidator, epoch, math.NewInt(10_000_000))
	k.SetEpochMinted(s, types.PoolValidator, epoch, math.ZeroInt())

	// Set PoolMinted to PoolCap - 100 uSOV
	poolCap := k.GetPoolCap(s, types.PoolValidator)
	k.SetPoolMinted(s, types.PoolValidator, poolCap.SubRaw(100))

	// Attempt to mint 101 uSOV (pool cap breach!)
	err := k.ExecuteMint(s, types.PoolValidator, "dest", math.NewInt(101), epoch, nil)
	if !errors.Is(err, types.ErrPoolCapExceeded) {
		t.Fatalf("expected ErrPoolCapExceeded, got: %v", err)
	}

	// Verify state counters remain unchanged
	if !k.GetPoolMinted(s, types.PoolValidator).Equal(poolCap.SubRaw(100)) {
		t.Fatalf("pool minted mutated on failure")
	}
}

// TC-01C: Global Lifetime Cap Rejection (Isolated Mock State)
func TestTC01C_GlobalCapRejection(t *testing.T) {
	k, s, _ := setupTestKeeper(t)

	epoch := uint64(1)
	// Huge epoch allowance & huge pool remaining
	k.SetEpochAllowance(s, types.PoolValidator, epoch, math.NewInt(10_000_000))
	k.SetEpochMinted(s, types.PoolValidator, epoch, math.ZeroInt())
	k.SetPoolMinted(s, types.PoolValidator, math.ZeroInt())

	// Set LifetimeMinted to GlobalLifetimeCap - 100 uSOV
	k.SetLifetimeMinted(s, types.GlobalLifetimeCap.SubRaw(100))

	// Attempt to mint 101 uSOV (global cap breach!)
	err := k.ExecuteMint(s, types.PoolValidator, "dest", math.NewInt(101), epoch, nil)
	if !errors.Is(err, types.ErrGlobalCapExceeded) {
		t.Fatalf("expected ErrGlobalCapExceeded, got: %v", err)
	}

	// Verify state counters remain unchanged
	if !k.GetLifetimeMinted(s).Equal(types.GlobalLifetimeCap.SubRaw(100)) {
		t.Fatalf("lifetime minted mutated on failure")
	}
}

// TC-01D: Exact Boundary Tests
func TestTC01D_ExactBoundaryTests(t *testing.T) {
	k, s, _ := setupTestKeeper(t)

	epoch := uint64(1)
	k.SetEpochAllowance(s, types.PoolValidator, epoch, math.NewInt(1000))
	k.SetEpochMinted(s, types.PoolValidator, epoch, math.ZeroInt())

	// Case 1: Exact allowance (1000) succeeds
	err := k.ExecuteMint(s, types.PoolValidator, "dest", math.NewInt(1000), epoch, nil)
	if err != nil {
		t.Fatalf("exact boundary mint failed: %v", err)
	}
	if !k.GetEpochMinted(s, types.PoolValidator, epoch).Equal(math.NewInt(1000)) {
		t.Fatalf("expected minted = 1000")
	}

	// Case 2: +1 unit over allowance fails
	err = k.ExecuteMint(s, types.PoolValidator, "dest", math.NewInt(1), epoch, nil)
	if !errors.Is(err, types.ErrEpochAllowanceExceeded) {
		t.Fatalf("expected ErrEpochAllowanceExceeded on +1 unit, got: %v", err)
	}
}

// TC-01E: Rollback on Bank Transfer Failure
func TestTC01E_BankFailureRollback(t *testing.T) {
	k, s, _ := setupTestKeeper(t)

	epoch := uint64(1)
	k.SetEpochAllowance(s, types.PoolValidator, epoch, math.NewInt(1000))
	k.SetEpochMinted(s, types.PoolValidator, epoch, math.ZeroInt())

	initialLifetime := k.GetLifetimeMinted(s)

	// Injected bank failure
	injectedErr := errors.New("simulated bank transfer failure")
	failingHandler := func(pool types.PoolID, dest string, amount math.Int) error {
		return injectedErr
	}

	err := k.ExecuteMint(s, types.PoolValidator, "dest", math.NewInt(500), epoch, failingHandler)
	if !errors.Is(err, injectedErr) {
		t.Fatalf("expected injectedErr, got: %v", err)
	}

	// Assert KVStore counters were completely rolled back
	if !k.GetEpochMinted(s, types.PoolValidator, epoch).IsZero() {
		t.Fatalf("rollback failed: epoch minted was not rolled back")
	}
	if !k.GetLifetimeMinted(s).Equal(initialLifetime) {
		t.Fatalf("rollback failed: lifetime minted was not rolled back")
	}
}

func TestBeginBlockerEpochAdvancementAndSeparatePoolDestinations(t *testing.T) {
	k, s, genesisTime := setupTestKeeper(t)

	// Track minted coins across the 3 separate destinations
	destinationMints := make(map[string]math.Int)
	mockBankHandler := func(pool types.PoolID, dest string, amount math.Int) error {
		current, ok := destinationMints[dest]
		if !ok {
			current = math.ZeroInt()
		}
		destinationMints[dest] = current.Add(amount)
		return nil
	}

	// Block 1 at genesisTime (Epoch 1 activation)
	err := k.BeginBlocker(s, genesisTime, mockBankHandler)
	if err != nil {
		t.Fatalf("BeginBlocker failed: %v", err)
	}

	if k.GetLastProcessedEpoch(s) != 1 {
		t.Fatalf("expected lastProcessedEpoch = 1, got %d", k.GetLastProcessedEpoch(s))
	}

	// Verify exact allowances and 2:4:1 daily ratios
	vAllow, cAllow, sAllow := types.ComputeEpochAllowance(1)

	// Assert 3 separate destinations received exact allocations
	if !destinationMints[types.FeeCollectorName].Equal(vAllow) {
		t.Fatalf("fee_collector received %s != %s", destinationMints[types.FeeCollectorName], vAllow)
	}
	if !destinationMints[types.CommunityPoolName].Equal(cAllow) {
		t.Fatalf("community_pool received %s != %s", destinationMints[types.CommunityPoolName], cAllow)
	}
	if !destinationMints[types.SeederEscrowPoolName].Equal(sAllow) {
		t.Fatalf("seeder_escrow received %s != %s", destinationMints[types.SeederEscrowPoolName], sAllow)
	}

	// Verify 2:4:1 daily ratio between the destinations
	if !destinationMints[types.FeeCollectorName].Equal(destinationMints[types.SeederEscrowPoolName].MulRaw(2)) {
		t.Fatalf("V != 2*S in destination mints")
	}
	if !destinationMints[types.CommunityPoolName].Equal(destinationMints[types.SeederEscrowPoolName].MulRaw(4)) {
		t.Fatalf("C != 4*S in destination mints")
	}
}

func TestExecuteBurnAndMasterSupplyInvariant(t *testing.T) {
	k, s, _ := setupTestKeeper(t)

	// Simulate current bank supply = GenesisCap
	bankSupply := types.GenesisCap

	// 1. Initial supply check
	if err := k.VerifySupplyInvariant(s, bankSupply); err != nil {
		t.Fatalf("initial supply invariant failed: %v", err)
	}

	// 2. Burn 500,000 uSOV
	burnAmount := math.NewInt(500_000)
	burnHandler := func(burner string, amount math.Int) error {
		bankSupply = bankSupply.Sub(amount)
		return nil
	}

	err := k.ExecuteBurn(s, "sovra1alice", burnAmount, burnHandler)
	if err != nil {
		t.Fatalf("ExecuteBurn failed: %v", err)
	}

	// Verify LifetimeBurned updated
	lifetimeBurned := k.GetLifetimeBurned(s)
	if !lifetimeBurned.Equal(burnAmount) {
		t.Fatalf("LifetimeBurned %s != %s", lifetimeBurned, burnAmount)
	}

	// Verify LifetimeMinted was NOT decremented
	if !k.GetLifetimeMinted(s).Equal(types.GenesisCap) {
		t.Fatalf("LifetimeMinted was incorrectly modified on burn")
	}

	// Verify master supply invariant holds after burn
	if err := k.VerifySupplyInvariant(s, bankSupply); err != nil {
		t.Fatalf("supply invariant broken after burn: %v", err)
	}
}
