package p2p

import (
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/sovra/chain/node"
)

// SwitchCallbacks defines application hooks for state sync and tx relay
type SwitchCallbacks struct {
	GetLocalHeight func() int64
	GetAppHash     func() []byte
	GetBlocks      func(from, to int64) []BlockData
	ApplyBlock     func(b BlockData) error
	OnReceiveTx    func(tx node.SignedTransaction) error
}

// Switch coordinates CometBFT P2P connections, PEX discovery, and fast-sync
type Switch struct {
	mu           sync.RWMutex
	cfg          P2PConfig
	nodeID       string
	moniker      string
	chainID      string
	p2pPort      int
	listener     net.Listener
	peers        map[string]*Peer        // nodeID -> active peer
	peerBook     map[string]*PeerAddress // nodeID -> known address
	stopCh       chan struct{}
	running      bool
	callbacks    SwitchCallbacks
	syncLock     sync.Mutex
	isFastSyncing bool
}

func NewSwitch(cfg P2PConfig, nodeID, moniker, chainID string, p2pPort int, callbacks SwitchCallbacks) *Switch {
	sw := &Switch{
		cfg:       cfg,
		nodeID:    nodeID,
		moniker:   moniker,
		chainID:   chainID,
		p2pPort:   p2pPort,
		peers:     make(map[string]*Peer),
		peerBook:  make(map[string]*PeerAddress),
		stopCh:    make(chan struct{}),
		callbacks: callbacks,
	}

	// Register seeds into peerBook
	for _, seedStr := range cfg.Seeds {
		if addr, err := ParsePeerAddress(seedStr); err == nil && addr.ID != nodeID {
			sw.peerBook[addr.ID] = addr
		}
	}

	// Register persistent peers into peerBook
	for _, peerStr := range cfg.PersistentPeers {
		if addr, err := ParsePeerAddress(peerStr); err == nil && addr.ID != nodeID {
			sw.peerBook[addr.ID] = addr
		}
	}

	return sw
}

func (sw *Switch) Start() error {
	sw.mu.Lock()
	defer sw.mu.Unlock()

	if sw.running {
		return nil
	}

	listenAddr := sw.cfg.ListenAddr
	listenAddr = strings.TrimPrefix(listenAddr, "tcp://")
	if !strings.Contains(listenAddr, ":") {
		listenAddr = fmt.Sprintf("0.0.0.0:%s", listenAddr)
	}

	l, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return fmt.Errorf("failed to listen on P2P address %s: %w", listenAddr, err)
	}
	sw.listener = l
	sw.running = true

	// Accept incoming connections
	go sw.acceptLoop()

	// Dial seed nodes & persistent peers
	go sw.dialSeedsLoop()

	// Peer exchange discovery loop
	if sw.cfg.PEX {
		go sw.pexLoop()
	}

	return nil
}

func (sw *Switch) Stop() {
	sw.mu.Lock()
	if !sw.running {
		sw.mu.Unlock()
		return
	}
	sw.running = false
	close(sw.stopCh)
	if sw.listener != nil {
		_ = sw.listener.Close()
	}

	peersToClose := make([]*Peer, 0, len(sw.peers))
	for _, p := range sw.peers {
		peersToClose = append(peersToClose, p)
	}
	sw.peers = make(map[string]*Peer)
	sw.mu.Unlock()

	for _, p := range peersToClose {
		p.Close()
	}
}

func (sw *Switch) NodeID() string {
	return sw.nodeID
}

func (sw *Switch) P2PPort() int {
	return sw.p2pPort
}

func (sw *Switch) ExternalAddress() string {
	if sw.cfg.ExternalAddr != "" {
		return fmt.Sprintf("%s@%s", sw.nodeID, sw.cfg.ExternalAddr)
	}
	return fmt.Sprintf("%s@127.0.0.1:%d", sw.nodeID, sw.p2pPort)
}

