package vm

import (
	"encoding/json"
	"fmt"
	"math/big"
	"strings"

	"github.com/sovra/chain/x/wasm/types"
)

var (
	KeySplitConfig         = []byte("split_config")
	PrefixSplitEarnings    = []byte("split_earn_")
	KeySplitTotalReceived  = []byte("split_total_received")
)

// SplitRecipient defines a payout destination and its relative weight/share
type SplitRecipient struct {
	Address string `json:"address"`
	Weight  uint64 `json:"weight"` // Relative share weight or basis points (e.g. 7000 = 70%)
}

// SplitConfig stores the creator revenue-sharing split configuration on-chain
type SplitConfig struct {
	Admin            string           `json:"admin"`
	Title            string           `json:"title"`
	Recipients       []SplitRecipient `json:"recipients"`
	TotalWeight      uint64           `json:"total_weight"`
	MinPayout        string           `json:"min_payout"`        // Minimum distributable threshold in uSOV
	TotalDistributed string           `json:"total_distributed"` // Cumulative uSOV distributed
}

// SplitInstantiateMsg initializes a new creator revenue-sharing split contract
type SplitInstantiateMsg struct {
	Admin      string           `json:"admin,omitempty"`
	Title      string           `json:"title,omitempty"`
	Recipients []SplitRecipient `json:"recipients"`
	MinPayout  string           `json:"min_payout,omitempty"`
}

type DistributeMsg struct {
	Amount string `json:"amount,omitempty"` // Optional override amount to distribute from attached/available funds
}

type UpdateRecipientsMsg struct {
	Recipients []SplitRecipient `json:"recipients"`
}

type UpdateAdminMsg struct {
	NewAdmin string `json:"new_admin"`
}

// ExecuteSplitInstantiate initializes a creator revenue-sharing split contract
func ExecuteSplitInstantiate(storage StorageDriver, env types.Env, info types.MessageInfo, msgBz []byte) (*types.Response, error) {
	var msg SplitInstantiateMsg
	if err := json.Unmarshal(msgBz, &msg); err != nil {
		return nil, fmt.Errorf("failed to parse SplitInstantiateMsg: %w", err)
	}

	admin := strings.TrimSpace(msg.Admin)
	if admin == "" {
		admin = info.Sender
	}

	if len(msg.Recipients) == 0 {
		return nil, fmt.Errorf("recipients list cannot be empty")
	}

	var totalWeight uint64
	seenAddrs := make(map[string]bool)

	for _, r := range msg.Recipients {
		addr := strings.TrimSpace(r.Address)
		if addr == "" {
			return nil, fmt.Errorf("recipient address cannot be empty")
		}
		if seenAddrs[addr] {
			return nil, fmt.Errorf("duplicate recipient address: %s", addr)
		}
		seenAddrs[addr] = true
		if r.Weight == 0 {
			return nil, fmt.Errorf("recipient weight must be positive for address: %s", addr)
		}
		totalWeight += r.Weight
	}

	if totalWeight == 0 {
		return nil, fmt.Errorf("total weight must be greater than zero")
	}

	title := strings.TrimSpace(msg.Title)
	if title == "" {
		title = "Creator Revenue Split"
	}

	minPayout := msg.MinPayout
	if minPayout == "" {
		minPayout = "1" // Default: 1 uSOV
	}

	cfg := SplitConfig{
		Admin:            admin,
		Title:            title,
		Recipients:       msg.Recipients,
		TotalWeight:      totalWeight,
		MinPayout:        minPayout,
		TotalDistributed: "0",
	}

	cfgBz, err := json.Marshal(cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to serialize split config: %w", err)
	}
	storage.Set(KeySplitConfig, cfgBz)

	return &types.Response{
		Attributes: []types.EventAttribute{
			{Key: "action", Value: "instantiate_split"},
			{Key: "admin", Value: admin},
			{Key: "title", Value: title},
			{Key: "recipients_count", Value: fmt.Sprintf("%d", len(msg.Recipients))},
			{Key: "total_weight", Value: fmt.Sprintf("%d", totalWeight)},
		},
	}, nil
}

