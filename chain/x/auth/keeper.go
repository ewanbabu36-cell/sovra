package auth

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"

	"github.com/sovra/chain/store"
)

var (
	KeyPrefixNonce  = []byte{0x20}
	KeyPrefixPubKey = []byte{0x21}
)

func NonceKey(addr string) []byte {
	return append(KeyPrefixNonce, []byte(addr)...)
}

func PubKeyKey(addr string) []byte {
	return append(KeyPrefixPubKey, []byte(addr)...)
}

type Keeper struct{}

func NewKeeper() *Keeper {
	return &Keeper{}
}

func (k *Keeper) GetNonce(s store.KVStore, addr string) uint64 {
	bz := s.Get(NonceKey(addr))
	if len(bz) < 8 {
		return 0
	}
	return binary.BigEndian.Uint64(bz)
}

func (k *Keeper) SetNonce(s store.KVStore, addr string, nonce uint64) {
	bz := make([]byte, 8)
	binary.BigEndian.PutUint64(bz, nonce)
	s.Set(NonceKey(addr), bz)
}

func (k *Keeper) IncrementNonce(s store.KVStore, addr string) uint64 {
	nonce := k.GetNonce(s, addr)
	next := nonce + 1
	k.SetNonce(s, addr, next)
	return next
}

// ComputeAddressFromPubKey derives a deterministic Sovra address from an ed25519 public key
func ComputeAddressFromPubKey(pubKey ed25519.PublicKey) string {
	hash := sha256.Sum256(pubKey)
	return "sovra1" + hex.EncodeToString(hash[:20])
}

// VerifySignature validates an ed25519 signature over message digest
func VerifySignature(pubKey ed25519.PublicKey, message []byte, signature []byte) bool {
	if len(pubKey) != ed25519.PublicKeySize || len(signature) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(pubKey, message, signature)
}

// CheckAndIncrementNonce enforces nonce replay protection
func (k *Keeper) CheckAndIncrementNonce(s store.KVStore, addr string, txNonce uint64) error {
	expectedNonce := k.GetNonce(s, addr)
	if txNonce != expectedNonce {
		return fmt.Errorf("account sequence mismatch: expected %d, got %d", expectedNonce, txNonce)
	}
	k.IncrementNonce(s, addr)
	return nil
}
