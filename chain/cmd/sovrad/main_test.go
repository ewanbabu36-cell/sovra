package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/sovra/chain/node"
	"github.com/sovra/chain/p2p"
)

func TestParseNodeFlags(t *testing.T) {
	args := []string{
		"--home", "/tmp/sovra_test",
		"--chain-id=sovra-custom-1",
		"--p2p.pex=true",
		"--p2p.seeds=id1@192.168.1.1:26656,id2@192.168.1.2:26656",
		"--p2p.laddr=tcp://0.0.0.0:36656",
		"--rpc.laddr=tcp://0.0.0.0:36657",
		"--insecure-plaintext-keys",
		"--passphrase=testsecret",
		"--v", "5",
	}

	flags := parseNodeFlags(args)

	if flags.Home != "/tmp/sovra_test" {
		t.Errorf("expected Home /tmp/sovra_test, got %s", flags.Home)
	}
	if flags.ChainID != "sovra-custom-1" {
		t.Errorf("expected ChainID sovra-custom-1, got %s", flags.ChainID)
	}
	if flags.PEX == nil || *flags.PEX != true {
		t.Errorf("expected PEX true, got %v", flags.PEX)
	}
	if flags.Seeds == nil || *flags.Seeds != "id1@192.168.1.1:26656,id2@192.168.1.2:26656" {
		t.Errorf("expected Seeds, got %v", flags.Seeds)
	}
	if flags.P2PLAddr == nil || *flags.P2PLAddr != "tcp://0.0.0.0:36656" {
		t.Errorf("expected P2PLAddr tcp://0.0.0.0:36656, got %v", flags.P2PLAddr)
	}
	if flags.RPCLAddr == nil || *flags.RPCLAddr != "tcp://0.0.0.0:36657" {
		t.Errorf("expected RPCLAddr tcp://0.0.0.0:36657, got %v", flags.RPCLAddr)
	}
	if !flags.InsecurePlaintext {
		t.Errorf("expected InsecurePlaintext true")
	}
	if flags.Passphrase != "testsecret" {
		t.Errorf("expected Passphrase testsecret, got %s", flags.Passphrase)
	}
	if flags.NumValidators != 5 {
		t.Errorf("expected NumValidators 5, got %d", flags.NumValidators)
	}
}

func TestGenerateTestnetP2PConfigAndGenesis(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "sovra-p2p-testnet-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	generateTestnet(4, tempDir, "testpass123", true)

	// Verify Node 0 config and genesis
	node0Dir := filepath.Join(tempDir, "node0")
	cfg0Bz, err := os.ReadFile(filepath.Join(node0Dir, "config.json"))
	if err != nil {
		t.Fatalf("failed to read node0 config: %v", err)
	}
	var cfg0 Config
	if err := json.Unmarshal(cfg0Bz, &cfg0); err != nil {
		t.Fatalf("failed to parse node0 config: %v", err)
	}

	if cfg0.NodeID == "" {
		t.Errorf("expected non-empty NodeID in node0 config")
	}
	if len(cfg0.NodeID) != 40 {
		t.Errorf("expected 40-char hex CometBFT NodeID, got %s (len: %d)", cfg0.NodeID, len(cfg0.NodeID))
	}
	if !cfg0.P2P.PEX {
		t.Errorf("expected node0 PEX enabled")
	}
	if cfg0.P2PPort != 26656 {
		t.Errorf("expected P2P port 26656, got %d", cfg0.P2PPort)
	}

	// Verify Node 1 config has Node 0 as seed peer
	node1Dir := filepath.Join(tempDir, "node1")
	cfg1Bz, err := os.ReadFile(filepath.Join(node1Dir, "config.json"))
	if err != nil {
		t.Fatalf("failed to read node1 config: %v", err)
	}
	var cfg1 Config
	if err := json.Unmarshal(cfg1Bz, &cfg1); err != nil {
		t.Fatalf("failed to parse node1 config: %v", err)
	}

	expectedSeed := cfg0.NodeID + "@127.0.0.1:26656"
	if len(cfg1.P2P.Seeds) == 0 || cfg1.P2P.Seeds[0] != expectedSeed {
		t.Errorf("expected node1 Seeds to contain %s, got %v", expectedSeed, cfg1.P2P.Seeds)
	}
	if !cfg1.P2P.PEX {
		t.Errorf("expected node1 PEX enabled")
	}

	// Verify genesis.json in node0 has external node identity strings and seed nodes
	gen0Bz, err := os.ReadFile(filepath.Join(node0Dir, "genesis.json"))
	if err != nil {
		t.Fatalf("failed to read node0 genesis: %v", err)
	}
	var gen0 node.GenesisState
	if err := json.Unmarshal(gen0Bz, &gen0); err != nil {
		t.Fatalf("failed to parse node0 genesis: %v", err)
	}

	if len(gen0.SeedNodes) == 0 || gen0.SeedNodes[0] != expectedSeed {
		t.Errorf("expected genesis SeedNodes to contain %s, got %v", expectedSeed, gen0.SeedNodes)
	}
	if len(gen0.Validators) != 4 {
		t.Fatalf("expected 4 validators in genesis, got %d", len(gen0.Validators))
	}
	for i, v := range gen0.Validators {
		if v.NodeID == "" {
			t.Errorf("validator %d missing NodeID", i)
		}
		if v.P2PAddr == "" {
			t.Errorf("validator %d missing P2PAddr", i)
		}
		addr, err := p2p.ParsePeerAddress(v.P2PAddr)
		if err != nil {
			t.Errorf("validator %d invalid P2PAddr %s: %v", i, v.P2PAddr, err)
		}
		if addr.ID != v.NodeID {
			t.Errorf("validator %d P2PAddr ID mismatch: %s vs %s", i, addr.ID, v.NodeID)
		}
	}
}

func TestInitNodeP2PConfig(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "sovra-p2p-init-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	pex := true
	seeds := "node0_id@127.0.0.1:26656"
	laddr := "tcp://0.0.0.0:28856"
	flags := NodeFlags{
		Home:              tempDir,
		ChainID:           "sovra-testnet-0",
		Passphrase:        "secret123",
		InsecurePlaintext: true,
		PEX:               &pex,
		Seeds:             &seeds,
		P2PLAddr:          &laddr,
	}

	initNode("validator-joiner", flags, 28857, 28856)

	cfgBz, err := os.ReadFile(filepath.Join(tempDir, "config.json"))
	if err != nil {
		t.Fatalf("failed to read config: %v", err)
	}
	var cfg Config
	if err := json.Unmarshal(cfgBz, &cfg); err != nil {
		t.Fatalf("failed to parse config: %v", err)
	}

	if !cfg.P2P.PEX {
		t.Errorf("expected PEX true")
	}
	if len(cfg.P2P.Seeds) != 1 || cfg.P2P.Seeds[0] != seeds {
		t.Errorf("expected Seeds %s, got %v", seeds, cfg.P2P.Seeds)
	}
	if cfg.P2P.ListenAddr != laddr {
		t.Errorf("expected ListenAddr %s, got %s", laddr, cfg.P2P.ListenAddr)
	}
}
