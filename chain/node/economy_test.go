package node_test

import (
	"encoding/hex"
	"encoding/json"
	"testing"

	"cosmossdk.io/math"
	"github.com/sovra/chain/node"
	"github.com/sovra/chain/store"
	issuancetypes "github.com/sovra/chain/x/issuance/types"
)

func TestL1SevenPillarTokenomicsEnforcement(t *testing.T) {
	memStore := store.NewMemoryStore()
	genesisTime := int64(1_700_000_000)
	app := node.NewSovraApp(memStore, genesisTime)

	alice := generateTestKeyPair(t, "alice")       // regular liquid user
	bob := generateTestKeyPair(t, "bob")           // seeder & creator
	vested := generateTestKeyPair(t, "foundation") // 12m cliff + 36m linear vesting
	fan := generateTestKeyPair(t, "fan")

	gen := node.GenesisState{
		ChainID:     "sovra-mainnet-1",
		GenesisTime: genesisTime,
		Accounts: map[string]string{
			alice.Address:  "10000000000000", // 10M SOV
			bob.Address:    "5000000000000",  // 5M SOV
			vested.Address: "10000000000000", // 10M SOV vested
			fan.Address:    "5000000000000",  // 5M SOV
		},
		VestingAccounts: []node.GenesisVestingAccount{
			{
				Address:                vested.Address,
				OriginalAmount:         "10000000000000",
				CliffSeconds:           365 * 86400,     // 12m cliff
				VestingDurationSeconds: 3 * 365 * 86400, // 36m linear
				Label:                  "Foundation Cliff Vesting",
			},
		},
		EconomicParams: &node.EconomicParams{
			MinTxFeeUsov:                100,
			FeeBurnBps:                  5000, // 50% EIP-1559 burn
			UnbondingPeriodSeconds:      14 * 86400,
			SecurityCouncilSunsetHeight: 5,
			SecurityCouncilSunsetTime:   genesisTime + 3*365*86400,
		},
		Validators: []node.GenesisValidator{
			{Name: "val-alice", Address: alice.Address, PubKeyHex: alice.PubKeyHex, VotingPower: 100},
		},
	}

	if err := app.InitChain(gen); err != nil {
		t.Fatalf("InitChain failed: %v", err)
	}
	if err := app.BeginBlock(1, genesisTime); err != nil {
		t.Fatalf("BeginBlock failed: %v", err)
	}

	// 1. Pillar 1: Reject zero/low fee transactions & verify 50% EIP-1559 burn on minimum valid fee
	zeroFeeTx := node.SignedTransaction{
		Type:      node.TxTypeSend,
		Recipient: bob.Address,
		Amount:    "1000",
		Nonce:     0,
		Fee:       "0",
	}
	signTransaction(alice, &zeroFeeTx)
	if err := app.CheckTx(zeroFeeTx); err == nil {
		t.Fatalf("expected zero-fee transaction to fail CheckTx")
	}

	lowFeeTx := node.SignedTransaction{
		Type:      node.TxTypeSend,
		Recipient: bob.Address,
		Amount:    "1000",
		Nonce:     0,
		Fee:       "99",
	}
	signTransaction(alice, &lowFeeTx)
	if err := app.CheckTx(lowFeeTx); err == nil {
		t.Fatalf("expected fee below 100 uSOV to fail CheckTx")
	}

	validFeeTx := node.SignedTransaction{
		Type:      node.TxTypeSend,
		Recipient: bob.Address,
		Amount:    "5000",
		Nonce:     0,
		Fee:       "1000", // 500 uSOV burned, 500 uSOV to fee_collector
	}
	signTransaction(alice, &validFeeTx)
	if err := app.DeliverTx(validFeeTx); err != nil {
		t.Fatalf("valid min-fee send failed: %v", err)
	}
	if !app.QueryLifetimeBurned().Equal(math.NewInt(500)) {
		t.Fatalf("expected 500 uSOV EIP-1559 burned, got %s", app.QueryLifetimeBurned())
	}

	// 2. Pillar 4: Genesis Vesting Cliff (0% unlocked at t = 0 or t = 180d, linear at 12m + 18m = 50%)
	vestSpendEarly := node.SignedTransaction{
		Type:      node.TxTypeSend,
		Recipient: bob.Address,
		Amount:    "1000",
		Nonce:     0,
		Fee:       "100",
	}
	signTransaction(vested, &vestSpendEarly)
	if err := app.CheckTx(vestSpendEarly); err == nil {
		t.Fatalf("expected spend from 12m cliff-locked genesis account to fail CheckTx")
	}

	// Advance time past 12m cliff + half of 36m vesting => 50% (5M SOV) unlocked
	halfVestTime := genesisTime + 365*86400 + (3*365*86400)/2
	if err := app.BeginBlock(2, halfVestTime); err != nil {
		t.Fatalf("BeginBlock halfVestTime failed: %v", err)
	}
	_, lockedMid, spendableMid := app.QueryVestingSchedule(vested.Address, halfVestTime)
	if !lockedMid.Equal(math.NewInt(5_000_000_000_000)) || !spendableMid.Equal(math.NewInt(5_000_000_000_000)) {
		t.Fatalf("expected 5M locked / 5M spendable at midpoint, got locked=%s spendable=%s", lockedMid, spendableMid)
	}
	if err := app.DeliverTx(vestSpendEarly); err != nil {
		t.Fatalf("expected vested spend after cliff unlock to succeed, got %v", err)
	}

	// 3. Pillar 2: "Stake-to-Work" DePIN Seeder Collateral + PoR Slashing
	if _, err := app.ClaimSeederEpochReward(bob.Address, math.NewInt(1_000_000), true); err == nil {
		t.Fatalf("expected unbonded seeder reward claim to be rejected")
	}
	bondSeederTx := node.SignedTransaction{
		Type:      node.TxTypeBondSeeder,
		Amount:    "200000000", // 200 SOV for 20 GB (10 SOV/GB)
		StorageGb: 20,
		Nonce:     0,
		Fee:       "1000",
	}
	signTransaction(bob, &bondSeederTx)
	if err := app.DeliverTx(bondSeederTx); err != nil {
		t.Fatalf("DeliverTx bond_seeder failed: %v", err)
	}
	payout, err := app.ClaimSeederEpochReward(bob.Address, math.NewInt(5_000_000), true)
	if err != nil || !payout.Equal(math.NewInt(5_000_000)) {
		t.Fatalf("expected bonded seeder to claim 5,000,000 uSOV, got payout=%s err=%v", payout, err)
	}
	_, bobLockedAfterClaim, _ := app.QueryVestingSchedule(bob.Address, halfVestTime)
	if !bobLockedAfterClaim.Equal(math.NewInt(2_500_000)) {
		t.Fatalf("expected 50%% (2,500,000 uSOV) rolling 30d emission lock on claimed seeder reward, got %s", bobLockedAfterClaim)
	}
	slashed, err := app.SlashSeederCollateral(bob.Address, 1000, "por_audit_failed") // 10% slash = 20 SOV burned
	if err != nil || !slashed.Equal(math.NewInt(20_000_000)) {
		t.Fatalf("expected 20,000,000 uSOV seeder slash burn, got %s err=%v", slashed, err)
	}

	// 4. Pillar 3: veSOV Time-Lock Multipliers + 14-Day Unbonding Delay + Patron Staking Yield
	veStakeTx := node.SignedTransaction{
		Type:      node.TxTypeDelegate,
		Validator: alice.Address,
		Amount:    "100000000", // 100 SOV
		LockDays:  365,         // 2.5x weight multiplier (25000 bps)
		Nonce:     0,
		Fee:       "1000",
	}
	signTransaction(fan, &veStakeTx)
	if err := app.DeliverTx(veStakeTx); err != nil {
		t.Fatalf("DeliverTx veSOV delegate failed: %v", err)
	}
	delRec := app.QueryDelegationRecord(fan.Address, alice.Address)
	if delRec == nil || delRec.MultiplierBps != 25000 || delRec.LockTier != "365d" {
		t.Fatalf("expected 365d 2.5x delegation record, got %+v", delRec)
	}

	// Early undelegate MUST fail while 365-day lock is active
	earlyUndelTx := node.SignedTransaction{
		Type:      node.TxTypeUndelegate,
		Validator: alice.Address,
		Amount:    "50000000",
		Nonce:     1,
		Fee:       "1000",
	}
	signTransaction(fan, &earlyUndelTx)
	if err := app.CheckTx(earlyUndelTx); err == nil {
		t.Fatalf("expected early undelegate before 365d lock expiration to fail")
	}

	// Flexible delegation can enter 14-day unbonding queue, NOT returned until +14 days
	flexStakeTx := node.SignedTransaction{
		Type:      node.TxTypeDelegate,
		Validator: alice.Address,
		Amount:    "1000000", // 1 SOV flexible
		LockDays:  0,
		Nonce:     1,
		Fee:       "1000",
	}
	signTransaction(alice, &flexStakeTx)
	if err := app.DeliverTx(flexStakeTx); err != nil {
		t.Fatalf("DeliverTx flexible delegate failed: %v", err)
	}
	flexUndelTx := node.SignedTransaction{
		Type:      node.TxTypeUndelegate,
		Validator: alice.Address,
		Amount:    "1000000",
		Nonce:     2,
		Fee:       "1000",
	}
	signTransaction(alice, &flexUndelTx)
	balBeforeUnbond := app.QueryBalance(alice.Address)
	if err := app.DeliverTx(flexUndelTx); err != nil {
		t.Fatalf("DeliverTx flexible undelegate failed: %v", err)
	}
	if len(app.QueryPendingUnbondings(alice.Address)) != 1 {
		t.Fatalf("expected 1 pending unbonding entry")
	}
	// At +13 days: still queued, balance NOT refunded yet!
	if err := app.BeginBlock(3, halfVestTime+13*86400); err != nil {
		t.Fatalf("BeginBlock +13d failed: %v", err)
	}
	if len(app.QueryPendingUnbondings(alice.Address)) != 1 {
		t.Fatalf("expected unbonding still queued at +13d")
	}
	// At +14 days: matured & released cleanly!
	if err := app.BeginBlock(4, halfVestTime+14*86400); err != nil {
		t.Fatalf("BeginBlock +14d failed: %v", err)
	}
	if len(app.QueryPendingUnbondings(alice.Address)) != 0 {
		t.Fatalf("expected unbonding matured & cleared at +14d")
	}
	if app.QueryBalance(alice.Address).LT(balBeforeUnbond.AddRaw(999000)) {
		t.Fatalf("expected matured unbonded stake returned to Alice after 14d cooldown")
	}

	// 5. Pillar 5: Patron Staking (Fan keeps principal, Creator earns fee yield)
	patronTx := node.SignedTransaction{
		Type:     node.TxTypePatronStake,
		Creator:  bob.Address,
		Amount:   "200000000", // 200 SOV
		LockDays: 0,
		Nonce:    1,
		Fee:      "1000",
	}
	signTransaction(fan, &patronTx)
	if err := app.DeliverTx(patronTx); err != nil {
		t.Fatalf("DeliverTx patron_stake failed: %v", err)
	}
	_ = app.DistributeEpochRewards()
	creatorReward := app.QueryClaimableRewards(bob.Address)
	if !creatorReward.IsPositive() {
		t.Fatalf("expected creator Bob to accrue real fee yield from Fan's patron stake")
	}
	claimTx := node.SignedTransaction{
		Type:  node.TxTypeClaimRewards,
		Nonce: 1,
		Fee:   "1000",
	}
	signTransaction(bob, &claimTx)
	if err := app.DeliverTx(claimTx); err != nil {
		t.Fatalf("DeliverTx claim_rewards failed: %v", err)
	}
	_, bobLockedAfterRewardClaim, _ := app.QueryVestingSchedule(bob.Address, halfVestTime+14*86400)
	if !bobLockedAfterRewardClaim.IsPositive() {
		t.Fatalf("expected claimed validator/patron rewards to enqueue rolling vesting lock, got %s", bobLockedAfterRewardClaim)
	}

	// 6. Pillar 1 Paid Usage Sinks: Handle Registration (80% burn), Storage Rent (50% burn + 50% bonded seeder), Boost (80% burn)
	handleTx := node.SignedTransaction{
		Type:   node.TxTypeRegisterHandle,
		Handle: "@sovra_king",
		Amount: "10000000", // 10 SOV -> 8 SOV burned
		Nonce:  2,
		Fee:    "1000",
	}
	signTransaction(fan, &handleTx)
	if err := app.DeliverTx(handleTx); err != nil {
		t.Fatalf("DeliverTx register_handle failed: %v", err)
	}
	if hRec := app.QueryHandle("sovra_king"); hRec == nil || hRec.BurnedUsov != "8000000" {
		t.Fatalf("expected handle burned 8,000,000 uSOV, got %+v", hRec)
	}

	rentTx := node.SignedTransaction{
		Type:           node.TxTypePayStorageRent,
		Recipient:      bob.Address, // Bonded seeder
		StorageGb:      4,
		DurationMonths: 1,
		Amount:         "2000000", // 4 * 0.5 SOV = 2 SOV -> 1 SOV burned, 1 SOV to Bob
		Nonce:          3,
		Fee:            "1000",
	}
	signTransaction(fan, &rentTx)
	if err := app.DeliverTx(rentTx); err != nil {
		t.Fatalf("DeliverTx pay_storage_rent failed: %v", err)
	}

	boostTx := node.SignedTransaction{
		Type:   node.TxTypeBoostBurn,
		Amount: "5000000", // 5 SOV -> 4 SOV burned
		Nonce:  4,
		Fee:    "1000",
	}
	signTransaction(fan, &boostTx)
	if err := app.DeliverTx(boostTx); err != nil {
		t.Fatalf("DeliverTx boost_burn failed: %v", err)
	}

	// 7. Pillar 7: Security Council Sunset at Height 5 + Protocol-Owned Liquidity (POL) Lock + Economy Dashboard Stats
	if !app.IsSecurityCouncilActive(4, halfVestTime) {
		t.Fatalf("expected Security Council active at height 4 before sunset height 5")
	}
	_ = app.BeginBlock(5, halfVestTime+15*86400)
	if app.IsSecurityCouncilActive(5, halfVestTime+15*86400) {
		t.Fatalf("expected Security Council automatically sunset at height 5")
	}

	econ := app.QueryEconomyStats()
	if !econ.SupplyInvariantHolds {
		t.Fatalf("economy supply invariant violated: %+v", econ)
	}
	if econ.FeeBurnBps != 5000 || econ.UnbondingPeriodSec != issuancetypes.DefaultUnbondingPeriodSeconds {
		t.Fatalf("unexpected economy params: %+v", econ)
	}

	// Master Supply Invariant check
	supply := app.QueryTotalSupply()
	minted := app.QueryLifetimeMinted()
	burned := app.QueryLifetimeBurned()
	if !supply.Equal(minted.Sub(burned)) {
		t.Fatalf("master invariant mismatch: supply=%s minted=%s burned=%s", supply, minted, burned)
	}

	// Test POL LP Lock via CosmWasm Swap Contract
	storeCw20 := node.SignedTransaction{
		Type:            node.TxTypeStoreCode,
		Fee:             "1000",
		Nonce:           5,
		WASMBytecodeHex: hex.EncodeToString([]byte("sovra_cw20_creator_token_standard_bytecode_v1")),
	}
	signTransaction(fan, &storeCw20)
	if err := app.DeliverTx(storeCw20); err != nil {
		t.Fatalf("StoreCode CW20 failed: %v", err)
	}
	instCw20 := node.SignedTransaction{
		Type:   node.TxTypeInstantiateContract,
		CodeID: 1,
		Label:  "POL Token",
		Msg:    `{"name":"POL","symbol":"POL","decimals":6,"initial_balances":[{"address":"` + fan.Address + `","amount":"100000000"}]}`,
		Fee:    "1000",
		Nonce:  6,
	}
	signTransaction(fan, &instCw20)
	if err := app.DeliverTx(instCw20); err != nil {
		t.Fatalf("Inst CW20 failed: %v", err)
	}
	tokAddr := app.GetLastInstantiatedContract()

	storeSwap := node.SignedTransaction{
		Type:            node.TxTypeStoreCode,
		Fee:             "1000",
		Nonce:           7,
		WASMBytecodeHex: hex.EncodeToString([]byte("sovra_amm_swap_pair_standard_bytecode_v1")),
	}
	signTransaction(fan, &storeSwap)
	if err := app.DeliverTx(storeSwap); err != nil {
		t.Fatalf("StoreCode Swap failed: %v", err)
	}
	instSwap := node.SignedTransaction{
		Type:   node.TxTypeInstantiateContract,
		CodeID: 2,
		Label:  "POL Swap",
		Funds:  "1000000",
		Msg:    `{"token_address":"` + tokAddr + `","reserve_sov":"1000000","reserve_token":"100000000","fee_percent":1}`,
		Fee:    "1000",
		Nonce:  8,
	}
	signTransaction(fan, &instSwap)
	if err := app.DeliverTx(instSwap); err != nil {
		t.Fatalf("Inst Swap failed: %v", err)
	}
	swapAddr := app.GetLastInstantiatedContract()

	lockPolTx := node.SignedTransaction{
		Type:     node.TxTypeExecuteContract,
		Contract: swapAddr,
		Msg:      `{"lock_pol_liquidity":{"permanent":true}}`,
		Fee:      "1000",
		Nonce:    9,
	}
	signTransaction(fan, &lockPolTx)
	if err := app.DeliverTx(lockPolTx); err != nil {
		t.Fatalf("lock_pol_liquidity failed: %v", err)
	}
	polQ, err := app.QueryWasmSmart(swapAddr, []byte(`{"pol_status":{"address":"`+fan.Address+`"}}`))
	if err != nil {
		t.Fatalf("pol_status query failed: %v", err)
	}
	var polState map[string]interface{}
	_ = json.Unmarshal(polQ, &polState)
	if polState["permanent_lock"] != true || polState["lock_active"] != true {
		t.Fatalf("expected active permanent POL lock, got %+v", polState)
	}

	removePolTx := node.SignedTransaction{
		Type:     node.TxTypeExecuteContract,
		Contract: swapAddr,
		Msg:      `{"remove_liquidity":{"amount":"1000"}}`,
		Fee:      "1000",
		Nonce:    10,
	}
	signTransaction(fan, &removePolTx)
	if err := app.DeliverTx(removePolTx); err == nil {
		t.Fatalf("expected remove_liquidity under active POL lock to fail")
	}
}
