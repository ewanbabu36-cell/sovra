package privval

import (
	"bufio"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// SignerServer is a standalone daemon running the PrivValidator socket protocol
type SignerServer struct {
	listenAddr string
	listener   net.Listener
	hsm        HSMBackend
	state      *LastSignedState
	stateFile  string
	mu         sync.Mutex
	stopCh     chan struct{}
	stopped    bool
}

func NewSignerServer(listenAddr string, hsm HSMBackend, stateFile string) *SignerServer {
	return &SignerServer{
		listenAddr: listenAddr,
		hsm:        hsm,
		state:      NewLastSignedState(),
		stateFile:  stateFile,
		stopCh:     make(chan struct{}),
	}
}

func (s *SignerServer) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Load persisted high-water mark state if available
	if s.stateFile != "" {
		if bz, err := os.ReadFile(s.stateFile); err == nil {
			var persisted LastSignedState
			if err := json.Unmarshal(bz, &persisted); err == nil {
				s.state.Height = persisted.Height
				s.state.Round = persisted.Round
				s.state.Step = persisted.Step
				s.state.BlockHash = persisted.BlockHash
			}
		}
	}

	network := "tcp"
	addr := s.listenAddr
	if strings.HasPrefix(addr, "unix://") {
		network = "unix"
		addr = strings.TrimPrefix(addr, "unix://")
		_ = os.Remove(addr)
	} else if strings.HasPrefix(addr, "tcp://") {
		addr = strings.TrimPrefix(addr, "tcp://")
	}

	listener, err := net.Listen(network, addr)
	if err != nil {
		return fmt.Errorf("failed to bind privval socket on %s: %w", s.listenAddr, err)
	}
	s.listener = listener

	go s.acceptLoop()
	return nil
}

func (s *SignerServer) Addr() net.Addr {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.listener != nil {
		return s.listener.Addr()
	}
	return nil
}

func (s *SignerServer) Stop() error {
	s.mu.Lock()
	if s.stopped {
		s.mu.Unlock()
		return nil
	}
	s.stopped = true
	close(s.stopCh)
	if s.listener != nil {
		_ = s.listener.Close()
	}
	s.mu.Unlock()

	s.persistState()
	return s.hsm.Close()
}

func (s *SignerServer) acceptLoop() {
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			select {
			case <-s.stopCh:
				return
			default:
				continue
			}
		}
		go s.handleConnection(conn)
	}
}

func (s *SignerServer) handleConnection(conn net.Conn) {
	defer conn.Close()
	reader := bufio.NewReader(conn)

	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			return
		}

		var req SocketRequest
		if err := json.Unmarshal(line, &req); err != nil {
			s.sendResponse(conn, SocketResponse{Success: false, Error: "invalid request payload: " + err.Error()})
			continue
		}

		resp := s.processRequest(req)
		s.sendResponse(conn, resp)
	}
}

func (s *SignerServer) processRequest(req SocketRequest) SocketResponse {
	switch req.Type {
	case "ping":
		return SocketResponse{Success: true, HSMType: s.hsm.GetHSMType()}

	case "pubkey":
		pub, err := s.hsm.GetPublicKey()
		if err != nil {
			return SocketResponse{Success: false, Error: err.Error()}
		}
		return SocketResponse{
			Success:   true,
			PubKeyHex: hex.EncodeToString(pub),
			HSMType:   s.hsm.GetHSMType(),
		}

	case "sign_vote":
		if req.Vote == nil {
			return SocketResponse{Success: false, Error: "vote payload missing"}
		}
		// Enforce high-water mark double-signing protection
		if err := s.state.CheckAndSign(req.Vote.Height, req.Vote.Round, req.Vote.Type, req.Vote.BlockHash); err != nil {
			return SocketResponse{Success: false, Error: err.Error()}
		}
		s.persistState()

		canonicalBytes := FormatCanonicalVoteBytes(req.ChainID, req.Vote)
		sig, err := s.hsm.Sign(canonicalBytes)
		if err != nil {
			return SocketResponse{Success: false, Error: err.Error()}
		}
		return SocketResponse{
			Success: true,
			SigHex:  hex.EncodeToString(sig),
			HSMType: s.hsm.GetHSMType(),
		}

	case "sign_proposal":
		if req.Proposal == nil {
			return SocketResponse{Success: false, Error: "proposal payload missing"}
		}
		// Enforce high-water mark double-signing protection
		if err := s.state.CheckAndSign(req.Proposal.Height, req.Proposal.Round, StepPropose, req.Proposal.BlockHash); err != nil {
			return SocketResponse{Success: false, Error: err.Error()}
		}
		s.persistState()

		canonicalBytes := FormatCanonicalProposalBytes(req.ChainID, req.Proposal)
		sig, err := s.hsm.Sign(canonicalBytes)
		if err != nil {
			return SocketResponse{Success: false, Error: err.Error()}
		}
		return SocketResponse{
			Success: true,
			SigHex:  hex.EncodeToString(sig),
			HSMType: s.hsm.GetHSMType(),
		}

	case "sign_bytes":
		data, err := hex.DecodeString(req.DataHex)
		if err != nil {
			return SocketResponse{Success: false, Error: "invalid hex data: " + err.Error()}
		}
		sig, err := s.hsm.Sign(data)
		if err != nil {
			return SocketResponse{Success: false, Error: err.Error()}
		}
		return SocketResponse{
			Success: true,
			SigHex:  hex.EncodeToString(sig),
			HSMType: s.hsm.GetHSMType(),
		}

	default:
		return SocketResponse{Success: false, Error: fmt.Sprintf("unsupported request type '%s'", req.Type)}
	}
}

func (s *SignerServer) sendResponse(conn net.Conn, resp SocketResponse) {
	bz, _ := json.Marshal(resp)
	bz = append(bz, '\n')
	_, _ = conn.Write(bz)
}

func (s *SignerServer) persistState() {
	if s.stateFile == "" {
		return
	}
	s.state.mu.Lock()
	bz, err := json.MarshalIndent(s.state, "", "  ")
	s.state.mu.Unlock()
	if err == nil {
		_ = os.MkdirAll(filepath.Dir(s.stateFile), 0755)
		_ = os.WriteFile(s.stateFile, bz, 0600)
	}
}
