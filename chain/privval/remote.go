package privval

import (
	"bufio"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"
)

// RemotePrivValidator connects to a remote signing daemon (TMKMS / PrivVal daemon)
type RemotePrivValidator struct {
	mu         sync.Mutex
	socketAddr string
	conn       net.Conn
	reader     *bufio.Reader
	pubKey     ed25519.PublicKey
	hsmType    string
}

func NewRemotePrivValidator(socketAddr string) (*RemotePrivValidator, error) {
	rpv := &RemotePrivValidator{
		socketAddr: socketAddr,
	}

	if err := rpv.reconnect(); err != nil {
		return nil, fmt.Errorf("failed to connect to remote privval at %s: %w", socketAddr, err)
	}

	// Fetch public key from remote signer
	resp, err := rpv.sendRequest(SocketRequest{Type: "pubkey"})
	if err != nil {
		rpv.Close()
		return nil, fmt.Errorf("failed to retrieve pubkey from remote signer: %w", err)
	}
	if !resp.Success {
		rpv.Close()
		return nil, fmt.Errorf("remote signer pubkey error: %s", resp.Error)
	}

	pubBz, err := hex.DecodeString(resp.PubKeyHex)
	if err != nil {
		rpv.Close()
		return nil, fmt.Errorf("invalid pubkey hex received: %w", err)
	}

	rpv.pubKey = ed25519.PublicKey(pubBz)
	rpv.hsmType = resp.HSMType
	return rpv, nil
}

func (r *RemotePrivValidator) reconnect() error {
	if r.conn != nil {
		_ = r.conn.Close()
	}

	network := "tcp"
	addr := r.socketAddr
	if strings.HasPrefix(addr, "unix://") {
		network = "unix"
		addr = strings.TrimPrefix(addr, "unix://")
	} else if strings.HasPrefix(addr, "tcp://") {
		addr = strings.TrimPrefix(addr, "tcp://")
	}

	conn, err := net.DialTimeout(network, addr, 5*time.Second)
	if err != nil {
		return err
	}
	r.conn = conn
	r.reader = bufio.NewReader(conn)
	return nil
}

func (r *RemotePrivValidator) sendRequest(req SocketRequest) (*SocketResponse, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	reqBz, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	reqBz = append(reqBz, '\n')

	// Attempt write, reconnect if connection dropped
	if r.conn == nil {
		if err := r.reconnect(); err != nil {
			return nil, err
		}
	}

	if _, err := r.conn.Write(reqBz); err != nil {
		// Reconnect and retry once
		if err := r.reconnect(); err != nil {
			return nil, fmt.Errorf("reconnection failed: %w", err)
		}
		if _, err := r.conn.Write(reqBz); err != nil {
			return nil, fmt.Errorf("write to remote signer failed: %w", err)
		}
	}

	respLine, err := r.reader.ReadBytes('\n')
	if err != nil {
		return nil, fmt.Errorf("read from remote signer failed: %w", err)
	}

	var resp SocketResponse
	if err := json.Unmarshal(respLine, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse signer response: %w", err)
	}

	return &resp, nil
}

func (r *RemotePrivValidator) GetPubKey() (ed25519.PublicKey, error) {
	if len(r.pubKey) == 0 {
		return nil, fmt.Errorf("public key not loaded")
	}
	return r.pubKey, nil
}

func (r *RemotePrivValidator) GetAddress() string {
	return hex.EncodeToString(r.pubKey)
}

func (r *RemotePrivValidator) GetHSMType() string {
	return r.hsmType
}

func (r *RemotePrivValidator) SignVote(chainID string, vote *Vote) ([]byte, error) {
	resp, err := r.sendRequest(SocketRequest{
		Type:    "sign_vote",
		ChainID: chainID,
		Vote:    vote,
	})
	if err != nil {
		return nil, err
	}
	if !resp.Success {
		return nil, fmt.Errorf("remote signer rejected vote: %s", resp.Error)
	}

	sig, err := hex.DecodeString(resp.SigHex)
	if err != nil {
		return nil, fmt.Errorf("invalid signature hex from remote signer: %w", err)
	}
	vote.SignatureHex = resp.SigHex
	return sig, nil
}

func (r *RemotePrivValidator) SignProposal(chainID string, proposal *Proposal) ([]byte, error) {
	resp, err := r.sendRequest(SocketRequest{
		Type:     "sign_proposal",
		ChainID:  chainID,
		Proposal: proposal,
	})
	if err != nil {
		return nil, err
	}
	if !resp.Success {
		return nil, fmt.Errorf("remote signer rejected proposal: %s", resp.Error)
	}

	sig, err := hex.DecodeString(resp.SigHex)
	if err != nil {
		return nil, fmt.Errorf("invalid signature hex from remote signer: %w", err)
	}
	proposal.SignatureHex = resp.SigHex
	return sig, nil
}

func (r *RemotePrivValidator) SignBytes(chainID string, data []byte) ([]byte, error) {
	resp, err := r.sendRequest(SocketRequest{
		Type:    "sign_bytes",
		ChainID: chainID,
		DataHex: hex.EncodeToString(data),
	})
	if err != nil {
		return nil, err
	}
	if !resp.Success {
		return nil, fmt.Errorf("remote signer rejected signing request: %s", resp.Error)
	}
	return hex.DecodeString(resp.SigHex)
}

func (r *RemotePrivValidator) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.conn != nil {
		err := r.conn.Close()
		r.conn = nil
		return err
	}
	return nil
}
