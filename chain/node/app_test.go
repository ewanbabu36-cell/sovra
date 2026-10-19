package node_test

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"testing"

	"cosmossdk.io/math"
	"github.com/sovra/chain/node"
	"github.com/sovra/chain/store"
	"github.com/sovra/chain/x/auth"
	issuancetypes "github.com/sovra/chain/x/issuance/types"
)

func generateTestKeyPair(t *testing.T, name string) *node.KeyPair {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	addr := auth.ComputeAddressFromPubKey(pub)
	return &node.KeyPair{
		Name:       name,
		Address:    addr,
		PublicKey:  pub,
		PrivateKey: priv,
		PubKeyHex:  hex.EncodeToString(pub),
		PrivKeyHex: hex.EncodeToString(priv),
	}
}

func signTransaction(kp *node.KeyPair, tx *node.SignedTransaction) {
	tx.Sender = kp.Address
	tx.PubKeyHex = kp.PubKeyHex
	signBytes := tx.GetSignBytes()
	sig := ed25519.Sign(kp.PrivateKey, signBytes)
	tx.SigHex = hex.EncodeToString(sig)
}

func TestFullSovraAppLifecycle(t *testing.T) {
	memStore := store.NewMemoryStore()
	genesisTime := int64(1_700_000_000)
	app := node.NewSovraApp(memStore, genesisTime)

	// Create test users
	alice := generateTestKeyPair(t, "alice")
	bob := generateTestKeyPair(t, "bob")

	// Set up Genesis with 30,000,000 SOV total
	// Alice: 20M SOV, Bob: 10M SOV
	gen := node.GenesisState{
		ChainID:     "sovra-testnet-0",
		GenesisTime: genesisTime,
		Accounts: map[string]string{
			alice.Address: "20000000000000", // 20M SOV
			bob.Address:   "10000000000000", // 10M SOV
		},
		Validators: []node.GenesisValidator{
			{Name: "val1", Address: alice.Address, PubKeyHex: alice.PubKeyHex, VotingPower: 100},
		},
	}

	// 1. InitChain
	if err := app.InitChain(gen); err != nil {
		t.Fatalf("InitChain failed: %v", err)
	}

	if !app.QueryTotalSupply().Equal(issuancetypes.GenesisCap) {
		t.Fatalf("Supply %s != 30M SOV", app.QueryTotalSupply())
	}
	if !app.QueryBalance(alice.Address).Equal(math.NewInt(20_000_000_000_000)) {
		t.Fatalf("Alice initial balance mismatch")
	}

	// 2. BeginBlock 1 (t = genesisTime -> Epoch 1 activates)
	if err := app.BeginBlock(1, genesisTime); err != nil {
		t.Fatalf("BeginBlock failed: %v", err)
	}

	// 3. Signed Transfer: Alice sends 500,000 uSOV to Bob with 1,000 uSOV fee
	sendTx := node.SignedTransaction{
		Type:      node.TxTypeSend,
		Recipient: bob.Address,
		Amount:    "500000",
		Nonce:     0,
		Fee:       "1000",
	}
	signTransaction(alice, &sendTx)

	// CheckTx passes
	if err := app.CheckTx(sendTx); err != nil {
		t.Fatalf("CheckTx failed: %v", err)
	}

	// DeliverTx executes
	if err := app.DeliverTx(sendTx); err != nil {
		t.Fatalf("DeliverTx failed: %v", err)
	}

	// Verify balances
	expectedAlice := math.NewInt(20_000_000_000_000).SubRaw(500_000 + 1_000)
	expectedBob := math.NewInt(10_000_000_000_000).AddRaw(500_000)

	if !app.QueryBalance(alice.Address).Equal(expectedAlice) {
		t.Fatalf("Alice balance after send: %s != %s", app.QueryBalance(alice.Address), expectedAlice)
	}
	if !app.QueryBalance(bob.Address).Equal(expectedBob) {
		t.Fatalf("Bob balance after send: %s != %s", app.QueryBalance(bob.Address), expectedBob)
	}

	// Fee collector received 1,000 uSOV
	feeCollectorAddr := "sovra_module_" + issuancetypes.FeeCollectorName
	if app.QueryBalance(feeCollectorAddr).LT(math.NewInt(1000)) {
		t.Fatalf("Fee collector did not receive transaction fee")
	}

	// 4. Replay Protection: Re-submitting the exact same tx MUST fail CheckTx and DeliverTx
	if err := app.CheckTx(sendTx); err == nil {
		t.Fatalf("replay attack succeeded: expected nonce mismatch error")
	}

	// 5. Authenticated Burn: Alice burns 1,000,000 uSOV (1 SOV)
	burnTx := node.SignedTransaction{
		Type:   node.TxTypeBurn,
		Amount: "1000000",
		Nonce:  1, // Nonce incremented
		Fee:    "0",
	}
	signTransaction(alice, &burnTx)

	if err := app.CheckTx(burnTx); err != nil {
		t.Fatalf("CheckTx burn failed: %v", err)
	}
	if err := app.DeliverTx(burnTx); err != nil {
		t.Fatalf("DeliverTx burn failed: %v", err)
	}

	// Assert supply accounting
	if !app.QueryLifetimeBurned().Equal(math.NewInt(1_000_000)) {
		t.Fatalf("LifetimeBurned %s != 1,000,000", app.QueryLifetimeBurned())
	}

	// Commit block 1
	appHash := app.Commit()
	if len(appHash) != 32 {
		t.Fatalf("expected 32-byte sha256 app hash, got %d", len(appHash))
	}

	// Verify master supply invariant is strictly preserved
	supply := app.QueryTotalSupply()
	minted := app.QueryLifetimeMinted()
	burned := app.QueryLifetimeBurned()
	if !supply.Equal(minted.Sub(burned)) {
		t.Fatalf("master supply invariant broken: supply %s != minted %s - burned %s", supply, minted, burned)
	}
}

