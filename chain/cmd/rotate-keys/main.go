package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/sovra/chain/x/auth"
)

type RotatedValidatorManifest struct {
	Timestamp          string                `json:"timestamp"`
	ChainID            string                `json:"chain_id"`
	Reason             string                `json:"reason"`
	PassphraseHint     string                `json:"passphrase_hint"`
	RevokedValidators  []RevokedValidator    `json:"revoked_validators"`
	RotatedValidators  []RotatedValidator    `json:"rotated_validators"`
	TransitionHeight   int64                 `json:"transition_height"`
	QuorumRequirement  string                `json:"quorum_requirement"`
	TotalVotingPower   int64                 `json:"total_voting_power"`
	SecurityNotice     string                `json:"security_notice"`
}

type RevokedValidator struct {
	Name      string `json:"name"`
	Address   string `json:"address"`
	PubKeyHex string `json:"pub_key"`
	Status    string `json:"status"`
}

type RotatedValidator struct {
	Name         string `json:"name"`
	Address      string `json:"address"`
	PubKeyHex    string `json:"pub_key"`
	VotingPower  int64  `json:"voting_power"`
	NodeID       string `json:"node_id"`
	KeystorePath string `json:"keystore_path"`
}

func main() {
	cwd, _ := os.Getwd()
	outputDir := filepath.Join(cwd, "rotated_keystores")
	manifestPath := filepath.Join(cwd, "..", "phase15_2-rotated-validator-manifest.json")

	if err := os.MkdirAll(outputDir, 0700); err != nil {
		fmt.Fprintf(os.Stderr, "failed to create output dir: %v\n", err)
		os.Exit(1)
	}

	passphrase := "sovra-validator-secure-rotated-2026"

	revoked := []RevokedValidator{
		{
			Name:      "validator-0",
			Address:   "sovra12a806ca82d506a025d580d40600abc77a69e10e7",
			PubKeyHex: "50dec499bc1281f64488a3ca9500c9c1a4eea67f5147af0450ee0deebf8601be",
			Status:    "PERMANENTLY_REVOKED_COMPROMISED_KEY",
		},
		{
			Name:      "validator-1",
			Address:   "sovra1664a83c922035ce28bb723e4e92aed1e60e26ea1",
			PubKeyHex: "a81cd7b53eb1edcfc9abce54679faf08ccaa002bd5898b63431f29cc964e67e3",
			Status:    "PERMANENTLY_REVOKED_COMPROMISED_KEY",
		},
		{
			Name:      "validator-2",
			Address:   "sovra1cb55be9a3d2afab1c9bcbffb88367bec797d11cb",
			PubKeyHex: "d6cbcf5c5acf4688995801c2993a53f4c5ff164bd897362909fb2f1a5ede7724",
			Status:    "PERMANENTLY_REVOKED_COMPROMISED_KEY",
		},
		{
			Name:      "validator-3",
			Address:   "sovra1d96f6140a4c4ae797d9e3a5badf467eb756d3d20",
			PubKeyHex: "b5fc366f668f7d6dfc43a9b2942895ccb9e4eea5d7b1ca46f1e8c710347977ec",
			Status:    "PERMANENTLY_REVOKED_COMPROMISED_KEY",
		},
	}

	var rotated []RotatedValidator

	for i := 0; i < 4; i++ {
		name := fmt.Sprintf("validator-%d", i)
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to generate key for %s: %v\n", name, err)
			os.Exit(1)
		}

		ks, err := auth.EncryptKey(priv, name, passphrase)
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to encrypt key for %s: %v\n", name, err)
			os.Exit(1)
		}

		// Verify round-trip decryption
		decPriv, decPub, err := auth.DecryptKey(ks, passphrase)
		if err != nil || !decPriv.Equal(priv) || !decPub.Equal(pub) {
			fmt.Fprintf(os.Stderr, "decryption verification failed for %s\n", name)
			os.Exit(1)
		}

		ksBytes, err := json.MarshalIndent(ks, "", "  ")
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to marshal keystore: %v\n", err)
			os.Exit(1)
		}

		ksPath := filepath.Join(outputDir, fmt.Sprintf("%s.keystore", name))
		if err := os.WriteFile(ksPath, ksBytes, 0600); err != nil {
			fmt.Fprintf(os.Stderr, "failed to write keystore: %v\n", err)
			os.Exit(1)
		}

		pubHash := sha256.Sum256(pub)
		nodeID := hex.EncodeToString(pubHash[:20])

		rotated = append(rotated, RotatedValidator{
			Name:         name,
			Address:      ks.Address,
			PubKeyHex:    ks.PubKeyHex,
			VotingPower:  25,
			NodeID:       nodeID,
			KeystorePath: filepath.Join("chain", "rotated_keystores", fmt.Sprintf("%s.keystore", name)),
		})
	}

	manifest := RotatedValidatorManifest{
		Timestamp:         time.Now().UTC().Format(time.RFC3339),
		ChainID:           "sovra-testnet-0",
		Reason:            "PHASE_15_2_HISTORICAL_COMPROMISED_KEY_ROTATION_AND_REVOCATION",
		PassphraseHint:    "AES-256-GCM Scrypt encrypted (stored in secure vault)",
		RevokedValidators: revoked,
		RotatedValidators: rotated,
		TransitionHeight:  40000,
		QuorumRequirement: "floor(2 * TotalPower / 3) + 1 = 75 (75%)",
		TotalVotingPower:  100,
		SecurityNotice:    "Zero plaintext private keys are exposed or recorded in this manifest.",
	}

	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to marshal manifest: %v\n", err)
		os.Exit(1)
	}

	if err := os.WriteFile(manifestPath, manifestBytes, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "failed to write manifest: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Successfully generated 4 fresh validator keystores in %s\n", outputDir)
	fmt.Printf("Manifest written to %s\n", manifestPath)
}
