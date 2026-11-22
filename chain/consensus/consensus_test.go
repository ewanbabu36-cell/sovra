package consensus_test

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"testing"
	"time"

	"github.com/sovra/chain/consensus"
	"github.com/sovra/chain/privval"
	"github.com/stretchr/testify/require"
)

type testVal struct {
	priv ed25519.PrivateKey
	pub  ed25519.PublicKey
	val  consensus.Validator
}

func setupTestValidators(t *testing.T, count int) ([]testVal, *consensus.ValidatorSet) {
	t.Helper()
	testVals := make([]testVal, count)
	vals := make([]consensus.Validator, count)

	for i := 0; i < count; i++ {
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		require.NoError(t, err)

		pubHex := hex.EncodeToString(pub)
		addr := "sovra1" + pubHex[:40]

		val := consensus.Validator{
			Name:        "validator-" + string(rune('0'+i)),
			Address:     addr,
			PubKeyHex:   pubHex,
			VotingPower: 25,
			NodeID:      pubHex[:40],
		}

		testVals[i] = testVal{priv: priv, pub: pub, val: val}
		vals[i] = val
	}

	valSet, err := consensus.NewValidatorSet(vals)
	require.NoError(t, err)
	return testVals, valSet
}

func signPrecommit(chainID string, tv testVal, height, round int64, blockHash string, idx int32) consensus.CommitSignature {
	vote := &privval.Vote{
		Type:             privval.StepPrecommit,
		Height:           height,
		Round:            round,
		BlockHash:        blockHash,
		ValidatorAddress: tv.val.Address,
		ValidatorIndex:   idx,
	}
	canonical := privval.FormatCanonicalVoteBytes(chainID, vote)
	sig := ed25519.Sign(tv.priv, canonical)

	return consensus.CommitSignature{
		ValidatorAddress: tv.val.Address,
		ValidatorIndex:   idx,
		VotingPower:      tv.val.VotingPower,
		SignatureHex:     hex.EncodeToString(sig),
		Timestamp:        time.Now().Unix(),
	}
}

