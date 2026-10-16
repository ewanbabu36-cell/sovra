package node

import (
	"crypto/ed25519"
	"encoding/json"
)

// Transaction types
type TxType string

const (
	TxTypeSend                TxType = "send"
	TxTypeBurn                TxType = "burn"
	TxTypeStoreCode           TxType = "store_code"
	TxTypeInstantiateContract TxType = "instantiate"
	TxTypeExecuteContract     TxType = "execute"
)

// SignedTransaction represents a standard signed transaction in Sovra
type SignedTransaction struct {
	Type      TxType `json:"type"`
	Sender    string `json:"sender"`
	Recipient string `json:"recipient,omitempty"`
	Amount    string `json:"amount,omitempty"` // in uSOV
	Nonce     uint64 `json:"nonce"`
	Fee       string `json:"fee"` // in uSOV

	// CosmWasm Fields
	WASMBytecodeHex string `json:"wasm_bytecode,omitempty"`
	CodeID          uint64 `json:"code_id,omitempty"`
	Contract        string `json:"contract,omitempty"`
	Label           string `json:"label,omitempty"`
	Admin           string `json:"admin,omitempty"`
	Msg             string `json:"msg,omitempty"`
	Funds           string `json:"funds,omitempty"`

	PubKeyHex string `json:"pub_key"` // ed25519 public key hex
	SigHex    string `json:"sig"`     // ed25519 signature hex
}

func (tx *SignedTransaction) GetSignBytes() []byte {
	// Canonical bytes without the signature
	payload := struct {
		Type            TxType `json:"type"`
		Sender          string `json:"sender"`
		Recipient       string `json:"recipient,omitempty"`
		Amount          string `json:"amount,omitempty"`
		Nonce           uint64 `json:"nonce"`
		Fee             string `json:"fee"`
		WASMBytecodeHex string `json:"wasm_bytecode,omitempty"`
		CodeID          uint64 `json:"code_id,omitempty"`
		Contract        string `json:"contract,omitempty"`
		Label           string `json:"label,omitempty"`
		Admin           string `json:"admin,omitempty"`
		Msg             string `json:"msg,omitempty"`
		Funds           string `json:"funds,omitempty"`
	}{
		Type:            tx.Type,
		Sender:          tx.Sender,
		Recipient:       tx.Recipient,
		Amount:          tx.Amount,
		Nonce:           tx.Nonce,
		Fee:             tx.Fee,
		WASMBytecodeHex: tx.WASMBytecodeHex,
		CodeID:          tx.CodeID,
		Contract:        tx.Contract,
		Label:           tx.Label,
		Admin:           tx.Admin,
		Msg:             tx.Msg,
		Funds:           tx.Funds,
	}
	bz, _ := json.Marshal(payload)
	return bz
}

// GenesisState defines initial blockchain parameters
type GenesisState struct {
	ChainID     string             `json:"chain_id"`
	GenesisTime int64              `json:"genesis_time"`
	Accounts    map[string]string  `json:"accounts"`   // addr -> uSOV
	Validators  []GenesisValidator `json:"validators"` // initial consensus validator set
	SeedNodes   []string           `json:"seed_nodes,omitempty"`
}

type GenesisValidator struct {
	Name        string `json:"name"`
	Address     string `json:"address"`
	PubKeyHex   string `json:"pub_key"`
	VotingPower int64  `json:"voting_power"`
	NodeID      string `json:"node_id,omitempty"`
	P2PAddr     string `json:"p2p_addr,omitempty"`
}

// KeyPair represents an ed25519 account keypair
type KeyPair struct {
	Name       string            `json:"name"`
	Address    string            `json:"address"`
	PublicKey  ed25519.PublicKey `json:"-"`
	PrivateKey ed25519.PrivateKey `json:"-"`
	PubKeyHex  string            `json:"pub_key"`
	PrivKeyHex string            `json:"priv_key"`
}
