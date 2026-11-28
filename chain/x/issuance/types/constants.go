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

	// HalvingIntervalEpochs is 4 years of daily epochs (4 * 365 = 1,460 epochs), matching Bitcoin's 4-year halving cadence.
	HalvingIntervalEpochs = 1460

	// MaxHalvingEras is 32 four-year halving eras (Era 0..31 = 128 years); Era 32 halves Era0CommunityBaseDaily to 0 uSOV.
	MaxHalvingEras = 32

	// TotalPolicyEpochs is 46,720 complete 86,400-second daily epochs (32 * 1,460 = 128 years).
	TotalPolicyEpochs = HalvingIntervalEpochs * MaxHalvingEras

	// Era0CommunityBaseDaily is the daily Community base unit in Era 0 (uSOV).
	// Total lifetime sum over 32 halving eras converges just under 10,000,000 SOV (Bitcoin integer-shift style).
	// At ratio V:C:S = 2:1:4, daily Era 0 mint = 6,849.315068 SOV Validator + 3,424.657534 SOV Community + 13,698.630136 SOV Seeder (~35M SOV in Years 1-4).
	Era0CommunityBaseDaily int64 = 3_424_657_534

	// Module Account Names for isolated destinations
	FeeCollectorName         = "fee_collector"
	CommunityPoolName        = "community_pool"
	SeederEscrowPoolName     = "seeder_escrow"
	BondedTokensPoolName     = "bonded_tokens_pool"
	UnbondingTokensPoolName  = "unbonding_tokens_pool"
	SeederCollateralPoolName = "seeder_collateral_pool"
	PatronStakingPoolName    = "patron_staking_pool"
	RewardYieldPoolName      = "reward_yield_pool"

	// L1 Monetary Sink & Security Defaults
	DefaultMinTxFeeUsov            int64 = 100              // 0.0001 SOV minimum transaction fee (prevents zero-fee spam)
	DefaultFeeBurnBps              int64 = 5000             // 50% EIP-1559 style fee burn via ExecuteBurn (valid range 5000..7000 bps)
	MinFeeBurnBps                  int64 = 5000             // 50% minimum protocol fee burn
	MaxFeeBurnBps                  int64 = 7000             // 70% maximum protocol fee burn
	DefaultUnbondingPeriodSeconds  int64 = 14 * 86400       // 14-day unbonding cooldown (1,209,600s)
	MinUnbondingPeriodSeconds      int64 = 14 * 86400       // 14-day minimum unbonding lock
	MaxUnbondingPeriodSeconds      int64 = 21 * 86400       // 21-day maximum unbonding lock
	MinSeederBondUsov              int64 = 100_000_000      // 100 SOV minimum seeder collateral bond
	MinSeederBondPerGbUsov         int64 = 10_000_000       // 10 SOV locked per claimed GB storage capacity
	HandleRegistrationMinFeeUsov   int64 = 10_000_000       // 10 SOV minimum handle fee (80% burned)
	HandleRegistrationDurationSec  int64 = 365 * 86400      // 1-year handle lease before renewal
	HandleBurnShareBps             int64 = 8000             // 80% of handle registration fee burned permanently
	StorageRentMinUsovPerGbMonth   int64 = 500_000          // 0.5 SOV / GB / month storage pinning rent
	StorageRentBurnShareBps        int64 = 5000             // 50% storage rent burned permanently (50% to bonded seeder)
	BoostBurnShareBps              int64 = 8000             // 80% of promoted/verification boost burned permanently
	DefaultGenesisCliffSeconds     int64 = 365 * 86400      // 12-month genesis cliff
	DefaultGenesisVestingSeconds   int64 = 3 * 365 * 86400  // 36-month linear vesting after cliff
	SeederRewardVestingShareBps    int64 = 5000             // 50% of claimed Seeder emissions stream over 30-day rolling vest
	SeederRewardVestingSeconds     int64 = 30 * 86400       // 30-day linear vesting on claimed daily seeder mints
	ValidatorRewardVestingShareBps int64 = 5000             // 50% of claimed Validator/Staking rewards stream over 14-day vest
	ValidatorRewardVestingSeconds  int64 = 14 * 86400       // 14-day linear vesting on claimed fee/validator rewards

	// Consensus Permanent Burn Sink addresses
	ConsensusBurnSinkAddress = "sovra10000000000000000000000000000000000000dead"
	ConsensusBurnSinkHex     = "0x000000000000000000000000000000000000dead"
	ConsensusBurnSinkDID     = "did:sov:burn:dead"
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

	// ValidatorCap: Exactly 20,000,000 SOV = 20,000,000,000,000 uSOV (2x base weight = 28.57% of mining)
	ValidatorCap = math.NewInt(20_000_000_000_000)

	// CommunityCap: Exactly 10,000,000 SOV = 10,000,000,000,000 uSOV (1x base weight = 14.29% of mining)
	CommunityCap = math.NewInt(10_000_000_000_000)

	// SeederCap: Exactly 40,000,000 SOV = 40,000,000,000,000 uSOV (4x base weight = 57.14% of mining, incentivizing fast DePIN seeders)
	SeederCap = math.NewInt(40_000_000_000_000)
)
