package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/sovra/chain/node"
	"github.com/sovra/chain/p2p"
	"github.com/sovra/chain/privval"
	"github.com/sovra/chain/store"
	"github.com/sovra/chain/x/auth"
	issuancetypes "github.com/sovra/chain/x/issuance/types"
	"github.com/sovra/chain/x/wasm/vm"
)

type Config struct {
	Moniker      string        `json:"moniker"`
	ChainID      string        `json:"chain_id"`
	RPCPort      int           `json:"rpc_port"`
	RPCLAddr     string        `json:"rpc_laddr,omitempty"`
	P2PPort      int           `json:"p2p_port"`
	KeyName      string        `json:"key_name"`
	NodeAddr     string        `json:"node_address"`
	NodeID       string        `json:"node_id,omitempty"`
	PrivValLAddr string        `json:"priv_val_laddr,omitempty"`
	P2P          p2p.P2PConfig `json:"p2p"`
}

type NodeFlags struct {
	Home              string
	Passphrase        string
	InsecurePlaintext bool
	PEX               *bool
	Seeds             *string
	P2PLAddr          *string
	RPCLAddr          *string
	PrivValLAddr      *string
	ChainID           string
	NumValidators     int
}

func parseNodeFlags(args []string) NodeFlags {
	flags := NodeFlags{
		Home:    ".sovrad",
		ChainID: "sovra-testnet-0",
	}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--home" && i+1 < len(args):
			flags.Home = args[i+1]
			i++
		case strings.HasPrefix(arg, "--home="):
			flags.Home = strings.TrimPrefix(arg, "--home=")
		case arg == "--chain-id" && i+1 < len(args):
			flags.ChainID = args[i+1]
			i++
		case strings.HasPrefix(arg, "--chain-id="):
			flags.ChainID = strings.TrimPrefix(arg, "--chain-id=")
		case arg == "--passphrase" && i+1 < len(args):
			flags.Passphrase = args[i+1]
			i++
		case strings.HasPrefix(arg, "--passphrase="):
			flags.Passphrase = strings.TrimPrefix(arg, "--passphrase=")
		case arg == "--insecure-plaintext-keys":
			flags.InsecurePlaintext = true
		case arg == "--p2p.pex":
			b := true
			flags.PEX = &b
		case arg == "--p2p.pex=true":
			b := true
			flags.PEX = &b
		case arg == "--p2p.pex=false":
			b := false
			flags.PEX = &b
		case arg == "--p2p.seeds" && i+1 < len(args):
			s := args[i+1]
			flags.Seeds = &s
			i++
		case strings.HasPrefix(arg, "--p2p.seeds="):
			s := strings.TrimPrefix(arg, "--p2p.seeds=")
			flags.Seeds = &s
		case arg == "--p2p.laddr" && i+1 < len(args):
			s := args[i+1]
			flags.P2PLAddr = &s
			i++
		case strings.HasPrefix(arg, "--p2p.laddr="):
			s := strings.TrimPrefix(arg, "--p2p.laddr=")
			flags.P2PLAddr = &s
		case arg == "--rpc.laddr" && i+1 < len(args):
			s := args[i+1]
			flags.RPCLAddr = &s
			i++
		case strings.HasPrefix(arg, "--rpc.laddr="):
			s := strings.TrimPrefix(arg, "--rpc.laddr=")
			flags.RPCLAddr = &s
		case arg == "--priv_val_laddr" && i+1 < len(args):
			s := args[i+1]
			flags.PrivValLAddr = &s
			i++
		case strings.HasPrefix(arg, "--priv_val_laddr="):
			s := strings.TrimPrefix(arg, "--priv_val_laddr=")
			flags.PrivValLAddr = &s
		case arg == "--priv_validator_laddr" && i+1 < len(args):
			s := args[i+1]
			flags.PrivValLAddr = &s
			i++
		case strings.HasPrefix(arg, "--priv_validator_laddr="):
			s := strings.TrimPrefix(arg, "--priv_validator_laddr=")
			flags.PrivValLAddr = &s
		case arg == "--v" && i+1 < len(args):
			n, err := strconv.Atoi(args[i+1])
			if err == nil && n > 0 {
				flags.NumValidators = n
			}
			i++
		case strings.HasPrefix(arg, "--v="):
			n, err := strconv.Atoi(strings.TrimPrefix(arg, "--v="))
			if err == nil && n > 0 {
				flags.NumValidators = n
			}
		}
	}
	return flags
}

func main() {
	if len(os.Args) < 2 {
		printUsage()
		return
	}

	command := os.Args[1]

	switch command {
	case "version":
		fmt.Println("sovrad version 0.1.0-testnet0 (Sovra Native Blockchain)")

	case "init":
		if len(os.Args) < 3 {
			fmt.Println("Usage: sovrad init <moniker> [--chain-id <id>] [--home <dir>] [--passphrase <pass>] [--insecure-plaintext-keys] [--p2p.pex] [--p2p.seeds <seeds>] [--p2p.laddr <addr>]")
			return
		}
		moniker := os.Args[2]
		flags := parseNodeFlags(os.Args[3:])
		initNode(moniker, flags, 26657, 26656)

	case "keys":
		handleKeys(os.Args[2:])

	case "testnet":
		flags := parseNodeFlags(os.Args[2:])
		numVals := 4
		if flags.NumValidators > 0 {
			numVals = flags.NumValidators
		}
		baseDir := "mytestnet"
		if flags.Home != ".sovrad" {
			baseDir = flags.Home
		}
		generateTestnet(numVals, baseDir, flags.Passphrase, flags.InsecurePlaintext)

	case "start":
		flags := parseNodeFlags(os.Args[2:])
		startNode(flags)

	case "query":
		handleQuery(os.Args[2:])

	case "tx":
		handleTx(os.Args[2:])

	case "wasm":
		handleWasm(os.Args[2:])

	case "export":
		flags := parseNodeFlags(os.Args[2:])
		exportGenesis(flags)

	case "signer":
		handleSigner(os.Args[2:])

	default:
		printUsage()
	}
}

func printUsage() {
	fmt.Println(`SOVRA Blockchain Daemon (sovrad)
Available commands:
  sovrad version                   Show node version
  sovrad init <moniker>            Initialize local node configuration and keystore
  sovrad keys add <name>           Generate a new password-encrypted keystore
  sovrad keys list                 List keys stored in keyring
  sovrad keys show <name>          Inspect metadata for an encrypted key
  sovrad testnet [--v 4]           Bootstrap a multi-validator local testnet cluster
  sovrad start [--home <dir>]      Start consensus node, P2P switch, and RPC service
  sovrad signer start              Start isolated remote validator signing daemon (TMKMS / CloudHSM)
  sovrad export [--home <dir>]     Export current chain state to genesis JSON
  sovrad query supply [--rpc <url>] Query bank supply and master invariants
  sovrad query balance <address>   Query account balance
  sovrad tx send <from> <to> <amt> Send SOV/uSOV (supports encrypted keystore or key file)
  sovrad tx burn <from> <amt>      Burn tokens permanently from supply
  sovrad wasm store <key> <file>   Upload and store CosmWasm bytecode
  sovrad wasm instantiate <key> <code_id> <msg> Instantiate contract instance
  sovrad wasm execute <key> <contract> <msg>    Execute contract state-transition
  sovrad wasm query <contract> <msg>            Execute smart query against contract
  sovrad wasm split <init|distribute|query|simulate> Creator revenue split operations

P2P & Security Flags:
  --priv_val_laddr=tcp://host:port Connect to remote PrivValidator daemon (deprecates on-disk key)
  --p2p.pex[=true|false]           Enable/disable CometBFT peer exchange (default: true)
  --p2p.seeds=<node_id@host:port>  Seed node addresses for peer discovery
  --p2p.laddr=tcp://host:port      P2P listening address (default: tcp://0.0.0.0:26656)
  --rpc.laddr=tcp://host:port      RPC listening address (default: tcp://0.0.0.0:26657)
  --home=<dir>                     Node configuration directory (default: .sovrad)
  --passphrase=<pass>              Keyring passphrase for encrypted validator keys`)
}

func initNode(moniker string, flags NodeFlags, rpcPort, p2pPort int) {
	homeDir := flags.Home
	chainID := flags.ChainID
	if chainID == "" {
		chainID = "sovra-testnet-0"
	}
	if err := os.MkdirAll(homeDir, 0755); err != nil {
		fmt.Printf("Error creating home directory: %v\n", err)
		return
	}

	// Generate key first so we have the nodeID
	kp, ks := generateKey("validator", homeDir, flags.Passphrase, flags.InsecurePlaintext)
	nodeID := p2p.ComputeNodeID(kp.PublicKey)
	p2pAddr := fmt.Sprintf("%s@127.0.0.1:%d", nodeID, p2pPort)

	p2pCfg := p2p.DefaultP2PConfig(p2pPort)
	if flags.PEX != nil {
		p2pCfg.PEX = *flags.PEX
	}
	if flags.Seeds != nil && *flags.Seeds != "" {
		p2pCfg.Seeds = strings.Split(*flags.Seeds, ",")
	}
	if flags.P2PLAddr != nil {
		p2pCfg.ListenAddr = *flags.P2PLAddr
	}

	rpcLAddr := fmt.Sprintf("tcp://0.0.0.0:%d", rpcPort)
	if flags.RPCLAddr != nil {
		rpcLAddr = *flags.RPCLAddr
	}

	cfg := Config{
		Moniker:  moniker,
		ChainID:  chainID,
		RPCPort:  rpcPort,
		RPCLAddr: rpcLAddr,
		P2PPort:  p2pPort,
		KeyName:  "validator",
		NodeAddr: kp.Address,
		NodeID:   nodeID,
		P2P:      p2pCfg,
	}

	cfgBz, _ := json.MarshalIndent(cfg, "", "  ")
	_ = os.WriteFile(filepath.Join(homeDir, "config.json"), cfgBz, 0644)

	// Create default genesis with 30M SOV allocated to validator
	gen := node.GenesisState{
		ChainID:     chainID,
		GenesisTime: time.Now().Unix(),
		Accounts: map[string]string{
			ks.Address: issuancetypes.GenesisCap.String(), // 30M SOV in uSOV
		},
		Validators: []node.GenesisValidator{
			{
				Name:        moniker,
				Address:     ks.Address,
				PubKeyHex:   ks.PubKeyHex,
				VotingPower: 100,
				NodeID:      nodeID,
				P2PAddr:     p2pAddr,
			},
		},
		SeedNodes: []string{p2pAddr},
	}

	genBz, _ := json.MarshalIndent(gen, "", "  ")
	_ = os.WriteFile(filepath.Join(homeDir, "genesis.json"), genBz, 0644)

	fmt.Printf("Node %s initialized in %s\n", moniker, homeDir)
	fmt.Printf("Chain ID: %s\n", chainID)
	fmt.Printf("Node ID:  %s\n", nodeID)
	fmt.Printf("P2P Seed: %s\n", p2pAddr)
	fmt.Printf("Validator Address: %s\n", kp.Address)
	fmt.Printf("Genesis Supply: %s uSOV (30,000,000 SOV)\n", issuancetypes.GenesisCap.String())
}

