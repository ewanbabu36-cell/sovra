#!/usr/bin/env bash
# ==============================================================================
# SOVRA PHASE 2 TESTNET — COMMUNITY VALIDATOR JOIN SCRIPT (Bash)
# Chain ID: sovra-testnet-0
# ==============================================================================

set -euo pipefail

MONIKER="${1:-community-validator-$RANDOM}"
HOME_DIR="${2:-$HOME/.sovrad}"
PASSPHRASE="${3:-sovra-testnet-secret}"
PRIV_VAL_LADDR="${4:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOVRAD_BIN="$SCRIPT_DIR/../sovrad"

if [ ! -f "$SOVRAD_BIN" ]; then
    SOVRAD_BIN="$(which sovrad || echo "")"
fi

if [ -z "$SOVRAD_BIN" ] || [ ! -x "$SOVRAD_BIN" ]; then
    echo "Error: Cannot locate sovrad binary. Please compile with: cd chain && go build -o sovrad ./cmd/sovrad"
    exit 1
fi

echo "=========================================================="
echo "  SOVRA PHASE 2 TESTNET: COMMUNITY VALIDATOR ONBOARDING"
echo "=========================================================="
echo "Moniker:              $MONIKER"
echo "Node Home Directory:  $HOME_DIR"
echo "Remote Signer Socket: ${PRIV_VAL_LADDR:-Disabled (Local Enclave Keystore)}"

# 1. Initialize node
echo -e "\n[1/5] Initializing node configuration..."
"$SOVRAD_BIN" init "$MONIKER" --home="$HOME_DIR" --passphrase="$PASSPHRASE"

# 2. Copy Canonical Phase 2 Genesis
GENESIS_SRC="$SCRIPT_DIR/../genesis-phase2-public.json"
GENESIS_DEST="$HOME_DIR/genesis.json"
echo "[2/5] Installing Phase 2 canonical genesis..."
cp "$GENESIS_SRC" "$GENESIS_DEST"

# 3. Configure public seed nodes
CONFIG_FILE="$HOME_DIR/config.json"
echo "[3/5] Injecting public seed nodes into $CONFIG_FILE..."
SEEDS_FILE="$SCRIPT_DIR/../seeds.txt"

SEEDS_CSV=""
if [ -f "$SEEDS_FILE" ]; then
    SEEDS_CSV=$(grep -v '^#' "$SEEDS_FILE" | grep -v '^$' | tr '\n' ',' | sed 's/,$//')
fi

if [ -z "$SEEDS_CSV" ]; then
    SEEDS_CSV="2a806ca82d506a025d580d40600abc77a69e10e7@127.0.0.1:26656"
fi

# Update config.json using python/node or sed
if command -v node >/dev/null 2>&1; then
    node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync('$CONFIG_FILE'));
    cfg.p2p.seeds = '$SEEDS_CSV'.split(',');
    cfg.p2p.pex = true;
    if ('$PRIV_VAL_LADDR') cfg.priv_val_laddr = '$PRIV_VAL_LADDR';
    fs.writeFileSync('$CONFIG_FILE', JSON.stringify(cfg, null, 2));
    "
fi

echo "[4/5] Configuration completed."
echo -e "\n[5/5] Ready to start synchronization."
echo "To run node in foreground:"
if [ -n "$PRIV_VAL_LADDR" ]; then
    echo "  $SOVRAD_BIN start --home=\"$HOME_DIR\" --priv_val_laddr=\"$PRIV_VAL_LADDR\""
else
    echo "  $SOVRAD_BIN start --home=\"$HOME_DIR\" --passphrase=\"$PASSPHRASE\""
fi

echo -e "\nTo check node sync status:"
echo "  curl -s http://127.0.0.1:26657/status | jq ."
