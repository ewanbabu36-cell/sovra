package vm

import (
	"encoding/json"
	"fmt"
	"math/big"
	"strings"

	"github.com/sovra/chain/x/wasm/types"
)

var (
	KeyPoolInfo     = []byte("pool_info")
	PrefixLpBalance = []byte("lp_balance_")
)

// PoolInfo holds the state of the AMM pair pool
type PoolInfo struct {
	TokenAddress   string `json:"token_address"`
	CreatorAddress string `json:"creator_address"`
	ReserveSov     string `json:"reserve_sov"`
	ReserveToken   string `json:"reserve_token"`
	FeePercent     uint64 `json:"fee_percent"` // 1 = 1%
	TotalLp        string `json:"total_lp"`
}

type SwapInstantiateMsg struct {
	TokenAddress   string `json:"token_address"`
	CreatorAddress string `json:"creator_address,omitempty"`
	ReserveSov     string `json:"reserve_sov,omitempty"`
	ReserveToken   string `json:"reserve_token,omitempty"`
	FeePercent     uint64 `json:"fee_percent,omitempty"`
}

type BuyTokensMsg struct {
	MinTokens string `json:"min_tokens,omitempty"`
}

type SellTokensMsg struct {
	Amount string `json:"amount"`
	MinSov string `json:"min_sov,omitempty"`
}

type AddLiquidityMsg struct {
	SovAmount   string `json:"sov_amount,omitempty"`
	TokenAmount string `json:"token_amount,omitempty"`
	MinLp       string `json:"min_lp,omitempty"`
}

type RemoveLiquidityMsg struct {
	Amount   string `json:"amount"` // LP shares to burn
	MinSov   string `json:"min_sov,omitempty"`
	MinToken string `json:"min_token,omitempty"`
}

// ExecuteSwapInstantiate initializes an AMM Swap Pair between Native SOV and a CW20 Token
func ExecuteSwapInstantiate(storage StorageDriver, env types.Env, info types.MessageInfo, msgBz []byte) (*types.Response, error) {
	var msg SwapInstantiateMsg
	if err := json.Unmarshal(msgBz, &msg); err != nil {
		return nil, fmt.Errorf("failed to parse SwapInstantiateMsg: %w", err)
	}

	if strings.TrimSpace(msg.TokenAddress) == "" {
		return nil, fmt.Errorf("token_address is required for swap contract")
	}

	creator := strings.TrimSpace(msg.CreatorAddress)
	if creator == "" {
		creator = info.Sender
	}

	reserveSov := "1000000" // default 1 SOV reserve
	if strings.TrimSpace(msg.ReserveSov) != "" {
		reserveSov = strings.TrimSpace(msg.ReserveSov)
	} else if len(info.Funds) > 0 && info.Funds[0].Amount != "" && info.Funds[0].Amount != "0" {
		reserveSov = info.Funds[0].Amount
	}

	reserveToken := "100000000" // default 100 creator tokens reserve
	if strings.TrimSpace(msg.ReserveToken) != "" {
		reserveToken = strings.TrimSpace(msg.ReserveToken)
	}

	feePercent := uint64(1)
	if msg.FeePercent > 0 {
		feePercent = msg.FeePercent
	}

	sovBn, _ := new(big.Int).SetString(reserveSov, 10)
	tokBn, _ := new(big.Int).SetString(reserveToken, 10)
	initialLp := sqrtBigInt(new(big.Int).Mul(sovBn, tokBn))
	if initialLp.Sign() <= 0 {
		initialLp = big.NewInt(10000000)
	}

	pool := PoolInfo{
		TokenAddress:   msg.TokenAddress,
		CreatorAddress: creator,
		ReserveSov:     reserveSov,
		ReserveToken:   reserveToken,
		FeePercent:     feePercent,
		TotalLp:        initialLp.String(),
	}

	pBz, _ := json.Marshal(pool)
	storage.Set(KeyPoolInfo, pBz)

	// Credit initial LP tokens to creator
	setLpBalance(storage, creator, initialLp)

	return &types.Response{
		Attributes: []types.EventAttribute{
			{Key: "action", Value: "instantiate_swap"},
			{Key: "contract_type", Value: "amm_swap_pair"},
			{Key: "token_address", Value: msg.TokenAddress},
			{Key: "creator_address", Value: creator},
			{Key: "reserve_sov", Value: reserveSov},
			{Key: "reserve_token", Value: reserveToken},
			{Key: "total_lp", Value: initialLp.String()},
			{Key: "fee_percent", Value: fmt.Sprintf("%d", feePercent)},
		},
	}, nil
}

