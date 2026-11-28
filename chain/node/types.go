package node

import (
	"crypto/ed25519"
	"encoding/json"
)

// Transaction types
type TxType string

const (
	TxTypeSend                TxType = "send"
	TxTypeBurn                TxType = "burn"
	TxTypeStoreCode           TxType = "store_code"
	TxTypeInstantiateContract TxType = "instantiate"
	TxTypeExecuteContract     TxType = "execute"
	TxTypeDelegate            TxType = "delegate"
	TxTypeUndelegate          TxType = "undelegate"
	TxTypeBondSeeder          TxType = "bond_seeder"
	TxTypeUnbondSeeder        TxType = "unbond_seeder"
	TxTypeClaimRewards        TxType = "claim_rewards"
	TxTypePatronStake         TxType = "patron_stake"
	TxTypePatronUnstake       TxType = "patron_unstake"
	TxTypeRegisterHandle      TxType = "register_handle"
	TxTypePayStorageRent      TxType = "pay_storage_rent"
	TxTypeBoostBurn           TxType = "boost_burn"
)

// SignedTransaction represents a standard signed transaction in Sovra
type SignedTransaction struct {
	Type      TxType `json:"type"`
	Sender    string `json:"sender"`
	Recipient string `json:"recipient,omitempty"`
	Amount    string `json:"amount,omitempty"` // in uSOV
	Nonce     uint64 `json:"nonce"`
	Fee       string `json:"fee"` // in uSOV

	// CosmWasm Fields
	WASMBytecodeHex string `json:"wasm_bytecode,omitempty"`
	CodeID          uint64 `json:"code_id,omitempty"`
	Contract        string `json:"contract,omitempty"`
	Label           string `json:"label,omitempty"`
	Admin           string `json:"admin,omitempty"`
	Msg             string `json:"msg,omitempty"`
	Funds           string `json:"funds,omitempty"`

	// Staking & PoS Fields
	Validator string `json:"validator,omitempty"`

	// Extended Economic / Utility Sink Fields (omitted when zero/empty so legacy sign bytes stay identical)
	LockDays       int64  `json:"lock_days,omitempty"`
	Handle         string `json:"handle,omitempty"`
	StorageGb      uint64 `json:"storage_gb,omitempty"`
	DurationMonths uint64 `json:"duration_months,omitempty"`
	Creator        string `json:"creator,omitempty"`

	PubKeyHex string `json:"pub_key"` // ed25519 public key hex
	SigHex    string `json:"sig"`     // ed25519 signature hex
}

func (tx *SignedTransaction) GetSignBytes() []byte {
	// Canonical bytes without the signature
	payload := struct {
		Type            TxType `json:"type"`
		Sender          string `json:"sender"`
		Recipient       string `json:"recipient,omitempty"`
		Amount          string `json:"amount,omitempty"`
		Nonce           uint64 `json:"nonce"`
		Fee             string `json:"fee"`
		WASMBytecodeHex string `json:"wasm_bytecode,omitempty"`
		CodeID          uint64 `json:"code_id,omitempty"`
		Contract        string `json:"contract,omitempty"`
		Label           string `json:"label,omitempty"`
		Admin           string `json:"admin,omitempty"`
		Msg             string `json:"msg,omitempty"`
		Funds           string `json:"funds,omitempty"`
		Validator       string `json:"validator,omitempty"`
		LockDays        int64  `json:"lock_days,omitempty"`
		Handle          string `json:"handle,omitempty"`
		StorageGb       uint64 `json:"storage_gb,omitempty"`
		DurationMonths  uint64 `json:"duration_months,omitempty"`
		Creator         string `json:"creator,omitempty"`
	}{
		Type:            tx.Type,
		Sender:          tx.Sender,
		Recipient:       tx.Recipient,
		Amount:          tx.Amount,
		Nonce:           tx.Nonce,
		Fee:             tx.Fee,
		WASMBytecodeHex: tx.WASMBytecodeHex,
		CodeID:          tx.CodeID,
		Contract:        tx.Contract,
		Label:           tx.Label,
		Admin:           tx.Admin,
		Msg:             tx.Msg,
		Funds:           tx.Funds,
		Validator:       tx.Validator,
		LockDays:        tx.LockDays,
		Handle:          tx.Handle,
		StorageGb:       tx.StorageGb,
		DurationMonths:  tx.DurationMonths,
		Creator:         tx.Creator,
	}
	bz, _ := json.Marshal(payload)
	return bz
}

