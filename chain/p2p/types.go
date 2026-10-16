package p2p

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"strconv"
	"strings"

	"github.com/sovra/chain/node"
)

// ComputeNodeID derives the canonical 20-byte CometBFT Node ID from an Ed25519 public key
func ComputeNodeID(pubKey ed25519.PublicKey) string {
	hash := sha256.Sum256(pubKey)
	return strings.ToLower(hex.EncodeToString(hash[:20]))
}

// PeerAddress represents a parsed CometBFT peer address string: <node_id>@<host>:<port>
type PeerAddress struct {
	ID   string `json:"id"`
	Host string `json:"host"`
	Port int    `json:"port"`
}

func (p PeerAddress) String() string {
	return fmt.Sprintf("%s@%s:%d", p.ID, p.Host, p.Port)
}

func (p PeerAddress) DialAddr() string {
	return fmt.Sprintf("%s:%d", p.Host, p.Port)
}

// ParsePeerAddress parses "<node_id>@<host>:<port>" or "tcp://<node_id>@<host>:<port>"
func ParsePeerAddress(raw string) (*PeerAddress, error) {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "tcp://")

	parts := strings.Split(raw, "@")
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid peer address '%s': expected format <node_id>@<host>:<port>", raw)
	}

	nodeID := strings.TrimSpace(parts[0])
	hostPort := strings.TrimSpace(parts[1])

	host, portStr, err := net.SplitHostPort(hostPort)
	if err != nil {
		return nil, fmt.Errorf("invalid host:port in peer address '%s': %w", raw, err)
	}

	port, err := strconv.Atoi(portStr)
	if err != nil || port <= 0 || port > 65535 {
		return nil, fmt.Errorf("invalid port in peer address '%s': %s", raw, portStr)
	}

	if host == "" || host == "0.0.0.0" {
		host = "127.0.0.1"
	}

	return &PeerAddress{
		ID:   nodeID,
		Host: host,
		Port: port,
	}, nil
}

// P2PConfig defines peer-to-peer networking options
type P2PConfig struct {
	ListenAddr      string   `json:"laddr"`            // e.g. "tcp://0.0.0.0:26656"
	ExternalAddr    string   `json:"external_address"` // e.g. "127.0.0.1:26656"
	PEX             bool     `json:"pex"`              // peer exchange enabled
	Seeds           []string `json:"seeds"`            // seed node addresses: ["<node_id>@<ip>:<port>"]
	PersistentPeers []string `json:"persistent_peers"` // persistent peers to dial
	MaxPeers        int      `json:"max_peers"`        // max active connections
}

func DefaultP2PConfig(port int) P2PConfig {
	return P2PConfig{
		ListenAddr:      fmt.Sprintf("tcp://0.0.0.0:%d", port),
		ExternalAddr:    fmt.Sprintf("127.0.0.1:%d", port),
		PEX:             true,
		Seeds:           []string{},
		PersistentPeers: []string{},
		MaxPeers:        50,
	}
}

// Message types
const (
	MsgTypeHandshake    = "handshake"
	MsgTypeHandshakeAck = "handshake_ack"
	MsgTypePEXRequest   = "pex_req"
	MsgTypePEXResponse  = "pex_resp"
	MsgTypeBlockRequest = "block_req"
	MsgTypeBlockResponse = "block_resp"
	MsgTypeNewBlock     = "new_block"
	MsgTypeTx           = "tx"
)

// Envelope wraps all wire-protocol P2P messages
type Envelope struct {
	Type    string          `json:"type"`
	Payload interface{}     `json:"payload,omitempty"`
}

type HandshakePayload struct {
	NodeID     string `json:"node_id"`
	Moniker    string `json:"moniker"`
	ChainID    string `json:"chain_id"`
	ListenAddr string `json:"listen_addr"`
	Height     int64  `json:"height"`
}

type PEXResponsePayload struct {
	Peers []string `json:"peers"`
}

type BlockRequestPayload struct {
	FromHeight int64 `json:"from_height"`
	ToHeight   int64 `json:"to_height"`
}

type BlockData struct {
	Height    int64                    `json:"height"`
	Time      int64                    `json:"time"`
	AppHash   string                   `json:"app_hash"`
	Proposer  string                   `json:"proposer"`
	TxCount   int                      `json:"tx_count"`
	Txs       []node.SignedTransaction `json:"txs,omitempty"`
}

type BlockResponsePayload struct {
	Blocks []BlockData `json:"blocks"`
}

type NewBlockPayload struct {
	Block BlockData `json:"block"`
}

type TxPayload struct {
	Tx node.SignedTransaction `json:"tx"`
}

// PeerInfo holds telemetry about an active connected peer
type PeerInfo struct {
	ID         string `json:"id"`
	Moniker    string `json:"moniker"`
	RemoteAddr string `json:"remote_addr"`
	ListenAddr string `json:"listen_addr"`
	Height     int64  `json:"height"`
	IsOutbound bool   `json:"is_outbound"`
}