// ExecuteSwapExecute handles buy_tokens, sell_tokens, add_liquidity, and remove_liquidity operations
func ExecuteSwapExecute(storage StorageDriver, env types.Env, info types.MessageInfo, msgBz []byte) (*types.Response, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(msgBz, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse Swap ExecuteMsg: %w", err)
	}

	poolBz := storage.Get(KeyPoolInfo)
	if len(poolBz) == 0 {
		return nil, fmt.Errorf("swap pool not initialized")
	}
	var pool PoolInfo
	if err := json.Unmarshal(poolBz, &pool); err != nil {
		return nil, fmt.Errorf("failed to parse pool info: %w", err)
	}

	reserveSov, _ := new(big.Int).SetString(pool.ReserveSov, 10)
	reserveToken, _ := new(big.Int).SetString(pool.ReserveToken, 10)
	if reserveSov == nil || reserveSov.Sign() <= 0 {
		reserveSov = big.NewInt(1000000)
	}
	if reserveToken == nil || reserveToken.Sign() <= 0 {
		reserveToken = big.NewInt(100000000)
	}

	// 1. Buy Tokens: swap attached native SOV for CW20 tokens
	if buyRaw, ok := raw["buy_tokens"]; ok {
		var buyMsg BuyTokensMsg
		_ = json.Unmarshal(buyRaw, &buyMsg)

		var sovIn *big.Int
		if len(info.Funds) > 0 && info.Funds[0].Amount != "" {
			sovIn, _ = new(big.Int).SetString(info.Funds[0].Amount, 10)
		}
		if sovIn == nil || sovIn.Sign() <= 0 {
			var alt struct {
				Amount string `json:"amount"`
			}
			_ = json.Unmarshal(buyRaw, &alt)
			if alt.Amount != "" {
				sovIn, _ = new(big.Int).SetString(alt.Amount, 10)
			}
		}

		if sovIn == nil || sovIn.Sign() <= 0 {
			return nil, fmt.Errorf("buy_tokens requires attached SOV funds")
		}

		// Calculate 1% royalty fee to creator
		feePercent := big.NewInt(int64(pool.FeePercent))
		fee := new(big.Int).Mul(sovIn, feePercent)
		fee.Div(fee, big.NewInt(100))

		netSovIn := new(big.Int).Sub(sovIn, fee)
		if netSovIn.Sign() <= 0 {
			return nil, fmt.Errorf("net SOV in must be positive after royalty fee")
		}

		// Constant Product Formula: token_out = (reserve_token * netSovIn) / (reserve_sov + netSovIn)
		numerator := new(big.Int).Mul(reserveToken, netSovIn)
		denominator := new(big.Int).Add(reserveSov, netSovIn)
		tokenOut := new(big.Int).Div(numerator, denominator)

		if tokenOut.Sign() <= 0 {
			return nil, fmt.Errorf("insufficient input SOV to acquire tokens")
		}
		if tokenOut.Cmp(reserveToken) >= 0 {
			return nil, fmt.Errorf("insufficient token liquidity in pool: need %s, have %s", tokenOut.String(), reserveToken.String())
		}

		if buyMsg.MinTokens != "" {
			minTok, _ := new(big.Int).SetString(buyMsg.MinTokens, 10)
			if minTok != nil && tokenOut.Cmp(minTok) < 0 {
				return nil, fmt.Errorf("slippage exceeded: received %s tokens, expected at least %s", tokenOut.String(), buyMsg.MinTokens)
			}
		}

		// Update pool reserves
		newReserveSov := new(big.Int).Add(reserveSov, netSovIn)
		newReserveToken := new(big.Int).Sub(reserveToken, tokenOut)
		pool.ReserveSov = newReserveSov.String()
		pool.ReserveToken = newReserveToken.String()
		updatedPoolBz, _ := json.Marshal(pool)
		storage.Set(KeyPoolInfo, updatedPoolBz)

		// Credit acquired CW20 tokens to buyer
		buyerBal := getCW20BalanceForContract(storage, pool.TokenAddress, info.Sender)
		buyerBal.Add(buyerBal, tokenOut)
		setCW20BalanceForContract(storage, pool.TokenAddress, info.Sender, buyerBal)

		// Route 1% creator royalty directly to creator address via Bank Send
		var subMsgs []types.SubMsg
		if fee.Sign() > 0 && pool.CreatorAddress != "" {
			subMsgs = append(subMsgs, types.SubMsg{
				ID: 1,
				Msg: types.CosmosMsg{
					Bank: &types.BankMsg{
						Send: &types.BankSendMsg{
							ToAddress: pool.CreatorAddress,
							Amount: []types.Coin{
								{Denom: "usov", Amount: fee.String()},
							},
						},
					},
				},
			})
		}

		return &types.Response{
			Messages: subMsgs,
			Attributes: []types.EventAttribute{
				{Key: "action", Value: "buy_tokens"},
				{Key: "buyer", Value: info.Sender},
				{Key: "token_address", Value: pool.TokenAddress},
				{Key: "sov_in", Value: sovIn.String()},
				{Key: "tokens_out", Value: tokenOut.String()},
				{Key: "fee_royalty", Value: fee.String()},
				{Key: "creator_address", Value: pool.CreatorAddress},
				{Key: "reserve_sov", Value: pool.ReserveSov},
				{Key: "reserve_token", Value: pool.ReserveToken},
			},
		}, nil
	}

	// 2. Sell Tokens: swap user CW20 tokens back for native SOV
	if sellRaw, ok := raw["sell_tokens"]; ok {
		var sellMsg SellTokensMsg
		if err := json.Unmarshal(sellRaw, &sellMsg); err != nil {
			return nil, fmt.Errorf("invalid sell_tokens msg: %w", err)
		}

		tokenIn, ok := new(big.Int).SetString(sellMsg.Amount, 10)
		if !ok || tokenIn.Sign() <= 0 {
			return nil, fmt.Errorf("token sell amount must be positive: %s", sellMsg.Amount)
		}

		// Verify user has sufficient CW20 balance
		userBal := getCW20BalanceForContract(storage, pool.TokenAddress, info.Sender)
		if userBal.Cmp(tokenIn) < 0 {
			return nil, fmt.Errorf("insufficient CW20 balance to sell: have %s, need %s", userBal.String(), tokenIn.String())
		}

		// Constant Product Formula: gross_sov_out = (reserve_sov * tokenIn) / (reserve_token + tokenIn)
		num := new(big.Int).Mul(reserveSov, tokenIn)
		den := new(big.Int).Add(reserveToken, tokenIn)
		grossSovOut := new(big.Int).Div(num, den)

		if grossSovOut.Sign() <= 0 {
			return nil, fmt.Errorf("token amount too small to generate SOV return")
		}
		if grossSovOut.Cmp(reserveSov) >= 0 {
			return nil, fmt.Errorf("insufficient SOV liquidity in pool: need %s, have %s", grossSovOut.String(), reserveSov.String())
		}

		// Deduct 1% creator royalty
		feePercent := big.NewInt(int64(pool.FeePercent))
		fee := new(big.Int).Mul(grossSovOut, feePercent)
		fee.Div(fee, big.NewInt(100))

		netSovOut := new(big.Int).Sub(grossSovOut, fee)
		if netSovOut.Sign() <= 0 {
			return nil, fmt.Errorf("net SOV output must be positive after royalty fee")
		}

		if sellMsg.MinSov != "" {
			minSov, _ := new(big.Int).SetString(sellMsg.MinSov, 10)
			if minSov != nil && netSovOut.Cmp(minSov) < 0 {
				return nil, fmt.Errorf("slippage exceeded: received %s SOV, expected at least %s", netSovOut.String(), sellMsg.MinSov)
			}
		}

		// Deduct CW20 tokens from seller
		userBal.Sub(userBal, tokenIn)
		setCW20BalanceForContract(storage, pool.TokenAddress, info.Sender, userBal)

		// Update pool reserves
		newReserveSov := new(big.Int).Sub(reserveSov, grossSovOut)
		newReserveToken := new(big.Int).Add(reserveToken, tokenIn)
		pool.ReserveSov = newReserveSov.String()
		pool.ReserveToken = newReserveToken.String()
		updatedPoolBz, _ := json.Marshal(pool)
		storage.Set(KeyPoolInfo, updatedPoolBz)

		// SubMsgs: send netSovOut to seller and fee to creator
		var subMsgs []types.SubMsg
		subMsgs = append(subMsgs, types.SubMsg{
			ID: 1,
			Msg: types.CosmosMsg{
				Bank: &types.BankMsg{
					Send: &types.BankSendMsg{
						ToAddress: info.Sender,
						Amount: []types.Coin{
							{Denom: "usov", Amount: netSovOut.String()},
						},
					},
				},
			},
		})

		if fee.Sign() > 0 && pool.CreatorAddress != "" {
			subMsgs = append(subMsgs, types.SubMsg{
				ID: 2,
				Msg: types.CosmosMsg{
					Bank: &types.BankMsg{
						Send: &types.BankSendMsg{
							ToAddress: pool.CreatorAddress,
							Amount: []types.Coin{
								{Denom: "usov", Amount: fee.String()},
							},
						},
					},
				},
			})
		}

		return &types.Response{
			Messages: subMsgs,
			Attributes: []types.EventAttribute{
				{Key: "action", Value: "sell_tokens"},
				{Key: "seller", Value: info.Sender},
				{Key: "token_address", Value: pool.TokenAddress},
				{Key: "tokens_in", Value: tokenIn.String()},
				{Key: "sov_out", Value: netSovOut.String()},
				{Key: "fee_royalty", Value: fee.String()},
				{Key: "creator_address", Value: pool.CreatorAddress},
				{Key: "reserve_sov", Value: pool.ReserveSov},
				{Key: "reserve_token", Value: pool.ReserveToken},
			},
		}, nil
	}

	// 3. Add Liquidity (Dual-Asset Deposit -> Mint LP tokens)
	if addRaw, ok := raw["add_liquidity"]; ok {
		var addMsg AddLiquidityMsg
		_ = json.Unmarshal(addRaw, &addMsg)

		var sAmt *big.Int
		if len(info.Funds) > 0 && info.Funds[0].Amount != "" && info.Funds[0].Amount != "0" {
			sAmt, _ = new(big.Int).SetString(info.Funds[0].Amount, 10)
		} else if addMsg.SovAmount != "" {
			sAmt, _ = new(big.Int).SetString(addMsg.SovAmount, 10)
		}

		if sAmt == nil || sAmt.Sign() <= 0 {
			return nil, fmt.Errorf("add_liquidity requires positive SOV amount")
		}

		tAmt, _ := new(big.Int).SetString(addMsg.TokenAmount, 10)
		if tAmt == nil || tAmt.Sign() <= 0 {
			return nil, fmt.Errorf("add_liquidity requires positive token_amount: %s", addMsg.TokenAmount)
		}

		// Verify provider has sufficient CW20 balance
		providerBal := getCW20BalanceForContract(storage, pool.TokenAddress, info.Sender)
		if providerBal.Cmp(tAmt) < 0 {
			return nil, fmt.Errorf("insufficient CW20 balance to add liquidity: have %s, need %s", providerBal.String(), tAmt.String())
		}

		totalLp, _ := new(big.Int).SetString(pool.TotalLp, 10)
		if totalLp == nil || totalLp.Sign() <= 0 {
			totalLp = sqrtBigInt(new(big.Int).Mul(reserveSov, reserveToken))
			if totalLp.Sign() <= 0 {
				totalLp = big.NewInt(10000000)
			}
		}

		// Calculate LP tokens to mint: L = min(totalLp * sAmt / reserveSov, totalLp * tAmt / reserveToken)
		lpFromSov := new(big.Int).Div(new(big.Int).Mul(totalLp, sAmt), reserveSov)
		lpFromToken := new(big.Int).Div(new(big.Int).Mul(totalLp, tAmt), reserveToken)

		mintLp := lpFromSov
		if lpFromToken.Cmp(mintLp) < 0 {
			mintLp = lpFromToken
		}

		if mintLp.Sign() <= 0 {
			return nil, fmt.Errorf("liquidity deposit too small to mint LP tokens")
		}

		if addMsg.MinLp != "" {
			minLp, _ := new(big.Int).SetString(addMsg.MinLp, 10)
			if minLp != nil && mintLp.Cmp(minLp) < 0 {
				return nil, fmt.Errorf("slippage exceeded: minted %s LP tokens, expected at least %s", mintLp.String(), addMsg.MinLp)
			}
		}

		// Deduct CW20 tokens from provider
		providerBal.Sub(providerBal, tAmt)
		setCW20BalanceForContract(storage, pool.TokenAddress, info.Sender, providerBal)

		// Credit LP tokens to provider
		userLp := getLpBalance(storage, info.Sender)
		userLp.Add(userLp, mintLp)
		setLpBalance(storage, info.Sender, userLp)

		// Update pool reserves and total LP
		newReserveSov := new(big.Int).Add(reserveSov, sAmt)
		newReserveToken := new(big.Int).Add(reserveToken, tAmt)
		newTotalLp := new(big.Int).Add(totalLp, mintLp)

		pool.ReserveSov = newReserveSov.String()
		pool.ReserveToken = newReserveToken.String()
		pool.TotalLp = newTotalLp.String()

		updatedPoolBz, _ := json.Marshal(pool)
		storage.Set(KeyPoolInfo, updatedPoolBz)

		return &types.Response{
			Attributes: []types.EventAttribute{
				{Key: "action", Value: "add_liquidity"},
				{Key: "provider", Value: info.Sender},
				{Key: "token_address", Value: pool.TokenAddress},
				{Key: "sov_in", Value: sAmt.String()},
				{Key: "token_in", Value: tAmt.String()},
				{Key: "lp_minted", Value: mintLp.String()},
				{Key: "user_lp_total", Value: userLp.String()},
				{Key: "pool_total_lp", Value: pool.TotalLp},
				{Key: "reserve_sov", Value: pool.ReserveSov},
				{Key: "reserve_token", Value: pool.ReserveToken},
			},
		}, nil
	}

	// 4. Remove Liquidity (Burn LP shares -> Withdraw SOV + CW20 + accumulated fees)
	if remRaw, ok := raw["remove_liquidity"]; ok {
		var remMsg RemoveLiquidityMsg
		if err := json.Unmarshal(remRaw, &remMsg); err != nil {
			return nil, fmt.Errorf("invalid remove_liquidity msg: %w", err)
		}

		burnLp, ok := new(big.Int).SetString(remMsg.Amount, 10)
		if !ok || burnLp.Sign() <= 0 {
			return nil, fmt.Errorf("invalid LP burn amount: %s", remMsg.Amount)
		}

		userLp := getLpBalance(storage, info.Sender)
		if userLp.Cmp(burnLp) < 0 {
			return nil, fmt.Errorf("insufficient LP balance: have %s, need %s", userLp.String(), burnLp.String())
		}

		totalLp, _ := new(big.Int).SetString(pool.TotalLp, 10)
		if totalLp == nil || totalLp.Sign() <= 0 {
			return nil, fmt.Errorf("invalid pool total_lp")
		}

		// Calculate refund: refundSov = reserveSov * burnLp / totalLp
		//                   refundToken = reserveToken * burnLp / totalLp
		refundSov := new(big.Int).Div(new(big.Int).Mul(reserveSov, burnLp), totalLp)
		refundToken := new(big.Int).Div(new(big.Int).Mul(reserveToken, burnLp), totalLp)

		if refundSov.Sign() <= 0 || refundToken.Sign() <= 0 {
			return nil, fmt.Errorf("refund amounts must be positive: %s SOV, %s Tokens", refundSov.String(), refundToken.String())
		}

		if remMsg.MinSov != "" {
			minSov, _ := new(big.Int).SetString(remMsg.MinSov, 10)
			if minSov != nil && refundSov.Cmp(minSov) < 0 {
				return nil, fmt.Errorf("slippage exceeded: received %s SOV, expected at least %s", refundSov.String(), remMsg.MinSov)
			}
		}
		if remMsg.MinToken != "" {
			minTok, _ := new(big.Int).SetString(remMsg.MinToken, 10)
			if minTok != nil && refundToken.Cmp(minTok) < 0 {
				return nil, fmt.Errorf("slippage exceeded: received %s tokens, expected at least %s", refundToken.String(), remMsg.MinToken)
			}
		}

		// Deduct LP tokens from user
		userLp.Sub(userLp, burnLp)
		setLpBalance(storage, info.Sender, userLp)

		// Update pool state
		newReserveSov := new(big.Int).Sub(reserveSov, refundSov)
		newReserveToken := new(big.Int).Sub(reserveToken, refundToken)
		newTotalLp := new(big.Int).Sub(totalLp, burnLp)

		pool.ReserveSov = newReserveSov.String()
		pool.ReserveToken = newReserveToken.String()
		pool.TotalLp = newTotalLp.String()
		updatedPoolBz, _ := json.Marshal(pool)
		storage.Set(KeyPoolInfo, updatedPoolBz)

		// Credit CW20 tokens back to provider
		providerBal := getCW20BalanceForContract(storage, pool.TokenAddress, info.Sender)
		providerBal.Add(providerBal, refundToken)
		setCW20BalanceForContract(storage, pool.TokenAddress, info.Sender, providerBal)

		// SubMsg: send refundSov to provider via BankSend
		var subMsgs []types.SubMsg
		subMsgs = append(subMsgs, types.SubMsg{
			ID: 1,
			Msg: types.CosmosMsg{
				Bank: &types.BankMsg{
					Send: &types.BankSendMsg{
						ToAddress: info.Sender,
						Amount: []types.Coin{
							{Denom: "usov", Amount: refundSov.String()},
						},
					},
				},
			},
		})

		return &types.Response{
			Messages: subMsgs,
			Attributes: []types.EventAttribute{
				{Key: "action", Value: "remove_liquidity"},
				{Key: "provider", Value: info.Sender},
				{Key: "token_address", Value: pool.TokenAddress},
				{Key: "lp_burned", Value: burnLp.String()},
				{Key: "refund_sov", Value: refundSov.String()},
				{Key: "refund_token", Value: refundToken.String()},
				{Key: "user_lp_remaining", Value: userLp.String()},
				{Key: "pool_total_lp", Value: pool.TotalLp},
				{Key: "reserve_sov", Value: pool.ReserveSov},
				{Key: "reserve_token", Value: pool.ReserveToken},
			},
		}, nil
	}

	return nil, fmt.Errorf("unknown swap action in msg: %s", string(msgBz))
}

