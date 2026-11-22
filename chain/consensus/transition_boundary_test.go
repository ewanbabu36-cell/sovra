package consensus

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"testing"

	"github.com/sovra/chain/privval"
)

// Helper to generate a test validator with a known keypair
func generateTestValidator(name string, power int64) (Validator, ed25519.PrivateKey) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		panic(err)
	}
	pubHex := hex.EncodeToString(pub)
	hash := sha256.Sum256(pub)
	addr := fmt.Sprintf("sovra1%s", hex.EncodeToString(hash[:20]))

	return Validator{
		Name:        name,
		Address:     addr,
		PubKeyHex:   pubHex,
		PubKeyBytes: pub,
		VotingPower: power,
		NodeID:      hex.EncodeToString(hash[:20]),
	}, priv
}

// Helper to sign a commit certificate
func signCommitCert(chainID string, height, round int64, blockHash string, vals []Validator, privKeys []ed25519.PrivateKey) *CommitCertificate {
	cert := &CommitCertificate{
		Height:     height,
		Round:      round,
		BlockHash:  blockHash,
		Signatures: make([]CommitSignature, 0, len(vals)),
	}

	for i, val := range vals {
		priv := privKeys[i]
		vote := &privval.Vote{
			Type:             privval.StepPrecommit,
			Height:           height,
			Round:            round,
			BlockHash:        blockHash,
			ValidatorAddress: val.Address,
			ValidatorIndex:   int32(i),
		}
		canonicalBytes := privval.FormatCanonicalVoteBytes(chainID, vote)
		sig := ed25519.Sign(priv, canonicalBytes)

		cert.Signatures = append(cert.Signatures, CommitSignature{
			ValidatorAddress: val.Address,
			ValidatorIndex:   int32(i),
			SignatureHex:     hex.EncodeToString(sig),
			VotingPower:      val.VotingPower,
		})
	}
	return cert
}

func TestBoundary_Height39999_HistoricalValidatorQuorum(t *testing.T) {
	chainID := "sovra-testnet-0"

	// 4 Genesis Validators
	gVals := make([]Validator, 4)
	gPrivs := make([]ed25519.PrivateKey, 4)
	for i := 0; i < 4; i++ {
		gVals[i], gPrivs[i] = generateTestValidator(fmt.Sprintf("genesis-val-%d", i), 25)
	}
	gSet, err := NewValidatorSet(gVals)
	if err != nil {
		t.Fatalf("failed to create genesis set: %v", err)
	}

	schedule := NewValidatorSchedule(chainID, gSet)

	// 4 Rotated Validators at H=40000
	rVals := make([]Validator, 4)
	rPrivs := make([]ed25519.PrivateKey, 4)
	revokedAddrs := make([]string, 4)
	for i := 0; i < 4; i++ {
		rVals[i], rPrivs[i] = generateTestValidator(fmt.Sprintf("rotated-val-%d", i), 25)
		revokedAddrs[i] = gVals[i].Address
	}

	err = schedule.AddTransition(ValidatorTransition{
		TransitionHeight:   40000,
		PreviousValidators: gVals,
		NewValidators:      rVals,
		RevokedAddresses:   revokedAddrs,
		Reason:             "SECURITY_KEY_ROTATION",
		Timestamp:          1792000000,
	})
	if err != nil {
		t.Fatalf("failed to add transition: %v", err)
	}

	// At Height 39,999: Genesis validators form valid quorum (3/4 = 75% >= 67%)
	cert39999 := signCommitCert(chainID, 39999, 0, "blockhash39999", gVals[:3], gPrivs[:3])
	err = VerifyCommitCertificateWithSchedule(cert39999, schedule, chainID)
	if err != nil {
		t.Fatalf("Height 39,999 commit certificate should be valid under genesis set, got: %v", err)
	}

	// At Height 39,999: Rotated validators are NOT yet active
	cert39999Rotated := signCommitCert(chainID, 39999, 0, "blockhash39999", rVals[:3], rPrivs[:3])
	err = VerifyCommitCertificateWithSchedule(cert39999Rotated, schedule, chainID)
	if err == nil {
		t.Fatalf("Height 39,999 signed by rotated validators must be rejected prior to transition")
	}
}