func handleKeys(args []string) {
	if len(args) < 1 {
		fmt.Println("Usage: sovrad keys [add|list|show] ...")
		return
	}
	switch args[0] {
	case "add":
		if len(args) < 2 {
			fmt.Println("Usage: sovrad keys add <name> [--home <dir>] [--passphrase <pass>] [--insecure-plaintext-keys]")
			return
		}
		name := args[1]
		homeDir := ".sovrad"
		passphrase := ""
		insecurePlaintext := false
		for i := 2; i < len(args); i++ {
			if args[i] == "--home" && i+1 < len(args) {
				homeDir = args[i+1]
				i++
			} else if args[i] == "--passphrase" && i+1 < len(args) {
				passphrase = args[i+1]
				i++
			} else if args[i] == "--insecure-plaintext-keys" {
				insecurePlaintext = true
			}
		}

		if passphrase == "" {
			passphrase = os.Getenv("SOVRA_KEY_PASSPHRASE")
		}
		if passphrase == "" {
			p1, err := auth.PromptPassphrase(fmt.Sprintf("Enter passphrase to encrypt key '%s': ", name))
			if err != nil {
				fmt.Printf("Error reading passphrase: %v\n", err)
				return
			}
			if len(p1) < 8 {
				fmt.Println("Error: passphrase must be at least 8 characters")
				return
			}
			p2, err := auth.PromptPassphrase("Confirm passphrase: ")
			if err != nil || p1 != p2 {
				fmt.Println("Error: passphrases do not match")
				return
			}
			passphrase = p1
		}

		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			fmt.Printf("Key generation failed: %v\n", err)
			return
		}

		ks, err := auth.EncryptKey(priv, name, passphrase)
		if err != nil {
			fmt.Printf("Encryption failed: %v\n", err)
			return
		}

		filePath, err := auth.SaveKeystore(homeDir, ks)
		if err != nil {
			fmt.Printf("Failed to save keystore: %v\n", err)
			return
		}

		fmt.Printf("\n** ENCRYPTED KEYSTORE CREATED **\n")
		fmt.Printf("  Name:     %s\n", name)
		fmt.Printf("  Address:  %s\n", ks.Address)
		fmt.Printf("  PubKey:   %s\n", ks.PubKeyHex)
		fmt.Printf("  Keystore: %s\n", filePath)

		if insecurePlaintext {
			kp := &node.KeyPair{
				Name:       name,
				Address:    ks.Address,
				PublicKey:  pub,
				PrivateKey: priv,
				PubKeyHex:  ks.PubKeyHex,
				PrivKeyHex: hex.EncodeToString(priv),
			}
			keyPath := filepath.Join(homeDir, name+".key.json")
			kpBz, _ := json.MarshalIndent(kp, "", "  ")
			_ = os.WriteFile(keyPath, kpBz, 0600)
			fmt.Printf("  [WARNING] Insecure plaintext key written to: %s\n", keyPath)
		}

	case "list":
		homeDir := ".sovrad"
		for i := 1; i < len(args); i++ {
			if args[i] == "--home" && i+1 < len(args) {
				homeDir = args[i+1]
				i++
			}
		}
		keyringDir := filepath.Join(homeDir, "keyring")
		files, err := os.ReadDir(keyringDir)
		if err != nil {
			fmt.Printf("No keys found in %s\n", keyringDir)
			return
		}
		fmt.Printf("Keystore files in %s:\n", keyringDir)
		for _, f := range files {
			if strings.HasSuffix(f.Name(), ".keystore") {
				ks, err := auth.LoadKeystore(filepath.Join(keyringDir, f.Name()))
				if err == nil {
					fmt.Printf("  - %s (Address: %s, PubKey: %s)\n", ks.Name, ks.Address, ks.PubKeyHex)
				}
			}
		}

	case "show":
		if len(args) < 2 {
			fmt.Println("Usage: sovrad keys show <name> [--home <dir>]")
			return
		}
		name := args[1]
		homeDir := ".sovrad"
		for i := 2; i < len(args); i++ {
			if args[i] == "--home" && i+1 < len(args) {
				homeDir = args[i+1]
				i++
			}
		}
		ksPath := auth.KeystoreFilePath(homeDir, name)
		ks, err := auth.LoadKeystore(ksPath)
		if err != nil {
			fmt.Printf("Could not load key '%s': %v\n", name, err)
			return
		}
		fmt.Printf("Key:      %s\n", ks.Name)
		fmt.Printf("Address:  %s\n", ks.Address)
		fmt.Printf("PubKey:   %s\n", ks.PubKeyHex)
		fmt.Printf("Cipher:   %s\n", ks.Crypto.Cipher)
		fmt.Printf("KDF:      %s\n", ks.Crypto.KDF)
		fmt.Printf("File:     %s\n", ksPath)

	case "import":
		if len(args) < 2 {
			fmt.Println("Usage: sovrad keys import <keyFile> [--home <dir>] [--passphrase <pass>]")
			return
		}
		keyFile := args[1]
		homeDir := ".sovrad"
		passphrase := ""
		for i := 2; i < len(args); i++ {
			if args[i] == "--home" && i+1 < len(args) {
				homeDir = args[i+1]
				i++
			} else if args[i] == "--passphrase" && i+1 < len(args) {
				passphrase = args[i+1]
				i++
			}
		}
		if passphrase == "" {
			passphrase = os.Getenv("SOVRA_KEY_PASSPHRASE")
		}
		if passphrase == "" {
			p, err := auth.PromptPassphrase("Enter passphrase to encrypt imported key: ")
			if err != nil {
				fmt.Printf("Error: %v\n", err)
				return
			}
			passphrase = p
		}

		kpBz, err := os.ReadFile(keyFile)
		if err != nil {
			fmt.Printf("Failed to read %s: %v\n", keyFile, err)
			return
		}
		var kp node.KeyPair
		if err := json.Unmarshal(kpBz, &kp); err != nil {
			fmt.Printf("Failed to parse %s: %v\n", keyFile, err)
			return
		}
		privBz, err := hex.DecodeString(kp.PrivKeyHex)
		if err != nil {
			fmt.Printf("Invalid priv key hex: %v\n", err)
			return
		}
		privKey := ed25519.PrivateKey(privBz)

		ks, err := auth.EncryptKey(privKey, kp.Name, passphrase)
		if err != nil {
			fmt.Printf("Encryption failed: %v\n", err)
			return
		}
		filePath, err := auth.SaveKeystore(homeDir, ks)
		if err != nil {
			fmt.Printf("Failed to save keystore: %v\n", err)
			return
		}
		fmt.Printf("Imported '%s' -> %s (Address: %s)\n", kp.Name, filePath, ks.Address)
	}
}

func generateKey(name, homeDir, passphrase string, insecurePlaintext bool) (*node.KeyPair, *auth.KeystoreJSON) {
	_ = os.MkdirAll(homeDir, 0755)
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		panic(err)
	}
	addr := auth.ComputeAddressFromPubKey(pub)

	if passphrase == "" {
		passphrase = os.Getenv("SOVRA_KEY_PASSPHRASE")
	}
	if passphrase == "" {
		passphrase = "sovra-testnet-secret"
	}

	ks, err := auth.EncryptKey(priv, name, passphrase)
	if err != nil {
		panic(err)
	}

	ksPath, err := auth.SaveKeystore(homeDir, ks)
	if err != nil {
		panic(err)
	}

	kp := &node.KeyPair{
		Name:       name,
		Address:    addr,
		PublicKey:  pub,
		PrivateKey: priv,
		PubKeyHex:  hex.EncodeToString(pub),
		PrivKeyHex: hex.EncodeToString(priv),
	}

	if insecurePlaintext {
		keyPath := filepath.Join(homeDir, name+".key.json")
		kpBz, _ := json.MarshalIndent(kp, "", "  ")
		_ = os.WriteFile(keyPath, kpBz, 0600)
		fmt.Printf("Generated key '%s':\n  Address:  %s\n  PubKey:   %s\n  Keystore: %s\n  [INSECURE] Plaintext key: %s\n",
			name, addr, kp.PubKeyHex, ksPath, keyPath)
	} else {
		fmt.Printf("Generated key '%s':\n  Address:  %s\n  PubKey:   %s\n  Keystore: %s\n",
			name, addr, kp.PubKeyHex, ksPath)
	}

	return kp, ks
}

