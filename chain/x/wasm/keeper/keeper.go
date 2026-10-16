package keeper

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"cosmossdk.io/math"
	"github.com/sovra/chain/store"
	"github.com/sovra/chain/x/bank"
	"github.com/sovra/chain/x/wasm/types"
	"github.com/sovra/chain/x/wasm/vm"
)

type ContractStorageAdapter struct {
	store        store.KVStore
	contractAddr string
}

func NewContractStorageAdapter(s store.KVStore, contractAddr string) *ContractStorageAdapter {
	return &ContractStorageAdapter{
		store:        s,
		contractAddr: contractAddr,
	}
}

func (c *ContractStorageAdapter) Get(key []byte) []byte {
	return c.store.Get(types.ContractStoreKey(c.contractAddr, key))
}

func (c *ContractStorageAdapter) Set(key, value []byte) {
	c.store.Set(types.ContractStoreKey(c.contractAddr, key), value)
}

func (c *ContractStorageAdapter) Delete(key []byte) {
	c.store.Delete(types.ContractStoreKey(c.contractAddr, key))
}

func (c *ContractStorageAdapter) GetContractKey(contractAddr string, key []byte) []byte {
	return c.store.Get(types.ContractStoreKey(contractAddr, key))
}

func (c *ContractStorageAdapter) SetContractKey(contractAddr string, key, value []byte) {
	c.store.Set(types.ContractStoreKey(contractAddr, key), value)
}

func (c *ContractStorageAdapter) DeleteContractKey(contractAddr string, key []byte) {
	c.store.Delete(types.ContractStoreKey(contractAddr, key))
}

// Keeper manages CosmWasm contract storage, execution, and state sandboxing
type Keeper struct {
	mu     sync.RWMutex
	config types.WasmConfig
	vm     *vm.WasmVM
}

func NewKeeper(config types.WasmConfig) *Keeper {
	return &Keeper{
		config: config,
		vm:     vm.NewWasmVM(config),
	}
}

// StoreCode saves new WASM bytecode and allocates a unique CodeID
func (k *Keeper) StoreCode(s store.KVStore, sender string, bytecode []byte) (uint64, string, error) {
	k.mu.Lock()
	defer k.mu.Unlock()

	if len(bytecode) == 0 {
		return 0, "", errors.New("empty bytecode")
	}
	if len(bytecode) > k.config.MaxBytecodeSize {
		return 0, "", fmt.Errorf("bytecode exceeds maximum allowed size (%d > %d bytes)", len(bytecode), k.config.MaxBytecodeSize)
	}

	hash := sha256.Sum256(bytecode)
	codeHash := hex.EncodeToString(hash[:])

	// Increment CodeID sequence
	var codeID uint64 = 1
	seqBz := s.Get(types.KeyCodeSeq)
	if len(seqBz) >= 8 {
		codeID = binary.BigEndian.Uint64(seqBz) + 1
	}
	newSeqBz := make([]byte, 8)
	binary.BigEndian.PutUint64(newSeqBz, codeID)
	s.Set(types.KeyCodeSeq, newSeqBz)

	codeInfo := types.CodeInfo{
		CodeID:       codeID,
		Creator:      sender,
		CodeHash:     codeHash,
		BytecodeSize: len(bytecode),
		Bytecode:     bytecode,
		Instantiate: types.AccessConfig{
			Permission: "Everybody",
		},
	}

	codeBz, err := json.Marshal(codeInfo)
	if err != nil {
		return 0, "", fmt.Errorf("failed to serialize code info: %w", err)
	}
	s.Set(types.CodeKey(codeID), codeBz)

	return codeID, codeHash, nil
}

// InstantiateContract deploys a new instance of an uploaded contract
func (k *Keeper) InstantiateContract(
	s store.KVStore,
	bk *bank.Keeper,
	sender string,
	admin string,
	codeID uint64,
	label string,
	msgBz []byte,
	funds math.Int,
	env types.Env,
) (string, *types.Response, error) {
	k.mu.Lock()
	defer k.mu.Unlock()

	codeInfo, err := k.GetCode(s, codeID)
	if err != nil {
		return "", nil, err
	}

	// Increment contract instance sequence
	var instanceID uint64 = 1
	instBz := s.Get(types.KeyInstanceSeq)
	if len(instBz) >= 8 {
		instanceID = binary.BigEndian.Uint64(instBz) + 1
	}
	newInstBz := make([]byte, 8)
	binary.BigEndian.PutUint64(newInstBz, instanceID)
	s.Set(types.KeyInstanceSeq, newInstBz)

	contractAddr := types.BuildContractAddress(codeID, instanceID)

	// Transfer funds if provided
	if funds.IsPositive() && bk != nil {
		if err := bk.SendCoins(s, sender, contractAddr, funds); err != nil {
			return "", nil, fmt.Errorf("failed to transfer funds to contract: %w", err)
		}
	}

	storageAdapter := NewContractStorageAdapter(s, contractAddr)
	env.Contract.Address = contractAddr

	info := types.MessageInfo{
		Sender: sender,
		Funds: []types.Coin{
			{Denom: "usov", Amount: funds.String()},
		},
	}

	resp, err := k.vm.Instantiate(codeInfo.Bytecode, storageAdapter, env, info, msgBz)
	if err != nil {
		return "", nil, fmt.Errorf("contract instantiate failed: %w", err)
	}

	contractInfo := types.ContractInfo{
		Address:   contractAddr,
		CodeID:    codeID,
		Creator:   sender,
		Admin:     admin,
		Label:     label,
		CreatedAt: env.Block.Time,
	}
	cBz, _ := json.Marshal(contractInfo)
	s.Set(types.ContractKey(contractAddr), cBz)

	// Process any sub-messages emitted by instantiate
	if err := k.processMessages(s, bk, contractAddr, resp.Messages); err != nil {
		return "", nil, err
	}

	return contractAddr, resp, nil
}

