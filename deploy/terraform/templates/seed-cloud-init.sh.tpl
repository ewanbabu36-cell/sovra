#!/usr/bin/env bash
# Cloud-Init Bootstrapping Script for Sovra Regional Seed + Coturn TURNS Node (${region})
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ufw certbot docker.io docker-compose-v2 jq coturn

# Configure UFW firewall for Noise_XX P2P, HTTP health, HTTPS/TURNS & WebRTC media ports
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow ${p2p_port}/tcp
ufw allow ${http_port}/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow 5349/udp
ufw allow 49152:49200/udp
echo "y" | ufw enable || true

PUBLIC_IP="$(curl -s https://api.ipify.org || echo "127.0.0.1")"
mkdir -p /opt/sovra
if [ ! -d /opt/sovra/.git ]; then
  git clone "${repo_url}" /opt/sovra || true
fi

# Provision Let's Encrypt TLS Certificate for Coturn TURNS (port 5349)
if [ "${root_domain}" != "localhost" ]; then
  certbot certonly --standalone --non-interactive --agree-tos \
    -m "${acme_email}" -d "${turn_domain}" -d "${seed_domain}" || true
  mkdir -p /etc/coturn/certs
  if [ -f "/etc/letsencrypt/live/${turn_domain}/fullchain.pem" ]; then
    cp -L "/etc/letsencrypt/live/${turn_domain}/fullchain.pem" /etc/coturn/certs/fullchain.pem
    cp -L "/etc/letsencrypt/live/${turn_domain}/privkey.pem" /etc/coturn/certs/privkey.pem
  fi
fi

# Install Sovra Seed Node systemd service
if [ -f /opt/sovra/deploy/seed-nodes/deploy-seeds.sh ]; then
  cd /opt/sovra && bash deploy/seed-nodes/deploy-seeds.sh "${region}" "$PUBLIC_IP"
fi
