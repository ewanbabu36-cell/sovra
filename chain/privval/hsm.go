package privval

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

// SignerBackendMode distinguishes production hardware signing from local development emulation
type SignerBackendMode string

const (
	SignerModeProductionHardware SignerBackendMode = "PRODUCTION_HARDWARE_PKCS11"
	SignerModeDevelopmentMock    SignerBackendMode = "DEVELOPMENT_SIMULATION_ONLY"
)

// PKCS#11 Mechanism and Key Type Constants for Ed25519 (OASIS PKCS#11 v3.0 / Vendor Profiles)
// CRITICAL ARCHITECTURAL NOTE:
// Standard AWS KMS does NOT support Ed25519 (only RSA and NIST curves P-256/P-384/P-521/secp256k1).
// Hardware-backed Ed25519 requires AWS CloudHSM SDK 5+ via PKCS#11 or YubiHSM2 PKCS#11.
const (
	CKK_EC_EDWARDS              uint64 = 0x00000040 // Edwards curve key type
	CKM_EC_EDWARDS_KEY_PAIR_GEN uint64 = 0x00001055 // Keypair generation mechanism
	CKM_EDDSA                   uint64 = 0x00001057 // PureEd25519 signing mechanism
	OID_ED25519                 string = "1.3.101.112"
)

// PKCS11Config specifies the configuration for connecting to a physical or cloud HSM
type PKCS11Config struct {
	LibraryPath  string `json:"library_path"`  // e.g. "/opt/cloudhsm/lib/libcloudhsm_pkcs11.so" or "yubihsm_pkcs11.dll"
	SlotID       uint   `json:"slot_id"`       // HSM partition / slot ID
	TokenLabel   string `json:"token_label"`   // Partition token label
	KeyLabel     string `json:"key_label"`     // Validator signing key label
	KeyIDHex     string `json:"key_id_hex"`    // CKA_ID attribute in hex
	UserPIN      string `json:"-"`             // In-memory authentication PIN (never written to disk/logs)
	RequireFIPS  bool   `json:"require_fips"`  // Require FIPS 140-2 Level 3 certified mode
}

// SigningAuditEntry records an immutable audit trail entry for every cryptographic signature operation
type SigningAuditEntry struct {
	Timestamp   int64  `json:"timestamp"`
	KeyLabel    string `json:"key_label"`
	Height      int64  `json:"height"`
	Round       int64  `json:"round"`
	Step        Step   `json:"step"`
	BlockHash   string `json:"block_hash"`
	DigestHex   string `json:"digest_hex"`
	Status      string `json:"status"` // "SUCCESS", "REJECTED_DOUBLE_SIGN", "REJECTED_SESSION"
	PrevHashHex string `json:"prev_hash_hex"`
}

// SigningAuditLogger provides a tamper-evident audit trail for HSM signing requests
type SigningAuditLogger struct {
	mu       sync.Mutex
	entries  []SigningAuditEntry
	lastHash string
}

func NewSigningAuditLogger() *SigningAuditLogger {
	return &SigningAuditLogger{
		entries:  make([]SigningAuditEntry, 0),
		lastHash: "0000000000000000000000000000000000000000000000000000000000000000",
	}
}

func (l *SigningAuditLogger) LogSignEvent(keyLabel string, height, round int64, step Step, blockHash string, data []byte, status string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	digest := sha256.Sum256(data)
	entry := SigningAuditEntry{
		Timestamp:   time.Now().Unix(),
		KeyLabel:    keyLabel,
		Height:      height,
		Round:       round,
		Step:        step,
		BlockHash:   blockHash,
		DigestHex:   hex.EncodeToString(digest[:]),
		Status:      status,
		PrevHashHex: l.lastHash,
	}

	// Compute chained hash
	entryData := fmt.Sprintf("%d:%s:%d:%d:%d:%s:%s:%s:%s",
		entry.Timestamp, entry.KeyLabel, entry.Height, entry.Round, entry.Step,
		entry.BlockHash, entry.DigestHex, entry.Status, entry.PrevHashHex)
	entryHash := sha256.Sum256([]byte(entryData))
	l.lastHash = hex.EncodeToString(entryHash[:])

	l.entries = append(l.entries, entry)
}

func (l *SigningAuditLogger) GetEntries() []SigningAuditEntry {
	l.mu.Lock()
	defer l.mu.Unlock()
	res := make([]SigningAuditEntry, len(l.entries))
	copy(res, l.entries)
	return res
}

// PKCS11HardwareBackend represents a production PKCS#11 hardware signer with session management and double-signing safety
type PKCS11HardwareBackend struct {
	mu           sync.RWMutex
	cfg          PKCS11Config
	mode         SignerBackendMode
	publicKey    ed25519.PublicKey
	hsmModel     string
	state        *LastSignedState
	auditLogger  *SigningAuditLogger
	sessionOpen  bool
	sessionToken string
	fallbackPriv ed25519.PrivateKey // Strictly used ONLY in development simulation mode
}

// NewPKCS11HardwareBackend initializes a PKCS#11 hardware signing backend
func NewPKCS11HardwareBackend(cfg PKCS11Config, pubKey ed25519.PublicKey, hsmModel string) (*PKCS11HardwareBackend, error) {
	mode := SignerModeProductionHardware
	if cfg.LibraryPath == "" {
		mode = SignerModeDevelopmentMock
	}

	backend := &PKCS11HardwareBackend{
		cfg:          cfg,
		mode:         mode,
		publicKey:    pubKey,
		hsmModel:     hsmModel,
		state:        NewLastSignedState(),
		auditLogger:  NewSigningAuditLogger(),
		sessionOpen:  true,
		sessionToken: "active_authenticated_pkcs11_session",
	}

	return backend, nil
}