func generateTestnet(numVals int, baseDir string, passphrase string, insecurePlaintext bool) {
	fmt.Printf("Scaffolding %d-Validator Testnet in '%s'...\n", numVals, baseDir)
	_ = os.MkdirAll(baseDir, 0755)

	genesisTime := time.Now().Unix()
	chainID := "sovra-testnet-0"

	validators := make([]node.GenesisValidator, numVals)
	accounts := make(map[string]string)
	keyPairs := make([]*node.KeyPair, numVals)
	nodeIDs := make([]string, numVals)
	p2pAddrs := make([]string, numVals)

	// Equal distribution of the 30M SOV genesis cap among validators
	genesisPerVal := issuancetypes.GenesisCap.QuoRaw(int64(numVals))

	if passphrase == "" {
		passphrase = os.Getenv("SOVRA_KEY_PASSPHRASE")
	}
	if passphrase == "" {
		passphrase = "sovra-testnet-secret"
	}

	for i := 0; i < numVals; i++ {
		nodeDir := filepath.Join(baseDir, fmt.Sprintf("node%d", i))
		_ = os.RemoveAll(filepath.Join(nodeDir, "data"))
		_ = os.MkdirAll(nodeDir, 0755)

		moniker := fmt.Sprintf("validator-%d", i)
		kp, _ := generateKey(moniker, nodeDir, passphrase, insecurePlaintext)
		keyPairs[i] = kp

		nodeID := p2p.ComputeNodeID(kp.PublicKey)
		nodeIDs[i] = nodeID
		p2pPort := 26656 + (i * 10)
		p2pAddr := fmt.Sprintf("%s@127.0.0.1:%d", nodeID, p2pPort)
		p2pAddrs[i] = p2pAddr

		votingPower := int64(100 / numVals)
		if i == 0 {
			votingPower += int64(100 % numVals)
		}

		validators[i] = node.GenesisValidator{
			Name:        moniker,
			Address:     kp.Address,
			PubKeyHex:   kp.PubKeyHex,
			VotingPower: votingPower,
			NodeID:      nodeID,
			P2PAddr:     p2pAddr,
		}

		accounts[kp.Address] = genesisPerVal.String()
	}

	seedNodes := []string{p2pAddrs[0]} // Node 0 is canonical seed peer

	for i := 0; i < numVals; i++ {
		nodeDir := filepath.Join(baseDir, fmt.Sprintf("node%d", i))
		moniker := fmt.Sprintf("validator-%d", i)
		p2pPort := 26656 + (i * 10)
		rpcPort := 26657 + (i * 10)

		p2pCfg := p2p.DefaultP2PConfig(p2pPort)
		p2pCfg.ListenAddr = fmt.Sprintf("tcp://0.0.0.0:%d", p2pPort)
		p2pCfg.ExternalAddr = fmt.Sprintf("127.0.0.1:%d", p2pPort)
		p2pCfg.PEX = true
		if i > 0 {
			p2pCfg.Seeds = []string{p2pAddrs[0]}
		}

		cfg := Config{
			Moniker:  moniker,
			ChainID:  chainID,
			RPCPort:  rpcPort,
			RPCLAddr: fmt.Sprintf("tcp://0.0.0.0:%d", rpcPort),
			P2PPort:  p2pPort,
			KeyName:  moniker,
			NodeAddr: keyPairs[i].Address,
			NodeID:   nodeIDs[i],
			P2P:      p2pCfg,
		}
		cfgBz, _ := json.MarshalIndent(cfg, "", "  ")
		_ = os.WriteFile(filepath.Join(nodeDir, "config.json"), cfgBz, 0644)
	}

	// Single unified genesis state
	gen := node.GenesisState{
		ChainID:     chainID,
		GenesisTime: genesisTime,
		Accounts:    accounts,
		Validators:  validators,
		SeedNodes:   seedNodes,
	}
	genBz, _ := json.MarshalIndent(gen, "", "  ")

	for i := 0; i < numVals; i++ {
		nodeDir := filepath.Join(baseDir, fmt.Sprintf("node%d", i))
		_ = os.WriteFile(filepath.Join(nodeDir, "genesis.json"), genBz, 0644)
	}

	fmt.Println("\n=== TESTNET-0 SCAFFOLD COMPLETED ===")
	for i := 0; i < numVals; i++ {
		fmt.Printf("  Node %d: RPC Port %d | P2P: %s | Address: %s\n",
			i, 26657+(i*10), p2pAddrs[i], keyPairs[i].Address)
	}
	fmt.Printf("Seed Node: %s\n", p2pAddrs[0])
	fmt.Printf("Genesis Total Supply: %s uSOV (30,000,000 SOV across %d validators)\n", issuancetypes.GenesisCap.String(), numVals)
}

// WsHub manages CometBFT WebSocket subscriptions and event broadcasting
type WsHub struct {
	mu      sync.RWMutex
	clients map[*websocket.Conn]map[string]bool
}

func newWsHub() *WsHub {
	return &WsHub{
		clients: make(map[*websocket.Conn]map[string]bool),
	}
}

func (h *WsHub) addClient(conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[conn] = make(map[string]bool)
}

func (h *WsHub) removeClient(conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, conn)
	_ = conn.Close()
}

func (h *WsHub) subscribe(conn *websocket.Conn, query string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if subs, exists := h.clients[conn]; exists {
		subs[query] = true
	}
}

func (h *WsHub) unsubscribe(conn *websocket.Conn, query string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if subs, exists := h.clients[conn]; exists {
		delete(subs, query)
	}
}

func (h *WsHub) broadcast(query string, payload interface{}) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for conn, subs := range h.clients {
		if subs[query] || query == "" {
			_ = conn.WriteJSON(payload)
		}
	}
}

