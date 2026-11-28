#!/usr/bin/env bash
# ==============================================================================
# Certbot Let's Encrypt Renewal Deploy Hook for Sovra Coturn TURNS (Port 5349)
# Place in /etc/letsencrypt/renewal-hooks/deploy/sovra-coturn-renew.sh
# ==============================================================================

set -euo pipefail

TURN_DOMAIN="${SOVRA_TURN_DOMAIN:-turn.sovra.network}"
CERT_SRC="/etc/letsencrypt/live/${TURN_DOMAIN}"
COTURN_CERT_DIR="${SOVRA_COTURN_CERT_DIR:-/etc/coturn/certs}"

if [ ! -f "${CERT_SRC}/fullchain.pem" ] || [ ! -f "${CERT_SRC}/privkey.pem" ]; then
  echo "[Coturn Hook] Certificate directory not found at ${CERT_SRC}; skipping."
  exit 0
fi

mkdir -p "${COTURN_CERT_DIR}"
cp -L "${CERT_SRC}/fullchain.pem" "${COTURN_CERT_DIR}/fullchain.pem"
cp -L "${CERT_SRC}/privkey.pem" "${COTURN_CERT_DIR}/privkey.pem"
chmod 644 "${COTURN_CERT_DIR}/fullchain.pem"
chmod 600 "${COTURN_CERT_DIR}/privkey.pem"

if command -v docker >/dev/null 2>&1 && docker ps -q -f name=sovra-coturn-relay | grep -q .; then
  docker restart sovra-coturn-relay
  echo "[Coturn Hook] Reloaded Docker container sovra-coturn-relay with renewed TLS cert."
elif systemctl is-active --quiet coturn; then
  systemctl reload-or-restart coturn
  echo "[Coturn Hook] Reloaded systemd coturn service."
fi
