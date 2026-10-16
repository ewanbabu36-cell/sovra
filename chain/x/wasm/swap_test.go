package wasm_test

import (
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/sovra/chain/node"
	"github.com/sovra/chain/store"
	"github.com/sovra/chain/x/wasm/vm"
)

func TestCosmWasmAMMSwapLifecycle(t *testing.T) {
	memStore := store.NewMemoryStore()
	genesisTime := int64(1_700_000_000)
	app := node.NewSovraApp(memStore, genesisTime)

	alice := generateKeyPair(t, "alice")
	bob := generateKeyPair(t, "bob")

	// Set up Genesis: Alice 20M SOV, Bob 10M SOV
	gen := node.GenesisState{
		ChainID:     "sovra-testnet-0",
		GenesisTime: genesisTime,
		Accounts: map[string]string{
			alice.Address: "20000000000000", // 20M SOV (in usov, 6 decimals)
			bob.Address:   "10000000000000", // 10M SOV
		},
		Validators: []node.GenesisValidator{
			{Name: "val1", Address: alice.Address, PubKeyHex: alice.PubKeyHex, VotingPower: 100},
		},
	}
	if err := app.InitChain(gen); err != nil {
		t.Fatalf("InitChain failed: %v", err)
	}

	// 1. Store CW20 Bytecode (CodeID 1)
	cw20Code := []byte("sovra_cw20_creator_token_standard_bytecode_v1")
	storeTx := node.SignedTransaction{
		Type:            node.TxTypeStoreCode,
		Fee:             "1000",
		Nonce:           0,
		WASMBytecodeHex: hex.EncodeToString(cw20Code),
	}
	signTx(alice, &storeTx)
	if err := app.DeliverTx(storeTx); err != nil {
		t.Fatalf("StoreCode CW20 failed: %v", err)
	}

	// 2. Instantiate CW20 Token (Contract 1)
	instantiateCw20Msg := vm.CW20InstantiateMsg{
		Name:     "Alice Creator Token",
		Symbol:   "ACT",
		Decimals: 6,
		InitialBalances: []vm.CW20InitialBalance{
			{Address: alice.Address, Amount: "1000000000"}, // 1000 ACT
		},
	}
	cBz, _ := json.Marshal(instantiateCw20Msg)
	instantiateCw20Tx := node.SignedTransaction{
		Type:   node.TxTypeInstantiateContract,
		CodeID: 1,
		Label:  "Alice Creator Token",
		Msg:    string(cBz),
		Fee:    "1000",
		Nonce:  1,
	}
	signTx(alice, &instantiateCw20Tx)
	if err := app.DeliverTx(instantiateCw20Tx); err != nil {
		t.Fatalf("Instantiate CW20 failed: %v", err)
	}
	cw20Addr := app.GetLastInstantiatedContract()

	// 3. Store Swap Bytecode (CodeID 2)
	swapCode := []byte("sovra_amm_swap_pair_standard_bytecode_v1")
	storeSwapTx := node.SignedTransaction{
		Type:            node.TxTypeStoreCode,
		Fee:             "1000",
		Nonce:           2,
		WASMBytecodeHex: hex.EncodeToString(swapCode),
	}
	signTx(alice, &storeSwapTx)
	if err := app.DeliverTx(storeSwapTx); err != nil {
		t.Fatalf("StoreCode Swap failed: %v", err)
	}

	// 4. Instantiate Swap Contract (Contract 2)
	// Initial pool: 1,000,000 usov (1 SOV) and 100,000,000 ACT (100 ACT)
	swapInstantiateMsg := vm.SwapInstantiateMsg{
		TokenAddress:   cw20Addr,
		CreatorAddress: alice.Address,
		ReserveSov:     "1000000",   // 1 SOV
		ReserveToken:   "100000000", // 100 ACT
		FeePercent:     1,           // 1% royalty
	}
	sBz, _ := json.Marshal(swapInstantiateMsg)
	instantiateSwapTx := node.SignedTransaction{
		Type:   node.TxTypeInstantiateContract,
		CodeID: 2,
		Label:  "ACT-SOV AMM Pool",
		Msg:    string(sBz),
		Fee:    "1000",
		Funds:  "1000000", // attach 1 SOV initial reserve
		Nonce:  3,
	}
	signTx(alice, &instantiateSwapTx)
	if err := app.DeliverTx(instantiateSwapTx); err != nil {
		t.Fatalf("Instantiate Swap failed: %v", err)
	}
	swapAddr := app.GetLastInstantiatedContract()

	// 5. Query Pool Info
	poolInfoQuery := []byte(`{"pool_info":{}}`)
	pRes, err := app.QueryWasmSmart(swapAddr, poolInfoQuery)
	if err != nil {
		t.Fatalf("Query pool_info failed: %v", err)
	}
	var poolData map[string]interface{}
	_ = json.Unmarshal(pRes, &poolData)
	if poolData["token_address"] != cw20Addr {
		t.Fatalf("Expected token_address %s, got %v", cw20Addr, poolData["token_address"])
	}
	if poolData["reserve_sov"] != "1000000" || poolData["reserve_token"] != "100000000" {
		t.Fatalf("Unexpected initial reserves: %+v", poolData)
	}

	// 6. Bob buys ACT tokens with 100,000 usov (0.1 SOV)
	// 1% fee = 1,000 usov to Alice (creator)
	// net_sov_in = 99,000 usov
	// Constant product token_out = (100,000,000 * 99,000) / (1,000,000 + 99,000) = 9,008,189 ACT tokens
	buyMsg := map[string]interface{}{
		"buy_tokens": map[string]string{
			"min_tokens": "9000000",
		},
	}
	bBz, _ := json.Marshal(buyMsg)
	buyTx := node.SignedTransaction{
		Type:     node.TxTypeExecuteContract,
		Contract: swapAddr,
		Msg:      string(bBz),
		Amount:   "100000", // 100,000 usov attached
		Fee:      "1000",
		Nonce:    0,
	}
	signTx(bob, &buyTx)

	alicePreBuyBal := app.QueryBalance(alice.Address)

	if err := app.DeliverTx(buyTx); err != nil {
		t.Fatalf("DeliverTx buy_tokens failed: %v", err)
	}

	// Check that Alice received 1% royalty (1,000 usov)
	alicePostBuyBal := app.QueryBalance(alice.Address)
	royaltyEarned := alicePostBuyBal.Sub(alicePreBuyBal)
	if royaltyEarned.String() != "1000" {
		t.Fatalf("Expected Alice royalty 1000, got %s", royaltyEarned.String())
	}

	// Query Bob's CW20 token balance in the token contract
	bobBalQuery := []byte(`{"balance":{"address":"` + bob.Address + `"}}`)
	bobBalBz, err := app.QueryWasmSmart(cw20Addr, bobBalQuery)
	if err != nil {
		t.Fatalf("Query bob balance failed: %v", err)
	}
	var bobBal map[string]string
	_ = json.Unmarshal(bobBalBz, &bobBal)
	if bobBal["balance"] != "9008189" {
		t.Fatalf("Expected Bob balance 9008189 ACT, got %s", bobBal["balance"])
	}

	// 7. Bob sells half his tokens (4,500,000 ACT) back for SOV
	sellMsg := map[string]interface{}{
		"sell_tokens": map[string]string{
			"amount":  "4500000",
			"min_sov": "40000",
		},
	}
	sExecBz, _ := json.Marshal(sellMsg)
	sellTx := node.SignedTransaction{
		Type:     node.TxTypeExecuteContract,
		Contract: swapAddr,
		Msg:      string(sExecBz),
		Fee:      "1000",
		Nonce:    1,
	}
	signTx(bob, &sellTx)

	bobPreSellBal := app.QueryBalance(bob.Address)

	if err := app.DeliverTx(sellTx); err != nil {
		t.Fatalf("DeliverTx sell_tokens failed: %v", err)
	}

	bobPostSellBal := app.QueryBalance(bob.Address)
	netSovReceived := bobPostSellBal.Sub(bobPreSellBal).AddRaw(1000) // account for fee
	if netSovReceived.IsZero() || netSovReceived.IsNegative() {
		t.Fatalf("Expected positive net SOV received by Bob from sell, got %s", netSovReceived.String())
	}

	// Bob's CW20 token balance should be exactly 9,008,189 - 4,500,000 = 4,508,189
	bobBalBz, _ = app.QueryWasmSmart(cw20Addr, bobBalQuery)
	_ = json.Unmarshal(bobBalBz, &bobBal)
	if bobBal["balance"] != "4508189" {
		t.Fatalf("Expected Bob balance 4508189 ACT, got %s", bobBal["balance"])
	}
}
