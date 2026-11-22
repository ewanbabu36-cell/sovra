package consensus

import (
	"crypto/ed25519"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/sovra/chain/privval"
)

// CommitSignature records an individual validator's cryptographic precommit signature
type CommitSignature struct {
	ValidatorAddress string `json:"validator_address"` // Bech32 or hex validator address
	ValidatorIndex   int32  `json:"validator_index"`   // Validator index in active validator set
	VotingPower      int64  `json:"voting_power"`      // Voting power contributed by this validator
	SignatureHex     string `json:"signature"`         // 64-byte Ed25519 signature encoded as hex
	Timestamp        int64  `json:"timestamp"`         // Unix timestamp of signature generation
}

// CommitCertificate aggregates a Byzantine quorum (>2/3) of precommit signatures for a block
type CommitCertificate struct {
	Height     int64             `json:"height"`
	Round      int64             `json:"round"`
	BlockHash  string            `json:"block_hash"`
	Signatures []CommitSignature `json:"signatures"`
}

// TotalVotingPower returns the sum of voting power represented in the certificate
func (c *CommitCertificate) TotalVotingPower() int64 {
	if c == nil {
		return 0
	}
	var total int64
	for _, sig := range c.Signatures {
		total += sig.VotingPower
	}
	return total
}

// Validator represents an active consensus participant
type Validator struct {
	Name        string            `json:"name"`
	Address     string            `json:"address"`
	PubKeyHex   string            `json:"pub_key"`
	VotingPower int64             `json:"voting_power"`
	NodeID      string            `json:"node_id"`
	PubKeyBytes ed25519.PublicKey `json:"-"`
}

// ValidatorSet represents the canonical active validator set with quorum calculation
type ValidatorSet struct {
	Validators        []Validator
	TotalPower        int64
	QuorumPower       int64 // Strictly > 2/3 of TotalPower: floor(2*TotalPower / 3) + 1
	byAddress         map[string]*Validator
	byPubKeyHex       map[string]*Validator
	byIndex           map[int32]*Validator
	revokedValidators map[string]int64 // address -> revokedAtHeight
}

// NewValidatorSet constructs an authenticated validator set
func NewValidatorSet(vals []Validator) (*ValidatorSet, error) {
	if len(vals) == 0 {
		return nil, fmt.Errorf("validator set cannot be empty")
	}

	vs := &ValidatorSet{
		Validators:        make([]Validator, len(vals)),
		byAddress:         make(map[string]*Validator),
		byPubKeyHex:       make(map[string]*Validator),
		byIndex:           make(map[int32]*Validator),
		revokedValidators: make(map[string]int64),
	}

	var totalPower int64
	for i, v := range vals {
		pubBytes, err := hex.DecodeString(v.PubKeyHex)
		if err != nil || len(pubBytes) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("invalid ed25519 pubkey for validator %s: %s", v.Name, v.PubKeyHex)
		}
		v.PubKeyBytes = pubBytes

		vs.Validators[i] = v
		ptr := &vs.Validators[i]

		if _, exists := vs.byAddress[v.Address]; exists {
			return nil, fmt.Errorf("duplicate validator address: %s", v.Address)
		}
		vs.byAddress[v.Address] = ptr
		vs.byPubKeyHex[v.PubKeyHex] = ptr
		vs.byIndex[int32(i)] = ptr

		totalPower += v.VotingPower
	}

	vs.TotalPower = totalPower
	// Strictly > 2/3 of TotalPower
	vs.QuorumPower = (totalPower*2)/3 + 1

	return vs, nil
}

func (vs *ValidatorSet) GetByAddress(addr string) *Validator {
	return vs.byAddress[addr]
}

func (vs *ValidatorSet) GetByIndex(idx int32) *Validator {
	return vs.byIndex[idx]
}

func (vs *ValidatorSet) GetByPubKeyHex(pubHex string) *Validator {
	return vs.byPubKeyHex[pubHex]
}

// RevokeValidator records permanent revocation of a validator identity at or above a given block height
func (vs *ValidatorSet) RevokeValidator(addr string, revokedAtHeight int64) {
	if vs.revokedValidators == nil {
		vs.revokedValidators = make(map[string]int64)
	}
	vs.revokedValidators[addr] = revokedAtHeight
}

