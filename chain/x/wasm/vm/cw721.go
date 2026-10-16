package vm

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/sovra/chain/x/wasm/types"
)

// Storage keys for CW721 Non-Fungible Token standard
var (
	KeyCW721ContractInfo = []byte("cw721_contract_info")
	KeyCW721Minter       = []byte("cw721_minter")
	KeyCW721NumTokens    = []byte("cw721_num_tokens")
	KeyCW721TokenList    = []byte("cw721_token_list")
	PrefixNFTOwner       = []byte("nft_owner_")
	PrefixNFTInfo        = []byte("nft_info_")
	PrefixNFTApproval    = []byte("nft_approval_")
)

type CW721ContractInfo struct {
	Name   string `json:"name"`
	Symbol string `json:"symbol"`
}

type CW721InstantiateMsg struct {
	Name   string `json:"name"`
	Symbol string `json:"symbol"`
	Minter string `json:"minter"`
}

type CW721MintMsg struct {
	TokenId   string                 `json:"token_id"`
	Owner     string                 `json:"owner"`
	TokenUri  string                 `json:"token_uri,omitempty"`
	Extension map[string]interface{} `json:"extension,omitempty"`
}

type CW721TransferNftMsg struct {
	Recipient string `json:"recipient"`
	TokenId   string `json:"token_id"`
}

type CW721BurnMsg struct {
	TokenId string `json:"token_id"`
}

type CW721ApproveMsg struct {
	Spender string `json:"spender"`
	TokenId string `json:"token_id"`
}

type CW721NFTInfoData struct {
	TokenId   string                 `json:"token_id"`
	TokenUri  string                 `json:"token_uri,omitempty"`
	Extension map[string]interface{} `json:"extension,omitempty"`
}

type CW721OwnerOfResponse struct {
	Owner     string   `json:"owner"`
	Approvals []string `json:"approvals"`
}

type CW721AllNftInfoResponse struct {
	Access struct {
		Owner     string   `json:"owner"`
		Approvals []string `json:"approvals"`
	} `json:"access"`
	Info CW721NFTInfoData `json:"info"`
}

type CW721NumTokensResponse struct {
	Count uint64 `json:"count"`
}

type CW721TokensResponse struct {
	Tokens []string `json:"tokens"`
}

// ExecuteCW721Instantiate initializes a CW721 NFT contract
func ExecuteCW721Instantiate(storage StorageDriver, env types.Env, info types.MessageInfo, msgBz []byte) (*types.Response, error) {
	var msg CW721InstantiateMsg
	if err := json.Unmarshal(msgBz, &msg); err != nil {
		return nil, fmt.Errorf("invalid CW721 instantiate msg: %w", err)
	}

	if strings.TrimSpace(msg.Name) == "" {
		return nil, fmt.Errorf("contract name cannot be empty")
	}
	if strings.TrimSpace(msg.Symbol) == "" {
		return nil, fmt.Errorf("contract symbol cannot be empty")
	}

	minter := msg.Minter
	if minter == "" {
		minter = info.Sender
	}

	contractInfo := CW721ContractInfo{
		Name:   msg.Name,
		Symbol: msg.Symbol,
	}

	infoBz, _ := json.Marshal(contractInfo)
	storage.Set(KeyCW721ContractInfo, infoBz)
	storage.Set(KeyCW721Minter, []byte(minter))
	storage.Set(KeyCW721NumTokens, []byte("0"))
	storage.Set(KeyCW721TokenList, []byte("[]"))

	return &types.Response{
		Attributes: []types.EventAttribute{
			{Key: "action", Value: "instantiate"},
			{Key: "contract_type", Value: "cw721_nft"},
			{Key: "name", Value: msg.Name},
			{Key: "symbol", Value: msg.Symbol},
			{Key: "minter", Value: minter},
		},
	}, nil
}