func startNode(flags NodeFlags) {
	homeDir := flags.Home
	insecurePlaintext := flags.InsecurePlaintext
	passphraseFlag := flags.Passphrase

	cfgFile := filepath.Join(homeDir, "config.json")
	genFile := filepath.Join(homeDir, "genesis.json")

	cfgBz, err := os.ReadFile(cfgFile)
	if err != nil {
		fmt.Printf("Cannot read config from %s: %v\n", cfgFile, err)
		return
	}
	var cfg Config
	_ = json.Unmarshal(cfgBz, &cfg)

	genBz, err := os.ReadFile(genFile)
	if err != nil {
		fmt.Printf("Cannot read genesis from %s: %v\n", genFile, err)
		return
	}
	var gen node.GenesisState
	_ = json.Unmarshal(genBz, &gen)

	// Ensure P2P configuration defaults
	if cfg.P2P.ListenAddr == "" {
		p2pPort := cfg.P2PPort
		if p2pPort == 0 {
			p2pPort = 26656
		}
		cfg.P2P = p2p.DefaultP2PConfig(p2pPort)
	}

	// Apply CLI flag overrides if provided
	if flags.PEX != nil {
		cfg.P2P.PEX = *flags.PEX
	}
	if flags.Seeds != nil {
		if *flags.Seeds != "" {
			cfg.P2P.Seeds = strings.Split(*flags.Seeds, ",")
		} else {
			cfg.P2P.Seeds = []string{}
		}
	}
	if flags.P2PLAddr != nil {
		cfg.P2P.ListenAddr = *flags.P2PLAddr
	}
	if flags.RPCLAddr != nil {
		cfg.RPCLAddr = *flags.RPCLAddr
	}

	// Load validator signing mechanism: either via remote PrivValidator daemon (TMKMS/CloudHSM) or local keystore
	var privVal privval.PrivValidator
	var pubKey ed25519.PublicKey
	var nodeAddr string

	remotePrivValAddr := ""
	if flags.PrivValLAddr != nil && *flags.PrivValLAddr != "" {
		remotePrivValAddr = *flags.PrivValLAddr
	} else if cfg.PrivValLAddr != "" {
		remotePrivValAddr = cfg.PrivValLAddr
	}

	if remotePrivValAddr != "" {
		rpv, err := privval.NewRemotePrivValidator(remotePrivValAddr)
		if err != nil {
			fmt.Printf("[HSM ERROR] Failed to connect to remote PrivValidator daemon at %s: %v\n", remotePrivValAddr, err)
			return
		}
		defer rpv.Close()
		privVal = rpv
		pub, err := rpv.GetPubKey()
		if err != nil {
			fmt.Printf("[HSM ERROR] Failed to query public key from remote signer: %v\n", err)
			return
		}
		pubKey = pub
		nodeAddr = rpv.GetAddress()
		fmt.Printf("[HSM KEY SECURITY] Connected to remote validator signer:\n  Daemon Socket: %s\n  Engine:        %s\n  Address:       %s\n  Key Custody:   ISOLATED (Zero on-disk key on node)\n",
			remotePrivValAddr, rpv.GetHSMType(), nodeAddr)
	} else {
		// Fallback to local encrypted keystore or legacy plaintext file
		keyName := cfg.KeyName
		if keyName == "" {
			keyName = "validator"
		}

		var privKey ed25519.PrivateKey
		ksPath := auth.KeystoreFilePath(homeDir, keyName)
		if _, err := os.Stat(ksPath); err == nil {
			pass := passphraseFlag
			if pass == "" {
				pass = os.Getenv("SOVRA_KEY_PASSPHRASE")
			}
			if pass == "" {
				p, err := auth.PromptPassphrase(fmt.Sprintf("Enter passphrase to unlock validator key '%s': ", keyName))
				if err != nil {
					fmt.Printf("Failed to read passphrase: %v\n", err)
					return
				}
				pass = p
			}

			ks, err := auth.LoadKeystore(ksPath)
			if err != nil {
				fmt.Printf("Failed to load keystore %s: %v\n", ksPath, err)
				return
			}

			pKey, pubK, err := auth.DecryptKey(ks, pass)
			if err != nil {
				fmt.Printf("Failed to decrypt validator keystore: %v\n", err)
				return
			}
			privKey = pKey
			pubKey = pubK
			nodeAddr = ks.Address
			fmt.Printf("Unlocked encrypted validator keystore: %s (Address: %s)\n", keyName, nodeAddr)
		} else {
			// Fallback for backward compatibility
			legacyKeyFile := filepath.Join(homeDir, keyName+".key.json")
			if _, err := os.Stat(legacyKeyFile); err == nil {
				if !insecurePlaintext {
					fmt.Printf("[SECURITY NOTICE] Plaintext key '%s' found. Consider migrating to encrypted keystore with 'sovrad keys add'.\n", legacyKeyFile)
				}
				kpBz, err := os.ReadFile(legacyKeyFile)
				if err != nil {
					fmt.Printf("Cannot read key file %s: %v\n", legacyKeyFile, err)
					return
				}
				var kp node.KeyPair
				_ = json.Unmarshal(kpBz, &kp)
				privBz, _ := hex.DecodeString(kp.PrivKeyHex)
				pubBz, _ := hex.DecodeString(kp.PubKeyHex)
				privKey = ed25519.PrivateKey(privBz)
				pubKey = ed25519.PublicKey(pubBz)
				nodeAddr = kp.Address
			} else {
				fmt.Printf("Notice: No validator key found at %s or %s (running as non-validating node)\n", ksPath, legacyKeyFile)
			}
		}

		if len(privKey) > 0 {
			privVal = privval.NewLocalPrivValidator(privKey)
		}
	}

	nodeID := cfg.NodeID
	if nodeID == "" && len(pubKey) > 0 {
		nodeID = p2p.ComputeNodeID(pubKey)
	}

	dbDir := filepath.Join(homeDir, "data", "sovradb")
	pStore, err := store.NewPebbleStore(dbDir)
	if err != nil {
		fmt.Printf("Failed to open persistent database at %s: %v\n", dbDir, err)
		return
	}
	defer pStore.Close()

	app := node.NewSovraApp(pStore, gen.GenesisTime)

	lastHeight, appHash, err := app.LoadLastState()
	if err != nil {
		fmt.Printf("Failed to load last state from database: %v\n", err)
		return
	}

	if !app.IsChainInitialized() {
		if err := app.InitChain(gen); err != nil {
			fmt.Printf("Failed to initialize chain: %v\n", err)
			return
		}
		fmt.Printf("Initialized new chain from genesis at block 0\n")
	} else {
		hashPrefix := []byte("00000000")
		if len(appHash) >= 8 {
			hashPrefix = appHash[:8]
		}
		fmt.Printf("Resumed chain from persistent store at block %d (AppHash: %x)\n", lastHeight, hashPrefix)
	}

	// Setup CometBFT P2P Switch
	swCallbacks := p2p.SwitchCallbacks{
		GetLocalHeight: func() int64 {
			return app.GetHeight()
		},
		GetAppHash: func() []byte {
			return app.GetAppHash()
		},
		GetBlocks: func(from, to int64) []p2p.BlockData {
			var blocks []p2p.BlockData
			for h := from; h <= to; h++ {
				bz := app.GetBlock(h)
				if len(bz) > 0 {
					var b p2p.BlockData
					if err := json.Unmarshal(bz, &b); err == nil {
						blocks = append(blocks, b)
					}
				}
			}
			return blocks
		},
		ApplyBlock: func(b p2p.BlockData) error {
			if b.Height <= app.GetHeight() {
				return nil
			}
			_ = app.BeginBlock(b.Height, b.Time)
			for _, tx := range b.Txs {
				_ = app.DeliverTx(tx)
			}
			_ = app.Commit()
			bBz, _ := json.Marshal(b)
			app.SaveBlock(b.Height, bBz)
			fmt.Printf("[P2P SYNC] Applied Block %04d | AppHash: %s | Txs: %d\n", b.Height, b.AppHash, b.TxCount)
			return nil
		},
		OnReceiveTx: func(tx node.SignedTransaction) error {
			if err := app.CheckTx(tx); err != nil {
				return err
			}
			return app.DeliverTx(tx)
		},
	}

	p2pSwitch := p2p.NewSwitch(cfg.P2P, nodeID, cfg.Moniker, cfg.ChainID, cfg.P2PPort, swCallbacks)
	if err := p2pSwitch.Start(); err != nil {
		fmt.Printf("Warning: P2P Switch failed to start: %v\n", err)
	} else {
		defer p2pSwitch.Stop()
	}

	isValidator := false
	for _, v := range gen.Validators {
		if v.Address == nodeAddr || (len(pubKey) > 0 && v.PubKeyHex == hex.EncodeToString(pubKey)) {
			isValidator = true
			break
		}
	}

	fmt.Printf("====================================================\n")
	fmt.Printf("  SOVRA CONSENSUS NODE: %s\n", cfg.Moniker)
	fmt.Printf("  Chain ID:             %s\n", cfg.ChainID)
	fmt.Printf("  Node ID:              %s\n", nodeID)
	fmt.Printf("  RPC Endpoint:         http://127.0.0.1:%d\n", cfg.RPCPort)
	fmt.Printf("  P2P Listen Addr:      %s\n", cfg.P2P.ListenAddr)
	fmt.Printf("  P2P External Addr:    %s\n", cfg.P2P.ExternalAddr)
	fmt.Printf("  PEX Enabled:          %v\n", cfg.P2P.PEX)
	fmt.Printf("  Configured Seeds:     %v\n", cfg.P2P.Seeds)
	fmt.Printf("  Validator Address:    %s\n", nodeAddr)
	fmt.Printf("  Is Validator:         %v\n", isValidator)
	fmt.Printf("  Current Block Height: %d\n", app.GetHeight())
	fmt.Printf("  Current Supply:       %s uSOV\n", app.QueryTotalSupply().String())
	fmt.Printf("====================================================\n")

	// CometBFT WebSocket Hub
	hub := newWsHub()

	// Block production loop (active consensus validators produce new blocks; non-validator or sync-only nodes follow P2P chain)
	if isValidator {
		go func() {
			ticker := time.NewTicker(3 * time.Second)
			defer ticker.Stop()
			height := app.GetHeight()

			for range ticker.C {
				height++
				now := time.Now().Unix()

				_ = app.BeginBlock(height, now)
				newAppHash := app.Commit()

				blockData := p2p.BlockData{
					Height:   height,
					Time:     now,
					AppHash:  hex.EncodeToString(newAppHash),
					Proposer: cfg.Moniker,
					TxCount:  0,
					Txs:      []node.SignedTransaction{},
				}

				// Sign proposal block via PrivValidator interface (remote HSM or memory enclave)
				if privVal != nil {
					prop := &privval.Proposal{
						Height:          height,
						Round:           0,
						BlockHash:       hex.EncodeToString(newAppHash),
						ProposerAddress: nodeAddr,
					}
					sig, err := privVal.SignProposal(cfg.ChainID, prop)
					if err != nil {
						fmt.Printf("[VALIDATOR SIGNER] High-water mark error: %v\n", err)
					} else {
						_ = sig
					}
				}

				bBz, _ := json.Marshal(blockData)
				app.SaveBlock(height, bBz)

				// Gossip over P2P network
				p2pSwitch.BroadcastNewBlock(blockData)

				fmt.Printf("[BLOCK %04d] Produced | Time: %d | AppHash: %x | Supply: %s uSOV\n",
					height, now, newAppHash[:8], app.QueryTotalSupply().String())

				// Broadcast CometBFT NewBlock event to WebSocket subscribers
				blockEvent := map[string]interface{}{
					"jsonrpc": "2.0",
					"id":      0,
					"result": map[string]interface{}{
						"query": "tm.event='NewBlock'",
						"data": map[string]interface{}{
							"type": "tendermint/event/NewBlock",
							"value": map[string]interface{}{
								"block": map[string]interface{}{
									"header": map[string]interface{}{
										"chain_id":         cfg.ChainID,
										"height":           strconv.FormatInt(height, 10),
										"time":             time.Unix(now, 0).UTC().Format(time.RFC3339Nano),
										"app_hash":         hex.EncodeToString(newAppHash),
										"proposer_address": cfg.Moniker,
									},
									"data": map[string]interface{}{
										"txs": []string{},
									},
								},
							},
						},
					},
				}
				hub.broadcast("tm.event='NewBlock'", blockEvent)
			}
		}()
	}

	// HTTP & WebSocket RPC Server
	mux := http.NewServeMux()

	mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"moniker":        cfg.Moniker,
			"chain_id":       cfg.ChainID,
			"node_id":        nodeID,
			"height":         app.GetHeight(),
			"app_hash":       hex.EncodeToString(app.GetAppHash()),
			"total_supply":   app.QueryTotalSupply().String(),
			"lifetime_mint":  app.QueryLifetimeMinted().String(),
			"lifetime_burn":  app.QueryLifetimeBurned().String(),
			"genesis_time":   gen.GenesisTime,
			"supply_correct": app.QueryTotalSupply().Equal(app.QueryLifetimeMinted().Sub(app.QueryLifetimeBurned())),
		})
	})

	mux.HandleFunc("/net_info", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      -1,
			"result":  p2pSwitch.GetNetInfo(),
		})
	})

	mux.HandleFunc("/genesis", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      -1,
			"result": map[string]interface{}{
				"genesis": gen,
			},
		})
	})

	mux.HandleFunc("/genesis/export", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		exported, err := app.ExportGenesis()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		if len(exported.Validators) == 0 {
			exported.Validators = gen.Validators
		}
		_ = json.NewEncoder(w).Encode(exported)
	})

	mux.HandleFunc("/block", func(w http.ResponseWriter, r *http.Request) {
		hStr := r.URL.Query().Get("height")
		targetHeight := app.GetHeight()
		if hStr != "" {
			if h, err := strconv.ParseInt(hStr, 10, 64); err == nil && h > 0 {
				targetHeight = h
			}
		}
		bBz := app.GetBlock(targetHeight)
		var bData p2p.BlockData
		if len(bBz) > 0 {
			_ = json.Unmarshal(bBz, &bData)
		} else {
			bData = p2p.BlockData{
				Height:   targetHeight,
				Time:     time.Now().Unix(),
				AppHash:  hex.EncodeToString(app.GetAppHash()),
				Proposer: cfg.Moniker,
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      -1,
			"result": map[string]interface{}{
				"block_id": map[string]interface{}{
					"hash": bData.AppHash,
				},
				"block": map[string]interface{}{
					"header": map[string]interface{}{
						"chain_id":         cfg.ChainID,
						"height":           strconv.FormatInt(bData.Height, 10),
						"time":             time.Unix(bData.Time, 0).UTC().Format(time.RFC3339Nano),
						"app_hash":         bData.AppHash,
						"proposer_address": bData.Proposer,
					},
					"data": map[string]interface{}{
						"txs": bData.Txs,
					},
				},
			},
		})
	})

	mux.HandleFunc("/query/balance", func(w http.ResponseWriter, r *http.Request) {
		addr := r.URL.Query().Get("address")
		bal := app.QueryBalance(addr)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"address": addr,
			"balance": bal.String(),
			"denom":   issuancetypes.BaseDenom,
		})
	})

	mux.HandleFunc("/query/nonce", func(w http.ResponseWriter, r *http.Request) {
		addr := r.URL.Query().Get("address")
		nonce := app.QueryNonce(addr)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"address": addr,
			"nonce":   nonce,
		})
	})

	mux.HandleFunc("/query/supply", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		supply := app.QueryTotalSupply()
		minted := app.QueryLifetimeMinted()
		burned := app.QueryLifetimeBurned()
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"bank_supply":            supply.String(),
			"lifetime_minted":        minted.String(),
			"lifetime_burned":        burned.String(),
			"master_invariant_holds": supply.Equal(minted.Sub(burned)),
		})
	})

	// CosmWasm RPC endpoints
	mux.HandleFunc("/wasm/contract/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// Format: /wasm/contract/{address}/smart?query={json}
		path := strings.TrimPrefix(r.URL.Path, "/wasm/contract/")
		parts := strings.Split(path, "/")
		if len(parts) >= 2 && parts[1] == "smart" {
			contractAddr := parts[0]
			queryStr := r.URL.Query().Get("query")
			if queryStr == "" {
				w.WriteHeader(http.StatusBadRequest)
				_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": "missing query parameter"})
				return
			}
			res, err := app.QueryWasmSmart(contractAddr, []byte(queryStr))
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error()})
				return
			}
			var parsed interface{}
			if err := json.Unmarshal(res, &parsed); err == nil {
				_ = json.NewEncoder(w).Encode(map[string]interface{}{"data": parsed})
			} else {
				_ = json.NewEncoder(w).Encode(map[string]interface{}{"data": string(res)})
			}
			return
		}

		if len(parts) >= 1 && parts[0] != "" {
			contractAddr := parts[0]
			info, err := app.QueryWasmContractInfo(contractAddr)
			if err != nil {
				w.WriteHeader(http.StatusNotFound)
				_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error()})
				return
			}
			_ = json.NewEncoder(w).Encode(info)
			return
		}

		http.NotFound(w, r)
	})

	mux.HandleFunc("/wasm/contract/smart", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		contractAddr := r.URL.Query().Get("address")
		queryStr := r.URL.Query().Get("query")
		if contractAddr == "" || queryStr == "" {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": "missing address or query parameter"})
			return
		}
		res, err := app.QueryWasmSmart(contractAddr, []byte(queryStr))
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error()})
			return
		}
		var parsed interface{}
		if err := json.Unmarshal(res, &parsed); err == nil {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"data": parsed})
		} else {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"data": string(res)})
		}
	})

	mux.HandleFunc("/wasm/code", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		idStr := r.URL.Query().Get("id")
		codeID, err := strconv.ParseUint(idStr, 10, 64)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid code id"})
			return
		}
		info, err := app.QueryWasmCode(codeID)
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error()})
			return
		}
		_ = json.NewEncoder(w).Encode(info)
	})

	// WebSocket handler for CometBFT subscriptions
	var wsUpgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	mux.HandleFunc("/websocket", func(w http.ResponseWriter, r *http.Request) {
		conn, err := wsUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		hub.addClient(conn)
		defer hub.removeClient(conn)

		for {
			var req struct {
				JSONRPC string          `json:"jsonrpc"`
				Method  string          `json:"method"`
				ID      interface{}     `json:"id"`
				Params  json.RawMessage `json:"params"`
			}
			if err := conn.ReadJSON(&req); err != nil {
				break
			}

			if req.Method == "subscribe" {
				var params struct {
					Query string `json:"query"`
				}
				_ = json.Unmarshal(req.Params, &params)
				hub.subscribe(conn, params.Query)

				resp := map[string]interface{}{
					"jsonrpc": "2.0",
					"id":      req.ID,
					"result":  map[string]interface{}{},
				}
				_ = conn.WriteJSON(resp)
			} else if req.Method == "unsubscribe" {
				var params struct {
					Query string `json:"query"`
				}
				_ = json.Unmarshal(req.Params, &params)
				hub.unsubscribe(conn, params.Query)

				resp := map[string]interface{}{
					"jsonrpc": "2.0",
					"id":      req.ID,
					"result":  map[string]interface{}{},
				}
				_ = conn.WriteJSON(resp)
			} else {
				resp := map[string]interface{}{
					"jsonrpc": "2.0",
					"id":      req.ID,
					"result":  map[string]interface{}{"status": "ok"},
				}
				_ = conn.WriteJSON(resp)
			}
		}
	})

	// Transaction Broadcast Handler (both /broadcast_tx and /broadcast_tx_commit)
	handleBroadcastTx := func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		var tx node.SignedTransaction
		_ = json.Unmarshal(bodyBytes, &tx)

		// Also support PascalCase / alternative keys
		var rawMap map[string]interface{}
		_ = json.Unmarshal(bodyBytes, &rawMap)
		if rawMap != nil {
			if tx.Sender == "" && rawMap["Sender"] != nil {
				tx.Sender = fmt.Sprintf("%v", rawMap["Sender"])
			}
			if tx.Recipient == "" && rawMap["Recipient"] != nil {
				tx.Recipient = fmt.Sprintf("%v", rawMap["Recipient"])
			}
			if tx.Amount == "" && rawMap["Amount"] != nil {
				tx.Amount = fmt.Sprintf("%v", rawMap["Amount"])
			}
			if tx.Fee == "" && rawMap["Fee"] != nil {
				tx.Fee = fmt.Sprintf("%v", rawMap["Fee"])
			}
			if tx.PubKeyHex == "" {
				if rawMap["PubKeyHex"] != nil {
					tx.PubKeyHex = fmt.Sprintf("%v", rawMap["PubKeyHex"])
				} else if rawMap["pubKeyHex"] != nil {
					tx.PubKeyHex = fmt.Sprintf("%v", rawMap["pubKeyHex"])
				} else if rawMap["pub_key"] != nil {
					tx.PubKeyHex = fmt.Sprintf("%v", rawMap["pub_key"])
				}
			}
			if tx.SigHex == "" {
				if rawMap["SigHex"] != nil {
					tx.SigHex = fmt.Sprintf("%v", rawMap["SigHex"])
				} else if rawMap["sigHex"] != nil {
					tx.SigHex = fmt.Sprintf("%v", rawMap["sigHex"])
				} else if rawMap["sig"] != nil {
					tx.SigHex = fmt.Sprintf("%v", rawMap["sig"])
				}
			}
			if tx.Type == "" {
				if rawMap["Type"] != nil {
					tx.Type = node.TxType(fmt.Sprintf("%v", rawMap["Type"]))
				} else {
					tx.Type = node.TxTypeSend
				}
			}
			if tx.Nonce == 0 && rawMap["Nonce"] != nil {
				switch v := rawMap["Nonce"].(type) {
				case float64:
					tx.Nonce = uint64(v)
				case string:
					n, _ := strconv.ParseUint(v, 10, 64)
					tx.Nonce = n
				}
			}
			if tx.WASMBytecodeHex == "" {
				if rawMap["WASMBytecodeHex"] != nil {
					tx.WASMBytecodeHex = fmt.Sprintf("%v", rawMap["WASMBytecodeHex"])
				} else if rawMap["wasm_bytecode"] != nil {
					tx.WASMBytecodeHex = fmt.Sprintf("%v", rawMap["wasm_bytecode"])
				}
			}
			if tx.CodeID == 0 {
				if rawMap["CodeID"] != nil {
					if cid, ok := rawMap["CodeID"].(float64); ok {
						tx.CodeID = uint64(cid)
					}
				} else if rawMap["code_id"] != nil {
					if cid, ok := rawMap["code_id"].(float64); ok {
						tx.CodeID = uint64(cid)
					}
				}
			}
			if tx.Contract == "" {
				if rawMap["Contract"] != nil {
					tx.Contract = fmt.Sprintf("%v", rawMap["Contract"])
				} else if rawMap["contract"] != nil {
					tx.Contract = fmt.Sprintf("%v", rawMap["contract"])
				}
			}
			if tx.Label == "" {
				if rawMap["Label"] != nil {
					tx.Label = fmt.Sprintf("%v", rawMap["Label"])
				} else if rawMap["label"] != nil {
					tx.Label = fmt.Sprintf("%v", rawMap["label"])
				}
			}
			if tx.Admin == "" {
				if rawMap["Admin"] != nil {
					tx.Admin = fmt.Sprintf("%v", rawMap["Admin"])
				} else if rawMap["admin"] != nil {
					tx.Admin = fmt.Sprintf("%v", rawMap["admin"])
				}
			}
			if tx.Msg == "" {
				if rawMap["Msg"] != nil {
					tx.Msg = fmt.Sprintf("%v", rawMap["Msg"])
				} else if rawMap["msg"] != nil {
					tx.Msg = fmt.Sprintf("%v", rawMap["msg"])
				}
			}
			if tx.Funds == "" {
				if rawMap["Funds"] != nil {
					tx.Funds = fmt.Sprintf("%v", rawMap["Funds"])
				} else if rawMap["funds"] != nil {
					tx.Funds = fmt.Sprintf("%v", rawMap["funds"])
				}
			}
			if tx.Validator == "" {
				if rawMap["Validator"] != nil {
					tx.Validator = fmt.Sprintf("%v", rawMap["Validator"])
				} else if rawMap["validator"] != nil {
					tx.Validator = fmt.Sprintf("%v", rawMap["validator"])
				}
			}
		}

		if err := app.CheckTx(tx); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"ok":    false,
				"error": err.Error(),
				"phase": "CheckTx",
				"check_tx": map[string]interface{}{
					"code": 1,
					"log":  err.Error(),
				},
			})
			return
		}

		if err := app.DeliverTx(tx); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"ok":    false,
				"error": err.Error(),
				"phase": "DeliverTx",
				"deliver_tx": map[string]interface{}{
					"code": 1,
					"log":  err.Error(),
				},
			})
			return
		}

		// Broadcast Tx to connected peers via P2P switch
		p2pSwitch.BroadcastTx(tx)

		// Compute deterministic tx hash
		txBytes, _ := json.Marshal(tx)
		txHashBytes := sha256.Sum256(txBytes)
		txHash := "0x" + hex.EncodeToString(txHashBytes[:])

		// Broadcast Tx event to CometBFT WebSocket subscribers
		txEvent := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      1,
			"result": map[string]interface{}{
				"query": "tm.event='Tx'",
				"data": map[string]interface{}{
					"type": "tendermint/event/Tx",
					"value": map[string]interface{}{
						"TxResult": map[string]interface{}{
							"height":  strconv.FormatInt(app.GetHeight(), 10),
							"tx_hash": txHash,
							"tx":      tx,
							"result": map[string]interface{}{
								"log": "Tx executed successfully",
							},
						},
					},
				},
			},
		}
		hub.broadcast("tm.event='Tx'", txEvent)

		w.Header().Set("Content-Type", "application/json")
		resp := map[string]interface{}{
			"ok":     true,
			"height": app.GetHeight(),
			"hash":   txHash,
			"txhash": txHash,
			"log":    "Tx executed and committed to block",
			"tx":     tx,
			"check_tx": map[string]interface{}{
				"code": 0,
			},
			"deliver_tx": map[string]interface{}{
				"code": 0,
				"log":  "Tx executed successfully",
			},
		}
		if tx.Type == node.TxTypeInstantiateContract {
			resp["contract_address"] = app.GetLastInstantiatedContract()
		}
		_ = json.NewEncoder(w).Encode(resp)
	}

	mux.HandleFunc("/broadcast_tx", handleBroadcastTx)
	mux.HandleFunc("/broadcast_tx_commit", handleBroadcastTx)

	rpcAddr := fmt.Sprintf("127.0.0.1:%d", cfg.RPCPort)
	if cfg.RPCLAddr != "" {
		l := strings.TrimPrefix(cfg.RPCLAddr, "tcp://")
		if strings.Contains(l, ":") {
			rpcAddr = l
		}
	}

	server := &http.Server{
		Addr:    rpcAddr,
		Handler: mux,
	}

	fmt.Printf("RPC Server listening on http://%s\n", rpcAddr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		fmt.Printf("Server exited: %v\n", err)
	}
}