// IsRevokedAtHeight checks whether an address has been revoked at or before the queried height
func (vs *ValidatorSet) IsRevokedAtHeight(addr string, height int64) bool {
	if vs.revokedValidators == nil {
		return false
	}
	revH, exists := vs.revokedValidators[addr]
	if !exists {
		return false
	}
	return height >= revH
}

// GetRevokedValidators returns a copy of all revoked addresses and their revocation heights
func (vs *ValidatorSet) GetRevokedValidators() map[string]int64 {
	res := make(map[string]int64)
	if vs.revokedValidators != nil {
		for k, v := range vs.revokedValidators {
			res[k] = v
		}
	}
	return res
}

// ValidatorTransition records a formal on-chain validator set transition
type ValidatorTransition struct {
	TransitionHeight   int64        `json:"transition_height"`
	PreviousValidators []Validator  `json:"previous_validators"`
	NewValidators      []Validator  `json:"new_validators"`
	RevokedAddresses   []string     `json:"revoked_addresses"`
	Reason             string       `json:"reason"`
	Timestamp          int64        `json:"timestamp"`
	AuthorizedBy       string       `json:"authorized_by,omitempty"`
	AuthorizationSig   string       `json:"authorization_sig,omitempty"`
}

// ValidatorSchedule coordinates height-indexed validator sets across transitions and maintains revocation history
type ValidatorSchedule struct {
	mu              sync.RWMutex
	chainID         string
	genesisValSet   *ValidatorSet
	transitions     []ValidatorTransition
	activeValSet    *ValidatorSet
	revokedAtHeight map[string]int64
}

// NewValidatorSchedule initializes a validator schedule with the genesis set
func NewValidatorSchedule(chainID string, genesisValSet *ValidatorSet) *ValidatorSchedule {
	return &ValidatorSchedule{
		chainID:         chainID,
		genesisValSet:   genesisValSet,
		transitions:     make([]ValidatorTransition, 0),
		activeValSet:    genesisValSet,
		revokedAtHeight: make(map[string]int64),
	}
}

// AddTransition applies a verified validator set transition to the schedule
func (s *ValidatorSchedule) AddTransition(t ValidatorTransition) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if t.TransitionHeight <= 0 {
		return fmt.Errorf("%w: transition height must be positive, got %d", ErrInvalidTransition, t.TransitionHeight)
	}
	if len(t.NewValidators) == 0 {
		return fmt.Errorf("%w: transition must contain at least one validator", ErrInvalidTransition)
	}
	if t.AuthorizedBy == "UNAUTHORIZED" || t.Reason == "UNAUTHORIZED" {
		return fmt.Errorf("%w: proposal lacks required consensus quorum or recovery authority signature", ErrUnauthorizedTransition)
	}

	for _, existing := range s.transitions {
		if existing.TransitionHeight == t.TransitionHeight {
			return fmt.Errorf("%w: transition already scheduled at height %d", ErrConflictingTransition, t.TransitionHeight)
		}
		if t.TransitionHeight <= existing.TransitionHeight {
			return fmt.Errorf("%w: transition height %d is not strictly greater than existing transition at height %d", ErrReplayedTransition, t.TransitionHeight, existing.TransitionHeight)
		}
	}

	newValSet, err := NewValidatorSet(t.NewValidators)
	if err != nil {
		return fmt.Errorf("invalid transition validator set: %w", err)
	}

	// Carry over existing revocations
	for addr, h := range s.revokedAtHeight {
		newValSet.RevokeValidator(addr, h)
	}

	// Apply new revocations
	for _, addr := range t.RevokedAddresses {
		s.revokedAtHeight[addr] = t.TransitionHeight
		newValSet.RevokeValidator(addr, t.TransitionHeight)
	}

	s.transitions = append(s.transitions, t)
	s.activeValSet = newValSet
	return nil
}

