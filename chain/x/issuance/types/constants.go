package types

import (
	"cosmossdk.io/math"
)

const (
	// ModuleName is the name of the issuance module
	ModuleName = "issuance"

	// StoreKey is the default store key for issuance
	StoreKey = ModuleName

	// RouterKey is the message route for issuance
	RouterKey = ModuleName

	// BaseDenom is the micro-denomination for Sovra (1 SOV = 1,000,000 uSOV)
	BaseDenom = "usov"

	// DisplayDenom is the standard human-readable token symbol
	DisplayDenom = "sov"

	// MicroPerSov is the number of uSOV per SOV
	MicroPerSov = 1_000_000

	// EpochDurationSeconds defines the exact duration of an epoch (86,400 seconds)
	EpochDurationSeconds = 86400

	// TotalPolicyEpochs is exactly 9,125 complete 86,400-second daily epochs (25 * 365)
	TotalPolicyEpochs = 9125

	// Module Account Names for isolated destinations
	FeeCollectorName     = "fee_collector"
	CommunityPoolName    = "community_pool"
	SeederEscrowPoolName = "seeder_escrow"
)

// PoolID identifies the origin pool for emissions
type PoolID string

const (
	PoolGenesis   PoolID = "genesis"
	PoolValidator PoolID = "validator"
	PoolCommunity PoolID = "community"
	PoolSeeder    PoolID = "seeder"
)

// ProtocolPhase represents the current lifecycle phase of emissions
type ProtocolPhase int

const (
	PhasePreGenesis ProtocolPhase = iota
	PhaseActive
	PhaseTerminal
)

// Formal Hard Caps in uSOV (integer precision down to 1 uSOV)
var (
	// GlobalLifetimeCap: Exactly 100,000,000 SOV = 100,000,000,000,000 uSOV
	GlobalLifetimeCap = math.NewInt(100_000_000_000_000)

	// GenesisCap: Exactly 30,000,000 SOV = 30,000,000,000,000 uSOV
	GenesisCap = math.NewInt(30_000_000_000_000)

	// ValidatorCap: Exactly 20,000,000 SOV = 20,000,000,000,000 uSOV
	ValidatorCap = math.NewInt(20_000_000_000_000)

	// CommunityCap: Exactly 40,000,000 SOV = 40,000,000,000,000 uSOV
	CommunityCap = math.NewInt(40_000_000_000_000)

	// SeederCap: Exactly 10,000,000 SOV = 10,000,000,000,000 uSOV
	SeederCap = math.NewInt(10_000_000_000_000)
)
