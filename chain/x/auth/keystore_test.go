package auth_test

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"os"
	"path/filepath"
	"testing"

	"github.com/sovra/chain/x/auth"
)

func TestEncryptDecryptRoundtrip(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}

	passphrase := "MySecretSovraPassphrase!2026"
	name := "test-validator"

	// 1. Encrypt key
	ks, err := auth.EncryptKey(priv, name, passphrase)
	if err != nil {
		t.Fatalf("EncryptKey failed: %v", err)
	}

	if ks.Version != 1 {
		t.Fatalf("expected version 1, got %d", ks.Version)
	}
	if ks.Name != name {
		t.Fatalf("name mismatch: expected %s, got %s", name, ks.Name)
	}
	if ks.Crypto.Cipher != "aes-256-gcm" {
		t.Fatalf("expected aes-256-gcm cipher, got %s", ks.Crypto.Cipher)
	}
	if ks.Crypto.KDF != "scrypt" {
		t.Fatalf("expected scrypt kdf, got %s", ks.Crypto.KDF)
	}
	if ks.Crypto.MAC == "" {
		t.Fatalf("expected non-empty MAC checksum")
	}

	expectedAddr := auth.ComputeAddressFromPubKey(pub)
	if ks.Address != expectedAddr {
		t.Fatalf("address mismatch: expected %s, got %s", expectedAddr, ks.Address)
	}

	// 2. Decrypt with correct passphrase
	decPriv, decPub, err := auth.DecryptKey(ks, passphrase)
	if err != nil {
		t.Fatalf("DecryptKey failed with correct passphrase: %v", err)
	}

	if !bytes.Equal(decPriv, priv) {
		t.Fatalf("decrypted private key does not match original private key")
	}
	if !bytes.Equal(decPub, pub) {
		t.Fatalf("decrypted public key does not match original public key")
	}

	// 3. Verify recovered key can sign and verify messages
	msg := []byte("Sovra Layer-1 Transaction Sign Test")
	sig := ed25519.Sign(decPriv, msg)
	if !ed25519.Verify(decPub, msg, sig) {
		t.Fatalf("signature verification failed with decrypted key")
	}
}

func TestDecryptIncorrectPassphraseFails(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}

	correctPass := "CorrectPassphrase!999"
	ks, err := auth.EncryptKey(priv, "alice", correctPass)
	if err != nil {
		t.Fatalf("EncryptKey failed: %v", err)
	}

	testCases := []string{
		"WrongPassphrase",
		"correctpassphrase!999", // case sensitivity test
		"CorrectPassphrase!998",
		" ",
		"",
	}

	for _, wrongPass := range testCases {
		_, _, err := auth.DecryptKey(ks, wrongPass)
		if err == nil {
			t.Fatalf("expected error when decrypting with wrong passphrase '%s'", wrongPass)
		}
		if err != auth.ErrInvalidPassphrase {
			t.Fatalf("expected ErrInvalidPassphrase, got %v", err)
		}
	}
}

func TestKeystoreTamperResistance(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}

	passphrase := "TamperTestPass123"
	ks, err := auth.EncryptKey(priv, "bob", passphrase)
	if err != nil {
		t.Fatalf("EncryptKey failed: %v", err)
	}

	// Case 1: Corrupt ciphertext
	corrupted := *ks
	cBz := []byte(corrupted.Crypto.CipherText)
	cBz[0] = cBz[0] ^ 0xFF
	corrupted.Crypto.CipherText = string(cBz)
	_, _, err = auth.DecryptKey(&corrupted, passphrase)
	if err == nil {
		t.Fatalf("expected decryption error on corrupted ciphertext")
	}

	// Case 2: Tamper with MAC
	tamperedMAC := *ks
	tamperedMAC.Crypto.MAC = "0000000000000000000000000000000000000000000000000000000000000000"
	_, _, err = auth.DecryptKey(&tamperedMAC, passphrase)
	if err != auth.ErrInvalidPassphrase {
		t.Fatalf("expected ErrInvalidPassphrase on tampered MAC, got %v", err)
	}

	// Case 3: Tamper with Address (AAD validation)
	tamperedAddr := *ks
	tamperedAddr.Address = "sovra10000000000000000000000000000000000000000"
	_, _, err = auth.DecryptKey(&tamperedAddr, passphrase)
	if err == nil {
		t.Fatalf("expected error on tampered address")
	}
}

func TestSaveAndLoadKeystore(t *testing.T) {
	dir := t.TempDir()

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}

	name := "charlie"
	passphrase := "CharlieSecureKeyPass2026"

	ks, err := auth.EncryptKey(priv, name, passphrase)
	if err != nil {
		t.Fatalf("EncryptKey failed: %v", err)
	}

	// Save to keyring
	filePath, err := auth.SaveKeystore(dir, ks)
	if err != nil {
		t.Fatalf("SaveKeystore failed: %v", err)
	}

	expectedPath := filepath.Join(dir, "keyring", "charlie.keystore")
	if filePath != expectedPath {
		t.Fatalf("file path mismatch: expected %s, got %s", expectedPath, filePath)
	}

	// Verify file exists on disk
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		t.Fatalf("keystore file does not exist on disk: %s", filePath)
	}

	// Load from disk
	loadedKs, err := auth.LoadKeystore(filePath)
	if err != nil {
		t.Fatalf("LoadKeystore failed: %v", err)
	}

	// Decrypt loaded keystore
	decPriv, decPub, err := auth.DecryptKey(loadedKs, passphrase)
	if err != nil {
		t.Fatalf("failed to decrypt loaded keystore: %v", err)
	}

	if !bytes.Equal(decPriv, priv) {
		t.Fatalf("loaded private key mismatch")
	}
	if !bytes.Equal(decPub, pub) {
		t.Fatalf("loaded public key mismatch")
	}
}