func TestCommitCertificate_QuorumVerification(t *testing.T) {
	testVals, valSet := setupTestValidators(t, 4)
	chainID := "sovra-testnet-0"
	height := int64(100)
	round := int64(0)
	blockHash := "9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b"

	// 1. Quorum satisfied: 3 of 4 validators (75 power >= 67 quorum)
	sig0 := signPrecommit(chainID, testVals[0], height, round, blockHash, 0)
	sig1 := signPrecommit(chainID, testVals[1], height, round, blockHash, 1)
	sig2 := signPrecommit(chainID, testVals[2], height, round, blockHash, 2)

	cert3 := &consensus.CommitCertificate{
		Height:     height,
		Round:      round,
		BlockHash:  blockHash,
		Signatures: []consensus.CommitSignature{sig0, sig1, sig2},
	}
	err := consensus.VerifyCommitCertificate(cert3, valSet, chainID)
	require.NoError(t, err, "3 of 4 validators (75% power) must satisfy 2/3+ quorum")

	// 2. Full consensus: 4 of 4 validators (100 power)
	sig3 := signPrecommit(chainID, testVals[3], height, round, blockHash, 3)
	cert4 := &consensus.CommitCertificate{
		Height:     height,
		Round:      round,
		BlockHash:  blockHash,
		Signatures: []consensus.CommitSignature{sig0, sig1, sig2, sig3},
	}
	err = consensus.VerifyCommitCertificate(cert4, valSet, chainID)
	require.NoError(t, err, "4 of 4 validators must satisfy quorum")

	// 3. Insufficient Quorum: 2 of 4 validators (50 power < 67 quorum)
	cert2 := &consensus.CommitCertificate{
		Height:     height,
		Round:      round,
		BlockHash:  blockHash,
		Signatures: []consensus.CommitSignature{sig0, sig1},
	}
	err = consensus.VerifyCommitCertificate(cert2, valSet, chainID)
	require.Error(t, err)
	require.ErrorIs(t, err, consensus.ErrInsufficientQuorum, "2 of 4 validators (50% power) must be rejected")

	// 4. Forged Signature: Mutated signature bytes
	corruptedSig := sig0
	corruptedSig.SignatureHex = "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
	certCorrupted := &consensus.CommitCertificate{
		Height:     height,
		Round:      round,
		BlockHash:  blockHash,
		Signatures: []consensus.CommitSignature{corruptedSig, sig1, sig2},
	}
	err = consensus.VerifyCommitCertificate(certCorrupted, valSet, chainID)
	require.Error(t, err)
	require.ErrorIs(t, err, consensus.ErrInvalidSignature, "tampered signature must be rejected")

	// 5. Tampered BlockHash: Signatures signed for different block hash
	certWrongHash := &consensus.CommitCertificate{
		Height:     height,
		Round:      round,
		BlockHash:  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
		Signatures: []consensus.CommitSignature{sig0, sig1, sig2},
	}
	err = consensus.VerifyCommitCertificate(certWrongHash, valSet, chainID)
	require.Error(t, err)
	require.ErrorIs(t, err, consensus.ErrInvalidSignature, "certificate with mismatched block hash must be rejected")

	// 6. Duplicate Signatures from Same Validator
	certDup := &consensus.CommitCertificate{
		Height:     height,
		Round:      round,
		BlockHash:  blockHash,
		Signatures: []consensus.CommitSignature{sig0, sig0, sig1},
	}
	err = consensus.VerifyCommitCertificate(certDup, valSet, chainID)
	require.Error(t, err)
	require.ErrorIs(t, err, consensus.ErrDuplicateSignature, "duplicate signatures must be rejected")

	// 7. Unknown Validator
	unknownPub, unknownPriv, _ := ed25519.GenerateKey(rand.Reader)
	_ = unknownPriv
	unknownSig := sig0
	unknownSig.ValidatorAddress = "sovra1" + hex.EncodeToString(unknownPub)[:40]
	certUnknown := &consensus.CommitCertificate{
		Height:     height,
		Round:      round,
		BlockHash:  blockHash,
		Signatures: []consensus.CommitSignature{unknownSig, sig1, sig2},
	}
	err = consensus.VerifyCommitCertificate(certUnknown, valSet, chainID)
	require.Error(t, err)
	require.ErrorIs(t, err, consensus.ErrUnknownValidator, "signature from unknown validator must be rejected")
}

func TestVotePool_EquivocationDetection(t *testing.T) {
	testVals, valSet := setupTestValidators(t, 4)
	chainID := "sovra-testnet-0"
	pool := consensus.NewVotePool(chainID, valSet)

	height := int64(101)
	round := int64(0)
	hashA := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	hashB := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

	// 1. Valid vote on Hash A
	voteA := &privval.Vote{
		Type:             privval.StepPrevote,
		Height:           height,
		Round:            round,
		BlockHash:        hashA,
		ValidatorAddress: testVals[0].val.Address,
		ValidatorIndex:   0,
	}
	canonA := privval.FormatCanonicalVoteBytes(chainID, voteA)
	voteA.SignatureHex = hex.EncodeToString(ed25519.Sign(testVals[0].priv, canonA))

	accepted, err := pool.AddVote(voteA)
	require.NoError(t, err)
	require.True(t, accepted)

	// 2. Duplicate identical vote on Hash A (idempotent, safe)
	dupAccepted, err := pool.AddVote(voteA)
	require.NoError(t, err)
	require.False(t, dupAccepted, "idempotent retry of identical vote should return false without error")

	// 3. Equivocating vote on Hash B at SAME Height, Round, Step!
	voteB := &privval.Vote{
		Type:             privval.StepPrevote,
		Height:           height,
		Round:            round,
		BlockHash:        hashB,
		ValidatorAddress: testVals[0].val.Address,
		ValidatorIndex:   0,
	}
	canonB := privval.FormatCanonicalVoteBytes(chainID, voteB)
	voteB.SignatureHex = hex.EncodeToString(ed25519.Sign(testVals[0].priv, canonB))

	_, err = pool.AddVote(voteB)
	require.Error(t, err, "equivocation on conflicting block hashes must trigger error")
	require.Contains(t, err.Error(), "byzantine equivocation detected")
}
