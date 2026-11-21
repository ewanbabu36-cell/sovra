# -----------------------------------------------------------------------------
# WireGuard Overlay Mesh Configuration (10.42.0.0/24 Subnet)
# Interconnects all 4 Sentries and Core Validators over ChaCha20-Poly1305 VPN
# -----------------------------------------------------------------------------

locals {
  wireguard_nodes = {
    node0 = {
      name        = "validator-0-aws"
      mesh_ip     = "10.42.0.1/24"
      sentry_ip   = "10.42.0.101/24"
      listen_port = 51820
      endpoint    = "${module.validator_0_aws.sentry_public_ip}:51820"
    }
    node1 = {
      name        = "validator-1-gcp"
      mesh_ip     = "10.42.0.2/24"
      sentry_ip   = "10.42.0.102/24"
      listen_port = 51820
      endpoint    = "${module.validator_1_gcp.sentry_public_ip}:51820"
    }
    node2 = {
      name        = "validator-2-azure"
      mesh_ip     = "10.42.0.3/24"
      sentry_ip   = "10.42.0.103/24"
      listen_port = 51820
      endpoint    = "${module.validator_2_azure.sentry_public_ip}:51820"
    }
    node3 = {
      name        = "validator-3-hetzner"
      mesh_ip     = "10.42.0.4/24"
      sentry_ip   = "10.42.0.104/24"
      listen_port = 51820
      endpoint    = "${module.validator_3_hetzner.sentry_public_ip}:51820"
    }
  }
}

# Template output for /etc/wireguard/wg0.conf on Node 0
output "wireguard_node0_config_template" {
  description = "Template WireGuard config for Node 0 Sentry"
  value       = <<-EOT
    [Interface]
    Address = 10.42.0.101/24
    ListenPort = 51820
    PrivateKey = <NODE0_SENTRY_PRIVATE_KEY>
    SaveConfig = true

    # Peer: Node 1 GCP Sentry
    [Peer]
    PublicKey = <NODE1_SENTRY_PUBLIC_KEY>
    Endpoint = ${module.validator_1_gcp.sentry_public_ip}:51820
    AllowedIPs = 10.42.0.102/32, 10.42.0.2/32
    PersistentKeepalive = 25

    # Peer: Node 2 Azure Sentry
    [Peer]
    PublicKey = <NODE2_SENTRY_PUBLIC_KEY>
    Endpoint = ${module.validator_2_azure.sentry_public_ip}:51820
    AllowedIPs = 10.42.0.103/32, 10.42.0.3/32
    PersistentKeepalive = 25

    # Peer: Node 3 Hetzner Sentry
    [Peer]
    PublicKey = <NODE3_SENTRY_PUBLIC_KEY>
    Endpoint = ${module.validator_3_hetzner.sentry_public_ip}:51820
    AllowedIPs = 10.42.0.104/32, 10.42.0.4/32
    PersistentKeepalive = 25
  EOT
}
