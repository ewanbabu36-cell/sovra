package privval

import (
	"crypto/ed25519"
	"encoding/hex"
)

// LocalPrivValidator implements PrivValidator locally using an in-memory enclave
type LocalPrivValidator struct {
	hsm   HSMBackend
	state *LastSignedState
}

func NewLocalPrivValidator(privKey ed25519.PrivateKey) *LocalPrivValidator {
	return &LocalPrivValidator{
		hsm:   NewMemoryEnclaveHSM(privKey),
		state: NewLastSignedState(),
	}
}

func (l *LocalPrivValidator) GetPubKey() (ed25519.PublicKey, error) {
	return l.hsm.GetPublicKey()
}

func (l *LocalPrivValidator) GetAddress() string {
	pub, err := l.hsm.GetPublicKey()
	if err != nil {
		return ""
	}
	return hex.EncodeToString(pub)
}

func (l *LocalPrivValidator) SignVote(chainID string, vote *Vote) ([]byte, error) {
	if err := l.state.CheckAndSign(vote.Height, vote.Round, vote.Type, vote.BlockHash); err != nil {
		return nil, err
	}
	canonical := FormatCanonicalVoteBytes(chainID, vote)
	sig, err := l.hsm.Sign(canonical)
	if err != nil {
		return nil, err
	}
	vote.SignatureHex = hex.EncodeToString(sig)
	return sig, nil
}

func (l *LocalPrivValidator) SignProposal(chainID string, proposal *Proposal) ([]byte, error) {
	if err := l.state.CheckAndSign(proposal.Height, proposal.Round, StepPropose, proposal.BlockHash); err != nil {
		return nil, err
	}
	canonical := FormatCanonicalProposalBytes(chainID, proposal)
	sig, err := l.hsm.Sign(canonical)
	if err != nil {
		return nil, err
	}
	proposal.SignatureHex = hex.EncodeToString(sig)
	return sig, nil
}

func (l *LocalPrivValidator) SignBytes(chainID string, data []byte) ([]byte, error) {
	return l.hsm.Sign(data)
}
