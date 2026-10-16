package auth

import (
	"bufio"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/scrypt"
	"golang.org/x/term"
)

var (
	ErrInvalidPassphrase = errors.New("invalid keystore passphrase or corrupted ciphertext")
	ErrKeystoreNotFound  = errors.New("keystore file not found")
)

const (
	ScryptN      = 32768
	ScryptR      = 8
	ScryptP      = 1
	ScryptKeyLen = 32
)

type ScryptParams struct {
	SaltHex string `json:"salt"`
	N       int    `json:"n"`
	R       int    `json:"r"`
	P       int    `json:"p"`
	KeyLen  int    `json:"keylen"`
}

type CryptoJSON struct {
	Cipher       string       `json:"cipher"`       // "aes-256-gcm"
	CipherText   string       `json:"ciphertext"`   // hex-encoded AES-GCM ciphertext + tag
	Nonce        string       `json:"nonce"`        // hex-encoded 12-byte nonce
	KDF          string       `json:"kdf"`          // "scrypt"
	ScryptParams ScryptParams `json:"scrypt_params"`
	MAC          string       `json:"mac"`          // sha256 checksum
}

// KeystoreJSON represents the encrypted key storage schema
type KeystoreJSON struct {
	Version   int        `json:"version"`
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Address   string     `json:"address"`
	PubKeyHex string     `json:"pub_key"`
	Crypto    CryptoJSON `json:"crypto"`
}

// EncryptKey encrypts an ed25519 private key using AES-256-GCM with scrypt key derivation
func EncryptKey(privKey ed25519.PrivateKey, name, passphrase string) (*KeystoreJSON, error) {
	if len(privKey) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("invalid ed25519 private key length: expected %d, got %d", ed25519.PrivateKeySize, len(privKey))
	}
	if strings.TrimSpace(passphrase) == "" {
		return nil, errors.New("passphrase cannot be empty")
	}

	pubKey := privKey.Public().(ed25519.PublicKey)
	address := ComputeAddressFromPubKey(pubKey)

	salt := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return nil, fmt.Errorf("failed to generate random salt: %w", err)
	}

	aesKey, err := scrypt.Key([]byte(passphrase), salt, ScryptN, ScryptR, ScryptP, ScryptKeyLen)
	if err != nil {
		return nil, fmt.Errorf("scrypt key derivation failed: %w", err)
	}

	block, err := aes.NewCipher(aesKey)
	if err != nil {
		return nil, fmt.Errorf("aes cipher initialization failed: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("gcm mode initialization failed: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("failed to generate nonce: %w", err)
	}

	// Encrypt with address as Additional Authenticated Data (AAD)
	ciphertext := gcm.Seal(nil, nonce, privKey, []byte(address))

	// Compute MAC = sha256(aesKey[16:32] + ciphertext)
	macHash := sha256.New()
	macHash.Write(aesKey[16:32])
	macHash.Write(ciphertext)
	mac := macHash.Sum(nil)

	// Random UUID style ID
	idBytes := make([]byte, 16)
	_, _ = io.ReadFull(rand.Reader, idBytes)
	idStr := fmt.Sprintf("%x-%x-%x-%x-%x", idBytes[0:4], idBytes[4:6], idBytes[6:8], idBytes[8:10], idBytes[10:16])

	return &KeystoreJSON{
		Version:   1,
		ID:        idStr,
		Name:      name,
		Address:   address,
		PubKeyHex: hex.EncodeToString(pubKey),
		Crypto: CryptoJSON{
			Cipher:     "aes-256-gcm",
			CipherText: hex.EncodeToString(ciphertext),
			Nonce:      hex.EncodeToString(nonce),
			KDF:        "scrypt",
			ScryptParams: ScryptParams{
				SaltHex: hex.EncodeToString(salt),
				N:       ScryptN,
				R:       ScryptR,
				P:       ScryptP,
				KeyLen:  ScryptKeyLen,
			},
			MAC: hex.EncodeToString(mac),
		},
	}, nil
}

