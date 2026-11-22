package consensus

import (
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/sovra/chain/privval"
)

// Engine orchestrates two-phase BFT commit consensus and vote aggregation
type Engine struct {
	mu        sync.RWMutex
	chainID   string
	valSet    *ValidatorSet
	votePool  *VotePool
	privVal   privval.PrivValidator
	myIndex   int32
	myAddr    string
	moniker   string
	lockHeight int64
	lockRound  int64
	lockHash   string
}

// NewEngine constructs a new BFT consensus engine for a validator
func NewEngine(chainID string, valSet *ValidatorSet, privVal privval.PrivValidator, moniker string) *Engine {
	pool := NewVotePool(chainID, valSet)

	var myAddr string
	var myIndex int32 = -1

	if privVal != nil {
		myAddr = privVal.GetAddress()
		for i, v := range valSet.Validators {
			if v.Address == myAddr || v.Name == moniker {
				myIndex = int32(i)
				myAddr = v.Address
				break
			}
		}
	}

	return &Engine{
		chainID:    chainID,
		valSet:     valSet,
		votePool:   pool,
		privVal:    privVal,
		myIndex:    myIndex,
		myAddr:     myAddr,
		moniker:    moniker,
		lockHeight: 0,
		lockRound:  -1,
		lockHash:   "",
	}
}

func (e *Engine) ValidatorSet() *ValidatorSet {
	return e.valSet
}

func (e *Engine) VotePool() *VotePool {
	return e.votePool
}

func (e *Engine) IsValidator() bool {
	return e.privVal != nil && e.myIndex >= 0
}

func (e *Engine) SignProposal(height, round int64, blockHash string) (*privval.Proposal, error) {
	if e.privVal == nil {
		return nil, fmt.Errorf("no privval configured for proposal signing")
	}

	prop := &privval.Proposal{
		Height:          height,
		Round:           round,
		POLRound:        -1,
		BlockHash:       blockHash,
		ProposerAddress: e.myAddr,
	}

	sig, err := e.privVal.SignProposal(e.chainID, prop)
	if err != nil {
		return nil, fmt.Errorf("sign proposal error: %w", err)
	}

	prop.SignatureHex = hex.EncodeToString(sig)
	return prop, nil
}

func (e *Engine) SignPrevote(height, round int64, blockHash string) (*privval.Vote, error) {
	if e.privVal == nil {
		return nil, fmt.Errorf("no privval configured for prevote signing")
	}

	vote := &privval.Vote{
		Type:             privval.StepPrevote,
		Height:           height,
		Round:            round,
		BlockHash:        blockHash,
		ValidatorAddress: e.myAddr,
		ValidatorIndex:   e.myIndex,
	}

	sig, err := e.privVal.SignVote(e.chainID, vote)
	if err != nil {
		return nil, fmt.Errorf("sign prevote error: %w", err)
	}

	vote.SignatureHex = hex.EncodeToString(sig)
	_, _ = e.votePool.AddVote(vote)
	return vote, nil
}

func (e *Engine) SignPrecommit(height, round int64, blockHash string) (*privval.Vote, error) {
	if e.privVal == nil {
		return nil, fmt.Errorf("no privval configured for precommit signing")
	}

	// Persistent locking: update lock on valid block
	e.mu.Lock()
	e.lockHeight = height
	e.lockRound = round
	e.lockHash = blockHash
	e.mu.Unlock()

	vote := &privval.Vote{
		Type:             privval.StepPrecommit,
		Height:           height,
		Round:            round,
		BlockHash:        blockHash,
		ValidatorAddress: e.myAddr,
		ValidatorIndex:   e.myIndex,
	}

	sig, err := e.privVal.SignVote(e.chainID, vote)
	if err != nil {
		return nil, fmt.Errorf("sign precommit error: %w", err)
	}

	vote.SignatureHex = hex.EncodeToString(sig)
	_, _ = e.votePool.AddVote(vote)
	return vote, nil
}

func (e *Engine) ProcessIncomingVote(vote *privval.Vote) (bool, error) {
	return e.votePool.AddVote(vote)
}

func (e *Engine) BuildCommitCertificate(height, round int64, blockHash string) (*CommitCertificate, error) {
	return e.votePool.MakeCommitCertificate(height, round, blockHash)
}

// WaitForPrecommitQuorum waits up to timeout for 2/3+ precommits
func (e *Engine) WaitForPrecommitQuorum(height, round int64, blockHash string, timeout time.Duration) (*CommitCertificate, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		cert, err := e.BuildCommitCertificate(height, round, blockHash)
		if err == nil && cert != nil {
			return cert, nil
		}
		time.Sleep(20 * time.Millisecond)
	}
	return nil, fmt.Errorf("timed out waiting for precommit quorum on H=%d R=%d", height, round)
}
