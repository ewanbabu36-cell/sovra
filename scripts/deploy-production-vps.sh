#!/usr/bin/env bash
# ==============================================================================
# SOVRA PRODUCTION VPS DEPLOYMENT AUTOMATION SCRIPT
# Target OS: Ubuntu 22.04 LTS / 24.04 LTS or Debian 12 (Bookworm)
# Stack: Docker Engine + Docker Compose + Caddy TLS + Coturn STUN/TURN + SQLite WAL
# Zero-Trust Security Standard: Fail2ban, UFW locked, Non-Root Node Runtime
# ==============================================================================

set -euo pipefail

# Visual formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

log_info() {
  echo -e "${CYAN}[SOVRA-DEPLOY]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SOVRA-SUCCESS]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[SOVRA-WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[SOVRA-ERROR]${NC} $1" >&2
}

echo -e "${BOLD}${BLUE}"
echo "=================================================================="
echo "   🚀 SOVRA PLATFORM — ZERO-TRUST PRODUCTION VPS LAUNCHER        "
echo "=================================================================="
echo -e "${NC}"

# 1. Root / Sudo Check
if [ "$(id -u)" -ne 0 ]; then
  log_error "This script must be executed as root or with sudo privileges."
  exit 1
fi

# 2. Configurable Variables (with sensible production defaults)
DEPLOY_DIR="/opt/sovra"
SOVRA_DOMAIN="${SOVRA_DOMAIN:-sovra.network}"
ACME_EMAIL="${ACME_EMAIL:-admin@${SOVRA_DOMAIN}}"
ADMIN_SECRET_KEY="${ADMIN_SECRET_KEY:-$(openssl rand -hex 32)}"
SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}"
SOVRA_TURN_SECRET="${SOVRA_TURN_SECRET:-$(openssl rand -hex 32)}"
NODE_ENV="production"

log_info "Deployment Destination: ${DEPLOY_DIR}"
log_info "Target Production Domain: ${SOVRA_DOMAIN}"

# 3. Update Package Repositories and Install System Prerequisites
log_info "Updating system packages and installing baseline prerequisites..."
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  apt-transport-https \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  ufw \
  fail2ban \
  jq \
  openssl \
  git

# 4. Install Official Docker Engine and Docker Compose Plugin
if ! command -v docker &> /dev/null; then
  log_info "Installing Docker Engine from official Docker repository..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  DISTRO_CODENAME="$(lsb_release -cs)"
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    ${DISTRO_CODENAME} stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  log_success "Docker Engine $(docker --version) successfully installed."
else
  log_info "Docker Engine is already installed: $(docker --version)"
fi

# 5. Configure Hardened UFW Firewall Rules
log_info "Configuring zero-trust UFW firewall rules..."
ufw default deny incoming
ufw default allow outgoing

# Port 22: Secure Shell Administration
ufw allow 22/tcp comment 'SSH Administration'
# Port 80: HTTP (Let'\''s Encrypt ACME Challenge)
ufw allow 80/tcp comment 'HTTP ACME Challenge'
# Port 443: HTTPS (Caddy TLS Termination)
ufw allow 443/tcp comment 'HTTPS TLS Traffic'
# Port 4001: SOVRA P2P Noise_XX Protocol Mesh Switch
ufw allow 4001/tcp comment 'SOVRA P2P Noise_XX Mesh'
# Port 3478: Coturn STUN/TURN Signaling (TCP & UDP)
ufw allow 3478/tcp comment 'Coturn STUN/TURN TCP'
ufw allow 3478/udp comment 'Coturn STUN/TURN UDP'
# Port 5349: Coturn STUN/TURN Secure TLS/DTLS
ufw allow 5349/tcp comment 'Coturn STUN/TURN Secure TLS'
ufw allow 5349/udp comment 'Coturn STUN/TURN Secure DTLS'
# Ports 49152-49200: Coturn WebRTC Relay UDP Range
ufw allow 49152:49200/udp comment 'Coturn WebRTC Relay UDP'

ufw --force enable
log_success "UFW firewall enabled with strict zero-trust rules."

# 6. Configure Fail2ban for Brute-Force Protection
log_info "Configuring fail2ban jail for SSH and rate-limit defense..."
cat << 'EOF' > /etc/fail2ban/jail.local
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port = 22
logpath = %(sshd_log)s
backend = %(default_backend)s
EOF