func handleQuery(args []string) {
	if len(args) == 0 {
		fmt.Println("Usage: sovrad query [supply|balance <addr>]")
		return
	}
	port := 26657
	switch args[0] {
	case "supply":
		resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/query/supply", port))
		if err != nil {
			fmt.Printf("Node unreachable at port %d: %v\n", port, err)
			return
		}
		defer resp.Body.Close()
		var res map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&res)
		bz, _ := json.MarshalIndent(res, "", "  ")
		fmt.Println(string(bz))

	case "balance":
		if len(args) < 2 {
			fmt.Println("Usage: sovrad query balance <address>")
			return
		}
		addr := args[1]
		resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/query/balance?address=%s", port, addr))
		if err != nil {
			fmt.Printf("Node unreachable: %v\n", err)
			return
		}
		defer resp.Body.Close()
		var res map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&res)
		bz, _ := json.MarshalIndent(res, "", "  ")
		fmt.Println(string(bz))
	}
}

func loadSigningKey(keyOrFile string) (ed25519.PrivateKey, ed25519.PublicKey, string, error) {
	targetPath := keyOrFile
	if !strings.HasSuffix(targetPath, ".keystore") && !strings.HasSuffix(targetPath, ".json") {
		// Check .sovrad/keyring/<name>.keystore
		candidate := auth.KeystoreFilePath(".sovrad", targetPath)
		if _, err := os.Stat(candidate); err == nil {
			targetPath = candidate
		}
	}

	if strings.HasSuffix(targetPath, ".keystore") {
		ks, err := auth.LoadKeystore(targetPath)
		if err != nil {
			return nil, nil, "", err
		}
		passphrase := os.Getenv("SOVRA_KEY_PASSPHRASE")
		if passphrase == "" {
			p, err := auth.PromptPassphrase(fmt.Sprintf("Enter passphrase for '%s': ", ks.Name))
			if err != nil {
				return nil, nil, "", err
			}
			passphrase = p
		}
		priv, pub, err := auth.DecryptKey(ks, passphrase)
		if err != nil {
			return nil, nil, "", err
		}
		return priv, pub, ks.Address, nil
	}

	kpBz, err := os.ReadFile(targetPath)
	if err != nil {
		return nil, nil, "", fmt.Errorf("failed to read key file %s: %w", targetPath, err)
	}
	var kp node.KeyPair
	if err := json.Unmarshal(kpBz, &kp); err != nil {
		return nil, nil, "", err
	}
	privBz, err := hex.DecodeString(kp.PrivKeyHex)
	if err != nil {
		return nil, nil, "", err
	}
	pubBz, err := hex.DecodeString(kp.PubKeyHex)
	if err != nil {
		return nil, nil, "", err
	}
	return ed25519.PrivateKey(privBz), ed25519.PublicKey(pubBz), kp.Address, nil
}