// ExecuteCW721Execute handles state mutations on CW721 contracts
func ExecuteCW721Execute(storage StorageDriver, env types.Env, info types.MessageInfo, msgBz []byte) (*types.Response, error) {
	var parsed map[string]json.RawMessage
	if err := json.Unmarshal(msgBz, &parsed); err != nil {
		return nil, fmt.Errorf("failed to parse execute message: %w", err)
	}

	// 1. Mint
	if raw, ok := parsed["mint"]; ok {
		var msg CW721MintMsg
		if err := json.Unmarshal(raw, &msg); err != nil {
			return nil, fmt.Errorf("invalid mint msg: %w", err)
		}

		minter := string(storage.Get(KeyCW721Minter))
		if minter != "" && minter != info.Sender {
			return nil, fmt.Errorf("unauthorized: only minter (%s) can mint tokens", minter)
		}

		if msg.TokenId == "" {
			return nil, fmt.Errorf("token_id cannot be empty")
		}
		if msg.Owner == "" {
			msg.Owner = info.Sender
		}

		ownerKey := append(PrefixNFTOwner, []byte(msg.TokenId)...)
		existing := storage.Get(ownerKey)
		if len(existing) > 0 {
			return nil, fmt.Errorf("token_id %s already exists", msg.TokenId)
		}

		storage.Set(ownerKey, []byte(msg.Owner))

		nftData := CW721NFTInfoData{
			TokenId:   msg.TokenId,
			TokenUri:  msg.TokenUri,
			Extension: msg.Extension,
		}
		nftBz, _ := json.Marshal(nftData)
		storage.Set(append(PrefixNFTInfo, []byte(msg.TokenId)...), nftBz)

		// Update token list
		var tokenList []string
		listBz := storage.Get(KeyCW721TokenList)
		if len(listBz) > 0 {
			_ = json.Unmarshal(listBz, &tokenList)
		}
		tokenList = append(tokenList, msg.TokenId)
		newListBz, _ := json.Marshal(tokenList)
		storage.Set(KeyCW721TokenList, newListBz)

		countStr := string(storage.Get(KeyCW721NumTokens))
		count, _ := strconv.ParseUint(countStr, 10, 64)
		storage.Set(KeyCW721NumTokens, []byte(strconv.FormatUint(count+1, 10)))

		return &types.Response{
			Attributes: []types.EventAttribute{
				{Key: "action", Value: "mint"},
				{Key: "token_id", Value: msg.TokenId},
				{Key: "owner", Value: msg.Owner},
				{Key: "token_uri", Value: msg.TokenUri},
			},
		}, nil
	}

	// 2. TransferNft
	if raw, ok := parsed["transfer_nft"]; ok {
		var msg CW721TransferNftMsg
		if err := json.Unmarshal(raw, &msg); err != nil {
			return nil, fmt.Errorf("invalid transfer_nft msg: %w", err)
		}

		if msg.Recipient == "" {
			return nil, fmt.Errorf("recipient cannot be empty")
		}

		ownerKey := append(PrefixNFTOwner, []byte(msg.TokenId)...)
		currentOwner := string(storage.Get(ownerKey))
		if currentOwner == "" {
			return nil, fmt.Errorf("token_id %s not found", msg.TokenId)
		}

		approvalKey := append(PrefixNFTApproval, []byte(msg.TokenId)...)
		approvedSpender := string(storage.Get(approvalKey))

		if info.Sender != currentOwner && info.Sender != approvedSpender {
			return nil, fmt.Errorf("unauthorized: caller %s is not owner or approved", info.Sender)
		}

		// Transfer ownership
		storage.Set(ownerKey, []byte(msg.Recipient))
		// Clear approvals
		storage.Delete(approvalKey)

		return &types.Response{
			Attributes: []types.EventAttribute{
				{Key: "action", Value: "transfer_nft"},
				{Key: "token_id", Value: msg.TokenId},
				{Key: "sender", Value: info.Sender},
				{Key: "recipient", Value: msg.Recipient},
			},
		}, nil
	}

	// 3. Burn
	if raw, ok := parsed["burn"]; ok {
		var msg CW721BurnMsg
		if err := json.Unmarshal(raw, &msg); err != nil {
			return nil, fmt.Errorf("invalid burn msg: %w", err)
		}

		ownerKey := append(PrefixNFTOwner, []byte(msg.TokenId)...)
		currentOwner := string(storage.Get(ownerKey))
		if currentOwner == "" {
			return nil, fmt.Errorf("token_id %s not found", msg.TokenId)
		}

		if info.Sender != currentOwner {
			return nil, fmt.Errorf("unauthorized: only owner can burn token")
		}

		storage.Delete(ownerKey)
		storage.Delete(append(PrefixNFTInfo, []byte(msg.TokenId)...))
		storage.Delete(append(PrefixNFTApproval, []byte(msg.TokenId)...))

		var tokenList []string
		listBz := storage.Get(KeyCW721TokenList)
		if len(listBz) > 0 {
			_ = json.Unmarshal(listBz, &tokenList)
		}
		var updated []string
		for _, t := range tokenList {
			if t != msg.TokenId {
				updated = append(updated, t)
			}
		}
		newListBz, _ := json.Marshal(updated)
		storage.Set(KeyCW721TokenList, newListBz)

		countStr := string(storage.Get(KeyCW721NumTokens))
		count, _ := strconv.ParseUint(countStr, 10, 64)
		if count > 0 {
			count--
		}
		storage.Set(KeyCW721NumTokens, []byte(strconv.FormatUint(count, 10)))

		return &types.Response{
			Attributes: []types.EventAttribute{
				{Key: "action", Value: "burn"},
				{Key: "token_id", Value: msg.TokenId},
				{Key: "sender", Value: info.Sender},
			},
		}, nil
	}

	// 4. Approve
	if raw, ok := parsed["approve"]; ok {
		var msg CW721ApproveMsg
		if err := json.Unmarshal(raw, &msg); err != nil {
			return nil, fmt.Errorf("invalid approve msg: %w", err)
		}

		ownerKey := append(PrefixNFTOwner, []byte(msg.TokenId)...)
		currentOwner := string(storage.Get(ownerKey))
		if currentOwner == "" {
			return nil, fmt.Errorf("token_id %s not found", msg.TokenId)
		}

		if info.Sender != currentOwner {
			return nil, fmt.Errorf("unauthorized: only owner can approve")
		}

		approvalKey := append(PrefixNFTApproval, []byte(msg.TokenId)...)
		storage.Set(approvalKey, []byte(msg.Spender))

		return &types.Response{
			Attributes: []types.EventAttribute{
				{Key: "action", Value: "approve"},
				{Key: "token_id", Value: msg.TokenId},
				{Key: "spender", Value: msg.Spender},
			},
		}, nil
	}

	return nil, fmt.Errorf("unsupported CW721 execute msg: %s", string(msgBz))
}