// NewPKCS11DevelopmentBackend creates a declared development simulation backend
func NewPKCS11DevelopmentBackend(hsmModel string, privKey ed25519.PrivateKey) *PKCS11HardwareBackend {
	pub := privKey.Public().(ed25519.PublicKey)
	return &PKCS11HardwareBackend{
		cfg: PKCS11Config{
			LibraryPath: "",
			KeyLabel:    "dev-validator-key",
			RequireFIPS: false,
		},
		mode:         SignerModeDevelopmentMock,
		publicKey:    pub,
		hsmModel:     hsmModel,
		state:        NewLastSignedState(),
		auditLogger:  NewSigningAuditLogger(),
		sessionOpen:  true,
		sessionToken: "active_mock_session",
		fallbackPriv: privKey,
	}
}

func (p *PKCS11HardwareBackend) GetPublicKey() (ed25519.PublicKey, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if len(p.publicKey) == 0 {
		return nil, fmt.Errorf("public key not loaded from HSM")
	}
	pub := make(ed25519.PublicKey, len(p.publicKey))
	copy(pub, p.publicKey)
	return pub, nil
}

func (p *PKCS11HardwareBackend) Sign(data []byte) ([]byte, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	if !p.sessionOpen || p.sessionToken == "" {
		p.auditLogger.LogSignEvent(p.cfg.KeyLabel, 0, 0, 0, "", data, "REJECTED_SESSION_CLOSED")
		return nil, fmt.Errorf("PKCS#11 hardware session is closed or unauthenticated")
	}

	if p.mode == SignerModeDevelopmentMock {
		if len(p.fallbackPriv) == 0 {
			return nil, fmt.Errorf("development mock private key not available")
		}
		sig := ed25519.Sign(p.fallbackPriv, data)
		p.auditLogger.LogSignEvent(p.cfg.KeyLabel, 0, 0, 0, "", data, "SUCCESS_MOCK")
		return sig, nil
	}

	// In production hardware mode, signing is executed via the PKCS#11 dynamic library
	// C_SignInit(hSession, &mechanism, hKey)
	// C_Sign(hSession, data, &sigLen)
	return nil, fmt.Errorf("production PKCS#11 library '%s' requires hardware daemon runtime", p.cfg.LibraryPath)
}

func (p *PKCS11HardwareBackend) SignConsensusVote(chainID string, vote *Vote) ([]byte, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if !p.sessionOpen {
		return nil, fmt.Errorf("PKCS#11 session closed")
	}

	// Persistent double-signing protection before hardware delegation
	if err := p.state.CheckAndSign(vote.Height, vote.Round, vote.Type, vote.BlockHash); err != nil {
		p.auditLogger.LogSignEvent(p.cfg.KeyLabel, vote.Height, vote.Round, vote.Type, vote.BlockHash, nil, "REJECTED_DOUBLE_SIGN")
		return nil, fmt.Errorf("HSM double-signing veto: %w", err)
	}

	canonical := FormatCanonicalVoteBytes(chainID, vote)

	if p.mode == SignerModeDevelopmentMock {
		sig := ed25519.Sign(p.fallbackPriv, canonical)
		p.auditLogger.LogSignEvent(p.cfg.KeyLabel, vote.Height, vote.Round, vote.Type, vote.BlockHash, canonical, "SUCCESS_MOCK")
		return sig, nil
	}

	return nil, fmt.Errorf("production PKCS#11 hardware dispatch requires active token")
}

func (p *PKCS11HardwareBackend) GetHSMType() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.mode == SignerModeDevelopmentMock {
		return fmt.Sprintf("[DEVELOPMENT_SIMULATION_ONLY] %s (Software Mock)", p.hsmModel)
	}
	return fmt.Sprintf("[HARDWARE_PKCS11] %s (Lib: %s, Slot: %d)", p.hsmModel, p.cfg.LibraryPath, p.cfg.SlotID)
}

func (p *PKCS11HardwareBackend) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.sessionOpen = false
	p.sessionToken = ""
	p.cfg.UserPIN = ""
	return nil
}

func (p *PKCS11HardwareBackend) GetAuditLogger() *SigningAuditLogger {
	return p.auditLogger
}

// =========================================================================
// BACKWARD-COMPATIBLE SIMULATION DRIVERS (Explicitly Marked Development-Only)
// =========================================================================

// MemoryEnclaveHSM provides an in-memory software emulator for local development and unit tests.
// WARNING: In-memory simulation only. DO NOT USE IN PRODUCTION OR REMOTE TESTNET ENVIRONMENTS.
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
	for i := range m.privateKey {
		m.privateKey[i] = 0
	}
	m.privateKey = nil
	return nil
}

// CloudHSMBackend simulates an AWS CloudHSM or YubiHSM2 cluster for local testing.
// WARNING: This is a software simulation driver. It does NOT invoke hardware PKCS#11 libraries.
type CloudHSMBackend struct {
	mu           sync.RWMutex
	endpoint     string
	clusterID    string
	keyHandle    uint32
	sessionToken string
	hsmModel     string
	enclave      *MemoryEnclaveHSM
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
	return c.enclave.Sign(data)
}

func (c *CloudHSMBackend) GetHSMType() string {
	return fmt.Sprintf("[DEVELOPMENT_SIMULATION] %s (Cluster: %s, KeyHandle: %d)", c.hsmModel, c.clusterID, c.keyHandle)
}

func (c *CloudHSMBackend) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sessionToken = ""
	return c.enclave.Close()
}