// ExecuteSplitExecute handles state-mutating execution messages on the revenue split contract
func ExecuteSplitExecute(storage StorageDriver, env types.Env, info types.MessageInfo, msgBz []byte) (*types.Response, error) {
	cfgBz := storage.Get(KeySplitConfig)
	if len(cfgBz) == 0 {
		return nil, fmt.Errorf("split contract not initialized")
	}
	var cfg SplitConfig
	if err := json.Unmarshal(cfgBz, &cfg); err != nil {
		return nil, fmt.Errorf("failed to load split config: %w", err)
	}

	// 1. Distribute Funds: { "distribute": {} }
	if strings.Contains(string(msgBz), "\"distribute\"") {
		var execMsg struct {
			Distribute DistributeMsg `json:"distribute"`
		}
		_ = json.Unmarshal(msgBz, &execMsg)

		// Determine distributable amount
		distAmount := big.NewInt(0)
		for _, fund := range info.Funds {
			if strings.EqualFold(fund.Denom, "usov") {
				if amt, ok := new(big.Int).SetString(fund.Amount, 10); ok {
					distAmount.Add(distAmount, amt)
				}
			}
		}

		// If explicit amount specified in message, check it
		if execMsg.Distribute.Amount != "" {
			if amt, ok := new(big.Int).SetString(execMsg.Distribute.Amount, 10); ok && amt.Sign() > 0 {
				distAmount = amt
			}
		}

		if distAmount.Sign() <= 0 {
			return nil, fmt.Errorf("no distributable uSOV funds provided or available")
		}

		minP, _ := new(big.Int).SetString(cfg.MinPayout, 10)
		if minP != nil && distAmount.Cmp(minP) < 0 {
			return nil, fmt.Errorf("distributable amount %s uSOV is below minimum payout threshold %s uSOV", distAmount.String(), cfg.MinPayout)
		}

		// Calculate exact integer distribution per recipient
		totWeight := new(big.Int).SetUint64(cfg.TotalWeight)
		var subMsgs []types.SubMsg
		distributedSum := big.NewInt(0)

		type PayoutRecord struct {
			Address string
			Amount  *big.Int
		}
		var payouts []PayoutRecord

		for _, r := range cfg.Recipients {
			w := new(big.Int).SetUint64(r.Weight)
			// share = (distAmount * weight) / totalWeight
			num := new(big.Int).Mul(distAmount, w)
			share := new(big.Int).Div(num, totWeight)

			if share.Sign() > 0 {
				distributedSum.Add(distributedSum, share)
				payouts = append(payouts, PayoutRecord{
					Address: r.Address,
					Amount:  share,
				})
			}
		}

		// Handle integer division dust remainder: assign remainder to primary recipient (first in list)
		remainder := new(big.Int).Sub(distAmount, distributedSum)
		if remainder.Sign() > 0 && len(payouts) > 0 {
			payouts[0].Amount.Add(payouts[0].Amount, remainder)
			distributedSum.Add(distributedSum, remainder)
		}

		// Build atomic Bank.Send submessages and update cumulative earnings
		for _, p := range payouts {
			subMsgs = append(subMsgs, types.SubMsg{
				Msg: types.CosmosMsg{
					Bank: &types.BankMsg{
						Send: &types.BankSendMsg{
							ToAddress: p.Address,
							Amount: []types.Coin{
								{Denom: "usov", Amount: p.Amount.String()},
							},
						},
					},
				},
			})

			// Record recipient cumulative earnings
			earnKey := append(PrefixSplitEarnings, []byte(p.Address)...)
			currentEarn := big.NewInt(0)
			if eBz := storage.Get(earnKey); len(eBz) > 0 {
				currentEarn.SetString(string(eBz), 10)
			}
			currentEarn.Add(currentEarn, p.Amount)
			storage.Set(earnKey, []byte(currentEarn.String()))
		}

		// Update cumulative total distributed in contract config
		curTotDist, _ := new(big.Int).SetString(cfg.TotalDistributed, 10)
		if curTotDist == nil {
			curTotDist = big.NewInt(0)
		}
		curTotDist.Add(curTotDist, distAmount)
		cfg.TotalDistributed = curTotDist.String()

		updatedCfgBz, _ := json.Marshal(cfg)
		storage.Set(KeySplitConfig, updatedCfgBz)

		return &types.Response{
			Messages: subMsgs,
			Attributes: []types.EventAttribute{
				{Key: "action", Value: "distribute_revenue"},
				{Key: "total_distributed", Value: distAmount.String()},
				{Key: "payouts_count", Value: fmt.Sprintf("%d", len(payouts))},
				{Key: "cumulative_distributed", Value: cfg.TotalDistributed},
			},
		}, nil
	}

	// 2. Update Recipients: { "update_recipients": { "recipients": [...] } }
	if strings.Contains(string(msgBz), "\"update_recipients\"") {
		if info.Sender != cfg.Admin {
			return nil, fmt.Errorf("unauthorized: only admin '%s' can update revenue split recipients", cfg.Admin)
		}

		var execMsg struct {
			UpdateRecipients UpdateRecipientsMsg `json:"update_recipients"`
		}
		if err := json.Unmarshal(msgBz, &execMsg); err != nil {
			return nil, fmt.Errorf("failed to parse UpdateRecipientsMsg: %w", err)
		}

		if len(execMsg.UpdateRecipients.Recipients) == 0 {
			return nil, fmt.Errorf("recipients list cannot be empty")
		}

		var newTotalWeight uint64
		seenAddrs := make(map[string]bool)

		for _, r := range execMsg.UpdateRecipients.Recipients {
			addr := strings.TrimSpace(r.Address)
			if addr == "" {
				return nil, fmt.Errorf("recipient address cannot be empty")
			}
			if seenAddrs[addr] {
				return nil, fmt.Errorf("duplicate recipient address: %s", addr)
			}
			seenAddrs[addr] = true
			if r.Weight == 0 {
				return nil, fmt.Errorf("recipient weight must be positive for address: %s", addr)
			}
			newTotalWeight += r.Weight
		}

		cfg.Recipients = execMsg.UpdateRecipients.Recipients
		cfg.TotalWeight = newTotalWeight

		updatedCfgBz, _ := json.Marshal(cfg)
		storage.Set(KeySplitConfig, updatedCfgBz)

		return &types.Response{
			Attributes: []types.EventAttribute{
				{Key: "action", Value: "update_recipients"},
				{Key: "new_recipients_count", Value: fmt.Sprintf("%d", len(cfg.Recipients))},
				{Key: "new_total_weight", Value: fmt.Sprintf("%d", newTotalWeight)},
			},
		}, nil
	}

	// 3. Update Admin: { "update_admin": { "new_admin": "..." } }
	if strings.Contains(string(msgBz), "\"update_admin\"") {
		if info.Sender != cfg.Admin {
			return nil, fmt.Errorf("unauthorized: only admin '%s' can transfer admin rights", cfg.Admin)
		}

		var execMsg struct {
			UpdateAdmin UpdateAdminMsg `json:"update_admin"`
		}
		if err := json.Unmarshal(msgBz, &execMsg); err != nil {
			return nil, fmt.Errorf("failed to parse UpdateAdminMsg: %w", err)
		}

		newAdmin := strings.TrimSpace(execMsg.UpdateAdmin.NewAdmin)
		if newAdmin == "" {
			return nil, fmt.Errorf("new admin address cannot be empty")
		}

		cfg.Admin = newAdmin
		updatedCfgBz, _ := json.Marshal(cfg)
		storage.Set(KeySplitConfig, updatedCfgBz)

		return &types.Response{
			Attributes: []types.EventAttribute{
				{Key: "action", Value: "update_admin"},
				{Key: "old_admin", Value: info.Sender},
				{Key: "new_admin", Value: newAdmin},
			},
		}, nil
	}

	return nil, fmt.Errorf("unrecognized split execute message")
}

