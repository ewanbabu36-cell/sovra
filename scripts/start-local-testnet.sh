#!/usr/bin/env bash
# scripts/start-local-testnet.sh
# SOVRA Layer-1 Independent Blockchain: Multi-Node Local Testnet Orchestrator
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
CHAIN_DIR="$ROOT_DIR/chain"
SOVRAD_BIN="$CHAIN_DIR/sovrad"
TESTNET_DIR="$CHAIN_DIR/mytestnet"
NUM_VALIDATORS=${1:-4}
PASSPHRASE=${2:-"sovra-testnet-secret"}

echo "=========================================================="
echo "  SOVRA INDEPENDENT LAYER 1 — LOCAL MULTI-NODE TESTNET   "
echo "=========================================================="

if [ ! -f "$SOVRAD_BIN" ]; then
  echo "[BUILD] Compiling sovrad daemon..."
  (cd "$CHAIN_DIR" && go build -o sovrad ./cmd/sovrad)
fi

echo "[PROCESS] Terminating any existing sovrad processes..."
pkill -f "$SOVRAD_BIN" 2>/dev/null || true
sleep 1

echo "[LAUNCH] Starting $NUM_VALIDATORS validator nodes..."
for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
  NODE_DIR="$TESTNET_DIR/node$i"
  RPC_PORT=$((26657 + i * 10))
  P2P_PORT=$((26656 + i * 10))
  echo "  Starting Validator-$i (RPC: $RPC_PORT, P2P: $P2P_PORT)..."
  "$SOVRAD_BIN" start --home="$NODE_DIR" --passphrase="$PASSPHRASE" > "$TESTNET_DIR/node$i.log" 2>&1 &
  sleep 0.5
done

sleep 2
echo "[HEALTH] Checking RPC ports..."
for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
  RPC_PORT=$((26657 + i * 10))
  curl -s -f "http://127.0.0.1:$RPC_PORT/status" | grep -q "height" && echo "  Node $i: ONLINE" || echo "  Node $i: OFFLINE"
done
echo "Cluster launched."