func (sw *Switch) acceptLoop() {
	for {
		conn, err := sw.listener.Accept()
		if err != nil {
			select {
			case <-sw.stopCh:
				return
			default:
				time.Sleep(100 * time.Millisecond)
				continue
			}
		}

		p := newPeer(conn, false, sw.handleMessage, sw.onPeerDisconnect)
		p.Start()

		// Send initial handshake
		localHeight := int64(0)
		if sw.callbacks.GetLocalHeight != nil {
			localHeight = sw.callbacks.GetLocalHeight()
		}

		_ = p.Send(MsgTypeHandshake, HandshakePayload{
			NodeID:     sw.nodeID,
			Moniker:    sw.moniker,
			ChainID:    sw.chainID,
			ListenAddr: sw.ExternalAddress(),
			Height:     localHeight,
		})
	}
}

func (sw *Switch) dialSeedsLoop() {
	// Immediate dial on startup
	sw.dialKnownPeers()

	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-sw.stopCh:
			return
		case <-ticker.C:
			sw.dialKnownPeers()
		}
	}
}

func (sw *Switch) dialKnownPeers() {
	sw.mu.RLock()
	known := make([]*PeerAddress, 0, len(sw.peerBook))
	for _, addr := range sw.peerBook {
		if addr.ID != sw.nodeID && sw.peers[addr.ID] == nil {
			known = append(known, addr)
		}
	}
	sw.mu.RUnlock()

	for _, addr := range known {
		go sw.DialPeer(addr)
	}
}

func (sw *Switch) DialPeer(addr *PeerAddress) {
	sw.mu.RLock()
	if sw.peers[addr.ID] != nil || addr.ID == sw.nodeID {
		sw.mu.RUnlock()
		return
	}
	sw.mu.RUnlock()

	dialTarget := addr.DialAddr()
	conn, err := net.DialTimeout("tcp", dialTarget, 3*time.Second)
	if err != nil {
		return
	}

	p := newPeer(conn, true, sw.handleMessage, sw.onPeerDisconnect)
	p.SetInfo(PeerInfo{
		ID:         addr.ID,
		ListenAddr: addr.String(),
		RemoteAddr: conn.RemoteAddr().String(),
		IsOutbound: true,
	})
	p.Start()

	// Send handshake
	localHeight := int64(0)
	if sw.callbacks.GetLocalHeight != nil {
		localHeight = sw.callbacks.GetLocalHeight()
	}

	_ = p.Send(MsgTypeHandshake, HandshakePayload{
		NodeID:     sw.nodeID,
		Moniker:    sw.moniker,
		ChainID:    sw.chainID,
		ListenAddr: sw.ExternalAddress(),
		Height:     localHeight,
	})
}

func (sw *Switch) onPeerDisconnect(p *Peer) {
	sw.mu.Lock()
	defer sw.mu.Unlock()
	if p.ID() != "" {
		delete(sw.peers, p.ID())
	}
}

func (sw *Switch) pexLoop() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-sw.stopCh:
			return
		case <-ticker.C:
			sw.BroadcastPEXRequest()
		}
	}
}

func (sw *Switch) BroadcastPEXRequest() {
	sw.mu.RLock()
	defer sw.mu.RUnlock()

	for _, p := range sw.peers {
		_ = p.Send(MsgTypePEXRequest, map[string]interface{}{})
	}
}