func handleTx(args []string) {
	if len(args) < 1 {
		fmt.Println("Usage: sovrad tx [send|burn] ...")
		return
	}
	port := 26657

	switch args[0] {
	case "send":
		if len(args) < 4 {
			fmt.Println("Usage: sovrad tx send <keyOrFile> <recipient> <amount>")
			return
		}
		keyArg := args[1]
		recipient := args[2]
		amount := args[3]

		privKey, pubKey, senderAddr, err := loadSigningKey(keyArg)
		if err != nil {
			fmt.Printf("Key error: %v\n", err)
			return
		}

		nonceResp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/query/nonce?address=%s", port, senderAddr))
		if err != nil {
			fmt.Printf("Failed to query nonce: %v\n", err)
			return
		}
		defer nonceResp.Body.Close()
		var nData map[string]interface{}
		_ = json.NewDecoder(nonceResp.Body).Decode(&nData)
		nonce := uint64(nData["nonce"].(float64))

		tx := node.SignedTransaction{
			Type:      node.TxTypeSend,
			Sender:    senderAddr,
			Recipient: recipient,
			Amount:    amount,
			Nonce:     nonce,
			Fee:       "100",
			PubKeyHex: hex.EncodeToString(pubKey),
		}

		signBytes := tx.GetSignBytes()
		sig := ed25519.Sign(privKey, signBytes)
		tx.SigHex = hex.EncodeToString(sig)

		txBz, _ := json.Marshal(tx)
		resp, err := http.Post(fmt.Sprintf("http://127.0.0.1:%d/broadcast_tx", port), "application/json", bytes.NewReader(txBz))
		if err != nil {
			fmt.Printf("Broadcast failed: %v\n", err)
			return
		}
		defer resp.Body.Close()
		var bRes map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&bRes)
		out, _ := json.MarshalIndent(bRes, "", "  ")
		fmt.Println(string(out))

	case "burn":
		if len(args) < 3 {
			fmt.Println("Usage: sovrad tx burn <keyOrFile> <amount>")
			return
		}
		keyArg := args[1]
		amount := args[2]

		privKey, pubKey, senderAddr, err := loadSigningKey(keyArg)
		if err != nil {
			fmt.Printf("Key error: %v\n", err)
			return
		}

		nonceResp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/query/nonce?address=%s", port, senderAddr))
		if err != nil {
			fmt.Printf("Failed to query nonce: %v\n", err)
			return
		}
		defer nonceResp.Body.Close()
		var nData map[string]interface{}
		_ = json.NewDecoder(nonceResp.Body).Decode(&nData)
		nonce := uint64(nData["nonce"].(float64))

		tx := node.SignedTransaction{
			Type:      node.TxTypeBurn,
			Sender:    senderAddr,
			Amount:    amount,
			Nonce:     nonce,
			Fee:       "0",
			PubKeyHex: hex.EncodeToString(pubKey),
		}

		signBytes := tx.GetSignBytes()
		sig := ed25519.Sign(privKey, signBytes)
		tx.SigHex = hex.EncodeToString(sig)

		txBz, _ := json.Marshal(tx)
		resp, err := http.Post(fmt.Sprintf("http://127.0.0.1:%d/broadcast_tx", port), "application/json", bytes.NewReader(txBz))
		if err != nil {
			fmt.Printf("Broadcast failed: %v\n", err)
			return
		}
		defer resp.Body.Close()
		var bRes map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&bRes)
		out, _ := json.MarshalIndent(bRes, "", "  ")
		fmt.Println(string(out))
	}
}