func TestSovraAppPersistentRestart(t *testing.T) {
	dir := t.TempDir()
	genesisTime := int64(1_700_000_000)

	// Create test users
	alice := generateTestKeyPair(t, "alice")
	bob := generateTestKeyPair(t, "bob")

	gen := node.GenesisState{
		ChainID:     "sovra-testnet-0",
		GenesisTime: genesisTime,
		Accounts: map[string]string{
			alice.Address: "20000000000000", // 20M SOV
			bob.Address:   "10000000000000", // 10M SOV
		},
		Validators: []node.GenesisValidator{
			{Name: "val1", Address: alice.Address, PubKeyHex: alice.PubKeyHex, VotingPower: 100},
		},
	}

	// 1. First run: Start from fresh Pebble disk store
	pStore1, err := store.NewPebbleStore(dir)
	if err != nil {
		t.Fatalf("failed to create pebble store: %v", err)
	}

	app1 := node.NewSovraApp(pStore1, genesisTime)
	if app1.IsChainInitialized() {
		t.Fatalf("expected uninitialized store initially")
	}

	if err := app1.InitChain(gen); err != nil {
		t.Fatalf("InitChain failed: %v", err)
	}

	// Produce Block 1: Transfer 1M uSOV Alice -> Bob
	if err := app1.BeginBlock(1, genesisTime); err != nil {
		t.Fatalf("BeginBlock failed: %v", err)
	}

	sendTx := node.SignedTransaction{
		Type:      node.TxTypeSend,
		Recipient: bob.Address,
		Amount:    "1000000",
		Nonce:     0,
		Fee:       "0",
	}
	signTransaction(alice, &sendTx)
	if err := app1.DeliverTx(sendTx); err != nil {
		t.Fatalf("DeliverTx failed: %v", err)
	}
	appHash1 := app1.Commit()

	// Gracefully shutdown first node instance and close database handle
	if err := pStore1.Close(); err != nil {
		t.Fatalf("failed to close pStore1: %v", err)
	}

	// 2. Second run: Node restarts from disk at height 1
	pStore2, err := store.NewPebbleStore(dir)
	if err != nil {
		t.Fatalf("failed to reopen pebble store: %v", err)
	}

	app2 := node.NewSovraApp(pStore2, genesisTime)

	// Verify state was fully restored from disk without calling InitChain!
	if !app2.IsChainInitialized() {
		t.Fatalf("expected chain to be initialized from disk")
	}
	if app2.GetHeight() != 1 {
		t.Fatalf("expected height 1 from disk, got %d", app2.GetHeight())
	}
	if !bytes.Equal(app2.GetAppHash(), appHash1) {
		t.Fatalf("appHash mismatch after restart")
	}

	// Verify account balances persisted
	expectedAlice := math.NewInt(20_000_000_000_000).SubRaw(1_000_000)
	expectedBob := math.NewInt(10_000_000_000_000).AddRaw(1_000_000)
	if !app2.QueryBalance(alice.Address).Equal(expectedAlice) {
		t.Fatalf("alice balance not restored: expected %s, got %s", expectedAlice, app2.QueryBalance(alice.Address))
	}
	if !app2.QueryBalance(bob.Address).Equal(expectedBob) {
		t.Fatalf("bob balance not restored: expected %s, got %s", expectedBob, app2.QueryBalance(bob.Address))
	}

	// Invariant: Trying to call InitChain again MUST fail to protect genesis state
	if err := app2.InitChain(gen); err == nil {
		t.Fatalf("expected error when re-running InitChain on initialized persistent store")
	}

	// Produce Block 2 on top of restored state
	if err := app2.BeginBlock(2, genesisTime+3); err != nil {
		t.Fatalf("BeginBlock 2 failed: %v", err)
	}
	_ = app2.Commit()

	if app2.GetHeight() != 2 {
		t.Fatalf("expected height 2, got %d", app2.GetHeight())
	}

	if err := pStore2.Close(); err != nil {
		t.Fatalf("failed to close pStore2: %v", err)
	}

	// 3. Third run: Verify height 2 persisted
	pStore3, err := store.NewPebbleStore(dir)
	if err != nil {
		t.Fatalf("failed to reopen pebble store 3: %v", err)
	}
	defer pStore3.Close()

	app3 := node.NewSovraApp(pStore3, genesisTime)
	if app3.GetHeight() != 2 {
		t.Fatalf("expected height 2 after 2nd restart, got %d", app3.GetHeight())
	}
}