// ExecuteContract executes a state-mutating message on an existing contract
func (k *Keeper) ExecuteContract(
	s store.KVStore,
	bk *bank.Keeper,
	sender string,
	contractAddr string,
	msgBz []byte,
	funds math.Int,
	env types.Env,
) (*types.Response, error) {
	k.mu.Lock()
	defer k.mu.Unlock()

	contractInfo, err := k.GetContractInfo(s, contractAddr)
	if err != nil {
		return nil, err
	}

	codeInfo, err := k.GetCode(s, contractInfo.CodeID)
	if err != nil {
		return nil, err
	}

	// Transfer funds to contract if attached
	if funds.IsPositive() && bk != nil {
		if err := bk.SendCoins(s, sender, contractAddr, funds); err != nil {
			return nil, fmt.Errorf("failed to transfer attached funds to contract: %w", err)
		}
	}

	storageAdapter := NewContractStorageAdapter(s, contractAddr)
	env.Contract.Address = contractAddr

	info := types.MessageInfo{
		Sender: sender,
		Funds: []types.Coin{
			{Denom: "usov", Amount: funds.String()},
		},
	}

	resp, err := k.vm.Execute(codeInfo.Bytecode, storageAdapter, env, info, msgBz)
	if err != nil {
		return nil, fmt.Errorf("contract execution failed: %w", err)
	}

	// Process any sub-messages emitted by execute
	if err := k.processMessages(s, bk, contractAddr, resp.Messages); err != nil {
		return nil, err
	}

	return resp, nil
}

// QuerySmartContract executes a read-only smart query against a contract
func (k *Keeper) QuerySmartContract(s store.KVStore, contractAddr string, queryBz []byte, env types.Env) ([]byte, error) {
	k.mu.RLock()
	defer k.mu.RUnlock()

	contractInfo, err := k.GetContractInfo(s, contractAddr)
	if err != nil {
		return nil, err
	}

	codeInfo, err := k.GetCode(s, contractInfo.CodeID)
	if err != nil {
		return nil, err
	}

	storageAdapter := NewContractStorageAdapter(s, contractAddr)
	env.Contract.Address = contractAddr

	return k.vm.Query(codeInfo.Bytecode, storageAdapter, env, queryBz)
}

func (k *Keeper) GetCode(s store.KVStore, codeID uint64) (*types.CodeInfo, error) {
	bz := s.Get(types.CodeKey(codeID))
	if len(bz) == 0 {
		return nil, fmt.Errorf("code ID %d not found", codeID)
	}
	var info types.CodeInfo
	if err := json.Unmarshal(bz, &info); err != nil {
		return nil, fmt.Errorf("failed to unmarshal code info: %w", err)
	}
	return &info, nil
}

func (k *Keeper) GetContractInfo(s store.KVStore, contractAddr string) (*types.ContractInfo, error) {
	bz := s.Get(types.ContractKey(contractAddr))
	if len(bz) == 0 {
		return nil, fmt.Errorf("contract %s not found", contractAddr)
	}
	var info types.ContractInfo
	if err := json.Unmarshal(bz, &info); err != nil {
		return nil, fmt.Errorf("failed to unmarshal contract info: %w", err)
	}
	return &info, nil
}

func (k *Keeper) processMessages(s store.KVStore, bk *bank.Keeper, contractAddr string, msgs []types.SubMsg) error {
	if bk == nil || len(msgs) == 0 {
		return nil
	}

	for _, subMsg := range msgs {
		if subMsg.Msg.Bank != nil && subMsg.Msg.Bank.Send != nil {
			sendMsg := subMsg.Msg.Bank.Send
			for _, coin := range sendMsg.Amount {
				amt, ok := math.NewIntFromString(coin.Amount)
				if !ok || !amt.IsPositive() {
					return fmt.Errorf("invalid bank send amount: %s", coin.Amount)
				}
				if err := bk.SendCoins(s, contractAddr, sendMsg.ToAddress, amt); err != nil {
					return fmt.Errorf("contract bank send failed: %w", err)
				}
			}
		}
	}
	return nil
}