// EconomicParams configures enforceable L1 fee burn, unbonding delay, and governance sunset rules.
type EconomicParams struct {
	MinTxFeeUsov                int64 `json:"min_tx_fee_usov"`
	FeeBurnBps                  int64 `json:"fee_burn_bps"`
	UnbondingPeriodSeconds      int64 `json:"unbonding_period_seconds"`
	SecurityCouncilSunsetHeight int64 `json:"security_council_sunset_height,omitempty"`
	SecurityCouncilSunsetTime   int64 `json:"security_council_sunset_time,omitempty"`
}

// GenesisVestingAccount binds cliff + linear vesting to a genesis account allocation.
type GenesisVestingAccount struct {
	Address                string `json:"address"`
	OriginalAmount         string `json:"original_amount"`
	CliffSeconds           int64  `json:"cliff_seconds"`
	VestingDurationSeconds int64  `json:"vesting_duration_seconds"`
	Label                  string `json:"label,omitempty"`
}

// VestingSchedule tracks active cliff and linear unlock timestamps for a genesis account.
type VestingSchedule struct {
	Address        string `json:"address"`
	OriginalAmount string `json:"original_amount"`
	StartTime      int64  `json:"start_time"`
	CliffTime      int64  `json:"cliff_time"`
	EndTime        int64  `json:"end_time"`
	Label          string `json:"label,omitempty"`
}

// SecurityCouncilGenesis captures emergency governance metadata and automatic sunset rules.
type SecurityCouncilGenesis struct {
	Threshold            string `json:"threshold,omitempty"`
	RequiredApprovals    int    `json:"required_approvals,omitempty"`
	TotalCouncilSeats    int    `json:"total_council_seats,omitempty"`
	TimelockDelaySeconds int64  `json:"timelock_delay_seconds,omitempty"`
	SunsetHeight         int64  `json:"sunset_height,omitempty"`
	SunsetTimestamp      int64  `json:"sunset_timestamp,omitempty"`
}

// GenesisState defines initial blockchain parameters
type GenesisState struct {
	ChainID         string                  `json:"chain_id"`
	GenesisTime     int64                   `json:"genesis_time"`
	Accounts        map[string]string       `json:"accounts"`   // addr -> uSOV
	Validators      []GenesisValidator      `json:"validators"` // initial consensus validator set
	SeedNodes       []string                `json:"seed_nodes,omitempty"`
	EconomicParams  *EconomicParams         `json:"economic_params,omitempty"`
	VestingAccounts []GenesisVestingAccount `json:"vesting_accounts,omitempty"`
	SecurityCouncil *SecurityCouncilGenesis `json:"security_council,omitempty"`
}

type GenesisValidator struct {
	Name        string `json:"name"`
	Address     string `json:"address"`
	PubKeyHex   string `json:"pub_key"`
	VotingPower int64  `json:"voting_power"`
	NodeID      string `json:"node_id,omitempty"`
	P2PAddr     string `json:"p2p_addr,omitempty"`
}

// ValidatorSetTransition records a formal on-chain validator rotation and revocation
type ValidatorSetTransition struct {
	TransitionHeight   int64              `json:"transition_height"`
	PreviousValidators []GenesisValidator `json:"previous_validators"`
	NewValidators      []GenesisValidator `json:"new_validators"`
	RevokedAddresses   []string           `json:"revoked_addresses"`
	Reason             string             `json:"reason"`
	Timestamp          int64              `json:"timestamp"`
}

// KeyPair represents an ed25519 account keypair
type KeyPair struct {
	Name       string            `json:"name"`
	Address    string            `json:"address"`
	PublicKey  ed25519.PublicKey `json:"-"`
	PrivateKey ed25519.PrivateKey `json:"-"`
	PubKeyHex  string            `json:"pub_key"`
	PrivKeyHex string            `json:"priv_key"`
}

// Slashing & Misbehavior Types
type MisbehaviorType string

const (
	MisbehaviorDoubleSign MisbehaviorType = "double_sign"
	MisbehaviorDowntime   MisbehaviorType = "downtime"
)

// Evidence represents verifiable proof of Byzantine fault or downtime
type Evidence struct {
	Type          MisbehaviorType `json:"type"`
	Validator     string          `json:"validator"`
	Height        int64           `json:"height"`
	Time          int64           `json:"time"`
	SlashFraction string          `json:"slash_fraction"`
	JailedUntil   int64           `json:"jailed_until"`
}