func (sw *Switch) handleMessage(p *Peer, env Envelope, rawPayload json.RawMessage) {
	switch env.Type {
	case MsgTypeHandshake:
		var hs HandshakePayload
		if err := json.Unmarshal(rawPayload, &hs); err != nil {
			return
		}

		if hs.ChainID != sw.chainID {
			p.Close()
			return
		}

		if hs.NodeID == sw.nodeID {
			p.Close()
			return
		}

		p.SetInfo(PeerInfo{
			ID:         hs.NodeID,
			Moniker:    hs.Moniker,
			ListenAddr: hs.ListenAddr,
			RemoteAddr: p.conn.RemoteAddr().String(),
			Height:     hs.Height,
			IsOutbound: p.outbound,
		})

		sw.mu.Lock()
		sw.peers[hs.NodeID] = p
		if hs.ListenAddr != "" {
			if addr, err := ParsePeerAddress(hs.ListenAddr); err == nil && addr.ID != sw.nodeID {
				sw.peerBook[addr.ID] = addr
			}
		}
		sw.mu.Unlock()

		// Acknowledge handshake
		localHeight := int64(0)
		if sw.callbacks.GetLocalHeight != nil {
			localHeight = sw.callbacks.GetLocalHeight()
		}

		_ = p.Send(MsgTypeHandshakeAck, HandshakePayload{
			NodeID:     sw.nodeID,
			Moniker:    sw.moniker,
			ChainID:    sw.chainID,
			ListenAddr: sw.ExternalAddress(),
			Height:     localHeight,
		})

		// Trigger PEX exchange if enabled
		if sw.cfg.PEX {
			_ = p.Send(MsgTypePEXRequest, map[string]interface{}{})
		}

		// Check if we need to fast-sync blocks from this peer
		if hs.Height > localHeight {
			go sw.syncBlocksFromPeer(p, localHeight+1, hs.Height)
		}

	case MsgTypeHandshakeAck:
		var hs HandshakePayload
		if err := json.Unmarshal(rawPayload, &hs); err != nil {
			return
		}

		p.SetInfo(PeerInfo{
			ID:         hs.NodeID,
			Moniker:    hs.Moniker,
			ListenAddr: hs.ListenAddr,
			RemoteAddr: p.conn.RemoteAddr().String(),
			Height:     hs.Height,
			IsOutbound: p.outbound,
		})

		sw.mu.Lock()
		sw.peers[hs.NodeID] = p
		if hs.ListenAddr != "" {
			if addr, err := ParsePeerAddress(hs.ListenAddr); err == nil && addr.ID != sw.nodeID {
				sw.peerBook[addr.ID] = addr
			}
		}
		sw.mu.Unlock()

		localHeight := int64(0)
		if sw.callbacks.GetLocalHeight != nil {
			localHeight = sw.callbacks.GetLocalHeight()
		}

		if sw.cfg.PEX {
			_ = p.Send(MsgTypePEXRequest, map[string]interface{}{})
		}

		if hs.Height > localHeight {
			go sw.syncBlocksFromPeer(p, localHeight+1, hs.Height)
		}

	case MsgTypePEXRequest:
		// Return our known peers list
		sw.mu.RLock()
		peerList := make([]string, 0, len(sw.peerBook)+1)
		peerList = append(peerList, sw.ExternalAddress())
		for _, addr := range sw.peerBook {
			if addr.ID != sw.nodeID && addr.ID != p.ID() {
				peerList = append(peerList, addr.String())
			}
		}
		sw.mu.RUnlock()

		_ = p.Send(MsgTypePEXResponse, PEXResponsePayload{Peers: peerList})

	case MsgTypePEXResponse:
		var resp PEXResponsePayload
		if err := json.Unmarshal(rawPayload, &resp); err != nil {
			return
		}

		// Ingest discovered peers into peerBook
		newPeers := make([]*PeerAddress, 0)
		sw.mu.Lock()
		for _, peerStr := range resp.Peers {
			addr, err := ParsePeerAddress(peerStr)
			if err != nil || addr.ID == sw.nodeID {
				continue
			}
			if _, exists := sw.peerBook[addr.ID]; !exists {
				sw.peerBook[addr.ID] = addr
				newPeers = append(newPeers, addr)
			}
		}
		sw.mu.Unlock()

		// Dial newly discovered peers
		for _, addr := range newPeers {
			go sw.DialPeer(addr)
		}

	case MsgTypeBlockRequest:
		var req BlockRequestPayload
		if err := json.Unmarshal(rawPayload, &req); err != nil {
			return
		}

		if sw.callbacks.GetBlocks != nil {
			blocks := sw.callbacks.GetBlocks(req.FromHeight, req.ToHeight)
			_ = p.Send(MsgTypeBlockResponse, BlockResponsePayload{Blocks: blocks})
		}

	case MsgTypeBlockResponse:
		var resp BlockResponsePayload
		if err := json.Unmarshal(rawPayload, &resp); err != nil {
			return
		}

		if sw.callbacks.ApplyBlock != nil {
			for _, b := range resp.Blocks {
				if err := sw.callbacks.ApplyBlock(b); err != nil {
					break
				}
				p.SetHeight(b.Height)
			}
		}

	case MsgTypeNewBlock:
		var nb NewBlockPayload
		if err := json.Unmarshal(rawPayload, &nb); err != nil {
			return
		}

		p.SetHeight(nb.Block.Height)
		if sw.callbacks.ApplyBlock != nil {
			_ = sw.callbacks.ApplyBlock(nb.Block)
		}

	case MsgTypeTx:
		var txPayload TxPayload
		if err := json.Unmarshal(rawPayload, &txPayload); err != nil {
			return
		}

		if sw.callbacks.OnReceiveTx != nil {
			_ = sw.callbacks.OnReceiveTx(txPayload.Tx)
		}
	}
}

