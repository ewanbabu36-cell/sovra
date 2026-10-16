package vm

// StorageDriver defines key-value state access for a contract instance
type StorageDriver interface {
	Get(key []byte) []byte
	Set(key, value []byte)
	Delete(key []byte)
	GetContractKey(contractAddr string, key []byte) []byte
	SetContractKey(contractAddr string, key, value []byte)
	DeleteContractKey(contractAddr string, key []byte)
}

// MemoryStorage is an in-memory implementation of StorageDriver
type MemoryStorage struct {
	data map[string][]byte
}

func NewMemoryStorage() *MemoryStorage {
	return &MemoryStorage{data: make(map[string][]byte)}
}

func (m *MemoryStorage) Get(key []byte) []byte {
	return m.data[string(key)]
}

func (m *MemoryStorage) Set(key, value []byte) {
	valCopy := make([]byte, len(value))
	copy(valCopy, value)
	m.data[string(key)] = valCopy
}

func (m *MemoryStorage) Delete(key []byte) {
	delete(m.data, string(key))
}

func (m *MemoryStorage) GetContractKey(contractAddr string, key []byte) []byte {
	return m.data[contractAddr+":"+string(key)]
}

func (m *MemoryStorage) SetContractKey(contractAddr string, key, value []byte) {
	valCopy := make([]byte, len(value))
	copy(valCopy, value)
	m.data[contractAddr+":"+string(key)] = valCopy
}

func (m *MemoryStorage) DeleteContractKey(contractAddr string, key []byte) {
	delete(m.data, contractAddr+":"+string(key))
}
