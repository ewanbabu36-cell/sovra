package wasm_test

import (
	"encoding/json"
	"testing"

	"github.com/sovra/chain/x/wasm/types"
	"github.com/sovra/chain/x/wasm/vm"
	"github.com/stretchr/testify/require"
)

func TestCreatorRevenueSplit_InstantiateAndQuery(t *testing.T) {
	storage := vm.NewMemoryStorage()
	wasmVM := vm.NewWasmVM(types.DefaultWasmConfig())

	env := types.Env{
		Block: types.BlockInfo{Height: 1, Time: 1000, ChainID: "sovra-testnet-0"},
		Contract: types.ContractInfoSummary{Address: "sovra1splitcontract001"},
	}
	info := types.MessageInfo{Sender: "sovra1creator_alice"}

	initMsg := vm.SplitInstantiateMsg{
		Admin: "sovra1creator_alice",
		Title: "Podcast Co-Host & Editor Revenue Split",
		Recipients: []vm.SplitRecipient{
			{Address: "sovra1creator_alice", Weight: 7000}, // 70.00%
			{Address: "sovra1cohost_bob", Weight: 2000},     // 20.00%
			{Address: "sovra1editor_charlie", Weight: 1000}, // 10.00%
		},
		MinPayout: "100",
	}
	initBz, err := json.Marshal(initMsg)
	require.NoError(t, err)

	bytecode := []byte("cw_split_v1")
	resp, err := wasmVM.Instantiate(bytecode, storage, env, info, initBz)
	require.NoError(t, err)
	require.NotNil(t, resp)

	// Query Config
	queryConfigBz := []byte(`{"config":{}}`)
	cfgBz, err := wasmVM.Query(bytecode, storage, env, queryConfigBz)
	require.NoError(t, err)

	var cfg vm.SplitConfig
	require.NoError(t, json.Unmarshal(cfgBz, &cfg))
	require.Equal(t, "sovra1creator_alice", cfg.Admin)
	require.Equal(t, "Podcast Co-Host & Editor Revenue Split", cfg.Title)
	require.Equal(t, uint64(10000), cfg.TotalWeight)
	require.Len(t, cfg.Recipients, 3)

	// Query Recipient Share for Bob
	queryBobBz := []byte(`{"recipient_share":{"address":"sovra1cohost_bob"}}`)
	bobShareBz, err := wasmVM.Query(bytecode, storage, env, queryBobBz)
	require.NoError(t, err)

	var bobShare struct {
		Address       string `json:"address"`
		IsRecipient   bool   `json:"is_recipient"`
		Weight        uint64 `json:"weight"`
		PercentageBps uint64 `json:"percentage_bps"`
		TotalEarned   string `json:"total_earned_usov"`
	}
	require.NoError(t, json.Unmarshal(bobShareBz, &bobShare))
	require.True(t, bobShare.IsRecipient)
	require.Equal(t, uint64(2000), bobShare.Weight)
	require.Equal(t, uint64(2000), bobShare.PercentageBps) // 20.00%
	require.Equal(t, "0", bobShare.TotalEarned)
}