// ExecuteCW721Query processes read-only CW721 smart contract queries
func ExecuteCW721Query(storage StorageDriver, env types.Env, queryBz []byte) ([]byte, error) {
	var query map[string]json.RawMessage
	if err := json.Unmarshal(queryBz, &query); err != nil {
		return nil, fmt.Errorf("invalid query json: %w", err)
	}

	// 1. OwnerOf
	if raw, ok := query["owner_of"]; ok {
		var params struct {
			TokenId string `json:"token_id"`
		}
		_ = json.Unmarshal(raw, &params)
		ownerKey := append(PrefixNFTOwner, []byte(params.TokenId)...)
		owner := string(storage.Get(ownerKey))
		if owner == "" {
			return nil, fmt.Errorf("token_id %s not found", params.TokenId)
		}

		approvalKey := append(PrefixNFTApproval, []byte(params.TokenId)...)
		approvedSpender := string(storage.Get(approvalKey))
		approvals := []string{}
		if approvedSpender != "" {
			approvals = append(approvals, approvedSpender)
		}

		resp := CW721OwnerOfResponse{
			Owner:     owner,
			Approvals: approvals,
		}
		return json.Marshal(resp)
	}

	// 2. NftInfo
	if raw, ok := query["nft_info"]; ok {
		var params struct {
			TokenId string `json:"token_id"`
		}
		_ = json.Unmarshal(raw, &params)
		infoBz := storage.Get(append(PrefixNFTInfo, []byte(params.TokenId)...))
		if len(infoBz) == 0 {
			return nil, fmt.Errorf("token_id %s not found", params.TokenId)
		}
		return infoBz, nil
	}

	// 3. AllNftInfo
	if raw, ok := query["all_nft_info"]; ok {
		var params struct {
			TokenId string `json:"token_id"`
		}
		_ = json.Unmarshal(raw, &params)
		ownerKey := append(PrefixNFTOwner, []byte(params.TokenId)...)
		owner := string(storage.Get(ownerKey))
		if owner == "" {
			return nil, fmt.Errorf("token_id %s not found", params.TokenId)
		}

		infoBz := storage.Get(append(PrefixNFTInfo, []byte(params.TokenId)...))
		var info CW721NFTInfoData
		if len(infoBz) > 0 {
			_ = json.Unmarshal(infoBz, &info)
		}

		approvalKey := append(PrefixNFTApproval, []byte(params.TokenId)...)
		approvedSpender := string(storage.Get(approvalKey))
		approvals := []string{}
		if approvedSpender != "" {
			approvals = append(approvals, approvedSpender)
		}

		resp := CW721AllNftInfoResponse{
			Info: info,
		}
		resp.Access.Owner = owner
		resp.Access.Approvals = approvals
		return json.Marshal(resp)
	}

	// 4. NumTokens
	if _, ok := query["num_tokens"]; ok {
		countStr := string(storage.Get(KeyCW721NumTokens))
		count, _ := strconv.ParseUint(countStr, 10, 64)
		resp := CW721NumTokensResponse{
			Count: count,
		}
		return json.Marshal(resp)
	}

	// 5. Tokens (all tokens or by owner)
	if raw, ok := query["tokens"]; ok {
		var params struct {
			Owner      string `json:"owner,omitempty"`
			StartAfter string `json:"start_after,omitempty"`
			Limit      int    `json:"limit,omitempty"`
		}
		_ = json.Unmarshal(raw, &params)

		var tokenList []string
		listBz := storage.Get(KeyCW721TokenList)
		if len(listBz) > 0 {
			_ = json.Unmarshal(listBz, &tokenList)
		}

		var matched []string
		for _, tid := range tokenList {
			if params.Owner != "" {
				owner := string(storage.Get(append(PrefixNFTOwner, []byte(tid)...)))
				if owner != params.Owner {
					continue
				}
			}
			matched = append(matched, tid)
		}

		if params.Limit > 0 && len(matched) > params.Limit {
			matched = matched[:params.Limit]
		}

		return json.Marshal(CW721TokensResponse{Tokens: matched})
	}

	// 6. ContractInfo
	if _, ok := query["contract_info"]; ok {
		infoBz := storage.Get(KeyCW721ContractInfo)
		if len(infoBz) == 0 {
			return nil, fmt.Errorf("contract info not found")
		}
		return infoBz, nil
	}

	// 7. Minter
	if _, ok := query["minter"]; ok {
		minter := string(storage.Get(KeyCW721Minter))
		return json.Marshal(map[string]string{"minter": minter})
	}

	return nil, fmt.Errorf("unknown CW721 query: %s", string(queryBz))
}
