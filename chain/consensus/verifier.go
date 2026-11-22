package consensus

import (
	"crypto/ed25519"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/sovra/chain/privval"
)

var (
	ErrNilCertificate         = errors.New("commit certificate is nil")
	ErrEmptySignatures        = errors.New("commit certificate contains no signatures")
	ErrInvalidHeightRound     = errors.New("commit certificate has invalid height or round")
	ErrEmptyBlockHash         = errors.New("commit certificate has empty block hash")
	ErrUnknownValidator       = errors.New("commit certificate signed by unknown validator")
	ErrDuplicateSignature     = errors.New("duplicate validator signature in commit certificate")
	ErrInvalidSignature       = errors.New("cryptographic signature verification failed")
	ErrInsufficientQuorum     = errors.New("commit certificate voting power strictly less than 2/3+ quorum")
	ErrValidatorSetMismatch   = errors.New("commit certificate voting power attribution does not match canonical validator set")
	ErrRevokedValidator       = errors.New("validator identity has been permanently revoked by protocol security transition")
	ErrConflictingTransition  = errors.New("conflicting validator transition proposal for existing height")
	ErrReplayedTransition     = errors.New("validator transition height is not strictly monotonically increasing")
	ErrUnauthorizedTransition = errors.New("validator transition lacks authorized cryptographic quorum")
	ErrInvalidTransition      = errors.New("validator transition parameters are invalid")
)

// VerifyCommitCertificate validates the cryptographic commit certificate against the validator set
func VerifyCommitCertificate(cert *CommitCertificate, valSet *ValidatorSet, chainID string) error {
	if cert == nil {
		return ErrNilCertificate
	}
	if cert.Height <= 0 || cert.Round < 0 {
		return fmt.Errorf("%w: height=%d, round=%d", ErrInvalidHeightRound, cert.Height, cert.Round)
	}
	if cert.BlockHash == "" {
		return ErrEmptyBlockHash
	}
	if len(cert.Signatures) == 0 {
		return ErrEmptySignatures
	}
	if valSet == nil || valSet.TotalPower <= 0 {
		return fmt.Errorf("invalid validator set")
	}

	seenValidators := make(map[string]bool)
	var accumulatedPower int64

	for idx, sig := range cert.Signatures {
		if sig.ValidatorAddress == "" {
			return fmt.Errorf("signature %d: empty validator address", idx)
		}

		// Reject duplicate signatures
		if seenValidators[sig.ValidatorAddress] {
			return fmt.Errorf("%w: validator %s appears multiple times", ErrDuplicateSignature, sig.ValidatorAddress)
		}
		seenValidators[sig.ValidatorAddress] = true

		val := valSet.GetByAddress(sig.ValidatorAddress)
		if val == nil {
			return fmt.Errorf("%w: %s", ErrUnknownValidator, sig.ValidatorAddress)
		}

		// Reject permanently revoked validators at or above revocation height
		if valSet.IsRevokedAtHeight(sig.ValidatorAddress, cert.Height) {
			return fmt.Errorf("%w: validator %s was revoked at or before height %d", ErrRevokedValidator, sig.ValidatorAddress, cert.Height)
		}

		// Ensure voting power matches canonical set
		if sig.VotingPower != val.VotingPower {
			return fmt.Errorf("%w for %s: certificate claims %d, canonical is %d",
				ErrValidatorSetMismatch, sig.ValidatorAddress, sig.VotingPower, val.VotingPower)
		}

		sigBytes, err := hex.DecodeString(sig.SignatureHex)
		if err != nil || len(sigBytes) != ed25519.SignatureSize {
			return fmt.Errorf("%w for %s: invalid ed25519 signature format", ErrInvalidSignature, sig.ValidatorAddress)
		}

		// Canonical precommit vote format
		vote := &privval.Vote{
			Type:             privval.StepPrecommit,
			Height:           cert.Height,
			Round:            cert.Round,
			BlockHash:        cert.BlockHash,
			ValidatorAddress: sig.ValidatorAddress,
			ValidatorIndex:   sig.ValidatorIndex,
		}
		canonicalBytes := privval.FormatCanonicalVoteBytes(chainID, vote)

		if !ed25519.Verify(val.PubKeyBytes, canonicalBytes, sigBytes) {
			return fmt.Errorf("%w: ed25519 verification failed for validator %s on block %s at H=%d R=%d",
				ErrInvalidSignature, sig.ValidatorAddress, cert.BlockHash, cert.Height, cert.Round)
		}

		accumulatedPower += val.VotingPower
	}

	// Strictly > 2/3 of total voting power
	if accumulatedPower < valSet.QuorumPower {
		return fmt.Errorf("%w: accumulated %d < quorum %d (total=%d, requires %.1f%%)",
			ErrInsufficientQuorum, accumulatedPower, valSet.QuorumPower, valSet.TotalPower,
			float64(valSet.QuorumPower)/float64(valSet.TotalPower)*100)
	}

	return nil
}

// VerifyProposal validates the designated proposer's signature on a proposed block header
func VerifyProposal(prop *privval.Proposal, valSet *ValidatorSet, chainID string) error {
	if prop == nil {
		return errors.New("proposal is nil")
	}

	val := valSet.GetByAddress(prop.ProposerAddress)
	if val == nil {
		return fmt.Errorf("proposal from unknown proposer address: %s", prop.ProposerAddress)
	}

	sigBytes, err := hex.DecodeString(prop.SignatureHex)
	if err != nil || len(sigBytes) != ed25519.SignatureSize {
		return fmt.Errorf("invalid proposal signature format")
	}

	canonicalBytes := privval.FormatCanonicalProposalBytes(chainID, prop)
	if !ed25519.Verify(val.PubKeyBytes, canonicalBytes, sigBytes) {
		return fmt.Errorf("proposer signature verification failed for %s", prop.ProposerAddress)
	}

	return nil
}

// VerifyCommitCertificateWithSchedule validates the commit certificate using the height-indexed validator schedule
func VerifyCommitCertificateWithSchedule(cert *CommitCertificate, schedule *ValidatorSchedule, chainID string) error {
	if cert == nil {
		return ErrNilCertificate
	}
	if schedule == nil {
		return errors.New("validator schedule is nil")
	}
	valSet, err := schedule.GetValidatorSetForHeight(cert.Height)
	if err != nil {
		return fmt.Errorf("failed to get validator set for height %d: %w", cert.Height, err)
	}
	return VerifyCommitCertificate(cert, valSet, chainID)
}

// VerifyProposalWithSchedule validates the proposer's signature using the height-indexed validator schedule
func VerifyProposalWithSchedule(prop *privval.Proposal, schedule *ValidatorSchedule, chainID string) error {
	if prop == nil {
		return errors.New("proposal is nil")
	}
	if schedule == nil {
		return errors.New("validator schedule is nil")
	}
	valSet, err := schedule.GetValidatorSetForHeight(prop.Height)
	if err != nil {
		return fmt.Errorf("failed to get validator set for height %d: %w", prop.Height, err)
	}
	if valSet.IsRevokedAtHeight(prop.ProposerAddress, prop.Height) {
		return fmt.Errorf("%w: proposer %s was revoked at or before height %d", ErrRevokedValidator, prop.ProposerAddress, prop.Height)
	}
	return VerifyProposal(prop, valSet, chainID)
}