func (sw *Switch) syncBlocksFromPeer(p *Peer, from, to int64) {
	sw.syncLock.Lock()
	if sw.isFastSyncing {
		sw.syncLock.Unlock()
		return
	}
	sw.isFastSyncing = true
	sw.syncLock.Unlock()

	defer func() {
		sw.syncLock.Lock()
		sw.isFastSyncing = false
		sw.syncLock.Unlock()
	}()

	current := from
	for current <= to {
		batchEnd := current + 49
		if batchEnd > to {
			batchEnd = to
		}

		_ = p.Send(MsgTypeBlockRequest, BlockRequestPayload{
			FromHeight: current,
			ToHeight:   batchEnd,
		})

		time.Sleep(200 * time.Millisecond)
		current = batchEnd + 1
	}
}

func (sw *Switch) BroadcastNewBlock(b BlockData) {
	sw.mu.RLock()
	defer sw.mu.RUnlock()

	for _, p := range sw.peers {
		_ = p.Send(MsgTypeNewBlock, NewBlockPayload{Block: b})
	}
}

func (sw *Switch) BroadcastTx(tx node.SignedTransaction) {
	sw.mu.RLock()
	defer sw.mu.RUnlock()

	for _, p := range sw.peers {
		_ = p.Send(MsgTypeTx, TxPayload{Tx: tx})
	}
}

func (sw *Switch) GetPeers() []PeerInfo {
	sw.mu.RLock()
	defer sw.mu.RUnlock()

	result := make([]PeerInfo, 0, len(sw.peers))
	for _, p := range sw.peers {
		result = append(result, p.Info())
	}
	return result
}

func (sw *Switch) GetNetInfo() map[string]interface{} {
	sw.mu.RLock()
	defer sw.mu.RUnlock()

	peers := make([]map[string]interface{}, 0, len(sw.peers))
	for _, p := range sw.peers {
		info := p.Info()
		peers = append(peers, map[string]interface{}{
			"node_info": map[string]interface{}{
				"id":          info.ID,
				"moniker":     info.Moniker,
				"listen_addr": info.ListenAddr,
			},
			"is_outbound": info.IsOutbound,
			"remote_ip":   info.RemoteAddr,
			"height":      info.Height,
		})
	}

	listenAddr := sw.cfg.ListenAddr
	return map[string]interface{}{
		"listening": sw.running,
		"listeners": []string{listenAddr},
		"n_peers":   len(sw.peers),
		"peers":     peers,
	}
}

func (sw *Switch) GetPeerBook() []string {
	sw.mu.RLock()
	defer sw.mu.RUnlock()

	res := make([]string, 0, len(sw.peerBook))
	for _, addr := range sw.peerBook {
		res = append(res, addr.String())
	}
	return res
}