// ValidatorSigningInfo tracks liveness and jailing state for a validator
type ValidatorSigningInfo struct {
	Address             string `json:"address"`
	StartHeight         int64  `json:"start_height"`
	IndexOffset         int64  `json:"index_offset"`
	JailedUntil         int64  `json:"jailed_until"`
	Tombstoned          bool   `json:"tombstoned"`
	MissedBlocksCounter int64  `json:"missed_blocks_counter"`
}

// DelegationRecord stores veSOV time-locked validator stake and reward weight multiplier.
type DelegationRecord struct {
	Delegator     string `json:"delegator"`
	Validator     string `json:"validator"`
	Amount        string `json:"amount"`
	LockTier      string `json:"lock_tier"`
	LockSeconds   int64  `json:"lock_seconds"`
	LockedAt      int64  `json:"locked_at"`
	UnlockAt      int64  `json:"unlock_at"`
	MultiplierBps int64  `json:"multiplier_bps"`
}

// UnbondingEntry tracks staked/bonded funds queued during the mandatory 14-21 day cooldown.
type UnbondingEntry struct {
	ID             string `json:"id"`
	Owner          string `json:"owner"`
	Target         string `json:"target,omitempty"`
	PoolKind       string `json:"pool_kind"` // "delegation" | "seeder" | "patron"
	Amount         string `json:"amount"`
	CreatedAt      int64  `json:"created_at"`
	CompletionTime int64  `json:"completion_time"`
}

// SeederBondRecord enforces "Stake-to-Work" DePIN collateral requirements for seeder nodes.
type SeederBondRecord struct {
	Address           string `json:"address"`
	BondedUsov        string `json:"bonded_usov"`
	StorageCapacityGb uint64 `json:"storage_capacity_gb"`
	PorPassedCount    uint64 `json:"por_passed_count"`
	PorFailedCount    uint64 `json:"por_failed_count"`
	SlashedUsov       string `json:"slashed_usov"`
	EarnedRewardsUsov string `json:"earned_rewards_usov"`
	BondedAt          int64  `json:"bonded_at"`
}

// PatronStakeRecord tracks principal-preserving fan patronage staked toward a creator.
type PatronStakeRecord struct {
	Fan           string `json:"fan"`
	Creator       string `json:"creator"`
	AmountUsov    string `json:"amount_usov"`
	LockDays      int64  `json:"lock_days"`
	UnlockAt      int64  `json:"unlock_at"`
	MultiplierBps int64  `json:"multiplier_bps"`
	StakedAt      int64  `json:"staked_at"`
}

// HandleRecord stores paid on-chain @handle leases backed by permanent SOV burn.
type HandleRecord struct {
	Handle     string `json:"handle"`
	Owner      string `json:"owner"`
	ExpiresAt  int64  `json:"expires_at"`
	FeePaidUsov string `json:"fee_paid_usov"`
	BurnedUsov string `json:"burned_usov"`
}

// EconomyStats summarizes transparent circulating, burned, locked, and pool balances.
type EconomyStats struct {
	Height                int64  `json:"height"`
	CurrentTime           int64  `json:"current_time"`
	ChainID               string `json:"chain_id"`
	GlobalLifetimeCap     string `json:"global_lifetime_cap"`
	LifetimeMinted        string `json:"lifetime_minted"`
	LifetimeBurned        string `json:"lifetime_burned"`
	TotalSupply           string `json:"total_supply"`
	BondedStake           string `json:"bonded_stake"`
	UnbondingTotal        string `json:"unbonding_total"`
	VestingLocked         string `json:"vesting_locked"`
	SeederCollateral      string `json:"seeder_collateral"`
	PatronStaked          string `json:"patron_staked"`
	RewardPoolUsov        string `json:"reward_pool_usov"`
	FeeCollectorUsov      string `json:"fee_collector_usov"`
	SeederEscrowUsov      string `json:"seeder_escrow_usov"`
	CommunityPoolUsov     string `json:"community_pool_usov"`
	LiquidCirculating     string `json:"liquid_circulating"`
	FeeBurnBps            int64  `json:"fee_burn_bps"`
	MinTxFeeUsov          int64  `json:"min_tx_fee_usov"`
	UnbondingPeriodSec    int64  `json:"unbonding_period_seconds"`
	SecurityCouncilActive bool   `json:"security_council_active"`
	SupplyInvariantHolds  bool   `json:"supply_invariant_holds"`
}