// ExecuteSplitQuery handles read-only queries against the revenue split contract
func ExecuteSplitQuery(storage StorageDriver, env types.Env, queryBz []byte) ([]byte, error) {
	cfgBz := storage.Get(KeySplitConfig)
	if len(cfgBz) == 0 {
		return nil, fmt.Errorf("split contract not initialized")
	}
	var cfg SplitConfig
	if err := json.Unmarshal(cfgBz, &cfg); err != nil {
		return nil, fmt.Errorf("failed to load split config: %w", err)
	}

	queryStr := string(queryBz)

	// 1. Config query: { "config": {} }
	if strings.Contains(queryStr, "\"config\"") {
		return cfgBz, nil
	}

	// 2. Recipient share query: { "recipient_share": { "address": "..." } }
	if strings.Contains(queryStr, "\"recipient_share\"") {
		var qMsg struct {
			RecipientShare struct {
				Address string `json:"address"`
			} `json:"recipient_share"`
		}
		_ = json.Unmarshal(queryBz, &qMsg)
		addr := strings.TrimSpace(qMsg.RecipientShare.Address)

		var matchedWeight uint64
		found := false
		for _, r := range cfg.Recipients {
			if r.Address == addr {
				matchedWeight = r.Weight
				found = true
				break
			}
		}

		earnKey := append(PrefixSplitEarnings, []byte(addr)...)
		totalEarned := "0"
		if eBz := storage.Get(earnKey); len(eBz) > 0 {
			totalEarned = string(eBz)
		}

		percentageBps := uint64(0)
		if cfg.TotalWeight > 0 && found {
			percentageBps = (matchedWeight * 10000) / cfg.TotalWeight
		}

		resp := struct {
			Address       string `json:"address"`
			IsRecipient   bool   `json:"is_recipient"`
			Weight        uint64 `json:"weight"`
			TotalWeight   uint64 `json:"total_weight"`
			PercentageBps uint64 `json:"percentage_bps"` // e.g. 7000 = 70.00%
			TotalEarned   string `json:"total_earned_usov"`
		}{
			Address:       addr,
			IsRecipient:   found,
			Weight:        matchedWeight,
			TotalWeight:   cfg.TotalWeight,
			PercentageBps: percentageBps,
			TotalEarned:   totalEarned,
		}

		return json.Marshal(resp)
	}

	// 3. Simulate distribution: { "simulate_distribute": { "amount": "1000000" } }
	if strings.Contains(queryStr, "\"simulate_distribute\"") {
		var qMsg struct {
			SimulateDistribute struct {
				Amount string `json:"amount"`
			} `json:"simulate_distribute"`
		}
		_ = json.Unmarshal(queryBz, &qMsg)

		amt, ok := new(big.Int).SetString(qMsg.SimulateDistribute.Amount, 10)
		if !ok || amt.Sign() <= 0 {
			return nil, fmt.Errorf("invalid simulation amount: %s", qMsg.SimulateDistribute.Amount)
		}

		totWeight := new(big.Int).SetUint64(cfg.TotalWeight)
		type SimPayout struct {
			Address string `json:"address"`
			Amount  string `json:"amount"`
		}
		var simPayouts []SimPayout
		distributedSum := big.NewInt(0)

		for _, r := range cfg.Recipients {
			w := new(big.Int).SetUint64(r.Weight)
			share := new(big.Int).Div(new(big.Int).Mul(amt, w), totWeight)
			distributedSum.Add(distributedSum, share)
			simPayouts = append(simPayouts, SimPayout{
				Address: r.Address,
				Amount:  share.String(),
			})
		}

		// Allocate remainder to first recipient
		rem := new(big.Int).Sub(amt, distributedSum)
		if rem.Sign() > 0 && len(simPayouts) > 0 {
			curFirst, _ := new(big.Int).SetString(simPayouts[0].Amount, 10)
			curFirst.Add(curFirst, rem)
			simPayouts[0].Amount = curFirst.String()
		}

		return json.Marshal(struct {
			DistributableAmount string      `json:"distributable_amount"`
			Payouts             []SimPayout `json:"payouts"`
		}{
			DistributableAmount: amt.String(),
			Payouts:             simPayouts,
		})
	}

	return nil, fmt.Errorf("unrecognized split query message")
}
