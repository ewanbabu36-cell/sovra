package privval

import (
	"crypto/ed25519"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
)

var (
	ErrDoubleSigningProtection = errors.New("double-signing violation: conflicting signature at same or earlier height/round")
	ErrInvalidStep             = errors.New("invalid consensus signing step")
	ErrConnectionClosed        = errors.New("remote signer connection closed")
)

type Step int8

const (
	StepPropose   Step = 1
	StepPrevote   Step = 2
	StepPrecommit Step = 3
)

// Vote represents a consensus vote in CometBFT/Tendermint
type Vote struct {
	Type             Step   `json:"type"`
	Height           int64  `json:"height"`
	Round            int64  `json:"round"`
	BlockHash        string `json:"block_hash"`
	ValidatorAddress string `json:"validator_address"`
	ValidatorIndex   int32  `json:"validator_index"`
	SignatureHex     string `json:"signature,omitempty"`
}

// Proposal represents a proposed block header in consensus
type Proposal struct {
	Height           int64  `json:"height"`
	Round            int64  `json:"round"`
	POLRound         int64  `json:"pol_round"`
	BlockHash        string `json:"block_hash"`
	ProposerAddress  string `json:"proposer_address"`
	SignatureHex     string `json:"signature,omitempty"`
}

// PrivValidator defines the standard CometBFT validator key interface
type PrivValidator interface {
	GetPubKey() (ed25519.PublicKey, error)
	GetAddress() string
	SignVote(chainID string, vote *Vote) ([]byte, error)
	SignProposal(chainID string, proposal *Proposal) ([]byte, error)
	SignBytes(chainID string, data []byte) ([]byte, error)
}

// LastSignedState prevents Byzantine double-signing faults across reboots
type LastSignedState struct {
	mu        sync.Mutex
	Height    int64  `json:"height"`
	Round     int64  `json:"round"`
	Step      Step   `json:"step"`
	BlockHash string `json:"block_hash"`
}

func NewLastSignedState() *LastSignedState {
	return &LastSignedState{
		Height:    0,
		Round:     -1,
		Step:      0,
		BlockHash: "",
	}
}

// CheckAndSign verifies that the signing request satisfies the high-water mark invariants
func (l *LastSignedState) CheckAndSign(height, round int64, step Step, blockHash string) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	// Height regression: strictly forbidden
	if height < l.Height {
		return fmt.Errorf("%w: requested height %d < last signed height %d", ErrDoubleSigningProtection, height, l.Height)
	}

	// Same height: round regression strictly forbidden
	if height == l.Height {
		if round < l.Round {
			return fmt.Errorf("%w: requested round %d < last signed round %d at height %d", ErrDoubleSigningProtection, round, l.Round, height)
		}

		if round == l.Round {
			// Same height and round: step regression forbidden
			if step < l.Step {
				return fmt.Errorf("%w: requested step %d < last signed step %d at height %d round %d", ErrDoubleSigningProtection, step, l.Step, height, round)
			}

			// Same height, round, and step: only allow re-signing if blockHash is IDENTICAL (idempotent retry)
			if step == l.Step {
				if l.BlockHash != "" && blockHash != l.BlockHash {
					return fmt.Errorf("%w: conflicting block hash %s != %s at height %d round %d step %d",
						ErrDoubleSigningProtection, blockHash, l.BlockHash, height, round, step)
				}
				// Idempotent retry allowed
				return nil
			}
		}
	}

	// Advance high-water mark
	l.Height = height
	l.Round = round
	l.Step = step
	l.BlockHash = blockHash
	return nil
}

// HSMBackend abstracts hardware security modules (AWS CloudHSM, YubiHSM2, PKCS#11)
type HSMBackend interface {
	GetPublicKey() (ed25519.PublicKey, error)
	Sign(data []byte) ([]byte, error)
	GetHSMType() string
	Close() error
}

// Wire request/response message envelope for socket transport
type SocketRequest struct {
	Type      string    `json:"type"` // "pubkey", "sign_vote", "sign_proposal", "sign_bytes", "ping"
	ChainID   string    `json:"chain_id,omitempty"`
	Vote      *Vote     `json:"vote,omitempty"`
	Proposal  *Proposal `json:"proposal,omitempty"`
	DataHex   string    `json:"data,omitempty"`
}

type SocketResponse struct {
	Success   bool   `json:"success"`
	PubKeyHex string `json:"pub_key,omitempty"`
	SigHex    string `json:"sig,omitempty"`
	Error     string `json:"error,omitempty"`
	HSMType   string `json:"hsm_type,omitempty"`
}

func FormatCanonicalVoteBytes(chainID string, vote *Vote) []byte {
	return []byte(fmt.Sprintf("SOVRA_CONSENSUS_VOTE:%s:%d:%d:%d:%s",
		chainID, vote.Type, vote.Height, vote.Round, vote.BlockHash))
}

func FormatCanonicalProposalBytes(chainID string, proposal *Proposal) []byte {
	return []byte(fmt.Sprintf("SOVRA_CONSENSUS_PROPOSAL:%s:%d:%d:%d:%s",
		chainID, proposal.Height, proposal.Round, proposal.POLRound, proposal.BlockHash))
}

func FormatCanonicalAddress(pubKey ed25519.PublicKey) string {
	return hex.EncodeToString(pubKey)
}
