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
	mu          sync.RWMutex
	chainID     string
	valSet      *ValidatorSet
	valSchedule *ValidatorSchedule
	votePool    *VotePool
	privVal     privval.PrivValidator
	myIndex     int32
	myAddr      string
	moniker     string
	lockHeight  int64
	lockRound   int64
	lockHash    string
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

func (e *Engine) SetValidatorSchedule(schedule *ValidatorSchedule) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.valSchedule = schedule
	if e.votePool != nil {
		e.votePool.SetValidatorSchedule(schedule)
	}
}

func (e *Engine) ValidatorSchedule() *ValidatorSchedule {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.valSchedule
}

func (e *Engine) GetValidatorSetForHeight(height int64) (*ValidatorSet, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.valSchedule != nil {
		return e.valSchedule.GetValidatorSetForHeight(height)
	}
	if e.valSet != nil {
		return e.valSet, nil
	}
	return nil, fmt.Errorf("no validator set configured")
}

func (e *Engine) IsValidator() bool {
	return e.privVal != nil && e.myIndex >= 0
}

func (e *Engine) IsValidatorAtHeight(height int64) bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.privVal == nil {
		return false
	}
	addr := e.privVal.GetAddress()
	var valSet *ValidatorSet
	if e.valSchedule != nil {
		sSet, err := e.valSchedule.GetValidatorSetForHeight(height)
		if err == nil {
			valSet = sSet
		}
	}
	if valSet == nil {
		valSet = e.valSet
	}
	if valSet == nil {
		return false
	}
	for _, v := range valSet.Validators {
		if v.Address == addr || v.PubKeyHex == addr || v.Name == e.moniker {
			if valSet.IsRevokedAtHeight(v.Address, height) {
				return false
			}
			return true
		}
	}
	return false
}

func (e *Engine) SignProposal(height, round int64, blockHash string) (*privval.Proposal, error) {
	if e.privVal == nil {
		return nil, fmt.Errorf("no privval configured for proposal signing")
	}

	myAddr := e.myAddr
	activeSet, err := e.GetValidatorSetForHeight(height)
	if err == nil && activeSet != nil {
		pvAddr := e.privVal.GetAddress()
		for _, v := range activeSet.Validators {
			if v.Address == pvAddr || v.PubKeyHex == pvAddr || v.Name == e.moniker {
				myAddr = v.Address
				break
			}
		}
		if activeSet.IsRevokedAtHeight(myAddr, height) {
			return nil, fmt.Errorf("validator %s is revoked at height %d: %w", myAddr, height, ErrRevokedValidator)
		}
	}

	prop := &privval.Proposal{
		Height:          height,
		Round:           round,
		POLRound:        -1,
		BlockHash:       blockHash,
		ProposerAddress: myAddr,
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

	myAddr := e.myAddr
	valIndex := e.myIndex
	activeSet, err := e.GetValidatorSetForHeight(height)
	if err == nil && activeSet != nil {
		pvAddr := e.privVal.GetAddress()
		for i, v := range activeSet.Validators {
			if v.Address == pvAddr || v.PubKeyHex == pvAddr || v.Name == e.moniker {
				myAddr = v.Address
				valIndex = int32(i)
				break
			}
		}
		if activeSet.IsRevokedAtHeight(myAddr, height) {
			return nil, fmt.Errorf("validator %s is revoked at height %d: %w", myAddr, height, ErrRevokedValidator)
		}
	}

	vote := &privval.Vote{
		Type:             privval.StepPrevote,
		Height:           height,
		Round:            round,
		BlockHash:        blockHash,
		ValidatorAddress: myAddr,
		ValidatorIndex:   valIndex,
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

	myAddr := e.myAddr
	valIndex := e.myIndex
	activeSet, err := e.GetValidatorSetForHeight(height)
	if err == nil && activeSet != nil {
		pvAddr := e.privVal.GetAddress()
		for i, v := range activeSet.Validators {
			if v.Address == pvAddr || v.PubKeyHex == pvAddr || v.Name == e.moniker {
				myAddr = v.Address
				valIndex = int32(i)
				break
			}
		}
		if activeSet.IsRevokedAtHeight(myAddr, height) {
			return nil, fmt.Errorf("validator %s is revoked at height %d: %w", myAddr, height, ErrRevokedValidator)
		}
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
		ValidatorAddress: myAddr,
		ValidatorIndex:   valIndex,
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

// ApplyValidatorTransition applies an authorized on-chain validator set transition and revocations
func (e *Engine) ApplyValidatorTransition(transition ValidatorTransition) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.valSchedule != nil {
		if err := e.valSchedule.AddTransition(transition); err != nil {
			return fmt.Errorf("failed to register transition in schedule: %w", err)
		}
	}

	newValSet, err := NewValidatorSet(transition.NewValidators)
	if err != nil {
		return fmt.Errorf("invalid new validator set in transition: %w", err)
	}

	// Carry over existing revocations
	if e.valSet != nil {
		for addr, h := range e.valSet.GetRevokedValidators() {
			newValSet.RevokeValidator(addr, h)
		}
	}
	// Apply new revocations
	for _, addr := range transition.RevokedAddresses {
		newValSet.RevokeValidator(addr, transition.TransitionHeight)
	}

	e.valSet = newValSet
	e.votePool.UpdateValidatorSet(newValSet)

	// Recheck our validator identity and role in the rotated validator set
	e.myIndex = -1
	if e.privVal != nil {
		myAddr := e.privVal.GetAddress()
		for i, v := range newValSet.Validators {
			if v.Address == myAddr || v.Name == e.moniker {
				e.myIndex = int32(i)
				e.myAddr = v.Address
				break
			}
		}
	}

	return nil
}

// SetPrivVal updates the validator signing interface (e.g. after key rotation)
func (e *Engine) SetPrivVal(privVal privval.PrivValidator) {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.privVal = privVal
	e.myIndex = -1
	if privVal != nil && e.valSet != nil {
		myAddr := privVal.GetAddress()
		for i, v := range e.valSet.Validators {
			if v.Address == myAddr || v.Name == e.moniker {
				e.myIndex = int32(i)
				e.myAddr = v.Address
				break
			}
		}
	}
}