func TestBoundary_Height40000_ExactTransitionActivation(t *testing.T) {
	chainID := "sovra-testnet-0"

	gVals := make([]Validator, 4)
	gPrivs := make([]ed25519.PrivateKey, 4)
	for i := 0; i < 4; i++ {
		gVals[i], gPrivs[i] = generateTestValidator(fmt.Sprintf("genesis-val-%d", i), 25)
	}
	gSet, _ := NewValidatorSet(gVals)
	schedule := NewValidatorSchedule(chainID, gSet)

	rVals := make([]Validator, 4)
	rPrivs := make([]ed25519.PrivateKey, 4)
	revokedAddrs := make([]string, 4)
	for i := 0; i < 4; i++ {
		rVals[i], rPrivs[i] = generateTestValidator(fmt.Sprintf("rotated-val-%d", i), 25)
		revokedAddrs[i] = gVals[i].Address
	}

	_ = schedule.AddTransition(ValidatorTransition{
		TransitionHeight:   40000,
		PreviousValidators: gVals,
		NewValidators:      rVals,
		RevokedAddresses:   revokedAddrs,
		Reason:             "SECURITY_KEY_ROTATION",
		Timestamp:          1792000000,
	})

	// At Height 40,000: Rotated validator quorum (3/4 = 75%) MUST be accepted
	cert40000 := signCommitCert(chainID, 40000, 0, "blockhash40000", rVals[:3], rPrivs[:3])
	err := VerifyCommitCertificateWithSchedule(cert40000, schedule, chainID)
	if err != nil {
		t.Fatalf("Height 40,000 commit certificate from rotated validators must be accepted, got: %v", err)
	}

	// At Height 40,000: Old compromised genesis validators MUST be rejected with ErrRevokedValidator
	cert40000Old := signCommitCert(chainID, 40000, 0, "blockhash40000", gVals[:3], gPrivs[:3])
	errOld := VerifyCommitCertificateWithSchedule(cert40000Old, schedule, chainID)
	if errOld == nil {
		t.Fatalf("Height 40,000 signed by compromised genesis validators must be rejected")
	}
}

func TestBoundary_Height40001_OnlyNewValidatorSetAuthorized(t *testing.T) {
	chainID := "sovra-testnet-0"

	gVals := make([]Validator, 4)
	gPrivs := make([]ed25519.PrivateKey, 4)
	for i := 0; i < 4; i++ {
		gVals[i], gPrivs[i] = generateTestValidator(fmt.Sprintf("genesis-val-%d", i), 25)
	}
	gSet, _ := NewValidatorSet(gVals)
	schedule := NewValidatorSchedule(chainID, gSet)

	rVals := make([]Validator, 4)
	rPrivs := make([]ed25519.PrivateKey, 4)
	revokedAddrs := make([]string, 4)
	for i := 0; i < 4; i++ {
		rVals[i], rPrivs[i] = generateTestValidator(fmt.Sprintf("rotated-val-%d", i), 25)
		revokedAddrs[i] = gVals[i].Address
	}

	_ = schedule.AddTransition(ValidatorTransition{
		TransitionHeight:   40000,
		PreviousValidators: gVals,
		NewValidators:      rVals,
		RevokedAddresses:   revokedAddrs,
		Reason:             "SECURITY_KEY_ROTATION",
		Timestamp:          1792000000,
	})

	// At Height 40,001: Rotated validator quorum (4/4 = 100%) accepted
	cert40001 := signCommitCert(chainID, 40001, 0, "blockhash40001", rVals, rPrivs)
	err := VerifyCommitCertificateWithSchedule(cert40001, schedule, chainID)
	if err != nil {
		t.Fatalf("Height 40,001 commit certificate from rotated validators failed: %v", err)
	}

	// At Height 40,001: Genesis validator signatures strictly rejected
	cert40001Old := signCommitCert(chainID, 40001, 0, "blockhash40001", gVals, gPrivs)
	errOld := VerifyCommitCertificateWithSchedule(cert40001Old, schedule, chainID)
	if errOld == nil {
		t.Fatalf("Height 40,001 signed by old validators must be rejected")
	}
}