func TestCreatorRevenueSplit_DistributeAndBankSubmessages(t *testing.T) {
	storage := vm.NewMemoryStorage()
	wasmVM := vm.NewWasmVM(types.DefaultWasmConfig())

	env := types.Env{
		Block: types.BlockInfo{Height: 10, Time: 10000, ChainID: "sovra-testnet-0"},
		Contract: types.ContractInfoSummary{Address: "sovra1splitcontract001"},
	}
	info := types.MessageInfo{Sender: "sovra1creator_alice"}

	initMsg := vm.SplitInstantiateMsg{
		Admin: "sovra1creator_alice",
		Title: "Creator DAO Revenue Split",
		Recipients: []vm.SplitRecipient{
			{Address: "sovra1alice", Weight: 6000}, // 60%
			{Address: "sovra1bob", Weight: 2500},   // 25%
			{Address: "sovra1carol", Weight: 1500}, // 15%
		},
		MinPayout: "1000",
	}
	initBz, _ := json.Marshal(initMsg)
	bytecode := []byte("cw_split_v1")
	_, err := wasmVM.Instantiate(bytecode, storage, env, info, initBz)
	require.NoError(t, err)

	// Simulate distribution of 1,000,000 uSOV (1 SOVRA)
	simQueryBz := []byte(`{"simulate_distribute":{"amount":"1000000"}}`)
	simBz, err := wasmVM.Query(bytecode, storage, env, simQueryBz)
	require.NoError(t, err)

	var simResult struct {
		DistributableAmount string `json:"distributable_amount"`
		Payouts             []struct {
			Address string `json:"address"`
			Amount  string `json:"amount"`
		} `json:"payouts"`
	}
	require.NoError(t, json.Unmarshal(simBz, &simResult))
	require.Equal(t, "1000000", simResult.DistributableAmount)
	require.Len(t, simResult.Payouts, 3)
	require.Equal(t, "600000", simResult.Payouts[0].Amount) // 60%
	require.Equal(t, "250000", simResult.Payouts[1].Amount) // 25%
	require.Equal(t, "150000", simResult.Payouts[2].Amount) // 15%

	// Execute Distribute with attached 1,000,000 uSOV funds
	execInfo := types.MessageInfo{
		Sender: "sovra1fan_tipper",
		Funds: []types.Coin{
			{Denom: "usov", Amount: "1000000"},
		},
	}
	distMsgBz := []byte(`{"distribute":{}}`)
	distResp, err := wasmVM.Execute(bytecode, storage, env, execInfo, distMsgBz)
	require.NoError(t, err)
	require.NotNil(t, distResp)

	// Verify exact on-chain Bank.Send submessages
	require.Len(t, distResp.Messages, 3)
	require.Equal(t, "sovra1alice", distResp.Messages[0].Msg.Bank.Send.ToAddress)
	require.Equal(t, "600000", distResp.Messages[0].Msg.Bank.Send.Amount[0].Amount)
	require.Equal(t, "usov", distResp.Messages[0].Msg.Bank.Send.Amount[0].Denom)

	require.Equal(t, "sovra1bob", distResp.Messages[1].Msg.Bank.Send.ToAddress)
	require.Equal(t, "250000", distResp.Messages[1].Msg.Bank.Send.Amount[0].Amount)

	require.Equal(t, "sovra1carol", distResp.Messages[2].Msg.Bank.Send.ToAddress)
	require.Equal(t, "150000", distResp.Messages[2].Msg.Bank.Send.Amount[0].Amount)

	// Query updated recipient earnings for Alice
	queryAliceBz := []byte(`{"recipient_share":{"address":"sovra1alice"}}`)
	aliceShareBz, err := wasmVM.Query(bytecode, storage, env, queryAliceBz)
	require.NoError(t, err)
	var aliceShare struct {
		TotalEarned string `json:"total_earned_usov"`
	}
	require.NoError(t, json.Unmarshal(aliceShareBz, &aliceShare))
	require.Equal(t, "600000", aliceShare.TotalEarned)
}

