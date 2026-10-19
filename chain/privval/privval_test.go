package privval_test

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"path/filepath"
	"testing"

	"github.com/sovra/chain/privval"
	"github.com/stretchr/testify/require"
)

func TestRemotePrivValidator_EndToEnd(t *testing.T) {
	// 1. Generate validator key
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)

	tmpDir := t.TempDir()
	stateFile := filepath.Join(tmpDir, "priv_validator_state.json")

	// 2. Setup Memory Enclave HSM and Daemon Server on dynamic loopback port
	hsm := privval.NewMemoryEnclaveHSM(priv)
	server := privval.NewSignerServer("127.0.0.1:0", hsm, stateFile)
	require.NoError(t, server.Start())
	defer server.Stop()

	serverAddr := server.Addr().String()

	// 3. Connect RemotePrivValidator client
	client, err := privval.NewRemotePrivValidator("tcp://" + serverAddr)
	require.NoError(t, err)
	defer client.Close()

	// 4. Verify public key
	clientPub, err := client.GetPubKey()
	require.NoError(t, err)
	require.Equal(t, pub, clientPub)
	require.Equal(t, hex.EncodeToString(pub), client.GetAddress())
	require.Equal(t, "Memory_Enclave_HSM", client.GetHSMType())

	chainID := "sovra-testnet-0"

	// 5. Sign Proposal at Height 1, Round 0
	proposal := &privval.Proposal{
		Height:          1,
		Round:           0,
		POLRound:        -1,
		BlockHash:       "0123456789abcdef",
		ProposerAddress: client.GetAddress(),
	}
	sig, err := client.SignProposal(chainID, proposal)
	require.NoError(t, err)
	require.NotEmpty(t, sig)
	require.Equal(t, hex.EncodeToString(sig), proposal.SignatureHex)

	canonicalProp := privval.FormatCanonicalProposalBytes(chainID, proposal)
	require.True(t, ed25519.Verify(pub, canonicalProp, sig), "proposal signature must verify against pubkey")

	// 6. Sign Prevote at Height 1, Round 0
	prevote := &privval.Vote{
		Type:             privval.StepPrevote,
		Height:           1,
		Round:            0,
		BlockHash:        "0123456789abcdef",
		ValidatorAddress: client.GetAddress(),
	}
	vSig, err := client.SignVote(chainID, prevote)
	require.NoError(t, err)
	require.NotEmpty(t, vSig)

	canonicalVote := privval.FormatCanonicalVoteBytes(chainID, prevote)
	require.True(t, ed25519.Verify(pub, canonicalVote, vSig), "vote signature must verify against pubkey")

	// 7. Double-Signing Protection: Attempt to sign a conflicting prevote at same height & round with DIFFERENT hash
	conflictingPrevote := &privval.Vote{
		Type:             privval.StepPrevote,
		Height:           1,
		Round:            0,
		BlockHash:        "ffffffffffffffff", // Conflicting Byzantine double-sign
		ValidatorAddress: client.GetAddress(),
	}
	_, err = client.SignVote(chainID, conflictingPrevote)
	require.Error(t, err, "signer daemon must reject double-signing attempt")
	require.Contains(t, err.Error(), "double-signing violation")

	// 8. Height Regression Protection: Attempt to sign at Height 0
	staleVote := &privval.Vote{
		Type:             privval.StepPrevote,
		Height:           0,
		Round:            0,
		BlockHash:        "0123456789abcdef",
		ValidatorAddress: client.GetAddress(),
	}
	_, err = client.SignVote(chainID, staleVote)
	require.Error(t, err, "signer daemon must reject height regression")
	require.Contains(t, err.Error(), "double-signing violation")

	// 9. Idempotent Re-sign: Signing the exact same prevote again must succeed
	dupSig, err := client.SignVote(chainID, prevote)
	require.NoError(t, err, "idempotent retry of identical vote must be permitted")
	require.Equal(t, vSig, dupSig)

	// 10. Advance to Precommit at Height 1, Round 0
	precommit := &privval.Vote{
		Type:             privval.StepPrecommit,
		Height:           1,
		Round:            0,
		BlockHash:        "0123456789abcdef",
		ValidatorAddress: client.GetAddress(),
	}
	pcSig, err := client.SignVote(chainID, precommit)
	require.NoError(t, err)
	require.NotEmpty(t, pcSig)

	// 11. Advance to Height 2, Round 0
	h2Proposal := &privval.Proposal{
		Height:          2,
		Round:           0,
		BlockHash:       "aabbccddeeff0011",
		ProposerAddress: client.GetAddress(),
	}
	h2Sig, err := client.SignProposal(chainID, h2Proposal)
	require.NoError(t, err)
	require.NotEmpty(t, h2Sig)
}

func TestCloudHSMBackend_SessionAndSigning(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)

	cloudHSM := privval.NewCloudHSMBackend(
		"AWS_CloudHSM_v3",
		"cloudhsm.us-east-1.amazonaws.com",
		"cluster-sovra-prod-001",
		42,
		priv,
	)
	defer cloudHSM.Close()

	require.Contains(t, cloudHSM.GetHSMType(), "AWS_CloudHSM_v3")
	require.Contains(t, cloudHSM.GetHSMType(), "cluster-sovra-prod-001")

	pub, err := cloudHSM.GetPublicKey()
	require.NoError(t, err)
	require.Equal(t, priv.Public().(ed25519.PublicKey), pub)

	testData := []byte("SOVRA_CLOUD_HSM_TEST_PAYLOAD")
	sig, err := cloudHSM.Sign(testData)
	require.NoError(t, err)
	require.True(t, ed25519.Verify(pub, testData, sig))
}
