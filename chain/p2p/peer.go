package p2p

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"sync"
	"time"
)

// Peer represents an active connection to another CometBFT node
type Peer struct {
	mu         sync.Mutex
	conn       net.Conn
	info       PeerInfo
	outbound   bool
	sendQueue  chan []byte
	stopCh     chan struct{}
	closed     bool
	handler    func(p *Peer, env Envelope, rawPayload json.RawMessage)
	disconnect func(p *Peer)
}

func newPeer(conn net.Conn, outbound bool, handler func(p *Peer, env Envelope, rawPayload json.RawMessage), disconnect func(p *Peer)) *Peer {
	return &Peer{
		conn:       conn,
		outbound:   outbound,
		sendQueue:  make(chan []byte, 128),
		stopCh:     make(chan struct{}),
		handler:    handler,
		disconnect: disconnect,
		info: PeerInfo{
			RemoteAddr: conn.RemoteAddr().String(),
			IsOutbound: outbound,
		},
	}
}

func (p *Peer) Start() {
	go p.readLoop()
	go p.writeLoop()
}

func (p *Peer) ID() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.info.ID
}

func (p *Peer) Info() PeerInfo {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.info
}

func (p *Peer) SetInfo(info PeerInfo) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.info = info
}

func (p *Peer) SetHeight(h int64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.info.Height = h
}

func (p *Peer) Send(msgType string, payload interface{}) error {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return fmt.Errorf("peer connection is closed")
	}
	p.mu.Unlock()

	raw, err := json.Marshal(map[string]interface{}{
		"type":    msgType,
		"payload": payload,
	})
	if err != nil {
		return err
	}

	raw = append(raw, '\n')

	select {
	case p.sendQueue <- raw:
		return nil
	case <-time.After(500 * time.Millisecond):
		return fmt.Errorf("peer send queue full")
	case <-p.stopCh:
		return fmt.Errorf("peer stopped")
	}
}

func (p *Peer) Close() {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	p.closed = true
	close(p.stopCh)
	_ = p.conn.Close()
	p.mu.Unlock()

	if p.disconnect != nil {
		p.disconnect(p)
	}
}

func (p *Peer) writeLoop() {
	defer p.Close()

	for {
		select {
		case <-p.stopCh:
			return
		case msg, ok := <-p.sendQueue:
			if !ok {
				return
			}
			_ = p.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if _, err := p.conn.Write(msg); err != nil {
				return
			}
		}
	}
}

func (p *Peer) readLoop() {
	defer p.Close()

	reader := bufio.NewReader(p.conn)
	for {
		select {
		case <-p.stopCh:
			return
		default:
		}

		_ = p.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		line, err := reader.ReadBytes('\n')
		if err != nil {
			return
		}

		var rawMsg struct {
			Type    string          `json:"type"`
			Payload json.RawMessage `json:"payload"`
		}
		if err := json.Unmarshal(line, &rawMsg); err != nil {
			continue
		}

		if p.handler != nil {
			p.handler(p, Envelope{Type: rawMsg.Type}, rawMsg.Payload)
		}
	}
}