systemctl enable --now fail2ban
systemctl restart fail2ban
log_success "Fail2ban protection active."

# 7. Prepare Production Directory Structure
log_info "Preparing application directory at ${DEPLOY_DIR}..."
mkdir -p "${DEPLOY_DIR}/docker"
mkdir -p "${DEPLOY_DIR}/storage"
chmod 700 "${DEPLOY_DIR}/storage"

# Determine repository root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Copy docker stack files
log_info "Synchronizing Docker stack templates..."
cp "${REPO_ROOT}/docker/docker-compose.production.yml" "${DEPLOY_DIR}/docker-compose.production.yml"
cp "${REPO_ROOT}/docker/turnserver.conf" "${DEPLOY_DIR}/turnserver.conf"
cp "${REPO_ROOT}/docker/Caddyfile" "${DEPLOY_DIR}/Caddyfile"
if [ -f "${REPO_ROOT}/docker/litestream.yml" ]; then
  cp "${REPO_ROOT}/docker/litestream.yml" "${DEPLOY_DIR}/litestream.yml"
fi

# 8. Render Production Environment Secrets (.env)
log_info "Generating production secrets in ${DEPLOY_DIR}/.env..."
cat << EOF > "${DEPLOY_DIR}/.env"
# SOVRA Autogenerated Production Secrets
NODE_ENV=${NODE_ENV}
SOVRA_DOMAIN=${SOVRA_DOMAIN}
ACME_EMAIL=${ACME_EMAIL}
ADMIN_SECRET_KEY=${ADMIN_SECRET_KEY}
SESSION_SECRET=${SESSION_SECRET}
SOVRA_TURN_SECRET=${SOVRA_TURN_SECRET}
SOVRA_TURN_SERVERS=turn:${SOVRA_DOMAIN}:3478?transport=udp,turn:${SOVRA_DOMAIN}:3478?transport=tcp
SOVRA_STORAGE_DIR=/app/.sovra-storage-prod
PORT=3001
SOVRA_P2P_PORT=4001
SOVRA_REQUIRE_POW=true
EOF
chmod 600 "${DEPLOY_DIR}/.env"

# 9. Build and Launch Multi-Container Production Stack
log_info "Starting Docker Compose production cluster..."
cd "${DEPLOY_DIR}"
docker compose -f docker-compose.production.yml --env-file .env down --remove-orphans || true
docker compose -f docker-compose.production.yml --env-file .env up -d --build

# 10. Health Verification & Probes
log_info "Waiting for container cluster to stabilize..."
sleep 8

MAX_RETRIES=20
COUNT=0
HEALTHY=false

while [ $COUNT -lt $MAX_RETRIES ]; do
  COUNT=$((COUNT + 1))
  log_info "Testing liveness & readiness probes (Attempt ${COUNT}/${MAX_RETRIES})..."
  
  if curl -sf http://127.0.0.1:3001/livez > /dev/null 2>&1 && curl -sf http://127.0.0.1:3001/readyz > /dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  sleep 3
done

if [ "$HEALTHY" = true ]; then
  LIVEZ_STATUS="$(curl -s http://127.0.0.1:3001/livez)"
  READYZ_STATUS="$(curl -s http://127.0.0.1:3001/readyz)"
  log_success "Node Liveness Probe: ${LIVEZ_STATUS}"
  log_success "Node Readiness Probe: ${READYZ_STATUS}"
else
  log_error "Health probes failed after ${MAX_RETRIES} attempts. Inspecting logs:"
  docker compose -f docker-compose.production.yml logs --tail=40
  exit 1
fi

echo -e "${BOLD}${GREEN}"
echo "=================================================================="
echo "   🎉 SOVRA PRODUCTION VPS DEPLOYMENT COMPLETED SUCCESSFULLY!    "
echo "=================================================================="
echo -e "${NC}"
echo "  • Primary Web Domain:     https://${SOVRA_DOMAIN}"
echo "  • P2P Mesh Gossip Port:   tcp://${SOVRA_DOMAIN}:4001"
echo "  • Coturn WebRTC STUN/TURN: turn://${SOVRA_DOMAIN}:3478"
echo "  • Storage Mount:          ${DEPLOY_DIR}/storage"
echo "  • Admin Portal:           https://${SOVRA_DOMAIN}/admin"
echo ""
echo "To monitor cluster logs:"
echo "  cd ${DEPLOY_DIR} && docker compose -f docker-compose.production.yml logs -f"
