package types

import (
	"encoding/binary"
)

var (
	// KeyPrefixLifetimeMinted stores total lifetime minted coins (8 bytes int64 or math.Int bytes)
	KeyPrefixLifetimeMinted = []byte{0x01}

	// KeyPrefixLifetimeBurned stores total lifetime burned coins
	KeyPrefixLifetimeBurned = []byte{0x02}

	// KeyPrefixPoolMinted stores lifetime minted per pool (prefix + poolID)
	KeyPrefixPoolMinted = []byte{0x03}

	// KeyPrefixPoolCap stores lifetime cap per pool (prefix + poolID)
	KeyPrefixPoolCap = []byte{0x04}

	// KeyPrefixEpochMinted stores minted amount for (poolID + epoch)
	KeyPrefixEpochMinted = []byte{0x05}

	// KeyPrefixEpochAllowance stores allowance for (poolID + epoch)
	KeyPrefixEpochAllowance = []byte{0x06}

	// KeyPrefixLastProcessedEpoch stores the last completed epoch index (uint64)
	KeyPrefixLastProcessedEpoch = []byte{0x07}

	// KeyPrefixTerminalPhase stores boolean flag if terminal phase has locked (0x00 or 0x01)
	KeyPrefixTerminalPhase = []byte{0x08}
)

// PoolMintedKey returns the store key for a specific pool's lifetime minted total
func PoolMintedKey(poolID PoolID) []byte {
	return append(KeyPrefixPoolMinted, []byte(poolID)...)
}

// PoolCapKey returns the store key for a specific pool's lifetime cap
func PoolCapKey(poolID PoolID) []byte {
	return append(KeyPrefixPoolCap, []byte(poolID)...)
}

// EpochPoolKey constructs key for (prefix + poolID + epoch)
func EpochPoolKey(prefix []byte, poolID PoolID, epoch uint64) []byte {
	epochBz := make([]byte, 8)
	binary.BigEndian.PutUint64(epochBz, epoch)
	key := append(prefix, []byte(poolID)...)
	return append(key, epochBz...)
}

// EpochMintedKey returns store key for minted coins in an epoch for a pool
func EpochMintedKey(poolID PoolID, epoch uint64) []byte {
	return EpochPoolKey(KeyPrefixEpochMinted, poolID, epoch)
}

// EpochAllowanceKey returns store key for allowance in an epoch for a pool
func EpochAllowanceKey(poolID PoolID, epoch uint64) []byte {
	return EpochPoolKey(KeyPrefixEpochAllowance, poolID, epoch)
}