// ExecuteSwapQuery processes read-only AMM pool queries
func ExecuteSwapQuery(storage StorageDriver, env types.Env, queryBz []byte) ([]byte, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(queryBz, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse Swap QueryMsg: %w", err)
	}

	poolBz := storage.Get(KeyPoolInfo)
	if len(poolBz) == 0 {
		return nil, fmt.Errorf("swap pool not found")
	}
	var pool PoolInfo
	_ = json.Unmarshal(poolBz, &pool)

	reserveSov, _ := new(big.Int).SetString(pool.ReserveSov, 10)
	reserveToken, _ := new(big.Int).SetString(pool.ReserveToken, 10)
	if reserveSov == nil || reserveSov.Sign() <= 0 {
		reserveSov = big.NewInt(1000000)
	}
	if reserveToken == nil || reserveToken.Sign() <= 0 {
		reserveToken = big.NewInt(100000000)
	}

	totalLp, _ := new(big.Int).SetString(pool.TotalLp, 10)
	if totalLp == nil || totalLp.Sign() <= 0 {
		totalLp = sqrtBigInt(new(big.Int).Mul(reserveSov, reserveToken))
	}

	// 1. Pool Info query: {"pool_info": {}}
	if _, ok := raw["pool_info"]; ok {
		spotPrice := float64(0)
		if reserveToken.Sign() > 0 {
			sovFloat := new(big.Float).SetInt(reserveSov)
			tokFloat := new(big.Float).SetInt(reserveToken)
			priceFloat := new(big.Float).Quo(sovFloat, tokFloat)
			spotPrice, _ = priceFloat.Float64()
		}
		return json.Marshal(map[string]interface{}{
			"token_address":   pool.TokenAddress,
			"creator_address": pool.CreatorAddress,
			"reserve_sov":     pool.ReserveSov,
			"reserve_token":   pool.ReserveToken,
			"total_lp":        totalLp.String(),
			"lp_symbol":       "SOV-LP",
			"fee_percent":     pool.FeePercent,
			"spot_price":      spotPrice,
		})
	}

	// 2. Simulate Buy: {"simulate_buy": {"sov_amount": "1000000"}}
	if simBuyRaw, ok := raw["simulate_buy"]; ok {
		var req struct {
			SovAmount string `json:"sov_amount"`
		}
		_ = json.Unmarshal(simBuyRaw, &req)
		sovIn, _ := new(big.Int).SetString(req.SovAmount, 10)
		if sovIn == nil || sovIn.Sign() <= 0 {
			return nil, fmt.Errorf("invalid sov_amount: %s", req.SovAmount)
		}
		feePercent := big.NewInt(int64(pool.FeePercent))
		fee := new(big.Int).Mul(sovIn, feePercent)
		fee.Div(fee, big.NewInt(100))
		netSovIn := new(big.Int).Sub(sovIn, fee)

		num := new(big.Int).Mul(reserveToken, netSovIn)
		den := new(big.Int).Add(reserveSov, netSovIn)
		tokensOut := new(big.Int).Div(num, den)

		return json.Marshal(map[string]interface{}{
			"tokens_out": tokensOut.String(),
			"fee":        fee.String(),
			"net_sov_in": netSovIn.String(),
		})
	}

	// 3. Simulate Sell: {"simulate_sell": {"token_amount": "1000"}}
	if simSellRaw, ok := raw["simulate_sell"]; ok {
		var req struct {
			TokenAmount string `json:"token_amount"`
		}
		_ = json.Unmarshal(simSellRaw, &req)
		tokIn, _ := new(big.Int).SetString(req.TokenAmount, 10)
		if tokIn == nil || tokIn.Sign() <= 0 {
			return nil, fmt.Errorf("invalid token_amount: %s", req.TokenAmount)
		}
		num := new(big.Int).Mul(reserveSov, tokIn)
		den := new(big.Int).Add(reserveToken, tokIn)
		grossSov := new(big.Int).Div(num, den)
		feePercent := big.NewInt(int64(pool.FeePercent))
		fee := new(big.Int).Mul(grossSov, feePercent)
		fee.Div(fee, big.NewInt(100))
		netSov := new(big.Int).Sub(grossSov, fee)

		return json.Marshal(map[string]interface{}{
			"sov_out":      netSov.String(),
			"gross_sov":    grossSov.String(),
			"fee":          fee.String(),
		})
	}

	// 4. LP Balance query: {"lp_balance": {"address": "sovra1..."}}
	if lpRaw, ok := raw["lp_balance"]; ok {
		var req struct {
			Address string `json:"address"`
		}
		_ = json.Unmarshal(lpRaw, &req)
		userLp := getLpBalance(storage, req.Address)

		sharePercent := float64(0)
		underlyingSov := big.NewInt(0)
		underlyingToken := big.NewInt(0)

		if totalLp.Sign() > 0 && userLp.Sign() > 0 {
			shareFloat := new(big.Float).Quo(new(big.Float).SetInt(userLp), new(big.Float).SetInt(totalLp))
			shareFloat.Mul(shareFloat, big.NewFloat(100))
			sharePercent, _ = shareFloat.Float64()

			underlyingSov.Div(new(big.Int).Mul(reserveSov, userLp), totalLp)
			underlyingToken.Div(new(big.Int).Mul(reserveToken, userLp), totalLp)
		}

		return json.Marshal(map[string]interface{}{
			"address":          req.Address,
			"lp_balance":       userLp.String(),
			"total_lp":         totalLp.String(),
			"share_percent":    sharePercent,
			"underlying_sov":   underlyingSov.String(),
			"underlying_token": underlyingToken.String(),
			"lp_symbol":        "SOV-LP",
		})
	}

	return nil, fmt.Errorf("unknown swap query: %s", string(queryBz))
}