func TestStakingDelegationAndUndelegation(t *testing.T) {
	memStore := store.NewMemoryStore()
	genesisTime := int64(1_700_000_000)
	app := node.NewSovraApp(memStore, genesisTime)

	alice := generateTestKeyPair(t, "alice")
	val1 := generateTestKeyPair(t, "val1")

	gen := node.GenesisState{
		ChainID:     "sovra-testnet-0",
		GenesisTime: genesisTime,
		Accounts: map[string]string{
			alice.Address: "10000000000000", // 10M SOV
			val1.Address:  "20000000000000", // 20M SOV
		},
		Validators: []node.GenesisValidator{
			{Name: "val1", Address: val1.Address, PubKeyHex: val1.PubKeyHex, VotingPower: 100},
		},
	}

	if err := app.InitChain(gen); err != nil {
		t.Fatalf("InitChain failed: %v", err)
	}

	if err := app.BeginBlock(1, genesisTime); err != nil {
		t.Fatalf("BeginBlock failed: %v", err)
	}

	// 1. Alice delegates 2,000,000 uSOV (2 SOV) to val1
	delTx := node.SignedTransaction{
		Type:      node.TxTypeDelegate,
		Recipient: val1.Address,
		Validator: val1.Address,
		Amount:    "2000000",
		Nonce:     0,
		Fee:       "1000",
	}
	signTransaction(alice, &delTx)

	if err := app.CheckTx(delTx); err != nil {
		t.Fatalf("CheckTx delegate failed: %v", err)
	}
	if err := app.DeliverTx(delTx); err != nil {
		t.Fatalf("DeliverTx delegate failed: %v", err)
	}

	// Verify delegation amount in store
	delBal := app.GetDelegation(memStore, alice.Address, val1.Address)
	if !delBal.Equal(math.NewInt(2_000_000)) {
		t.Fatalf("expected 2,000,000 uSOV delegation, got %s", delBal)
	}

	// 2. Alice undelegates 500,000 uSOV from val1
	undelTx := node.SignedTransaction{
		Type:      node.TxTypeUndelegate,
		Recipient: val1.Address,
		Validator: val1.Address,
		Amount:    "500000",
		Nonce:     1,
		Fee:       "1000",
	}
	signTransaction(alice, &undelTx)

	if err := app.CheckTx(undelTx); err != nil {
		t.Fatalf("CheckTx undelegate failed: %v", err)
	}
	if err := app.DeliverTx(undelTx); err != nil {
		t.Fatalf("DeliverTx undelegate failed: %v", err)
	}

	// Verify delegation decreased to 1,500,000 uSOV
	delBal2 := app.GetDelegation(memStore, alice.Address, val1.Address)
	if !delBal2.Equal(math.NewInt(1_500_000)) {
		t.Fatalf("expected 1,500,000 uSOV delegation, got %s", delBal2)
	}

	// 3. Excess undelegate attempt must fail CheckTx
	excessUndelTx := node.SignedTransaction{
		Type:      node.TxTypeUndelegate,
		Recipient: val1.Address,
		Validator: val1.Address,
		Amount:    "10000000", // exceeds 1.5M remaining
		Nonce:     2,
		Fee:       "1000",
	}
	signTransaction(alice, &excessUndelTx)

	if err := app.CheckTx(excessUndelTx); err == nil {
		t.Fatalf("expected excess undelegation to fail CheckTx")
	}
}

