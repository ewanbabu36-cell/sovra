# SOVRA PHASE 7 — DEPLOYMENT & DISASTER RECOVERY RUNBOOK
**Document Reference:** `SOVRA_PHASE7_DEPLOYMENT_AND_RECOVERY_RUNBOOK.md`  
**Phase:** Phase 7 — Real Multi-Cloud Independent Validator Federation & Governance Audit  
**Canonical Specification:** `SOVRA_INDUSTRY_STANDARD_MASTER_GOAL_AND_ACCEPTANCE.md`  
**Date:** November 21, 2026  
**Auditor:** Principal DevSecOps Engineer & Site Reliability Architect  

---

## 1. PURPOSE & OPERATIONAL SCOPE

This runbook provides independent infrastructure operators with complete, copy-pasteable instructions, configuration templates, systemd service units, WireGuard mesh configs, and emergency recovery procedures to deploy and operate a secure, Byzantine fault-tolerant SOVRA validator node.

---

## 2. HARDWARE & OPERATING SYSTEM REQUIREMENTS

Each validator and sentry node must be provisioned on dedicated cloud virtual machines or bare-metal instances:

| Component | Minimum Specification | Recommended Specification |
| :--- | :--- | :--- |
| **Operating System** | Ubuntu 24.04 LTS / Debian 12 / Rocky Linux 9 | Ubuntu 24.04 LTS (HWE Kernel) |
| **CPU Architecture** | 4 vCPU (x86_64 or ARM64) | 8 vCPU (High Single-Core Frequency) |
| **System Memory (RAM)** | 16 GB DDR4/DDR5 ECC | 32 GB DDR5 ECC |
| **Storage (Disk)** | 500 GB NVMe SSD (IOPS $\ge 3,000$) | 1 TB NVMe SSD (PCIe Gen4, IOPS $\ge 10,000$) |
| **Network Interface** | 1 Gbps NIC, Static Public IP (Sentry only) | 10 Gbps Redundant Uplink |

---

## 3. NETWORK TOPOLOGY & FIREWALL MATRIX

```mermaid
flowchart LR
    subgraph Sentry["Sentry Node (Public DMZ)"]
        P2PPublic[Public P2P Port: 26656]
        RPCPublic[Public RPC Port: 26657]
        WGSentry[WireGuard Interface: wg0 (10.100.1.1)]
    end

    subgraph Validator["Core Validator (Private Subnet)"]
        WGVal[WireGuard Interface: wg0 (10.100.1.10)]
        P2PPrivate[Private P2P Port: 26656]
        PrivValKey[(priv_validator_key.json)]
    end

    Internet((Public Internet)) -->|Port 26656| P2PPublic
    Internet -->|Port 26657 (Rate-Limited)| RPCPublic
    P2PPublic <-->|Encrypted WireGuard| P2PPrivate
    Validator -.->|Zero Public Ingress| Internet
```

### 3.1 Firewall Rules (UFW / iptables)
**On Public Sentry Node:**
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH restricted to admin IP'
sudo ufw allow 26656/tcp comment 'CometBFT P2P Peer Gossip'
sudo ufw allow 26657/tcp comment 'CometBFT RPC (Rate-limited via NGINX)'
sudo ufw allow 51820/udp comment 'WireGuard VPN Mesh'
sudo ufw enable
```

**On Core Validator Node (Private VPC):**
```bash
sudo ufw default deny incoming
sudo ufw default deny outgoing
sudo ufw allow out on wg0 comment 'Allow WireGuard Mesh Traffic'
sudo ufw allow in on wg0 to any port 26656 proto tcp comment 'CometBFT P2P via Sentry only'
sudo ufw enable
```

---

## 4. STEP-BY-STEP VALIDATOR DEPLOYMENT GUIDE

### Step 1: Install Dependencies & Binary
```bash
# Update OS and install build tools
sudo apt update && sudo apt install -y git build-essential wireguard ufw curl jq

# Install SOVRA node daemon
git clone https://github.com/ewanbabu36-cell/sovra.git /opt/sovra
cd /opt/sovra
# Build Go daemon sovrad
cd chain && go build -o /usr/local/bin/sovrad ./cmd/sovrad
sovrad version
```

### Step 2: Initialize Node Home Directory
```bash
export SOVRA_HOME=/var/lib/sovra
sudo mkdir -p $SOVRA_HOME
sudo chown -R sovra:sovra $SOVRA_HOME

# Initialize node configuration
sovrad init "validator-operator-alpha" --chain-id=sovra-testnet-0 --home=$SOVRA_HOME
```

### Step 3: Fetch Canonical Genesis File
```bash
curl -sSL https://raw.githubusercontent.com/ewanbabu36-cell/sovra/main/chain/mytestnet/node0/config/genesis.json \
  -o $SOVRA_HOME/config/genesis.json

# Verify genesis checksum
sha256sum $SOVRA_HOME/config/genesis.json
```

### Step 4: Configure `config.toml` for Sentry Architecture
Edit `$SOVRA_HOME/config/config.toml`:
```toml
# In config.toml on CORE VALIDATOR:
[p2p]
laddr = "tcp://10.100.1.10:26656"
pex = false
addr_book_strict = false
persistent_peers = "NODE_ID_SENTRY@10.100.1.1:26656"

[consensus]
create_empty_blocks = true
create_empty_blocks_interval = "1s"

[rpc]
laddr = "tcp://127.0.0.1:26657"
```

### Step 5: Create Systemd Service Unit
Create `/etc/systemd/system/sovrad.service`:
```ini
[Unit]
Description=SOVRA Layer-1 Validator Node
After=network.target wireguard.service

[Service]
Type=simple
User=sovra
Group=sovra
WorkingDirectory=/var/lib/sovra
ExecStart=/usr/local/bin/sovrad start --home=/var/lib/sovra --passphrase=YOUR_NODE_PASSPHRASE
Restart=always
RestartSec=5
LimitNOFILE=65535
MemoryLimit=16G

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sovrad.service
sudo journalctl -u sovrad.service -f
```

---

## 5. EMERGENCY DISASTER RECOVERY & ROLLBACK RUNBOOK

### Scenario: Validator Node Host Corruption
1. **Stop Failing Service:**
   ```bash
   sudo systemctl stop sovrad.service
   ```
2. **Restore Application & Consensus State from Backup:**
   ```bash
   # Extract latest verified backup snapshot
   sudo tar -xzf /backups/sovra_backup_latest.tar.gz -C /var/lib/sovra/data
   ```
3. **Verify SQLite Database Integrity:**
   ```bash
   sqlite3 /var/lib/sovra/data/sovra-social.sqlite "PRAGMA integrity_check;"
   # Output must be: ok
   ```
4. **Restart Daemon & Catch-Up via FastSync:**
   ```bash
   sudo systemctl start sovrad.service
   # Confirm block catch-up:
   curl -s http://127.0.0.1:26657/status | jq '.result.sync_info'
   ```
   Verify that `catching_up: false` once state reaches tip.
