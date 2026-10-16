package vm

import (
	"encoding/json"
	"fmt"
	"math/big"
	"strings"

	"github.com/sovra/chain/x/wasm/types"
)

// Storage keys for CW20 standard
var (
	KeyCW20TokenInfo = []byte("token_info")
	KeyCW20Minter    = []byte("minter")
	PrefixBalance    = []byte("balance_")
)

type CW20TokenInfo struct {
	Name        string `json:"name"`
	Symbol      string `json:"symbol"`
	Decimals    uint8  `json:"decimals"`
	TotalSupply string `json:"total_supply"`
}

type CW20MinterInfo struct {
	Minter string `json:"minter"`
	Cap    string `json:"cap,omitempty"`
}

type CW20InitialBalance struct {
	Address string `json:"address"`
	Amount  string `json:"amount"`
}

type CW20InstantiateMsg struct {
	Name            string               `json:"name"`
	Symbol          string               `json:"symbol"`
	Decimals        uint8                `json:"decimals"`
	InitialBalances []CW20InitialBalance `json:"initial_balances"`
	Mint            *CW20MinterInfo      `json:"mint,omitempty"`
}

type CW20TransferMsg struct {
	Recipient string `json:"recipient"`
	Amount    string `json:"amount"`
}

type CW20BurnMsg struct {
	Amount string `json:"amount"`
}

type CW20MintMsg struct {
	Recipient string `json:"recipient"`
	Amount    string `json:"amount"`
}

// ExecuteCW20Instantiate processes a standard CW20 initialization payload
func ExecuteCW20Instantiate(storage StorageDriver, env types.Env, info types.MessageInfo, msgBz []byte) (*types.Response, error) {
	var msg CW20InstantiateMsg
	if err := json.Unmarshal(msgBz, &msg); err != nil {
		return nil, fmt.Errorf("failed to parse CW20 InstantiateMsg: %w", err)
	}

	if strings.TrimSpace(msg.Name) == "" {
		return nil, fmt.Errorf("token name cannot be empty")
	}
	if strings.TrimSpace(msg.Symbol) == "" {
		return nil, fmt.Errorf("token symbol cannot be empty")
	}

	total := big.NewInt(0)
	for _, initBal := range msg.InitialBalances {
		amt, ok := new(big.Int).SetString(initBal.Amount, 10)
		if !ok || amt.Sign() < 0 {
			return nil, fmt.Errorf("invalid initial balance amount for %s: %s", initBal.Address, initBal.Amount)
		}
		if amt.Sign() > 0 {
			total.Add(total, amt)
			cur := getCW20Balance(storage, initBal.Address)
			cur.Add(cur, amt)
			setCW20Balance(storage, initBal.Address, cur)
		}
	}

	tokenInfo := CW20TokenInfo{
		Name:        msg.Name,
		Symbol:      msg.Symbol,
		Decimals:    msg.Decimals,
		TotalSupply: total.String(),
	}
	tBz, _ := json.Marshal(tokenInfo)
	storage.Set(KeyCW20TokenInfo, tBz)

	if msg.Mint != nil {
		mBz, _ := json.Marshal(msg.Mint)
		storage.Set(KeyCW20Minter, mBz)
	}

	return &types.Response{
		Attributes: []types.EventAttribute{
			{Key: "action", Value: "instantiate"},
			{Key: "contract_type", Value: "cw20_creator_token"},
			{Key: "name", Value: msg.Name},
			{Key: "symbol", Value: msg.Symbol},
			{Key: "decimals", Value: fmt.Sprintf("%d", msg.Decimals)},
			{Key: "total_supply", Value: total.String()},
			{Key: "creator", Value: info.Sender},
		},
	}, nil
}