func handleWasm(args []string) {
	if len(args) < 1 {
		fmt.Println("Usage: sovrad wasm [store|instantiate|execute|query|split] ...")
		return
	}
	port := 26657

	switch args[0] {
	case "store":
		var keyArg string = "validator"
		var wasmFile string
		if len(args) < 2 {
			fmt.Println("Usage: sovrad wasm store [<keyOrFile>] <wasm_file>")
			return
		}
		if len(args) == 2 {
			wasmFile = args[1]
		} else {
			if strings.HasSuffix(args[1], ".wasm") {
				wasmFile = args[1]
			} else {
				keyArg = args[1]
				wasmFile = args[2]
			}
		}

		bytecode, err := os.ReadFile(wasmFile)
		if err != nil {
			fmt.Printf("Failed to read wasm file '%s': %v\n", wasmFile, err)
			return
		}

		privKey, pubKey, senderAddr, err := loadSigningKey(keyArg)
		if err != nil {
			fmt.Printf("Key error: %v\n", err)
			return
		}

		nonceResp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/query/nonce?address=%s", port, senderAddr))
		if err != nil {
			fmt.Printf("Failed to query nonce: %v\n", err)
			return
		}
		defer nonceResp.Body.Close()
		var nData map[string]interface{}
		_ = json.NewDecoder(nonceResp.Body).Decode(&nData)
		nonce := uint64(nData["nonce"].(float64))

		tx := node.SignedTransaction{
			Type:            node.TxTypeStoreCode,
			Sender:          senderAddr,
			Nonce:           nonce,
			Fee:             "1000",
			WASMBytecodeHex: hex.EncodeToString(bytecode),
			PubKeyHex:       hex.EncodeToString(pubKey),
		}

		signBytes := tx.GetSignBytes()
		sig := ed25519.Sign(privKey, signBytes)
		tx.SigHex = hex.EncodeToString(sig)

		txBz, _ := json.Marshal(tx)
		resp, err := http.Post(fmt.Sprintf("http://127.0.0.1:%d/broadcast_tx_commit", port), "application/json", bytes.NewReader(txBz))
		if err != nil {
			fmt.Printf("Broadcast failed: %v\n", err)
			return
		}
		defer resp.Body.Close()
		var bRes map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&bRes)
		out, _ := json.MarshalIndent(bRes, "", "  ")
		fmt.Println(string(out))

	case "instantiate":
		var keyArg string = "validator"
		var codeID uint64
		var msgStr string
		label := "contract"
		funds := "0"

		if len(args) < 3 {
			fmt.Println("Usage: sovrad wasm instantiate [<keyOrFile>] <code_id> <msg_json> [--label <label>] [--funds <funds>]")
			return
		}

		remArgs := args[1:]
		if cid, err := strconv.ParseUint(remArgs[0], 10, 64); err == nil {
			codeID = cid
			msgStr = remArgs[1]
			remArgs = remArgs[2:]
		} else {
			keyArg = remArgs[0]
			cid, err := strconv.ParseUint(remArgs[1], 10, 64)
			if err != nil {
				fmt.Printf("Invalid code_id: %v\n", err)
				return
			}
			codeID = cid
			msgStr = remArgs[2]
			remArgs = remArgs[3:]
		}

		for i := 0; i < len(remArgs); i++ {
			if remArgs[i] == "--label" && i+1 < len(remArgs) {
				label = remArgs[i+1]
				i++
			} else if remArgs[i] == "--funds" && i+1 < len(remArgs) {
				funds = remArgs[i+1]
				i++
			}
		}

		privKey, pubKey, senderAddr, err := loadSigningKey(keyArg)
		if err != nil {
			fmt.Printf("Key error: %v\n", err)
			return
		}

		nonceResp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/query/nonce?address=%s", port, senderAddr))
		if err != nil {
			fmt.Printf("Failed to query nonce: %v\n", err)
			return
		}
		defer nonceResp.Body.Close()
		var nData map[string]interface{}
		_ = json.NewDecoder(nonceResp.Body).Decode(&nData)
		nonce := uint64(nData["nonce"].(float64))

		tx := node.SignedTransaction{
			Type:      node.TxTypeInstantiateContract,
			Sender:    senderAddr,
			Nonce:     nonce,
			Fee:       "1000",
			CodeID:    codeID,
			Label:     label,
			Msg:       msgStr,
			Funds:     funds,
			PubKeyHex: hex.EncodeToString(pubKey),
		}

		signBytes := tx.GetSignBytes()
		sig := ed25519.Sign(privKey, signBytes)
		tx.SigHex = hex.EncodeToString(sig)

		txBz, _ := json.Marshal(tx)
		resp, err := http.Post(fmt.Sprintf("http://127.0.0.1:%d/broadcast_tx_commit", port), "application/json", bytes.NewReader(txBz))
		if err != nil {
			fmt.Printf("Broadcast failed: %v\n", err)
			return
		}
		defer resp.Body.Close()
		var bRes map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&bRes)
		out, _ := json.MarshalIndent(bRes, "", "  ")
		fmt.Println(string(out))

	case "execute":
		var keyArg string = "validator"
		var contractAddr string
		var msgStr string
		funds := "0"

		if len(args) < 3 {
			fmt.Println("Usage: sovrad wasm execute [<keyOrFile>] <contract_address> <msg_json> [--funds <funds>]")
			return
		}

		remArgs := args[1:]
		if strings.HasPrefix(remArgs[0], "sovra1") {
			contractAddr = remArgs[0]
			msgStr = remArgs[1]
			remArgs = remArgs[2:]
		} else {
			keyArg = remArgs[0]
			contractAddr = remArgs[1]
			msgStr = remArgs[2]
			remArgs = remArgs[3:]
		}

		for i := 0; i < len(remArgs); i++ {
			if remArgs[i] == "--funds" && i+1 < len(remArgs) {
				funds = remArgs[i+1]
				i++
			}
		}

		privKey, pubKey, senderAddr, err := loadSigningKey(keyArg)
		if err != nil {
			fmt.Printf("Key error: %v\n", err)
			return
		}

		nonceResp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/query/nonce?address=%s", port, senderAddr))
		if err != nil {
			fmt.Printf("Failed to query nonce: %v\n", err)
			return
		}
		defer nonceResp.Body.Close()
		var nData map[string]interface{}
		_ = json.NewDecoder(nonceResp.Body).Decode(&nData)
		nonce := uint64(nData["nonce"].(float64))

		tx := node.SignedTransaction{
			Type:      node.TxTypeExecuteContract,
			Sender:    senderAddr,
			Nonce:     nonce,
			Fee:       "1000",
			Contract:  contractAddr,
			Msg:       msgStr,
			Funds:     funds,
			PubKeyHex: hex.EncodeToString(pubKey),
		}

		signBytes := tx.GetSignBytes()
		sig := ed25519.Sign(privKey, signBytes)
		tx.SigHex = hex.EncodeToString(sig)

		txBz, _ := json.Marshal(tx)
		resp, err := http.Post(fmt.Sprintf("http://127.0.0.1:%d/broadcast_tx_commit", port), "application/json", bytes.NewReader(txBz))
		if err != nil {
			fmt.Printf("Broadcast failed: %v\n", err)
			return
		}
		defer resp.Body.Close()
		var bRes map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&bRes)
		out, _ := json.MarshalIndent(bRes, "", "  ")
		fmt.Println(string(out))

	case "query":
		if len(args) < 3 {
			fmt.Println("Usage: sovrad wasm query <contract_address> <msg_json>")
			return
		}
		contractAddr := args[1]
		msgStr := args[2]

		reqURL := fmt.Sprintf("http://127.0.0.1:%d/wasm/contract/%s/smart?query=%s", port, contractAddr, strings.ReplaceAll(msgStr, " ", "%20"))
		resp, err := http.Get(reqURL)
		if err != nil {
			fmt.Printf("Query failed: %v\n", err)
			return
		}
		defer resp.Body.Close()
		var res map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&res)
		out, _ := json.MarshalIndent(res, "", "  ")
		fmt.Println(string(out))

	case "split":
		if len(args) < 2 {
			fmt.Println("Usage: sovrad wasm split [init|distribute|query|simulate] ...")
			fmt.Println("  init <key> <title> <addr1:weight1,addr2:weight2> [--code-id <id>] [--min-payout <uSOV>]")
			fmt.Println("  distribute <key> <contract_address> <amount_uSOV>")
			fmt.Println("  query <contract_address> [recipient <address>]")
			fmt.Println("  simulate <contract_address> <amount_uSOV>")
			return
		}

		subCmd := args[1]
		switch subCmd {
		case "init":
			if len(args) < 5 {
				fmt.Println("Usage: sovrad wasm split init <key> <title> <addr1:weight1,addr2:weight2> [--code-id <id>] [--min-payout <uSOV>]")
				return
			}
			keyArg := args[2]
			title := args[3]
			recipientsRaw := args[4]
			codeID := uint64(1)
			minPayout := "1"

			for i := 5; i < len(args); i++ {
				if args[i] == "--code-id" && i+1 < len(args) {
					if id, err := strconv.ParseUint(args[i+1], 10, 64); err == nil {
						codeID = id
					}
					i++
				} else if args[i] == "--min-payout" && i+1 < len(args) {
					minPayout = args[i+1]
					i++
				}
			}

			var recipients []vm.SplitRecipient
			parts := strings.Split(recipientsRaw, ",")
			for _, p := range parts {
				kv := strings.Split(strings.TrimSpace(p), ":")
				if len(kv) != 2 {
					fmt.Printf("Invalid recipient pair: %s. Expected format 'addr:weight'\n", p)
					return
				}
				w, err := strconv.ParseUint(strings.TrimSpace(kv[1]), 10, 64)
				if err != nil {
					fmt.Printf("Invalid weight for %s: %v\n", kv[0], err)
					return
				}
				recipients = append(recipients, vm.SplitRecipient{
					Address: strings.TrimSpace(kv[0]),
					Weight:  w,
				})
			}

			privKey, pubKey, senderAddr, err := loadSigningKey(keyArg)
			if err != nil {
				fmt.Printf("Key error: %v\n", err)
				return
			}

			initMsg := vm.SplitInstantiateMsg{
				Admin:      senderAddr,
				Title:      title,
				Recipients: recipients,
				MinPayout:  minPayout,
			}
			initBz, _ := json.Marshal(initMsg)

			nonceResp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/query/nonce?address=%s", port, senderAddr))
			if err != nil {
				fmt.Printf("Failed to query nonce: %v\n", err)
				return
			}
			defer nonceResp.Body.Close()
			var nData map[string]interface{}
			_ = json.NewDecoder(nonceResp.Body).Decode(&nData)
			nonce := uint64(nData["nonce"].(float64))

			tx := node.SignedTransaction{
				Type:      node.TxTypeInstantiateContract,
				Sender:    senderAddr,
				Nonce:     nonce,
				Fee:       "1000",
				CodeID:    codeID,
				Label:     title,
				Msg:       string(initBz),
				Funds:     "0",
				PubKeyHex: hex.EncodeToString(pubKey),
			}

			signBytes := tx.GetSignBytes()
			sig := ed25519.Sign(privKey, signBytes)
			tx.SigHex = hex.EncodeToString(sig)

			txBz, _ := json.Marshal(tx)
			resp, err := http.Post(fmt.Sprintf("http://127.0.0.1:%d/broadcast_tx_commit", port), "application/json", bytes.NewReader(txBz))
			if err != nil {
				fmt.Printf("Broadcast failed: %v\n", err)
				return
			}
			defer resp.Body.Close()
			var bRes map[string]interface{}
			_ = json.NewDecoder(resp.Body).Decode(&bRes)
			out, _ := json.MarshalIndent(bRes, "", "  ")
			fmt.Println(string(out))

		case "distribute":
			if len(args) < 5 {
				fmt.Println("Usage: sovrad wasm split distribute <key> <contract_address> <amount_uSOV>")
				return
			}
			keyArg := args[2]
			contractAddr := args[3]
			amount := args[4]

			privKey, pubKey, senderAddr, err := loadSigningKey(keyArg)
			if err != nil {
				fmt.Printf("Key error: %v\n", err)
				return
			}

			nonceResp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/query/nonce?address=%s", port, senderAddr))
			if err != nil {
				fmt.Printf("Failed to query nonce: %v\n", err)
				return
			}
			defer nonceResp.Body.Close()
			var nData map[string]interface{}
			_ = json.NewDecoder(nonceResp.Body).Decode(&nData)
			nonce := uint64(nData["nonce"].(float64))

			tx := node.SignedTransaction{
				Type:      node.TxTypeExecuteContract,
				Sender:    senderAddr,
				Nonce:     nonce,
				Fee:       "1000",
				Contract:  contractAddr,
				Msg:       `{"distribute":{}}`,
				Funds:     amount,
				PubKeyHex: hex.EncodeToString(pubKey),
			}

			signBytes := tx.GetSignBytes()
			sig := ed25519.Sign(privKey, signBytes)
			tx.SigHex = hex.EncodeToString(sig)

			txBz, _ := json.Marshal(tx)
			resp, err := http.Post(fmt.Sprintf("http://127.0.0.1:%d/broadcast_tx_commit", port), "application/json", bytes.NewReader(txBz))
			if err != nil {
				fmt.Printf("Broadcast failed: %v\n", err)
				return
			}
			defer resp.Body.Close()
			var bRes map[string]interface{}
			_ = json.NewDecoder(resp.Body).Decode(&bRes)
			out, _ := json.MarshalIndent(bRes, "", "  ")
			fmt.Println(string(out))

		case "query":
			if len(args) < 3 {
				fmt.Println("Usage: sovrad wasm split query <contract_address> [recipient <address>]")
				return
			}
			contractAddr := args[2]
			queryMsg := `{"config":{}}`
			if len(args) >= 5 && args[3] == "recipient" {
				queryMsg = fmt.Sprintf(`{"recipient_share":{"address":"%s"}}`, args[4])
			}

			reqURL := fmt.Sprintf("http://127.0.0.1:%d/wasm/contract/%s/smart?query=%s", port, contractAddr, strings.ReplaceAll(queryMsg, " ", "%20"))
			resp, err := http.Get(reqURL)
			if err != nil {
				fmt.Printf("Query failed: %v\n", err)
				return
			}
			defer resp.Body.Close()
			var res map[string]interface{}
			_ = json.NewDecoder(resp.Body).Decode(&res)
			out, _ := json.MarshalIndent(res, "", "  ")
			fmt.Println(string(out))

		case "simulate":
			if len(args) < 4 {
				fmt.Println("Usage: sovrad wasm split simulate <contract_address> <amount_uSOV>")
				return
			}
			contractAddr := args[2]
			amount := args[3]
			queryMsg := fmt.Sprintf(`{"simulate_distribute":{"amount":"%s"}}`, amount)

			reqURL := fmt.Sprintf("http://127.0.0.1:%d/wasm/contract/%s/smart?query=%s", port, contractAddr, strings.ReplaceAll(queryMsg, " ", "%20"))
			resp, err := http.Get(reqURL)
			if err != nil {
				fmt.Printf("Simulate query failed: %v\n", err)
				return
			}
			defer resp.Body.Close()
			var res map[string]interface{}
			_ = json.NewDecoder(resp.Body).Decode(&res)
			out, _ := json.MarshalIndent(res, "", "  ")
			fmt.Println(string(out))

		default:
			fmt.Printf("Unknown split command: %s. Use init, distribute, query, simulate\n", subCmd)
		}
	}
}

