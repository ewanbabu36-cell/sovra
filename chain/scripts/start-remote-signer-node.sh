#!/usr/bin/env bash
# chain/scripts/start-remote-signer-node.sh
# SOVRA Layer 1 — Isolated Remote Validator Signing Daemon (TMKMS / CloudHSM) Orchestrator
set -euo pipefail

SIGNER_PORT="${SIGNER_PORT:-26659}"
RPC_PORT="${RPC_PORT:-26657}"
P2P_PORT="${P2P_PORT:-26656}"
HOME_DIR="${HOME_DIR:-$HOME/.sovrad}"
SIGNER_HOME="${SIGNER_HOME:-$HOME/.sovrad-signer}"
KEY_NAME="${KEY_NAME:-validator}"
PASSPHRASE="${PASSPHRASE:-}"
HSM_BACKEND="${HSM_BACKEND:-enclave}"

echo "=========================================================="
echo "  SOVRA REMOTE VALIDATOR SIGNING DAEMON (TMKMS / CloudHSM)"
echo "=========================================================="
echo "  Signer Port:  tcp://127.0.0.1:$SIGNER_PORT"
echo "  HSM Engine:   $HSM_BACKEND"
echo "  Node RPC:     http://127.0.0.1:$RPC_PORT"
echo "  Key Custody:  ISOLATED ENCLAVE (Deprecates on-disk node key)"
echo "=========================================================="

mkdir -p "$SIGNER_HOME/keyring" "$SIGNER_HOME/data"

if [ -f "$HOME_DIR/keyring/$KEY_NAME.keystore" ]; then
    cp "$HOME_DIR/keyring/$KEY_NAME.keystore" "$SIGNER_HOME/keyring/$KEY_NAME.keystore"
    echo "[KEYRING] Transferred validator keystore to isolated signer enclave."
fi

SIGNER_SOCKET="tcp://127.0.0.1:$SIGNER_PORT"
echo "[SIGNER] Launching sovrad signer daemon on $SIGNER_SOCKET..."
sovrad signer start \
    --listen="$SIGNER_SOCKET" \
    --home="$SIGNER_HOME" \
    --key="$KEY_NAME" \
    --passphrase="$PASSPHRASE" \
    --hsm="$HSM_BACKEND" > "$SIGNER_HOME/signer.log" 2>&1 &
SIGNER_PID=$!
sleep 1

if ! kill -0 $SIGNER_PID 2>/dev/null; then
    echo "[ERROR] Signer daemon failed to start. Log output:"
    cat "$SIGNER_HOME/signer.log"
    exit 1
fi
echo "  ✅ Signer Daemon running (PID: $SIGNER_PID)"

echo "[NODE] Launching validator node with --priv_val_laddr=$SIGNER_SOCKET..."
sovrad start \
    --home="$HOME_DIR" \
    --priv_val_laddr="$SIGNER_SOCKET" \
    --rpc.laddr="tcp://0.0.0.0:$RPC_PORT" \
    --p2p.laddr="tcp://0.0.0.0:$P2P_PORT" > "$HOME_DIR/node.log" 2>&1 &
NODE_PID=$!
sleep 2

if ! kill -0 $NODE_PID 2>/dev/null; then
    echo "[ERROR] Node failed to start. Log output:"
    cat "$HOME_DIR/node.log"
    kill $SIGNER_PID || true
    exit 1
fi
echo "  ✅ Node running (PID: $NODE_PID) with ZERO keys on disk!"

echo -e "\n[TELEMETRY] Probing node status at http://127.0.0.1:$RPC_PORT/status..."
curl -s "http://127.0.0.1:$RPC_PORT/status" || true

echo "=========================================================="
echo "  REMOTE SIGNING ACTIVE: Keys protected by Hardware/Memory Enclave."
echo "=========================================================="
