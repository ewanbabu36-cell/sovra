package types

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
)

var (
	KeyPrefixCode          = []byte{0x40}
	KeyPrefixContract      = []byte{0x41}
	KeyPrefixContractStore = []byte{0x42}
	KeyCodeSeq             = []byte{0x43}
	KeyInstanceSeq         = []byte{0x44}
)

func CodeKey(codeID uint64) []byte {
	bz := make([]byte, 9)
	bz[0] = 0x40
	binary.BigEndian.PutUint64(bz[1:], codeID)
	return bz
}

func ContractKey(addr string) []byte {
	return append(KeyPrefixContract, []byte(addr)...)
}

func ContractStorePrefix(contractAddr string) []byte {
	prefix := append(KeyPrefixContractStore, []byte(contractAddr)...)
	return append(prefix, 0x00)
}

func ContractStoreKey(contractAddr string, key []byte) []byte {
	return append(ContractStorePrefix(contractAddr), key...)
}

// BuildContractAddress derives a deterministic CosmWasm contract address
func BuildContractAddress(codeID, instanceID uint64) string {
	raw := fmt.Sprintf("sovra_wasm_contract:%d:%d", codeID, instanceID)
	hash := sha256.Sum256([]byte(raw))
	return "sovra1wasm" + hex.EncodeToString(hash[:16])
}

// AccessConfig specifies permissions for instantiating uploaded code
type AccessConfig struct {
	Permission string `json:"permission"` // "Everybody", "Nobody", "AnyOfAddresses"
	Address    string `json:"address,omitempty"`
}

// CodeInfo contains metadata and storage reference for uploaded WASM bytecode
type CodeInfo struct {
	CodeID       uint64       `json:"code_id"`
	Creator      string       `json:"creator"`
	CodeHash     string       `json:"code_hash"` // hex-encoded sha256
	BytecodeSize int          `json:"bytecode_size"`
	Bytecode     []byte       `json:"bytecode,omitempty"`
	Instantiate  AccessConfig `json:"instantiate_config"`
}

// ContractInfo contains deployed contract configuration and metadata
type ContractInfo struct {
	Address   string `json:"address"`
	CodeID    uint64 `json:"code_id"`
	Creator   string `json:"creator"`
	Admin     string `json:"admin,omitempty"`
	Label     string `json:"label"`
	CreatedAt int64  `json:"created_at"`
}

// WasmConfig holds limits and gas bounds for contract execution
type WasmConfig struct {
	MemoryLimitPages uint32 `json:"memory_limit_pages"` // in 64KiB wasm pages (default: 32 = 2MB)
	MaxGas           uint64 `json:"max_gas"`
	MaxBytecodeSize  int    `json:"max_bytecode_size"` // e.g. 800 KB
}

func DefaultWasmConfig() WasmConfig {
	return WasmConfig{
		MemoryLimitPages: 32, // 2MB memory sandbox
		MaxGas:           10_000_000,
		MaxBytecodeSize:  800 * 1024,
	}
}

// Coin represents a denomination and amount in CosmWasm
type Coin struct {
	Denom  string `json:"denom"`
	Amount string `json:"amount"`
}

// BlockInfo holds the current block state for CosmWasm contracts
type BlockInfo struct {
	Height  int64  `json:"height"`
	Time    int64  `json:"time"` // unix timestamp in seconds (or nanoseconds in CosmWasm)
	ChainID string `json:"chain_id"`
}

type ContractInfoSummary struct {
	Address string `json:"address"`
}

// Env represents the CosmWasm contract execution environment
type Env struct {
	Block    BlockInfo           `json:"block"`
	Contract ContractInfoSummary `json:"contract"`
}

// MessageInfo represents the transaction context for execute / instantiate
type MessageInfo struct {
	Sender string `json:"sender"`
	Funds  []Coin `json:"funds"`
}

// EventAttribute represents a key-value tag in a CosmWasm response
type EventAttribute struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// Event represents an emitted CosmWasm event
type Event struct {
	Type       string           `json:"type"`
	Attributes []EventAttribute `json:"attributes"`
}

// SubMsg wraps a message to be executed by the runtime after the contract completes
type SubMsg struct {
	ID       uint64    `json:"id,omitempty"`
	Msg      CosmosMsg `json:"msg"`
	GasLimit *uint64   `json:"gas_limit,omitempty"`
	ReplyOn  string    `json:"reply_on,omitempty"`
}

// CosmosMsg represents messages dispatched from a contract to the chain
type CosmosMsg struct {
	Bank *BankMsg `json:"bank,omitempty"`
	Wasm *WasmMsg `json:"wasm,omitempty"`
}

type BankMsg struct {
	Send *BankSendMsg `json:"send,omitempty"`
	Burn *BankBurnMsg `json:"burn,omitempty"`
}

type BankSendMsg struct {
	ToAddress string `json:"to_address"`
	Amount    []Coin `json:"amount"`
}

type BankBurnMsg struct {
	Amount []Coin `json:"amount"`
}

type WasmMsg struct {
	Execute     *WasmExecuteMsg     `json:"execute,omitempty"`
	Instantiate *WasmInstantiateMsg `json:"instantiate,omitempty"`
}

type WasmExecuteMsg struct {
	ContractAddr string `json:"contract_addr"`
	Msg          string `json:"msg"`
	Funds        []Coin `json:"funds,omitempty"`
}

type WasmInstantiateMsg struct {
	CodeID uint64 `json:"code_id"`
	Msg    string `json:"msg"`
	Funds  []Coin `json:"funds,omitempty"`
	Label  string `json:"label"`
	Admin  string `json:"admin,omitempty"`
}

// Response represents the standard output of instantiate and execute
type Response struct {
	Messages   []SubMsg         `json:"messages,omitempty"`
	Attributes []EventAttribute `json:"attributes,omitempty"`
	Events     []Event          `json:"events,omitempty"`
	Data       string           `json:"data,omitempty"` // base64 or raw string
}