func TestBoundary_TransitionValidationAndNegativeAttacks(t *testing.T) {
	chainID := "sovra-testnet-0"

	gVals := make([]Validator, 4)
	for i := 0; i < 4; i++ {
		gVals[i], _ = generateTestValidator(fmt.Sprintf("val-%d", i), 25)
	}
	gSet, _ := NewValidatorSet(gVals)
	schedule := NewValidatorSchedule(chainID, gSet)

	rVals := make([]Validator, 4)
	for i := 0; i < 4; i++ {
		rVals[i], _ = generateTestValidator(fmt.Sprintf("rval-%d", i), 25)
	}

	// Attack 1: Non-positive transition height rejected
	err := schedule.AddTransition(ValidatorTransition{
		TransitionHeight: 0,
		NewValidators:    rVals,
	})
	if err == nil {
		t.Fatalf("expected error for non-positive transition height, got nil")
	}

	// Attack 2: Empty validator set rejected
	err = schedule.AddTransition(ValidatorTransition{
		TransitionHeight: 40000,
		NewValidators:    []Validator{},
	})
	if err == nil {
		t.Fatalf("expected error for empty validator set transition, got nil")
	}

	// Legitimate transition at 40000
	err = schedule.AddTransition(ValidatorTransition{
		TransitionHeight: 40000,
		NewValidators:    rVals,
		Reason:           "LEGITIMATE_TRANSITION",
	})
	if err != nil {
		t.Fatalf("legitimate transition failed: %v", err)
	}

	// Attack 3: Conflicting transition proposal at same height (40000) rejected
	errConflicting := schedule.AddTransition(ValidatorTransition{
		TransitionHeight: 40000,
		NewValidators:    gVals,
		Reason:           "CONFLICTING_PROPOSAL",
	})
	if errConflicting == nil {
		t.Fatalf("conflicting transition at height 40000 must be rejected")
	}

	// Attack 4: Replay of an older transition height (e.g. 30000 <= 40000) rejected
	errReplay := schedule.AddTransition(ValidatorTransition{
		TransitionHeight: 30000,
		NewValidators:    gVals,
		Reason:           "REPLAY_OLD_TRANSITION",
	})
	if errReplay == nil {
		t.Fatalf("replayed transition with height <= current must be rejected")
	}

	// Attack 5: Unauthorized transition rejected
	errUnauthorized := schedule.AddTransition(ValidatorTransition{
		TransitionHeight: 50000,
		NewValidators:    rVals,
		AuthorizedBy:     "UNAUTHORIZED",
	})
	if errUnauthorized == nil {
		t.Fatalf("unauthorized transition must be rejected")
	}
}

func TestBoundary_RestartAndPartitionResilience(t *testing.T) {
	chainID := "sovra-testnet-0"

	gVals := make([]Validator, 4)
	gPrivs := make([]ed25519.PrivateKey, 4)
	for i := 0; i < 4; i++ {
		gVals[i], gPrivs[i] = generateTestValidator(fmt.Sprintf("gval-%d", i), 25)
	}
	gSet, _ := NewValidatorSet(gVals)

	rVals := make([]Validator, 4)
	rPrivs := make([]ed25519.PrivateKey, 4)
	revAddrs := make([]string, 4)
	for i := 0; i < 4; i++ {
		rVals[i], rPrivs[i] = generateTestValidator(fmt.Sprintf("rval-%d", i), 25)
		revAddrs[i] = gVals[i].Address
	}

	trans := ValidatorTransition{
		TransitionHeight:   40000,
		PreviousValidators: gVals,
		NewValidators:      rVals,
		RevokedAddresses:   revAddrs,
		Reason:             "SECURITY_KEY_ROTATION",
	}

	// Simulated Node 1 (Simulate Restart Before Transition at H=39,998)
	nodePreRestartSchedule := NewValidatorSchedule(chainID, gSet)
	_ = nodePreRestartSchedule.AddTransition(trans)
	valSetPre, _ := nodePreRestartSchedule.GetValidatorSetForHeight(39998)
	if valSetPre.Validators[0].Address != gVals[0].Address {
		t.Fatalf("expected genesis validator set before transition height")
	}

	// Simulated Node 2 (Simulate Restart After Transition at H=40,005)
	nodePostRestartSchedule := NewValidatorSchedule(chainID, gSet)
	_ = nodePostRestartSchedule.AddTransition(trans)
	valSetPost, _ := nodePostRestartSchedule.GetValidatorSetForHeight(40005)
	if valSetPost.Validators[0].Address != rVals[0].Address {
		t.Fatalf("expected rotated validator set after transition height")
	}
	if !valSetPost.IsRevokedAtHeight(gVals[0].Address, 40005) {
		t.Fatalf("genesis validator address must remain permanently revoked on post-transition restart")
	}

	// Simulated Partition Catch-up (Node receives blocks 39999, 40000, 40001 in sequence)
	// Block 39999: Genesis cert valid
	cert39999 := signCommitCert(chainID, 39999, 0, "hash39999", gVals[:3], gPrivs[:3])
	if err := VerifyCommitCertificateWithSchedule(cert39999, nodePostRestartSchedule, chainID); err != nil {
		t.Fatalf("partition catch-up: block 39999 verification failed: %v", err)
	}

	// Block 40000: Rotated cert valid
	cert40000 := signCommitCert(chainID, 40000, 0, "hash40000", rVals[:3], rPrivs[:3])
	if err := VerifyCommitCertificateWithSchedule(cert40000, nodePostRestartSchedule, chainID); err != nil {
		t.Fatalf("partition catch-up: block 40000 verification failed: %v", err)
	}

	// Malicious partition attempt: Attacker sends block 40000 signed by compromised genesis keys
	badCert40000 := signCommitCert(chainID, 40000, 0, "badhash40000", gVals[:3], gPrivs[:3])
	if err := VerifyCommitCertificateWithSchedule(badCert40000, nodePostRestartSchedule, chainID); err == nil {
		t.Fatalf("partition catch-up: malicious block 40000 from old keys must be rejected")
	}
}
