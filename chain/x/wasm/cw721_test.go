package wasm_test

import (
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/sovra/chain/node"
	"github.com/sovra/chain/store"
	wasmtypes "github.com/sovra/chain/x/wasm/types"
	"github.com/sovra/chain/x/wasm/vm"
)

func TestCW721NFTLifecycle(t *testing.T) {
	memStore := store.NewMemoryStore()
	genesisTime := int64(1_700_000_000)
	app := node.NewSovraApp(memStore, genesisTime)

	alice := generateKeyPair(t, "alice")
	bob := generateKeyPair(t, "bob")

	gen := node.GenesisState{
		ChainID:     "sovra-testnet-0",
		GenesisTime: genesisTime,
		Accounts: map[string]string{
			alice.Address: "20000000000000",
			bob.Address:   "10000000000000",
		},
		Validators: []node.GenesisValidator{
			{Name: "val1", Address: alice.Address, PubKeyHex: alice.PubKeyHex, VotingPower: 100},
		},
	}

	if err := app.InitChain(gen); err != nil {
		t.Fatalf("InitChain failed: %v", err)
	}

	// 1. Store CW721 Bytecode
	cw721Bytecode := []byte("sovra_cw721_nft_standard_bytecode_v1")
	storeTx := node.SignedTransaction{
		Type:            node.TxTypeStoreCode,
		Fee:             "1000",
		Nonce:           0,
		WASMBytecodeHex: hex.EncodeToString(cw721Bytecode),
	}
	signTx(alice, &storeTx)

	if err := app.CheckTx(storeTx); err != nil {
		t.Fatalf("CheckTx storeCode failed: %v", err)
	}
	if err := app.DeliverTx(storeTx); err != nil {
		t.Fatalf("DeliverTx storeCode failed: %v", err)
	}

	// 2. Instantiate CW721 Contract
	instantiateMsg := vm.CW721InstantiateMsg{
		Name:   "Sovra VIP Backstage Passes",
		Symbol: "SOVVIP",
		Minter: alice.Address,
	}
	instantiateBz, _ := json.Marshal(instantiateMsg)

	instantiateTx := node.SignedTransaction{
		Type:   node.TxTypeInstantiateContract,
		CodeID: 1,
		Label:  "Backstage Passes",
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

	contractAddr := wasmtypes.BuildContractAddress(1, 1)

	// 3. Mint Token #1 to Alice
	mintMsg1 := map[string]interface{}{
		"mint": vm.CW721MintMsg{
			TokenId:  "vip_pass_001",
			Owner:    alice.Address,
			TokenUri: "ipfs://bafybeivippass001",
			Extension: map[string]interface{}{
				"tier":        "Gold Inner Circle",
				"perks":       "Backstage + Meet & Greet",
				"accessLevel": 1,
			},
		},
	}
	mintBz1, _ := json.Marshal(mintMsg1)

	mintTx1 := node.SignedTransaction{
		Type:            node.TxTypeExecuteContract,
		Contract: contractAddr,
		Msg:             string(mintBz1),
		Fee:             "1000",
		Nonce:           2,
	}
	signTx(alice, &mintTx1)

	if err := app.CheckTx(mintTx1); err != nil {
		t.Fatalf("CheckTx mint 1 failed: %v", err)
	}
	if err := app.DeliverTx(mintTx1); err != nil {
		t.Fatalf("DeliverTx mint 1 failed: %v", err)
	}

	// 4. Query NumTokens
	numTokensBz, err := app.QueryWasmSmart(contractAddr, []byte(`{"num_tokens":{}}`))
	if err != nil {
		t.Fatalf("Query num_tokens failed: %v", err)
	}
	var numTokens vm.CW721NumTokensResponse
	_ = json.Unmarshal(numTokensBz, &numTokens)
	if numTokens.Count != 1 {
		t.Fatalf("Expected 1 token, got %d", numTokens.Count)
	}

	// 5. Query OwnerOf Token #1
	ownerOfBz, err := app.QueryWasmSmart(contractAddr, []byte(`{"owner_of":{"token_id":"vip_pass_001"}}`))
	if err != nil {
		t.Fatalf("Query owner_of failed: %v", err)
	}
	var ownerOf vm.CW721OwnerOfResponse
	_ = json.Unmarshal(ownerOfBz, &ownerOf)
	if ownerOf.Owner != alice.Address {
		t.Fatalf("Expected owner %s, got %s", alice.Address, ownerOf.Owner)
	}

	// 6. Query NftInfo
	nftInfoBz, err := app.QueryWasmSmart(contractAddr, []byte(`{"nft_info":{"token_id":"vip_pass_001"}}`))
	if err != nil {
		t.Fatalf("Query nft_info failed: %v", err)
	}
	var nftInfo vm.CW721NFTInfoData
	_ = json.Unmarshal(nftInfoBz, &nftInfo)
	if nftInfo.TokenUri != "ipfs://bafybeivippass001" {
		t.Fatalf("Expected token_uri ipfs://bafybeivippass001, got %s", nftInfo.TokenUri)
	}

	// 7. Mint Token #2 to Bob
	mintMsg2 := map[string]interface{}{
		"mint": vm.CW721MintMsg{
			TokenId:  "vip_pass_002",
			Owner:    bob.Address,
			TokenUri: "ipfs://bafybeivippass002",
			Extension: map[string]interface{}{
				"tier": "Silver Supporter",
			},
		},
	}
	mintBz2, _ := json.Marshal(mintMsg2)
	mintTx2 := node.SignedTransaction{
		Type:            node.TxTypeExecuteContract,
		Contract: contractAddr,
		Msg:             string(mintBz2),
		Fee:             "1000",
		Nonce:           3,
	}
	signTx(alice, &mintTx2)

	if err := app.CheckTx(mintTx2); err != nil {
		t.Fatalf("CheckTx mint 2 failed: %v", err)
	}
	if err := app.DeliverTx(mintTx2); err != nil {
		t.Fatalf("DeliverTx mint 2 failed: %v", err)
	}

	// 8. Transfer Token #1 from Alice to Bob
	transferMsg := map[string]interface{}{
		"transfer_nft": vm.CW721TransferNftMsg{
			Recipient: bob.Address,
			TokenId:   "vip_pass_001",
		},
	}
	transferBz, _ := json.Marshal(transferMsg)
	transferTx := node.SignedTransaction{
		Type:            node.TxTypeExecuteContract,
		Contract: contractAddr,
		Msg:             string(transferBz),
		Fee:             "1000",
		Nonce:           4,
	}
	signTx(alice, &transferTx)

	if err := app.CheckTx(transferTx); err != nil {
		t.Fatalf("CheckTx transfer failed: %v", err)
	}
	if err := app.DeliverTx(transferTx); err != nil {
		t.Fatalf("DeliverTx transfer failed: %v", err)
	}

	// 9. Query OwnerOf Token #1 - should now be Bob
	ownerOfBz2, _ := app.QueryWasmSmart(contractAddr, []byte(`{"owner_of":{"token_id":"vip_pass_001"}}`))
	var ownerOf2 vm.CW721OwnerOfResponse
	_ = json.Unmarshal(ownerOfBz2, &ownerOf2)
	if ownerOf2.Owner != bob.Address {
		t.Fatalf("Expected new owner %s, got %s", bob.Address, ownerOf2.Owner)
	}

	// 10. Query Bob's Tokens
	tokensBz, _ := app.QueryWasmSmart(contractAddr, []byte(`{"tokens":{"owner":"`+bob.Address+`"}}`))
	var tokensResp vm.CW721TokensResponse
	_ = json.Unmarshal(tokensBz, &tokensResp)
	if len(tokensResp.Tokens) != 2 {
		t.Fatalf("Expected Bob to own 2 tokens, got %d", len(tokensResp.Tokens))
	}

	// 11. Bob Burns Token #2
	burnMsg := map[string]interface{}{
		"burn": vm.CW721BurnMsg{
			TokenId: "vip_pass_002",
		},
	}
	burnBz, _ := json.Marshal(burnMsg)
	burnTx := node.SignedTransaction{
		Type:            node.TxTypeExecuteContract,
		Contract: contractAddr,
		Msg:             string(burnBz),
		Fee:             "1000",
		Nonce:           0,
	}
	signTx(bob, &burnTx)

	if err := app.CheckTx(burnTx); err != nil {
		t.Fatalf("CheckTx burn failed: %v", err)
	}
	if err := app.DeliverTx(burnTx); err != nil {
		t.Fatalf("DeliverTx burn failed: %v", err)
	}

	// 12. Final count should be 1
	finalCountBz, _ := app.QueryWasmSmart(contractAddr, []byte(`{"num_tokens":{}}`))
	var finalCount vm.CW721NumTokensResponse
	_ = json.Unmarshal(finalCountBz, &finalCount)
	if finalCount.Count != 1 {
		t.Fatalf("Expected final count 1, got %d", finalCount.Count)
	}
}
