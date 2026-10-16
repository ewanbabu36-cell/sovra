#!/usr/bin/env bash
# ==============================================================================
# Sovra Layer-1 Testnet Bootstrapper (sovra-testnet-0)
#
# Bootstraps and connects a new node to the Sovra testnet via CometBFT
# Peer Exchange (PEX) and seed node discovery.
# ==============================================================================

set -euo pipefail

MONIKER="${1:-node4-participant}"
HOME_DIR="${2:-chain/mytestnet/node4}"
SEED_RPC="${3:-http://127.0.0.1:26657}"
P2P_PORT="${4:-26696}"
RPC_PORT="${5:-26697}"
PASSPHRASE="${6:-sovra-testnet-secret}"

echo "==========================================================="
echo "  SOVRA LAYER-1 TESTNET BOOTSTRAPPER (sovra-testnet-0)    "
echo "==========================================================="
echo "Target Moniker:   $MONIKER"
echo "Home Directory:   $HOME_DIR"
echo "Seed RPC:         $SEED_RPC"
echo "P2P Listen Port:  $P2P_PORT"
echo "RPC Listen Port:  $RPC_PORT"
echo ""

# 1. Probe Seed RPC Status
echo "[1/5] Probing seed node at $SEED_RPC..."
STATUS_JSON=$(curl -s --connect-timeout 5 "$SEED_RPC/status" || { echo "Failed to reach $SEED_RPC"; exit 1; })
CHAIN_ID=$(echo "$STATUS_JSON" | grep -o '"chain_id":"[^"]*' | cut -d'"' -f4)
SEED_HEIGHT=$(echo "$STATUS_JSON" | grep -o '"height":[0-9]*' | cut -d':' -f2)
SEED_NODE_ID=$(echo "$STATUS_JSON" | grep -o '"node_id":"[^"]*' | cut -d'"' -f4 || echo "")

echo "Connected to Seed Node: (Chain: $CHAIN_ID, Height: $SEED_HEIGHT, Node ID: $SEED_NODE_ID)"

# 2. Download Canonical Genesis State
echo "[2/5] Downloading canonical genesis.json from $SEED_RPC/genesis..."
GEN_JSON=$(curl -s --connect-timeout 5 "$SEED_RPC/genesis")

SEED_HOST=$(echo "$SEED_RPC" | awk -F[/:] '{print $4}')
if [ -z "$SEED_HOST" ]; then
  SEED_HOST="127.0.0.1"
fi

SEED_PEER_ADDR="${SEED_NODE_ID}@${SEED_HOST}:26656"
echo "Canonical Seed Peer: $SEED_PEER_ADDR"

# 3. Build daemon if necessary
SOVRAD_BIN="chain/sovrad"
if [ ! -f "$SOVRAD_BIN" ] && [ ! -f "chain/sovrad.exe" ]; then
    echo "[3/5] Building sovrad binary..."
    (cd chain && go build -o sovrad ./cmd/sovrad)
else
    echo "[3/5] Using existing sovrad binary."
    if [ -f "chain/sovrad.exe" ]; then
        SOVRAD_BIN="chain/sovrad.exe"
    fi
fi

# 4. Initialize Node Directory
echo "[4/5] Initializing node in $HOME_DIR..."
mkdir -p "$HOME_DIR"

"$SOVRAD_BIN" init "$MONIKER" --home "$HOME_DIR" --chain-id "$CHAIN_ID" \
  --p2p.pex=true --p2p.seeds "$SEED_PEER_ADDR" \
  --passphrase "$PASSPHRASE" --insecure-plaintext-keys

# Extract genesis from RPC wrapper if present
if echo "$GEN_JSON" | grep -q '"genesis"'; then
  python3 -c "import sys, json; data=json.loads(sys.stdin.read()); print(json.dumps(data.get('result', {}).get('genesis', data)))" <<< "$GEN_JSON" > "$HOME_DIR/genesis.json" 2>/dev/null || echo "$GEN_JSON" > "$HOME_DIR/genesis.json"
else
  echo "$GEN_JSON" > "$HOME_DIR/genesis.json"
fi

# Update config.json ports and seeds
if command -v python3 &>/dev/null; then
  python3 -c "
import json
with open('$HOME_DIR/config.json', 'r') as f:
    cfg = json.load(f)
cfg['rpc_port'] = int('$RPC_PORT')
cfg['rpc_laddr'] = 'tcp://0.0.0.0:$RPC_PORT'
cfg['p2p_port'] = int('$P2P_PORT')
if 'p2p' not in cfg:
    cfg['p2p'] = {}
cfg['p2p']['laddr'] = 'tcp://0.0.0.0:$P2P_PORT'
cfg['p2p']['external_address'] = '127.0.0.1:$P2P_PORT'
cfg['p2p']['pex'] = True
cfg['p2p']['seeds'] = ['$SEED_PEER_ADDR']
with open('$HOME_DIR/config.json', 'w') as f:
    json.dump(cfg, f, indent=2)
"
fi

# 5. Start Node Daemon
echo "[5/5] Starting node daemon with PEX discovery..."
"$SOVRAD_BIN" start --home "$HOME_DIR" --passphrase "$PASSPHRASE" &
NODE_PID=$!

echo "Node daemon started (PID: $NODE_PID). Fast-syncing block headers..."
for i in {1..15}; do
    sleep 1
    CUR_STATUS=$(curl -s "http://127.0.0.1:$RPC_PORT/status" 2>/dev/null || echo "")
    if [ -n "$CUR_STATUS" ]; then
        CUR_HEIGHT=$(echo "$CUR_STATUS" | grep -o '"height":[0-9]*' | cut -d':' -f2)
        echo "  -> Current Height: $CUR_HEIGHT / $SEED_HEIGHT"
        if [ "$CUR_HEIGHT" -ge "$SEED_HEIGHT" ] && [ "$CUR_HEIGHT" -gt 0 ]; then
            echo "SUCCESS! Node '$MONIKER' caught up to chain tip ($CUR_HEIGHT)."
            break
        fi
    fi
done
