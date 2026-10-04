#!/usr/bin/env bash
# ============================================================
#   SOVRA 1-CLICK UBUNTU / DEBIAN VPS SEED NODE DEPLOYER
# ============================================================
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ewanbabu36-cell/sovra/main/scripts/deploy-vps.sh | bash
# ============================================================

set -e

echo "============================================================"
echo "   🚀 Setting up Sovra Global Bootstrap Seed Node on VPS     "
echo "============================================================"

# Detect Public IP
PUBLIC_IP=$(curl -s -4 ifconfig.me || curl -s -4 icanhazip.com || echo "127.0.0.1")
echo "[INFO] Detected Public Server IP: ${PUBLIC_IP}"

# 1. Update OS Packages
echo "[1/5] Updating OS packages..."
sudo apt-get update -y
sudo apt-get install -y curl git ufw jq

# 2. Configure Firewall (UFW)
echo "[2/5] Configuring firewall rules (SSH: 22, Sovra P2P: 4001, HTTP: 8080)..."
sudo ufw allow 22/tcp || true
sudo ufw allow 4001/tcp
sudo ufw allow 8080/tcp
sudo ufw --force enable || true

# 3. Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo "[3/5] Installing Docker Engine..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$USER"
fi

# 4. Clone or pull latest Sovra repository
INSTALL_DIR="/opt/sovra"
if [ ! -d "$INSTALL_DIR" ]; then
    echo "[4/5] Cloning Sovra repository to ${INSTALL_DIR}..."
    sudo git clone https://github.com/ewanbabu36-cell/sovra.git "$INSTALL_DIR"
    sudo chown -R "$USER:$USER" "$INSTALL_DIR"
else
    echo "[4/5] Pulling latest updates in ${INSTALL_DIR}..."
    cd "$INSTALL_DIR"
    git pull origin main
fi

# 5. Launch Seed Node Container
cd "$INSTALL_DIR"
echo "[5/5] Building and launching Sovra Bootstrap Seed Node..."
export PUBLIC_IP="${PUBLIC_IP}"
docker compose -f docker/docker-compose.seed.yml up -d --build

echo "============================================================"
echo "  ✅ SOVRA BOOTSTRAP SEED NODE IS LIVE & OPERATIONAL!       "
echo "============================================================"
echo ""
echo "  👉 Public Health Endpoint: http://${PUBLIC_IP}:8080/health"
echo "  👉 Prometheus Metrics:     http://${PUBLIC_IP}:8080/metrics"
echo "  👉 P2P Noise_XX Port:       ${PUBLIC_IP}:4001"
echo ""
echo "View logs anytime with: docker logs -f sovra-bootstrap-seed"
echo "============================================================"
