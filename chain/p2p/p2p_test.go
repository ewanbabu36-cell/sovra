package p2p

import (
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"net"
	"testing"
	"time"
)

func getFreePort() (int, error) {
	addr, err := net.ResolveTCPAddr("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	l, err := net.ListenTCP("tcp", addr)
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func TestNodeIDDerivation(t *testing.T) {
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}

	nodeID := ComputeNodeID(pub)
	if len(nodeID) != 40 {
		t.Fatalf("expected 40-character hex string, got %d chars: %s", len(nodeID), nodeID)
	}

	// Deterministic check
	nodeID2 := ComputeNodeID(pub)
	if nodeID != nodeID2 {
		t.Fatalf("NodeID derivation not deterministic: %s != %s", nodeID, nodeID2)
	}
}

func TestParsePeerAddress(t *testing.T) {
	raw := "1739c2ea6279a63885377f17631a391432bad8c8@127.0.0.1:26656"
	addr, err := ParsePeerAddress(raw)
	if err != nil {
		t.Fatalf("unexpected error parsing peer address: %v", err)
	}

	if addr.ID != "1739c2ea6279a63885377f17631a391432bad8c8" {
		t.Fatalf("unexpected node id: %s", addr.ID)
	}
	if addr.Host != "127.0.0.1" {
		t.Fatalf("unexpected host: %s", addr.Host)
	}
	if addr.Port != 26656 {
		t.Fatalf("unexpected port: %d", addr.Port)
	}
	if addr.String() != raw {
		t.Fatalf("expected '%s', got '%s'", raw, addr.String())
	}

	// With tcp:// prefix
	addr2, err := ParsePeerAddress("tcp://" + raw)
	if err != nil || addr2.String() != raw {
		t.Fatalf("failed to parse with tcp:// prefix: %v", err)
	}

	// Invalid cases
	if _, err := ParsePeerAddress("invalid"); err == nil {
		t.Fatalf("expected error for invalid address")
	}
	if _, err := ParsePeerAddress("nodeid@host"); err == nil {
		t.Fatalf("expected error for missing port")
	}
}

func TestP2PHandshakeAndPEX(t *testing.T) {
	portA, err := getFreePort()
	if err != nil {
		t.Fatal(err)
	}
	portB, err := getFreePort()
	if err != nil {
		t.Fatal(err)
	}

	pubA, _, _ := ed25519.GenerateKey(rand.Reader)
	nodeIDA := ComputeNodeID(pubA)

	pubB, _, _ := ed25519.GenerateKey(rand.Reader)
	nodeIDB := ComputeNodeID(pubB)

	cfgA := P2PConfig{
		ListenAddr:   fmt.Sprintf("tcp://127.0.0.1:%d", portA),
		ExternalAddr: fmt.Sprintf("127.0.0.1:%d", portA),
		PEX:          true,
	}
	cfgB := P2PConfig{
		ListenAddr:   fmt.Sprintf("tcp://127.0.0.1:%d", portB),
		ExternalAddr: fmt.Sprintf("127.0.0.1:%d", portB),
		PEX:          true,
		Seeds:        []string{fmt.Sprintf("%s@127.0.0.1:%d", nodeIDA, portA)},
	}

	var heightA int64 = 5
	var heightB int64 = 0

	swA := NewSwitch(cfgA, nodeIDA, "node-a", "sovra-testnet-0", portA, SwitchCallbacks{
		GetLocalHeight: func() int64 { return heightA },
		GetBlocks: func(from, to int64) []BlockData {
			blocks := make([]BlockData, 0)
			for h := from; h <= to; h++ {
				blocks = append(blocks, BlockData{
					Height:   h,
					Time:     time.Now().Unix(),
					AppHash:  fmt.Sprintf("apphash-%d", h),
					Proposer: "node-a",
				})
			}
			return blocks
		},
	})

	appliedBlocks := make([]BlockData, 0)
	swB := NewSwitch(cfgB, nodeIDB, "node-b", "sovra-testnet-0", portB, SwitchCallbacks{
		GetLocalHeight: func() int64 { return heightB },
		ApplyBlock: func(b BlockData) error {
			appliedBlocks = append(appliedBlocks, b)
			heightB = b.Height
			return nil
		},
	})

	if err := swA.Start(); err != nil {
		t.Fatalf("failed to start swA: %v", err)
	}
	defer swA.Stop()

	if err := swB.Start(); err != nil {
		t.Fatalf("failed to start swB: %v", err)
	}
	defer swB.Stop()

	// Wait for connection and fast-sync
	var connected bool
	for i := 0; i < 40; i++ {
		time.Sleep(100 * time.Millisecond)
		peersA := swA.GetPeers()
		peersB := swB.GetPeers()
		if len(peersA) > 0 && len(peersB) > 0 {
			connected = true
			break
		}
	}

	if !connected {
		t.Fatalf("expected nodes to connect over P2P, got A peers=%d, B peers=%d",
			len(swA.GetPeers()), len(swB.GetPeers()))
	}

	// Verify NetInfo telemetry
	netInfoA := swA.GetNetInfo()
	if netInfoA["n_peers"].(int) != 1 {
		t.Fatalf("expected 1 peer in netInfo, got %v", netInfoA["n_peers"])
	}

	// Wait for fast-sync of blocks 1..5
	var synced bool
	for i := 0; i < 40; i++ {
		time.Sleep(100 * time.Millisecond)
		if heightB == 5 && len(appliedBlocks) == 5 {
			synced = true
			break
		}
	}

	if !synced {
		t.Fatalf("expected node B to fast-sync to height 5, got heightB=%d (blocks applied: %d)",
			heightB, len(appliedBlocks))
	}

	// Verify Block Broadcast
	newBlock := BlockData{
		Height:   6,
		Time:     time.Now().Unix(),
		AppHash:  "apphash-6",
		Proposer: "node-a",
	}
	swA.BroadcastNewBlock(newBlock)

	time.Sleep(200 * time.Millisecond)
	if heightB != 6 {
		t.Fatalf("expected node B to receive live broadcast block 6, got heightB=%d", heightB)
	}
}

func TestThreeNodePEXDiscovery(t *testing.T) {
	port0, _ := getFreePort()
	port1, _ := getFreePort()
	port4, _ := getFreePort()

	pub0, _, _ := ed25519.GenerateKey(rand.Reader)
	nodeID0 := ComputeNodeID(pub0)

	pub1, _, _ := ed25519.GenerateKey(rand.Reader)
	nodeID1 := ComputeNodeID(pub1)

	pub4, _, _ := ed25519.GenerateKey(rand.Reader)
	nodeID4 := ComputeNodeID(pub4)

	// Node 0: Seed node
	cfg0 := P2PConfig{
		ListenAddr:   fmt.Sprintf("tcp://127.0.0.1:%d", port0),
		ExternalAddr: fmt.Sprintf("127.0.0.1:%d", port0),
		PEX:          true,
	}

	// Node 1: Connected to Node 0
	cfg1 := P2PConfig{
		ListenAddr:   fmt.Sprintf("tcp://127.0.0.1:%d", port1),
		ExternalAddr: fmt.Sprintf("127.0.0.1:%d", port1),
		PEX:          true,
		Seeds:        []string{fmt.Sprintf("%s@127.0.0.1:%d", nodeID0, port0)},
	}

	// Node 4: Dynamic joiner with ONLY Node 0 in seed list
	cfg4 := P2PConfig{
		ListenAddr:   fmt.Sprintf("tcp://127.0.0.1:%d", port4),
		ExternalAddr: fmt.Sprintf("127.0.0.1:%d", port4),
		PEX:          true,
		Seeds:        []string{fmt.Sprintf("%s@127.0.0.1:%d", nodeID0, port0)},
	}

	sw0 := NewSwitch(cfg0, nodeID0, "validator-0", "sovra-testnet-0", port0, SwitchCallbacks{})
	sw1 := NewSwitch(cfg1, nodeID1, "validator-1", "sovra-testnet-0", port1, SwitchCallbacks{})
	sw4 := NewSwitch(cfg4, nodeID4, "validator-4", "sovra-testnet-0", port4, SwitchCallbacks{})

	_ = sw0.Start()
	defer sw0.Stop()
	_ = sw1.Start()
	defer sw1.Stop()

	// Wait for Node 1 to connect to Node 0
	for i := 0; i < 30; i++ {
		time.Sleep(100 * time.Millisecond)
		if len(sw0.GetPeers()) > 0 && len(sw1.GetPeers()) > 0 {
			break
		}
	}

	// Start Node 4
	_ = sw4.Start()
	defer sw4.Stop()

	// Wait for Node 4 to discover Node 1 via PEX through Node 0
	var pexSuccess bool
	for i := 0; i < 50; i++ {
		time.Sleep(100 * time.Millisecond)
		peers4 := sw4.GetPeers()
		// Node 4 should now have 2 connected peers: Node 0 AND Node 1
		if len(peers4) >= 2 {
			pexSuccess = true
			break
		}
	}

	if !pexSuccess {
		t.Fatalf("PEX discovery failed: Node 4 expected 2 peers (Node 0 and Node 1), got %d: %+v",
			len(sw4.GetPeers()), sw4.GetPeers())
	}
}