// DecryptKey decrypts the private key using the provided passphrase
func DecryptKey(ks *KeystoreJSON, passphrase string) (ed25519.PrivateKey, ed25519.PublicKey, error) {
	if ks == nil {
		return nil, nil, errors.New("keystore is nil")
	}

	salt, err := hex.DecodeString(ks.Crypto.ScryptParams.SaltHex)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid salt encoding: %w", err)
	}

	n := ks.Crypto.ScryptParams.N
	r := ks.Crypto.ScryptParams.R
	p := ks.Crypto.ScryptParams.P
	keyLen := ks.Crypto.ScryptParams.KeyLen
	if keyLen <= 0 {
		keyLen = 32
	}

	aesKey, err := scrypt.Key([]byte(passphrase), salt, n, r, p, keyLen)
	if err != nil {
		return nil, nil, fmt.Errorf("scrypt derivation failed: %w", err)
	}

	ciphertext, err := hex.DecodeString(ks.Crypto.CipherText)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid ciphertext encoding: %w", err)
	}

	// Verify MAC before decryption to catch invalid passphrase
	macHash := sha256.New()
	macHash.Write(aesKey[16:32])
	macHash.Write(ciphertext)
	computedMAC := hex.EncodeToString(macHash.Sum(nil))

	if computedMAC != ks.Crypto.MAC {
		return nil, nil, ErrInvalidPassphrase
	}

	nonce, err := hex.DecodeString(ks.Crypto.Nonce)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid nonce encoding: %w", err)
	}

	block, err := aes.NewCipher(aesKey)
	if err != nil {
		return nil, nil, fmt.Errorf("aes init failed: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, fmt.Errorf("gcm init failed: %w", err)
	}

	plaintext, err := gcm.Open(nil, nonce, ciphertext, []byte(ks.Address))
	if err != nil {
		return nil, nil, ErrInvalidPassphrase
	}

	if len(plaintext) != ed25519.PrivateKeySize {
		return nil, nil, fmt.Errorf("decrypted key invalid size: %d", len(plaintext))
	}

	privKey := ed25519.PrivateKey(plaintext)
	pubKey := privKey.Public().(ed25519.PublicKey)

	// Validate address against public key
	derivedAddr := ComputeAddressFromPubKey(pubKey)
	if derivedAddr != ks.Address {
		return nil, nil, fmt.Errorf("address mismatch: derived %s != stored %s", derivedAddr, ks.Address)
	}

	return privKey, pubKey, nil
}

// KeystoreFilePath returns the path to <homeDir>/keyring/<name>.keystore
func KeystoreFilePath(homeDir, name string) string {
	return filepath.Join(homeDir, "keyring", name+".keystore")
}

// SaveKeystore writes KeystoreJSON to <homeDir>/keyring/<name>.keystore with 0600 permissions
func SaveKeystore(homeDir string, ks *KeystoreJSON) (string, error) {
	keyringDir := filepath.Join(homeDir, "keyring")
	if err := os.MkdirAll(keyringDir, 0700); err != nil {
		return "", fmt.Errorf("failed to create keyring directory: %w", err)
	}

	filePath := filepath.Join(keyringDir, ks.Name+".keystore")
	bz, err := json.MarshalIndent(ks, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to marshal keystore JSON: %w", err)
	}

	if err := os.WriteFile(filePath, bz, 0600); err != nil {
		return "", fmt.Errorf("failed to write keystore file: %w", err)
	}
	return filePath, nil
}

// LoadKeystore reads a KeystoreJSON file from disk
func LoadKeystore(filePath string) (*KeystoreJSON, error) {
	bz, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrKeystoreNotFound
		}
		return nil, fmt.Errorf("failed to read keystore file %s: %w", filePath, err)
	}

	var ks KeystoreJSON
	if err := json.Unmarshal(bz, &ks); err != nil {
		return nil, fmt.Errorf("failed to parse keystore JSON %s: %w", filePath, err)
	}
	return &ks, nil
}

// PromptPassphrase prompts the user for a password, masking input if interactive
func PromptPassphrase(prompt string) (string, error) {
	if envPass := os.Getenv("SOVRA_KEY_PASSPHRASE"); envPass != "" {
		return envPass, nil
	}
	fmt.Print(prompt)
	fd := int(os.Stdin.Fd())
	if term.IsTerminal(fd) {
		bytePassword, err := term.ReadPassword(fd)
		fmt.Println()
		if err != nil {
			return "", err
		}
		return strings.TrimSpace(string(bytePassword)), nil
	}

	reader := bufio.NewReader(os.Stdin)
	pass, err := reader.ReadString('\n')
	if err != nil && err != io.EOF {
		return "", err
	}
	return strings.TrimRight(pass, "\r\n"), nil
}

// ReadPassphrase reads passphrase from env SOVRA_KEY_PASSPHRASE or prompts stdin
func ReadPassphrase(prompt string) (string, error) {
	return PromptPassphrase(prompt)
}