func TestSlashingAndGenesisExport(t *testing.T) {
	memStore := store.NewMemoryStore()
	genesisTime := int64(1_700_000_000)
	app := node.NewSovraApp(memStore, genesisTime)

	alice := generateTestKeyPair(t, "alice")
	bob := generateTestKeyPair(t, "bob")

	gen := node.GenesisState{
		ChainID:     "sovra-testnet-0",
		GenesisTime: genesisTime,
		Accounts: map[string]string{
			alice.Address: "20000000000000", // 20M SOV
			bob.Address:   "10000000000000", // 10M SOV
		},
		Validators: []node.GenesisValidator{
			{Name: "val-alice", Address: alice.Address, PubKeyHex: alice.PubKeyHex, VotingPower: 50},
			{Name: "val-bob", Address: bob.Address, PubKeyHex: bob.PubKeyHex, VotingPower: 50},
		},
	}

	if err := app.InitChain(gen); err != nil {
		t.Fatalf("InitChain failed: %v", err)
	}

	// 1. Export genesis and verify state round-trip
	exported, err := app.ExportGenesis()
	if err != nil {
		t.Fatalf("ExportGenesis failed: %v", err)
	}
	if exported.ChainID != "sovra-testnet-0" {
		t.Fatalf("expected ChainID sovra-testnet-0, got %s", exported.ChainID)
	}
	if exported.Accounts[alice.Address] != "20000000000000" {
		t.Fatalf("exported balance mismatch for alice")
	}
	if len(exported.Validators) != 2 {
		t.Fatalf("expected 2 validators, got %d", len(exported.Validators))
	}

	// 2. Double-Sign Slashing on Alice (5% = 500 bps)
	now := int64(1_700_000_100)
	slashedAmt, err := app.SlashValidator(alice.Address, 500, 3600, node.MisbehaviorDoubleSign)
	if err != nil {
		t.Fatalf("SlashValidator failed: %v", err)
	}
	expectedSlash := math.NewInt(20_000_000_000_000).Mul(math.NewInt(500)).Quo(math.NewInt(10000))
	if !slashedAmt.Equal(expectedSlash) {
		t.Fatalf("expected slash %s, got %s", expectedSlash, slashedAmt)
	}
	if !app.IsValidatorJailed(alice.Address, now) {
		t.Fatalf("expected Alice to be jailed after double-signing")
	}
	// Tombstoned validator can NEVER be unjailed
	if err := app.UnjailValidator(alice.Address, now+7200); err == nil {
		t.Fatalf("expected unjailing tombstoned validator to fail")
	}

	// 3. Downtime Tracking & Slashing on Bob
	// Simulate 4 missed blocks (threshold is 5)
	for i := 0; i < 4; i++ {
		slashed, err := app.RecordValidatorBlockActivity(bob.Address, false, now+int64(i), 5)
		if err != nil || slashed {
			t.Fatalf("unexpected slashing on block %d", i)
		}
	}
	if app.IsValidatorJailed(bob.Address, now) {
		t.Fatalf("Bob should not be jailed yet at 4 missed blocks")
	}

	// 5th missed block triggers downtime jail
	slashed, err := app.RecordValidatorBlockActivity(bob.Address, false, now+5, 5)
	if err != nil || !slashed {
		t.Fatalf("expected Bob to be slashed/jailed on 5th missed block")
	}
	if !app.IsValidatorJailed(bob.Address, now+5) {
		t.Fatalf("Bob should be jailed at 5 missed blocks")
	}

	// Cannot unjail before jail duration (600s) expires
	if err := app.UnjailValidator(bob.Address, now+5+100); err == nil {
		t.Fatalf("expected early unjail to fail")
	}

	// Can unjail after jail duration expires
	if err := app.UnjailValidator(bob.Address, now+5+601); err != nil {
		t.Fatalf("unjail after expiry failed: %v", err)
	}
	if app.IsValidatorJailed(bob.Address, now+5+601) {
		t.Fatalf("Bob should not be jailed after successful unjail")
	}
}