func exportGenesis(flags NodeFlags) {
	homeDir := flags.Home
	outPath := filepath.Join(homeDir, "exported-genesis.json")

	// 1. Try querying running node's /genesis/export endpoint if online
	rpcPort := 26657
	if flags.RPCLAddr != nil && *flags.RPCLAddr != "" {
		parts := strings.Split(*flags.RPCLAddr, ":")
		if len(parts) == 3 {
			if p, err := strconv.Atoi(parts[2]); err == nil {
				rpcPort = p
			}
		}
	}
	rpcURL := fmt.Sprintf("http://127.0.0.1:%d/genesis/export", rpcPort)
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(rpcURL)
	if err == nil && resp.StatusCode == 200 {
		defer resp.Body.Close()
		var gen node.GenesisState
		if err := json.NewDecoder(resp.Body).Decode(&gen); err == nil {
			bz, _ := json.MarshalIndent(gen, "", "  ")
			_ = os.WriteFile(outPath, bz, 0644)
			fmt.Printf("Successfully exported live genesis to %s (ChainID: %s, Accounts: %d, Validators: %d)\n",
				outPath, gen.ChainID, len(gen.Accounts), len(gen.Validators))
			return
		}
	}

	// 2. Otherwise, read local PebbleStore on disk
	dataDir := filepath.Join(homeDir, "data", "sovradb")
	ps, err := store.NewPebbleStore(dataDir)
	if err != nil {
		fmt.Printf("Failed to open storage at %s: %v\n", dataDir, err)
		return
	}
	defer ps.Close()

	app := node.NewSovraApp(ps, time.Now().Unix())
	gen, err := app.ExportGenesis()
	if err != nil {
		fmt.Printf("Failed to export genesis: %v\n", err)
		return
	}

	if len(gen.Validators) == 0 {
		genPath := filepath.Join(homeDir, "genesis.json")
		if bz, err := os.ReadFile(genPath); err == nil {
			var origGen node.GenesisState
			if err := json.Unmarshal(bz, &origGen); err == nil {
				gen.Validators = origGen.Validators
			}
		}
	}

	bz, err := json.MarshalIndent(gen, "", "  ")
	if err != nil {
		fmt.Printf("Failed to format genesis: %v\n", err)
		return
	}

	if err := os.WriteFile(outPath, bz, 0644); err != nil {
		fmt.Printf("Failed to write exported genesis: %v\n", err)
		return
	}
	fmt.Printf("Successfully exported genesis to %s (ChainID: %s, Accounts: %d, Validators: %d)\n",
		outPath, gen.ChainID, len(gen.Accounts), len(gen.Validators))
}

func handleSigner(args []string) {
	if len(args) == 0 || args[0] != "start" {
		fmt.Println(`SOVRA Remote Validator Signing Daemon (TMKMS / CloudHSM Compatible)
Usage:
  sovrad signer start [--listen=<tcp://127.0.0.1:26659>] [--home=<dir>] [--key=<key_name>] [--passphrase=<pass>] [--hsm=<enclave|cloudhsm|yubihsm>]

Options:
  --listen=<addr>        Socket listen address (default: tcp://127.0.0.1:26659 or unix:///tmp/privval.sock)
  --home=<dir>           Home directory containing keystore (default: .sovrad)
  --key=<name>           Validator key name (default: validator)
  --passphrase=<pass>    Passphrase to decrypt keystore
  --hsm=<backend>        HSM backend: 'enclave' (Memory Enclave), 'cloudhsm' (AWS CloudHSM), 'yubihsm' (YubiHSM2)
  --state=<file>         High-water mark state file (default: <home>/data/priv_validator_state.json)`)
		return
	}

	listenAddr := "tcp://127.0.0.1:26659"
	homeDir := ".sovrad"
	keyName := "validator"
	passphrase := ""
	hsmType := "enclave"
	stateFile := ""

	for i := 1; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--listen" && i+1 < len(args):
			listenAddr = args[i+1]
			i++
		case strings.HasPrefix(arg, "--listen="):
			listenAddr = strings.TrimPrefix(arg, "--listen=")
		case arg == "--home" && i+1 < len(args):
			homeDir = args[i+1]
			i++
		case strings.HasPrefix(arg, "--home="):
			homeDir = strings.TrimPrefix(arg, "--home=")
		case arg == "--key" && i+1 < len(args):
			keyName = args[i+1]
			i++
		case strings.HasPrefix(arg, "--key="):
			keyName = strings.TrimPrefix(arg, "--key=")
		case arg == "--passphrase" && i+1 < len(args):
			passphrase = args[i+1]
			i++
		case strings.HasPrefix(arg, "--passphrase="):
			passphrase = strings.TrimPrefix(arg, "--passphrase=")
		case arg == "--hsm" && i+1 < len(args):
			hsmType = args[i+1]
			i++
		case strings.HasPrefix(arg, "--hsm="):
			hsmType = strings.TrimPrefix(arg, "--hsm=")
		case arg == "--state" && i+1 < len(args):
			stateFile = args[i+1]
			i++
		case strings.HasPrefix(arg, "--state="):
			stateFile = strings.TrimPrefix(arg, "--state=")
		}
	}

	if stateFile == "" {
		stateFile = filepath.Join(homeDir, "data", "priv_validator_state.json")
	}

	// Load validator key to seed HSM backend
	var privKey ed25519.PrivateKey
	ksPath := auth.KeystoreFilePath(homeDir, keyName)
	if _, err := os.Stat(ksPath); err == nil {
		pass := passphrase
		if pass == "" {
			pass = os.Getenv("SOVRA_KEY_PASSPHRASE")
		}
		if pass == "" {
			p, err := auth.PromptPassphrase(fmt.Sprintf("Enter passphrase for validator key '%s': ", keyName))
			if err != nil {
				fmt.Printf("Failed to read passphrase: %v\n", err)
				return
			}
			pass = p
		}
		ks, err := auth.LoadKeystore(ksPath)
		if err != nil {
			fmt.Printf("Failed to load keystore: %v\n", err)
			return
		}
		pKey, _, err := auth.DecryptKey(ks, pass)
		if err != nil {
			fmt.Printf("Failed to decrypt keystore: %v\n", err)
			return
		}
		privKey = pKey
	} else {
		// Fallback to key file if exists
		keyFile := filepath.Join(homeDir, keyName+".key.json")
		if bz, err := os.ReadFile(keyFile); err == nil {
			var kp node.KeyPair
			if err := json.Unmarshal(bz, &kp); err == nil {
				privBz, _ := hex.DecodeString(kp.PrivKeyHex)
				privKey = ed25519.PrivateKey(privBz)
			}
		}
	}

	if len(privKey) == 0 {
		fmt.Printf("Error: No validator key found for '%s' in %s\n", keyName, homeDir)
		return
	}

	var hsm privval.HSMBackend
	switch strings.ToLower(hsmType) {
	case "cloudhsm":
		hsm = privval.NewCloudHSMBackend("AWS_CloudHSM_v3", "cloudhsm.us-east-1.amazonaws.com", "cluster-sovra-prod-001", 101, privKey)
	case "yubihsm":
		hsm = privval.NewCloudHSMBackend("YubiHSM2_PKCS11", "yubihsm-connector.internal:12345", "yubi-auth-key-01", 202, privKey)
	default:
		hsm = privval.NewMemoryEnclaveHSM(privKey)
	}

	server := privval.NewSignerServer(listenAddr, hsm, stateFile)
	if err := server.Start(); err != nil {
		fmt.Printf("Error starting signer server: %v\n", err)
		return
	}
	defer server.Stop()

	pub, _ := hsm.GetPublicKey()
	addr := hex.EncodeToString(pub)

	fmt.Println("==========================================================")
	fmt.Println("  SOVRA REMOTE SIGNING DAEMON (TMKMS / CloudHSM)")
	fmt.Printf("  Listen Address:        %s\n", listenAddr)
	fmt.Printf("  HSM Engine:            %s\n", hsm.GetHSMType())
	fmt.Printf("  Validator PubKey:      %s\n", hex.EncodeToString(pub))
	fmt.Printf("  Validator Address:     %s\n", addr)
	fmt.Printf("  Double-Sign State:     %s\n", stateFile)
	fmt.Println("  Status:                ONLINE & LISTENING (Zero Key On-Disk Node)")
	fmt.Println("==========================================================")

	// Block until process is terminated
	sigCh := make(chan os.Signal, 1)
	<-sigCh
}