func TestCreatorRevenueSplit_ZeroFloatRemainderPreservation(t *testing.T) {
	storage := vm.NewMemoryStorage()
	wasmVM := vm.NewWasmVM(types.DefaultWasmConfig())

	env := types.Env{
		Block: types.BlockInfo{Height: 20, Time: 20000, ChainID: "sovra-testnet-0"},
		Contract: types.ContractInfoSummary{Address: "sovra1splitcontract002"},
	}
	info := types.MessageInfo{Sender: "sovra1admin"}

	// 3 recipients with equal weights of 1 (total weight = 3)
	initMsg := vm.SplitInstantiateMsg{
		Admin: "sovra1admin",
		Title: "Trio Split with Dust Remainder",
		Recipients: []vm.SplitRecipient{
			{Address: "sovra1p1", Weight: 1},
			{Address: "sovra1p2", Weight: 1},
			{Address: "sovra1p3", Weight: 1},
		},
		MinPayout: "1",
	}
	initBz, _ := json.Marshal(initMsg)
	bytecode := []byte("cw_split_v1")
	_, err := wasmVM.Instantiate(bytecode, storage, env, info, initBz)
	require.NoError(t, err)

	// Distribute 10 uSOV (indivisible integer units). 10 / 3 = 3 each, remainder = 1 allocated to primary recipient
	execInfo := types.MessageInfo{
		Sender: "sovra1tipper",
		Funds: []types.Coin{
			{Denom: "usov", Amount: "10"},
		},
	}
	distResp, err := wasmVM.Execute(bytecode, storage, env, execInfo, []byte(`{"distribute":{}}`))
	require.NoError(t, err)
	require.Len(t, distResp.Messages, 3)

	amt1 := distResp.Messages[0].Msg.Bank.Send.Amount[0].Amount
	amt2 := distResp.Messages[1].Msg.Bank.Send.Amount[0].Amount
	amt3 := distResp.Messages[2].Msg.Bank.Send.Amount[0].Amount

	require.Equal(t, "4", amt1) // Primary recipient receives 3 + 1 remainder
	require.Equal(t, "3", amt2)
	require.Equal(t, "3", amt3)
	// Total distributed is 4 + 3 + 3 = 10 (exact asset conservation!)
}

func TestCreatorRevenueSplit_AdminUpdatePermissions(t *testing.T) {
	storage := vm.NewMemoryStorage()
	wasmVM := vm.NewWasmVM(types.DefaultWasmConfig())

	env := types.Env{
		Block: types.BlockInfo{Height: 30, Time: 30000, ChainID: "sovra-testnet-0"},
		Contract: types.ContractInfoSummary{Address: "sovra1splitcontract003"},
	}
	adminInfo := types.MessageInfo{Sender: "sovra1admin_alice"}

	initMsg := vm.SplitInstantiateMsg{
		Admin: "sovra1admin_alice",
		Title: "Adjustable Split",
		Recipients: []vm.SplitRecipient{
			{Address: "sovra1alice", Weight: 80},
			{Address: "sovra1bob", Weight: 20},
		},
	}
	initBz, _ := json.Marshal(initMsg)
	bytecode := []byte("cw_split_v1")
	_, err := wasmVM.Instantiate(bytecode, storage, env, adminInfo, initBz)
	require.NoError(t, err)

	// Non-admin attempt to update recipients must be rejected
	hackerInfo := types.MessageInfo{Sender: "sovra1hacker"}
	updateMsg := []byte(`{"update_recipients":{"recipients":[{"address":"sovra1hacker","weight":100}]}}`)
	_, err = wasmVM.Execute(bytecode, storage, env, hackerInfo, updateMsg)
	require.Error(t, err)
	require.Contains(t, err.Error(), "unauthorized")

	// Admin executes update successfully
	updateValidMsg := []byte(`{"update_recipients":{"recipients":[{"address":"sovra1alice","weight":50},{"address":"sovra1bob","weight":50}]}}`)
	resp, err := wasmVM.Execute(bytecode, storage, env, adminInfo, updateValidMsg)
	require.NoError(t, err)
	require.NotNil(t, resp)

	// Verify updated config
	cfgBz, err := wasmVM.Query(bytecode, storage, env, []byte(`{"config":{}}`))
	require.NoError(t, err)
	var cfg vm.SplitConfig
	require.NoError(t, json.Unmarshal(cfgBz, &cfg))
	require.Equal(t, uint64(100), cfg.TotalWeight)
	require.Equal(t, uint64(50), cfg.Recipients[0].Weight)
	require.Equal(t, uint64(50), cfg.Recipients[1].Weight)
}
