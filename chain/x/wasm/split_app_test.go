package wasm_test

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"testing"

	"cosmossdk.io/math"
	"github.com/sovra/chain/node"
	"github.com/sovra/chain/store"
	"github.com/sovra/chain/x/auth"
	issuancetypes "github.com/sovra/chain/x/issuance/types"
	wasmtypes "github.com/sovra/chain/x/wasm/types"
	"github.com/sovra/chain/x/wasm/vm"
	"github.com/stretchr/testify/require"
)

func generateSplitTestAccount(t *testing.T, name string) *node.KeyPair {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
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

func signSplitTx(kp *node.KeyPair, tx *node.SignedTransaction) {
	tx.Sender = kp.Address
	tx.PubKeyHex = kp.PubKeyHex
	signBytes := tx.GetSignBytes()
	sig := ed25519.Sign(kp.PrivateKey, signBytes)
	tx.SigHex = hex.EncodeToString(sig)
}

func TestCreatorRevenueSplit_BlockchainLifecycle(t *testing.T) {
	memStore := store.NewMemoryStore()
	genesisTime := int64(1_700_000_000)
	app := node.NewSovraApp(memStore, genesisTime)

	// Create test personas:
	// Alice (Creator / Admin)
	// Bob (Co-host, 20%)
	// Charlie (Editor / Producer, 10%)
	// Dave (Supporter / Tipper)
	alice := generateSplitTestAccount(t, "alice")
	bob := generateSplitTestAccount(t, "bob")
	charlie := generateSplitTestAccount(t, "charlie")
	dave := generateSplitTestAccount(t, "dave")

	// Set up Genesis with 30,000,000 SOV total
	// Alice: 15M SOV, Dave: 15M SOV, Bob: 0, Charlie: 0
	gen := node.GenesisState{
		ChainID:     "sovra-testnet-0",
		GenesisTime: genesisTime,
		Accounts: map[string]string{
			alice.Address: "15000000000000",
			dave.Address:  "15000000000000",
		},
		Validators: []node.GenesisValidator{
			{Name: "val1", Address: alice.Address, PubKeyHex: alice.PubKeyHex, VotingPower: 100},
		},
	}

	require.NoError(t, app.InitChain(gen))
	require.Equal(t, issuancetypes.GenesisCap.String(), app.QueryTotalSupply().String())

	// 1. Store CosmWasm Split Bytecode on-chain
	splitBytecode := []byte("cw_split_v1")
	storeTx := node.SignedTransaction{
		Type:            node.TxTypeStoreCode,
		Fee:             "1000",
		Nonce:           0,
		WASMBytecodeHex: hex.EncodeToString(splitBytecode),
	}
	signSplitTx(alice, &storeTx)

	require.NoError(t, app.CheckTx(storeTx))
	require.NoError(t, app.DeliverTx(storeTx))

	codeInfo, err := app.QueryWasmCode(1)
	require.NoError(t, err)
	require.Equal(t, uint64(1), codeInfo.CodeID)
	require.Equal(t, alice.Address, codeInfo.Creator)

	// 2. Instantiate Creator Revenue Split Contract (70% Alice, 20% Bob, 10% Charlie)
	initMsg := vm.SplitInstantiateMsg{
		Admin: alice.Address,
		Title: "Podcast & Creative Team Revenue Pool",
		Recipients: []vm.SplitRecipient{
			{Address: alice.Address, Weight: 7000},  // 70%
			{Address: bob.Address, Weight: 2000},    // 20%
			{Address: charlie.Address, Weight: 1000}, // 10%
		},
		MinPayout: "100",
	}
	initBz, err := json.Marshal(initMsg)
	require.NoError(t, err)

	instantiateTx := node.SignedTransaction{
		Type:      node.TxTypeInstantiateContract,
		Fee:       "1000",
		Nonce:     1,
		CodeID:    1,
		Label:     "podcast-rev-share",
		Msg:       string(initBz),
		Funds:     "0",
	}
	signSplitTx(alice, &instantiateTx)

	require.NoError(t, app.CheckTx(instantiateTx))
	require.NoError(t, app.DeliverTx(instantiateTx))

	// Compute contract address (CodeID: 1, InstanceID: 1)
	contractAddr := wasmtypes.BuildContractAddress(1, 1)
	require.NotEmpty(t, contractAddr, "instantiated split contract address must be discovered")

	// Verify on-chain config via QuerySmartContract
	configQueryBz := []byte(`{"config":{}}`)
	rawConfig, err := app.QueryWasmSmart(contractAddr, configQueryBz)
	require.NoError(t, err)
	var splitCfg vm.SplitConfig
	require.NoError(t, json.Unmarshal(rawConfig, &splitCfg))
	require.Equal(t, alice.Address, splitCfg.Admin)
	require.Equal(t, "Podcast & Creative Team Revenue Pool", splitCfg.Title)
	require.Equal(t, uint64(10000), splitCfg.TotalWeight)
	require.Len(t, splitCfg.Recipients, 3)

	// Verify Bob's initial balance is zero
	bobInitialBal := app.QueryBalance(bob.Address)
	require.True(t, bobInitialBal.IsZero())

	// Verify Charlie's initial balance is zero
	charlieInitialBal := app.QueryBalance(charlie.Address)
	require.True(t, charlieInitialBal.IsZero())

	// 3. Dave Tips / Streams Revenue to the Creator Split Contract
	// Dave sends 10,000,000 uSOV (10 SOVRA) with `{"distribute":{}}`
	tipAmount := "10000000"
	gasFee := "1000"
	daveInitialBal := app.QueryBalance(dave.Address)
	aliceBeforeBal := app.QueryBalance(alice.Address)

	distributeTx := node.SignedTransaction{
		Type:      node.TxTypeExecuteContract,
		Fee:       gasFee,
		Nonce:     0,
		Contract:  contractAddr,
		Msg:       `{"distribute":{}}`,
		Funds:     tipAmount,
	}
	signSplitTx(dave, &distributeTx)

	require.NoError(t, app.CheckTx(distributeTx))
	require.NoError(t, app.DeliverTx(distributeTx))

	// 4. Assert Atomic On-Chain Ledger Balances:
	// - Dave: initial - 10,000,000 - 1,000 fee
	tipInt, _ := math.NewIntFromString(tipAmount)
	feeInt, _ := math.NewIntFromString(gasFee)
	expectedDaveBal := daveInitialBal.Sub(tipInt).Sub(feeInt)
	require.Equal(t, expectedDaveBal.String(), app.QueryBalance(dave.Address).String())

	// - Alice: before + 7,000,000 (70% share)
	aliceShareInt, _ := math.NewIntFromString("7000000")
	expectedAliceBal := aliceBeforeBal.Add(aliceShareInt)
	require.Equal(t, expectedAliceBal.String(), app.QueryBalance(alice.Address).String())

	// - Bob: 2,000,000 (20% share)
	require.Equal(t, "2000000", app.QueryBalance(bob.Address).String())

	// - Charlie: 1,000,000 (10% share)
	require.Equal(t, "1000000", app.QueryBalance(charlie.Address).String())

	// 5. MinPayout Threshold Enforcement: Dave attempts to distribute 99 uSOV (< 100 uSOV threshold)
	underMinTx := node.SignedTransaction{
		Type:     node.TxTypeExecuteContract,
		Fee:      gasFee,
		Nonce:    1,
		Contract: contractAddr,
		Msg:      `{"distribute":{}}`,
		Funds:    "99",
	}
	signSplitTx(dave, &underMinTx)
	require.Error(t, app.DeliverTx(underMinTx), "distribution below MinPayout threshold must be rejected")

	// 6. Zero-Loss Dust Remainder Test on Live Ledger:
	// Dave distributes 101 uSOV:
	// Total weight: 10,000
	// Alice:   (101 * 7,000) / 10,000 = 70 uSOV
	// Bob:     (101 * 2,000) / 10,000 = 20 uSOV
	// Charlie: (101 * 1,000) / 10,000 = 10 uSOV
	// Sum: 70 + 20 + 10 = 100 uSOV. Remainder: 101 - 100 = 1 uSOV.
	// Remainder goes to Alice (primary recipient) => Alice gets 70 + 1 = 71 uSOV!
	oddDistributeTx := node.SignedTransaction{
		Type:     node.TxTypeExecuteContract,
		Fee:      gasFee,
		Nonce:    1,
		Contract: contractAddr,
		Msg:      `{"distribute":{}}`,
		Funds:    "101",
	}
	signSplitTx(dave, &oddDistributeTx)
	require.NoError(t, app.CheckTx(oddDistributeTx))
	require.NoError(t, app.DeliverTx(oddDistributeTx))

	// Alice gains 71 uSOV
	require.Equal(t, expectedAliceBal.Add(math.NewInt(71)).String(), app.QueryBalance(alice.Address).String())
	// Bob gains 20 uSOV
	require.Equal(t, "2000020", app.QueryBalance(bob.Address).String())
	// Charlie gains 10 uSOV
	require.Equal(t, "1000010", app.QueryBalance(charlie.Address).String())

	// Invariant: Total bank supply remains constant (minus burned fees)
	// Query cumulative earnings via Smart Query
	bobQueryBz := []byte(`{"recipient_share":{"address":"` + bob.Address + `"}}`)
	bobQueryResp, err := app.QueryWasmSmart(contractAddr, bobQueryBz)
	require.NoError(t, err)
	var bobShareInfo struct {
		IsRecipient   bool   `json:"is_recipient"`
		Weight        uint64 `json:"weight"`
		PercentageBps uint64 `json:"percentage_bps"`
		TotalEarned   string `json:"total_earned_usov"`
	}
	require.NoError(t, json.Unmarshal(bobQueryResp, &bobShareInfo))
	require.True(t, bobShareInfo.IsRecipient)
	require.Equal(t, uint64(2000), bobShareInfo.PercentageBps)
	require.Equal(t, "2000020", bobShareInfo.TotalEarned)

	// 6. Access Control: Non-admin cannot alter recipient split weights
	unauthUpdateTx := node.SignedTransaction{
		Type:     node.TxTypeExecuteContract,
		Fee:      gasFee,
		Nonce:    2,
		Contract: contractAddr,
		Msg:      `{"update_recipients":{"recipients":[{"address":"` + dave.Address + `","weight":100}]}}`,
	}
	signSplitTx(dave, &unauthUpdateTx)
	// DeliverTx must reject unauthorized configuration changes
	err = app.DeliverTx(unauthUpdateTx)
	require.Error(t, err)
	require.Contains(t, err.Error(), "unauthorized")

	// 7. Admin Alice updates split to 50/50 between Alice and Bob
	validUpdateTx := node.SignedTransaction{
		Type:     node.TxTypeExecuteContract,
		Fee:      gasFee,
		Nonce:    2,
		Contract: contractAddr,
		Msg:      `{"update_recipients":{"recipients":[{"address":"` + alice.Address + `","weight":5000},{"address":"` + bob.Address + `","weight":5000}]}}`,
	}
	signSplitTx(alice, &validUpdateTx)
	require.NoError(t, app.CheckTx(validUpdateTx))
	require.NoError(t, app.DeliverTx(validUpdateTx))

	// Verify updated configuration on-chain
	updatedCfgRaw, err := app.QueryWasmSmart(contractAddr, configQueryBz)
	require.NoError(t, err)
	var updatedCfg vm.SplitConfig
	require.NoError(t, json.Unmarshal(updatedCfgRaw, &updatedCfg))
	require.Len(t, updatedCfg.Recipients, 2)
	require.Equal(t, uint64(10000), updatedCfg.TotalWeight)
}
