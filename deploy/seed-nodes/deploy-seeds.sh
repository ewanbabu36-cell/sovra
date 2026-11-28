#!/usr/bin/env bash
# ============================================================
#   SOVRA BOOTSTRAP SEED NODE ONE-CLICK PROVISIONING SCRIPT
#   Target: Ubuntu 22.04 / Debian 12 VPS
#   Regions: US-East, Frankfurt (EU), Singapore (AP)
# ============================================================

set -euo pipefail

REGION="${1:-us-east}"
PUBLIC_IP="${2:-$(curl -s https://api.ipify.org || echo "127.0.0.1")}"

echo "============================================================"
echo "  Deploying Sovra Seed Node for Region: ${REGION}"
echo "  Public IP: ${PUBLIC_IP}"
echo "============================================================"

# Ensure Node.js 20+ is installed
if ! command -v node >/dev/null 2>&1; then
    echo "[*] Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# Ensure user and directories exist
id -u sovra &>/dev/null || useradd -r -s /bin/false -d /var/lib/sovra sovra
mkdir -p /var/lib/sovra/seed-data /opt/sovra
chown -R sovra:sovra /var/lib/sovra

echo "[*] Copying application files..."
rsync -a --exclude='.git' --exclude='node_modules' ./ /opt/sovra/
cd /opt/sovra
npm ci --production --ignore-scripts
npm run build --workspaces --if-present

# Configure Systemd Service
cat <<EOF > /etc/systemd/system/sovra-seed.service
[Unit]
Description=Sovra Production Bootstrap Seed Node (${REGION})
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=sovra
Group=sovra
WorkingDirectory=/opt/sovra
ExecStart=/usr/bin/node --experimental-strip-types scripts/bootstrap-node.ts
Restart=always
RestartSec=5s
Environment=NODE_ENV=production
Environment=SOVRA_P2P_HOST=0.0.0.0
Environment=SOVRA_P2P_PORT=4001
Environment=SOVRA_HTTP_PORT=8080
Environment=SOVRA_PUBLIC_IP=${PUBLIC_IP}
Environment=SOVRA_DATA_DIR=/var/lib/sovra/seed-data
Environment=SOVRA_REGION=${REGION}
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable sovra-seed
systemctl restart sovra-seed

echo "[*] Waiting for seed node startup..."
sleep 3
curl -s http://127.0.0.1:8080/health | grep -q "healthy" && echo "✅ Seed node successfully online!" || echo "⚠️ Warning: Check journalctl -u sovra-seed"