// ExecuteCW20Execute processes standard CW20 contract operations: transfer, burn, mint
func ExecuteCW20Execute(storage StorageDriver, env types.Env, info types.MessageInfo, msgBz []byte) (*types.Response, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(msgBz, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse CW20 ExecuteMsg: %w", err)
	}

	// 1. Transfer
	if transferRaw, ok := raw["transfer"]; ok {
		var tMsg CW20TransferMsg
		if err := json.Unmarshal(transferRaw, &tMsg); err != nil {
			return nil, fmt.Errorf("invalid transfer msg: %w", err)
		}
		amt, ok := new(big.Int).SetString(tMsg.Amount, 10)
		if !ok || amt.Sign() <= 0 {
			return nil, fmt.Errorf("transfer amount must be positive: %s", tMsg.Amount)
		}

		senderBal := getCW20Balance(storage, info.Sender)
		if senderBal.Cmp(amt) < 0 {
			return nil, fmt.Errorf("insufficient CW20 balance: have %s, need %s", senderBal.String(), amt.String())
		}

		senderBal.Sub(senderBal, amt)
		setCW20Balance(storage, info.Sender, senderBal)

		recipientBal := getCW20Balance(storage, tMsg.Recipient)
		recipientBal.Add(recipientBal, amt)
		setCW20Balance(storage, tMsg.Recipient, recipientBal)

		return &types.Response{
			Attributes: []types.EventAttribute{
				{Key: "action", Value: "transfer"},
				{Key: "from", Value: info.Sender},
				{Key: "to", Value: tMsg.Recipient},
				{Key: "amount", Value: tMsg.Amount},
			},
		}, nil
	}

	// 2. Burn
	if burnRaw, ok := raw["burn"]; ok {
		var bMsg CW20BurnMsg
		if err := json.Unmarshal(burnRaw, &bMsg); err != nil {
			return nil, fmt.Errorf("invalid burn msg: %w", err)
		}
		amt, ok := new(big.Int).SetString(bMsg.Amount, 10)
		if !ok || amt.Sign() <= 0 {
			return nil, fmt.Errorf("burn amount must be positive: %s", bMsg.Amount)
		}

		senderBal := getCW20Balance(storage, info.Sender)
		if senderBal.Cmp(amt) < 0 {
			return nil, fmt.Errorf("insufficient balance to burn: have %s, need %s", senderBal.String(), amt.String())
		}
		senderBal.Sub(senderBal, amt)
		setCW20Balance(storage, info.Sender, senderBal)

		// Reduce total supply
		var tInfo CW20TokenInfo
		tBz := storage.Get(KeyCW20TokenInfo)
		if len(tBz) > 0 {
			_ = json.Unmarshal(tBz, &tInfo)
			supply, _ := new(big.Int).SetString(tInfo.TotalSupply, 10)
			supply.Sub(supply, amt)
			tInfo.TotalSupply = supply.String()
			newTBz, _ := json.Marshal(tInfo)
			storage.Set(KeyCW20TokenInfo, newTBz)
		}

		return &types.Response{
			Attributes: []types.EventAttribute{
				{Key: "action", Value: "burn"},
				{Key: "from", Value: info.Sender},
				{Key: "amount", Value: bMsg.Amount},
			},
		}, nil
	}

	// 3. Mint
	if mintRaw, ok := raw["mint"]; ok {
		var mMsg CW20MintMsg
		if err := json.Unmarshal(mintRaw, &mMsg); err != nil {
			return nil, fmt.Errorf("invalid mint msg: %w", err)
		}

		// Verify sender is authorized minter
		mBz := storage.Get(KeyCW20Minter)
		if len(mBz) == 0 {
			return nil, fmt.Errorf("contract has no minter configured")
		}
		var minterInfo CW20MinterInfo
		_ = json.Unmarshal(mBz, &minterInfo)
		if minterInfo.Minter != info.Sender {
			return nil, fmt.Errorf("unauthorized: only minter '%s' can mint tokens", minterInfo.Minter)
		}

		amt, ok := new(big.Int).SetString(mMsg.Amount, 10)
		if !ok || amt.Sign() <= 0 {
			return nil, fmt.Errorf("mint amount must be positive: %s", mMsg.Amount)
		}

		recipBal := getCW20Balance(storage, mMsg.Recipient)
		recipBal.Add(recipBal, amt)
		setCW20Balance(storage, mMsg.Recipient, recipBal)

		// Increase total supply
		var tInfo CW20TokenInfo
		tBz := storage.Get(KeyCW20TokenInfo)
		if len(tBz) > 0 {
			_ = json.Unmarshal(tBz, &tInfo)
			supply, _ := new(big.Int).SetString(tInfo.TotalSupply, 10)
			supply.Add(supply, amt)
			tInfo.TotalSupply = supply.String()
			newTBz, _ := json.Marshal(tInfo)
			storage.Set(KeyCW20TokenInfo, newTBz)
		}

		return &types.Response{
			Attributes: []types.EventAttribute{
				{Key: "action", Value: "mint"},
				{Key: "minter", Value: info.Sender},
				{Key: "to", Value: mMsg.Recipient},
				{Key: "amount", Value: mMsg.Amount},
			},
		}, nil
	}

	return nil, fmt.Errorf("unknown or unsupported CW20 execute action in msg: %s", string(msgBz))
}

// ExecuteCW20Query processes read-only smart queries against contract state
func ExecuteCW20Query(storage StorageDriver, env types.Env, queryBz []byte) ([]byte, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(queryBz, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse CW20 QueryMsg: %w", err)
	}

	// 1. Balance query: {"balance": {"address": "sovra1..."}}
	if balRaw, ok := raw["balance"]; ok {
		var req struct {
			Address string `json:"address"`
		}
		_ = json.Unmarshal(balRaw, &req)
		bal := getCW20Balance(storage, req.Address)
		return json.Marshal(map[string]string{
			"balance": bal.String(),
		})
	}

	// 2. Token info query: {"token_info": {}}
	if _, ok := raw["token_info"]; ok {
		tBz := storage.Get(KeyCW20TokenInfo)
		if len(tBz) == 0 {
			return nil, fmt.Errorf("token_info not found")
		}
		return tBz, nil
	}

	// 3. Minter query: {"minter": {}}
	if _, ok := raw["minter"]; ok {
		mBz := storage.Get(KeyCW20Minter)
		if len(mBz) == 0 {
			return json.Marshal(map[string]interface{}{"minter": nil})
		}
		return mBz, nil
	}

	return nil, fmt.Errorf("unknown CW20 query request: %s", string(queryBz))
}

func getCW20Balance(storage StorageDriver, addr string) *big.Int {
	key := append(PrefixBalance, []byte(addr)...)
	bz := storage.Get(key)
	if len(bz) == 0 {
		return big.NewInt(0)
	}
	n, ok := new(big.Int).SetString(string(bz), 10)
	if !ok {
		return big.NewInt(0)
	}
	return n
}

func setCW20Balance(storage StorageDriver, addr string, amount *big.Int) {
	key := append(PrefixBalance, []byte(addr)...)
	if amount.Sign() <= 0 {
		storage.Delete(key)
		return
	}
	storage.Set(key, []byte(amount.String()))
}
