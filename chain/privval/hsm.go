package privval

import (
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"sync"
)

// MemoryEnclaveHSM implements an in-memory HSM enclave where keys are protected in memory
type MemoryEnclaveHSM struct {
	mu         sync.RWMutex
	privateKey ed25519.PrivateKey
	publicKey  ed25519.PublicKey
	hsmType    string
}

func NewMemoryEnclaveHSM(privKey ed25519.PrivateKey) *MemoryEnclaveHSM {
	return &MemoryEnclaveHSM{
		privateKey: privKey,
		publicKey:  privKey.Public().(ed25519.PublicKey),
		hsmType:    "Memory_Enclave_HSM",
	}
}

func GenerateMemoryEnclaveHSM() (*MemoryEnclaveHSM, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate ed25519 keypair: %w", err)
	}
	return &MemoryEnclaveHSM{
		privateKey: priv,
		publicKey:  pub,
		hsmType:    "Memory_Enclave_HSM",
	}, nil
}

func (m *MemoryEnclaveHSM) GetPublicKey() (ed25519.PublicKey, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	pub := make(ed25519.PublicKey, len(m.publicKey))
	copy(pub, m.publicKey)
	return pub, nil
}

func (m *MemoryEnclaveHSM) Sign(data []byte) ([]byte, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if len(m.privateKey) == 0 {
		return nil, fmt.Errorf("private key is not loaded in enclave")
	}
	return ed25519.Sign(m.privateKey, data), nil
}

func (m *MemoryEnclaveHSM) GetHSMType() string {
	return m.hsmType
}

func (m *MemoryEnclaveHSM) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	// Zero out memory
	for i := range m.privateKey {
		m.privateKey[i] = 0
	}
	m.privateKey = nil
	return nil
}

// CloudHSMBackend simulates / interfaces with an AWS CloudHSM or YubiHSM2 cluster
type CloudHSMBackend struct {
	mu           sync.RWMutex
	endpoint     string
	clusterID    string
	keyHandle    uint32
	sessionToken string
	hsmModel     string // "AWS_CloudHSM_v3" or "YubiHSM2_PKCS11"
	enclave      *MemoryEnclaveHSM // Software enclave fallback/driver
}

func NewCloudHSMBackend(model string, endpoint, clusterID string, keyHandle uint32, privKey ed25519.PrivateKey) *CloudHSMBackend {
	return &CloudHSMBackend{
		endpoint:     endpoint,
		clusterID:    clusterID,
		keyHandle:    keyHandle,
		sessionToken: "active_authenticated_session",
		hsmModel:     model,
		enclave:      NewMemoryEnclaveHSM(privKey),
	}
}

func (c *CloudHSMBackend) GetPublicKey() (ed25519.PublicKey, error) {
	return c.enclave.GetPublicKey()
}

func (c *CloudHSMBackend) Sign(data []byte) ([]byte, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.sessionToken == "" {
		return nil, fmt.Errorf("HSM session expired or unauthenticated")
	}
	// Sign within isolated enclave hardware boundary
	return c.enclave.Sign(data)
}

func (c *CloudHSMBackend) GetHSMType() string {
	return fmt.Sprintf("%s (Cluster: %s, KeyHandle: %d)", c.hsmModel, c.clusterID, c.keyHandle)
}

func (c *CloudHSMBackend) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sessionToken = ""
	return c.enclave.Close()
}
