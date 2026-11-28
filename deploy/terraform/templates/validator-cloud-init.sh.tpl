#!/usr/bin/env bash
# Cloud-Init Bootstrapping Script for Sovra Multi-Operator Layer-1 CometBFT Validator (${validator_name})
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ufw jq golang-go

ufw allow 22/tcp
ufw allow ${p2p_port}/tcp comment 'CometBFT P2P Consensus Mesh'
ufw allow from 127.0.0.1 to any port ${rpc_port} comment 'Restrict Validator RPC to Local/Sentry'
ufw allow from 10.0.0.0/8 to any port 26660 comment 'Restrict Prometheus Metrics to Internal Monitoring VPC'
echo "y" | ufw enable || true

mkdir -p /opt/sovra /var/lib/sovra-chain/validator /etc/sovra
if [ ! -d /opt/sovra/.git ]; then
  git clone "${repo_url}" /opt/sovra || true
fi

if [ -d /opt/sovra/chain ]; then
  cd /opt/sovra/chain
  go build -o /usr/local/bin/sovrad ./cmd/sovrad
fi

# External KMS / HSM Signer hook (set SOVRA_KMS_LADDR=tcp://127.0.0.1:26658 in KMS-enabled operators)
if [ ! -f /etc/sovra/validator.env ]; then
  cat <<ENVEOF > /etc/sovra/validator.env
SOVRA_OPERATOR_NAME=${validator_name}
SOVRA_CLOUD_ZONE=${cloud_zone}
SOVRA_KMS_LADDR=
SOVRA_PERSISTENT_PEERS=
ENVEOF
  chmod 0600 /etc/sovra/validator.env
fi

cat <<EOF > /etc/systemd/system/sovra-validator.service
[Unit]
Description=Sovra Layer-1 Validator (${validator_name} - ${cloud_zone})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/var/lib/sovra-chain/validator
EnvironmentFile=/etc/sovra/validator.env
ExecStart=/usr/local/bin/sovrad start --home /var/lib/sovra-chain/validator
Restart=always
RestartSec=3s
LimitNOFILE=65535
NoNewPrivileges=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable sovra-validator
systemctl restart sovra-validator