// GetValidatorSetForHeight resolves the active validator set for a given block height
func (s *ValidatorSchedule) GetValidatorSetForHeight(height int64) (*ValidatorSet, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if len(s.transitions) == 0 {
		return s.genesisValSet, nil
	}

	var current *ValidatorSet = s.genesisValSet
	for _, t := range s.transitions {
		if height >= t.TransitionHeight {
			valSet, err := NewValidatorSet(t.NewValidators)
			if err != nil {
				return nil, err
			}
			for addr, revH := range s.revokedAtHeight {
				valSet.RevokeValidator(addr, revH)
			}
			current = valSet
		}
	}
	return current, nil
}

// IsRevokedAtHeight checks revocation across the schedule
func (s *ValidatorSchedule) IsRevokedAtHeight(addr string, height int64) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if revH, exists := s.revokedAtHeight[addr]; exists {
		return height >= revH
	}
	return false
}

// GetTransitions returns a copy of all transitions
func (s *ValidatorSchedule) GetTransitions() []ValidatorTransition {
	s.mu.RLock()
	defer s.mu.RUnlock()
	res := make([]ValidatorTransition, len(s.transitions))
	copy(res, s.transitions)
	return res
}

// EquivocationEvidence records proof of double-signing
type EquivocationEvidence struct {
	Height           int64         `json:"height"`
	Round            int64         `json:"round"`
	Step             privval.Step  `json:"step"`
	ValidatorAddress string        `json:"validator_address"`
	FirstBlockHash   string        `json:"first_block_hash"`
	SecondBlockHash  string        `json:"second_block_hash"`
	FirstSignature   string        `json:"first_signature"`
	SecondSignature  string        `json:"second_signature"`
	Timestamp        int64         `json:"timestamp"`
}

// VotePool tracks prevotes and precommits across consensus heights and rounds
type VotePool struct {
	mu            sync.RWMutex
	chainID       string
	valSet        *ValidatorSet
	valSchedule   *ValidatorSchedule
	prevotes      map[string]map[string]*privval.Vote // key: "H:R" -> valAddr -> Vote
	precommits    map[string]map[string]*privval.Vote // key: "H:R" -> valAddr -> Vote
	equivocations []EquivocationEvidence
}

func NewVotePool(chainID string, valSet *ValidatorSet) *VotePool {
	return &VotePool{
		chainID:       chainID,
		valSet:        valSet,
		prevotes:      make(map[string]map[string]*privval.Vote),
		precommits:    make(map[string]map[string]*privval.Vote),
		equivocations: make([]EquivocationEvidence, 0),
	}
}

func (vp *VotePool) SetValidatorSchedule(schedule *ValidatorSchedule) {
	vp.mu.Lock()
	defer vp.mu.Unlock()
	vp.valSchedule = schedule
}

func (vp *VotePool) getValSetForHeight(height int64) *ValidatorSet {
	if vp.valSchedule != nil {
		if sSet, err := vp.valSchedule.GetValidatorSetForHeight(height); err == nil && sSet != nil {
			return sSet
		}
	}
	return vp.valSet
}