func getCW20BalanceForContract(storage StorageDriver, contractAddr, userAddr string) *big.Int {
	key := append(PrefixBalance, []byte(userAddr)...)
	bz := storage.GetContractKey(contractAddr, key)
	if len(bz) == 0 {
		return big.NewInt(0)
	}
	n, ok := new(big.Int).SetString(string(bz), 10)
	if !ok {
		return big.NewInt(0)
	}
	return n
}

func setCW20BalanceForContract(storage StorageDriver, contractAddr, userAddr string, amount *big.Int) {
	key := append(PrefixBalance, []byte(userAddr)...)
	if amount.Sign() <= 0 {
		storage.DeleteContractKey(contractAddr, key)
		return
	}
	storage.SetContractKey(contractAddr, key, []byte(amount.String()))
}

func getLpBalance(storage StorageDriver, userAddr string) *big.Int {
	key := append(PrefixLpBalance, []byte(userAddr)...)
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

func setLpBalance(storage StorageDriver, userAddr string, amount *big.Int) {
	key := append(PrefixLpBalance, []byte(userAddr)...)
	if amount.Sign() <= 0 {
		storage.Delete(key)
		return
	}
	storage.Set(key, []byte(amount.String()))
}

func sqrtBigInt(n *big.Int) *big.Int {
	if n.Sign() <= 0 {
		return big.NewInt(0)
	}
	var z, y big.Int
	z.Set(n)
	y.Add(n, big.NewInt(1))
	y.Div(&y, big.NewInt(2))
	for y.Cmp(&z) < 0 {
		z.Set(&y)
		var t big.Int
		t.Div(n, &y)
		t.Add(&t, &y)
		y.Div(&t, big.NewInt(2))
	}
	return &z
}
