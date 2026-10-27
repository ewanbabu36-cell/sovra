#!/usr/bin/env bash
# ==============================================================================
# SOVRA TURNKEY VPS & BARE-METAL PRODUCTION INSTALLER
# Supported OS: Debian 12+ / Ubuntu 22.04 LTS / Ubuntu 24.04 LTS
#
# Idempotently provisions:
# 1. System prerequisites, UFW firewall ports (3001, 3443, 4001, 80, 443).
# 2. Node.js LTS (v22/v24), pnpm, and Docker Engine.
# 3. Dedicated non-root 'sovra' system user and directory structure.
# 4. Production Systemd service unit (deploy/sovra-node.service).
# 5. Local TLS certificates and Docker Compose stack configuration.
# ==============================================================================

set -euo pipefail

# Elevate to root if executed as normal user
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo ">>> Elevating to root privileges..."
  exec sudo bash "$0" "$@"
fi

echo "============================================================"
echo "⚡ Starting Sovra Sovereign Node Turnkey Installation"
echo "============================================================"

INSTALL_DIR="${SOVRA_DIR:-/opt/sovra}"
SOVRA_USER="${SOVRA_USER:-sovra}"
NODE_MAJOR=22

# 1. Update package manager & install core utilities
echo ">>> [1/6] Updating package cache and installing dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  git \
  ufw \
  jq \
  openssl \
  build-essential

# 2. Configure UFW Firewall Ports
echo ">>> [2/6] Configuring production firewall ports..."
ufw allow 22/tcp comment 'SSH' || true
ufw allow 80/tcp comment 'HTTP Let'\''s Encrypt' || true
ufw allow 443/tcp comment 'HTTPS Caddy TLS' || true
ufw allow 3001/tcp comment 'Sovra HTTP Microservice' || true
ufw allow 3443/tcp comment 'Sovra WebRTC HTTPS Calling' || true
ufw allow 4001/tcp comment 'Sovra Noise_XX P2P Mesh' || true
if ! ufw status | grep -q "Status: active"; then
  echo "y" | ufw enable || true
fi

# 3. Install Node.js LTS & pnpm if not present
echo ">>> [3/6] Verifying Node.js & pnpm runtime..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 20 ]; then
  echo ">>> Installing Node.js ${NODE_MAJOR}.x LTS..."
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo ">>> Installing pnpm..."
  npm install -g pnpm@latest
fi

# 4. Install Docker Engine & Compose plugin if not present
echo ">>> [4/6] Verifying Docker Engine..."
if ! command -v docker >/dev/null 2>&1; then
  echo ">>> Installing Docker CE & Compose..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

# 5. Provision non-root 'sovra' system user and directories
echo ">>> [5/6] Provisioning system user '${SOVRA_USER}' and file structure..."
if ! id -u "${SOVRA_USER}" >/dev/null 2>&1; then
  useradd -r -m -s /bin/bash "${SOVRA_USER}" || true
fi
usermod -aG docker "${SOVRA_USER}" || true

mkdir -p "${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}/.sovra-storage-prod"
mkdir -p "${INSTALL_DIR}/certs"

# Generate local self-signed TLS certificates for development/fallback if not present
if [ ! -f "${INSTALL_DIR}/certs/server.crt" ]; then
  echo ">>> Generating fallback TLS certificates for port 3443..."
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "${INSTALL_DIR}/certs/server.key" \
    -out "${INSTALL_DIR}/certs/server.crt" \
    -subj "/C=US/ST=Sovereign/L=Decentralized/O=Sovra/CN=localhost" \
    >/dev/null 2>&1 || true
fi

# 6. Install and configure systemd service unit
echo ">>> [6/6] Installing systemd service unit..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/sovra-node.service" ]; then
  cp "${SCRIPT_DIR}/sovra-node.service" /etc/systemd/system/sovra-node.service
  systemctl daemon-reload
  systemctl enable sovra-node.service || true
fi

chown -R "${SOVRA_USER}:${SOVRA_USER}" "${INSTALL_DIR}" || true

echo "============================================================"
echo "✅ Sovra Node VPS Installation Succeeded!"
echo "   - Node Directory:       ${INSTALL_DIR}"
echo "   - P2P Noise Mesh Port:  4001"
echo "   - HTTP Service Port:    3001"
echo "   - WebRTC Calling Port:  3443"
echo "   - Reverse Proxy Ports:  80, 443"
echo "   - Systemd Service:      systemctl start sovra-node"
echo "   - Docker Stack:         cd ${SCRIPT_DIR} && docker compose -f docker-compose.prod.yml up -d"
echo "============================================================"
