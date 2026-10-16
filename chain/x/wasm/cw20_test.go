package wasm_test

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/sovra/chain/node"
	"github.com/sovra/chain/store"
	"github.com/sovra/chain/x/auth"
	issuancetypes "github.com/sovra/chain/x/issuance/types"
	wasmtypes "github.com/sovra/chain/x/wasm/types"
	"github.com/sovra/chain/x/wasm/vm"
)

func generateKeyPair(t *testing.T, name string) *node.KeyPair {
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

func signTx(kp *node.KeyPair, tx *node.SignedTransaction) {
	tx.Sender = kp.Address
	tx.PubKeyHex = kp.PubKeyHex
	signBytes := tx.GetSignBytes()
	sig := ed25519.Sign(kp.PrivateKey, signBytes)
	tx.SigHex = hex.EncodeToString(sig)
}

func TestCW20CreatorTokenLifecycle(t *testing.T) {
	memStore := store.NewMemoryStore()
	genesisTime := int64(1_700_000_000)
	app := node.NewSovraApp(memStore, genesisTime)

	// Create test users: Alice (creator) and Bob (community member)
	alice := generateKeyPair(t, "alice")
	bob := generateKeyPair(t, "bob")

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

	if err := app.InitChain(gen); err != nil {
		t.Fatalf("InitChain failed: %v", err)
	}

	initialNativeSupply := app.QueryTotalSupply()
	if !initialNativeSupply.Equal(issuancetypes.GenesisCap) {
		t.Fatalf("Initial supply %s != %s", initialNativeSupply, issuancetypes.GenesisCap)
	}

	// 1. Storing CW20 creator token WASM bytecode
	cw20Bytecode := []byte("sovra_cw20_creator_token_standard_bytecode_v1")
	storeTx := node.SignedTransaction{
		Type:            node.TxTypeStoreCode,
		Fee:             "1000",
		Nonce:           0,
		WASMBytecodeHex: hex.EncodeToString(cw20Bytecode),
	}
	signTx(alice, &storeTx)

	if err := app.CheckTx(storeTx); err != nil {
		t.Fatalf("CheckTx storeCode failed: %v", err)
	}
	if err := app.DeliverTx(storeTx); err != nil {
		t.Fatalf("DeliverTx storeCode failed: %v", err)
	}

	// Verify Code was stored
	codeInfo, err := app.QueryWasmCode(1)
	if err != nil {
		t.Fatalf("Failed to query stored code: %v", err)
	}
	if codeInfo.CodeID != 1 {
		t.Fatalf("Expected code ID 1, got %d", codeInfo.CodeID)
	}
	if codeInfo.Creator != alice.Address {
		t.Fatalf("Expected creator %s, got %s", alice.Address, codeInfo.Creator)
	}

	// 2. Instantiating CW20 Creator Token contract
	instantiateMsg := vm.CW20InstantiateMsg{
		Name:     "Alice Creator Token",
		Symbol:   "ACT",
		Decimals: 6,
		InitialBalances: []vm.CW20InitialBalance{
			{Address: alice.Address, Amount: "1000000000"}, // 1,000 ACT tokens
		},
		Mint: &vm.CW20MinterInfo{
			Minter: alice.Address,
		},
	}
	instantiateBz, err := json.Marshal(instantiateMsg)
	if err != nil {
		t.Fatalf("Marshal instantiateMsg failed: %v", err)
	}

	instantiateTx := node.SignedTransaction{
		Type:   node.TxTypeInstantiateContract,
		CodeID: 1,
		Label:  "Alice Creator Token",
		Msg:    string(instantiateBz),
		Fee:    "1000",
		Nonce:  1,
	}
	signTx(alice, &instantiateTx)

	if err := app.CheckTx(instantiateTx); err != nil {
		t.Fatalf("CheckTx instantiate failed: %v", err)
	}
	if err := app.DeliverTx(instantiateTx); err != nil {
		t.Fatalf("DeliverTx instantiate failed: %v", err)
	}

	// Compute contract address
	contractAddr := wasmtypes.BuildContractAddress(1, 1)

	// Verify contract info
	cMeta, err := app.QueryWasmContractInfo(contractAddr)
	if err != nil {
		t.Fatalf("Failed to query contract info: %v", err)
	}
	if cMeta.Label != "Alice Creator Token" {
		t.Fatalf("Unexpected contract label: %s", cMeta.Label)
	}
	if cMeta.Creator != alice.Address {
		t.Fatalf("Unexpected contract creator: %s", cMeta.Creator)
	}

	// Query token info smart contract state
	tokenInfoQuery := []byte(`{"token_info":{}}`)
	tokenInfoBz, err := app.QueryWasmSmart(contractAddr, tokenInfoQuery)
	if err != nil {
		t.Fatalf("Query token_info failed: %v", err)
	}
	var tokenInfo vm.CW20TokenInfo
	if err := json.Unmarshal(tokenInfoBz, &tokenInfo); err != nil {
		t.Fatalf("Unmarshal token_info failed: %v", err)
	}
	if tokenInfo.Name != "Alice Creator Token" || tokenInfo.Symbol != "ACT" || tokenInfo.TotalSupply != "1000000000" {
		t.Fatalf("Invalid token_info: %+v", tokenInfo)
	}

	// Query Alice CW20 balance
	aliceBalQuery := []byte(`{"balance":{"address":"` + alice.Address + `"}}`)
	aliceBalBz, err := app.QueryWasmSmart(contractAddr, aliceBalQuery)
	if err != nil {
		t.Fatalf("Query alice balance failed: %v", err)
	}
	var aliceBal map[string]string
	_ = json.Unmarshal(aliceBalBz, &aliceBal)
	if aliceBal["balance"] != "1000000000" {
		t.Fatalf("Expected Alice balance 1000000000, got %s", aliceBal["balance"])
	}

	// Query Bob CW20 balance before transfer
	bobBalQuery := []byte(`{"balance":{"address":"` + bob.Address + `"}}`)
	bobBalBz, err := app.QueryWasmSmart(contractAddr, bobBalQuery)
	if err != nil {
		t.Fatalf("Query bob balance failed: %v", err)
	}
	var bobBal map[string]string
	_ = json.Unmarshal(bobBalBz, &bobBal)
	if bobBal["balance"] != "0" {
		t.Fatalf("Expected Bob balance 0, got %s", bobBal["balance"])
	}

	// 3. Executing a transfer of 250,000,000 ACT from Alice to Bob
	transferMsg := map[string]interface{}{
		"transfer": map[string]string{
			"recipient": bob.Address,
			"amount":    "250000000",
		},
	}
	transferBz, _ := json.Marshal(transferMsg)

	execTx := node.SignedTransaction{
		Type:     node.TxTypeExecuteContract,
		Contract: contractAddr,
		Msg:      string(transferBz),
		Fee:      "1000",
		Nonce:    2,
	}
	signTx(alice, &execTx)

	if err := app.CheckTx(execTx); err != nil {
		t.Fatalf("CheckTx execute transfer failed: %v", err)
	}
	if err := app.DeliverTx(execTx); err != nil {
		t.Fatalf("DeliverTx execute transfer failed: %v", err)
	}

	// 4. Query balances after transfer
	aliceBalBz, _ = app.QueryWasmSmart(contractAddr, aliceBalQuery)
	_ = json.Unmarshal(aliceBalBz, &aliceBal)
	if aliceBal["balance"] != "750000000" {
		t.Fatalf("Expected Alice balance 750000000, got %s", aliceBal["balance"])
	}

	bobBalBz, _ = app.QueryWasmSmart(contractAddr, bobBalQuery)
	_ = json.Unmarshal(bobBalBz, &bobBal)
	if bobBal["balance"] != "250000000" {
		t.Fatalf("Expected Bob balance 250000000, got %s", bobBal["balance"])
	}

	// 5. Test error case: Bob attempts to transfer more than his balance (300,000,000)
	overTransferMsg := map[string]interface{}{
		"transfer": map[string]string{
			"recipient": alice.Address,
			"amount":    "300000000",
		},
	}
	overTransferBz, _ := json.Marshal(overTransferMsg)
	overTx := node.SignedTransaction{
		Type:     node.TxTypeExecuteContract,
		Contract: contractAddr,
		Msg:      string(overTransferBz),
		Fee:      "1000",
		Nonce:    0,
	}
	signTx(bob, &overTx)

	if err := app.DeliverTx(overTx); err == nil {
		t.Fatalf("Expected transfer exceeding balance to fail, but it succeeded")
	}

	// Verify Bob's balance did not change after failed tx
	bobBalBz, _ = app.QueryWasmSmart(contractAddr, bobBalQuery)
	_ = json.Unmarshal(bobBalBz, &bobBal)
	if bobBal["balance"] != "250000000" {
		t.Fatalf("Bob balance altered on failed tx: %s", bobBal["balance"])
	}

	// 6. Strict Verification: L1 native bank total supply invariants remain strictly preserved
	finalNativeSupply := app.QueryTotalSupply()
	if !finalNativeSupply.Equal(initialNativeSupply) {
		t.Fatalf("L1 Total native supply changed! Initial: %s, Final: %s", initialNativeSupply, finalNativeSupply)
	}

	// Verify master supply invariant holds
	minted := app.QueryLifetimeMinted()
	burned := app.QueryLifetimeBurned()
	if !finalNativeSupply.Equal(minted.Sub(burned)) {
		t.Fatalf("Master supply invariant violated: supply %s != minted %s - burned %s", finalNativeSupply, minted, burned)
	}
}

func TestWazeroWasmRuntimeExecution(t *testing.T) {
	// Verify that pure-Go wazero engine compiles and executes WebAssembly bytecode without CGo
	cfg := wasmtypes.DefaultWasmConfig()
	wazeroVM := vm.NewWasmVM(cfg)

	// Minimal valid WASM bytecode (\0asm with version 1)
	minimalWasm := []byte{
		0x00, 0x61, 0x73, 0x6d, // \0asm
		0x01, 0x00, 0x00, 0x00, // version 1
	}

	if !vm.IsWasmBytecode(minimalWasm) {
		t.Fatalf("Expected minimalWasm to be recognized as WebAssembly binary")
	}

	memStorage := vm.NewMemoryStorage()
	env := wasmtypes.Env{
		Block: wasmtypes.BlockInfo{
			Height:  1,
			Time:    1_700_000_000,
			ChainID: "sovra-testnet-0",
		},
		Contract: wasmtypes.ContractInfoSummary{
			Address: "sovra1wasmtest",
		},
	}
	info := wasmtypes.MessageInfo{
		Sender: "sovra1creator",
	}

	// Calling Instantiate on valid minimal WASM module executes via wazero sandbox
	resp, err := wazeroVM.Instantiate(minimalWasm, memStorage, env, info, []byte(`{}`))
	if err != nil {
		t.Fatalf("Wazero instantiate execution failed: %v", err)
	}
	if resp == nil {
		t.Fatalf("Expected non-nil response from wazero execution")
	}
}