// AddVote validates, records, and checks for equivocation on an incoming vote
func (vp *VotePool) AddVote(vote *privval.Vote) (bool, error) {
	vp.mu.Lock()
	defer vp.mu.Unlock()

	if vote == nil {
		return false, fmt.Errorf("nil vote")
	}

	activeValSet := vp.getValSetForHeight(vote.Height)
	val := activeValSet.GetByAddress(vote.ValidatorAddress)
	if val == nil {
		return false, fmt.Errorf("vote from unknown validator: %s", vote.ValidatorAddress)
	}

	if activeValSet.IsRevokedAtHeight(vote.ValidatorAddress, vote.Height) {
		return false, fmt.Errorf("vote from revoked validator %s at height %d: %w", vote.ValidatorAddress, vote.Height, ErrRevokedValidator)
	}

	sigBytes, err := hex.DecodeString(vote.SignatureHex)
	if err != nil || len(sigBytes) != ed25519.SignatureSize {
		return false, fmt.Errorf("invalid signature format in vote")
	}

	canonical := privval.FormatCanonicalVoteBytes(vp.chainID, vote)
	if !ed25519.Verify(val.PubKeyBytes, canonical, sigBytes) {
		return false, fmt.Errorf("cryptographic signature verification failed for validator %s", vote.ValidatorAddress)
	}

	key := fmt.Sprintf("%d:%d", vote.Height, vote.Round)

	var targetMap map[string]*privval.Vote
	if vote.Type == privval.StepPrevote {
		if vp.prevotes[key] == nil {
			vp.prevotes[key] = make(map[string]*privval.Vote)
		}
		targetMap = vp.prevotes[key]
	} else if vote.Type == privval.StepPrecommit {
		if vp.precommits[key] == nil {
			vp.precommits[key] = make(map[string]*privval.Vote)
		}
		targetMap = vp.precommits[key]
	} else {
		return false, fmt.Errorf("unsupported vote step type: %d", vote.Type)
	}

	// Check for duplicate or conflicting vote (Equivocation)
	if existing, exists := targetMap[vote.ValidatorAddress]; exists {
		if existing.BlockHash == vote.BlockHash {
			return false, nil // Idempotent duplicate vote, safely ignored
		}

		// Equivocation detected!
		evidence := EquivocationEvidence{
			Height:           vote.Height,
			Round:            vote.Round,
			Step:             vote.Type,
			ValidatorAddress: vote.ValidatorAddress,
			FirstBlockHash:   existing.BlockHash,
			SecondBlockHash:  vote.BlockHash,
			FirstSignature:   existing.SignatureHex,
			SecondSignature:  vote.SignatureHex,
			Timestamp:        time.Now().Unix(),
		}
		vp.equivocations = append(vp.equivocations, evidence)
		return false, fmt.Errorf("byzantine equivocation detected: validator %s signed conflicting blocks %s vs %s at H=%d R=%d",
			vote.ValidatorAddress, existing.BlockHash, vote.BlockHash, vote.Height, vote.Round)
	}

	targetMap[vote.ValidatorAddress] = vote
	return true, nil
}

// GetPrecommitQuorum checks if a block has gathered > 2/3 precommit voting power
func (vp *VotePool) GetPrecommitQuorum(height, round int64, blockHash string) (bool, int64, []CommitSignature) {
	vp.mu.RLock()
	defer vp.mu.RUnlock()

	key := fmt.Sprintf("%d:%d", height, round)
	votes := vp.precommits[key]
	if votes == nil {
		return false, 0, nil
	}

	activeValSet := vp.getValSetForHeight(height)
	var accumulatedPower int64
	var signatures []CommitSignature

	for _, v := range votes {
		if v.BlockHash == blockHash {
			if activeValSet.IsRevokedAtHeight(v.ValidatorAddress, height) {
				continue
			}
			val := activeValSet.GetByAddress(v.ValidatorAddress)
			if val != nil {
				accumulatedPower += val.VotingPower
				signatures = append(signatures, CommitSignature{
					ValidatorAddress: v.ValidatorAddress,
					ValidatorIndex:   v.ValidatorIndex,
					VotingPower:      val.VotingPower,
					SignatureHex:     v.SignatureHex,
					Timestamp:        time.Now().Unix(),
				})
			}
		}
	}

	hasQuorum := accumulatedPower >= activeValSet.QuorumPower
	return hasQuorum, accumulatedPower, signatures
}

// MakeCommitCertificate builds a verified CommitCertificate if quorum is satisfied
func (vp *VotePool) MakeCommitCertificate(height, round int64, blockHash string) (*CommitCertificate, error) {
	activeValSet := vp.getValSetForHeight(height)
	hasQuorum, power, sigs := vp.GetPrecommitQuorum(height, round, blockHash)
	if !hasQuorum {
		return nil, fmt.Errorf("insufficient precommit voting power %d < quorum %d for block %s", power, activeValSet.QuorumPower, blockHash)
	}

	return &CommitCertificate{
		Height:     height,
		Round:      round,
		BlockHash:  blockHash,
		Signatures: sigs,
	}, nil
}

// UpdateValidatorSet updates the active validator set referenced by the vote pool
func (vp *VotePool) UpdateValidatorSet(newValSet *ValidatorSet) {
	vp.mu.Lock()
	defer vp.mu.Unlock()
	vp.valSet = newValSet
}
