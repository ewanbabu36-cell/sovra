terraform {
  required_version = ">= 1.5.0"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
  }
}

# 1. Private Cloud Network
resource "hcloud_network" "sovra_net" {
  name     = "${var.node_moniker}-net"
  ip_range = "10.103.0.0/16"
}

resource "hcloud_network_subnet" "subnet" {
  network_id   = hcloud_network.sovra_net.id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = "10.103.1.0/24"
}

# 2. Firewall Rules
resource "hcloud_firewall" "sentry_fw" {
  name = "${var.node_moniker}-sentry-fw"

  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "26656"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
    description = "CometBFT P2P Gossip"
  }

  rule {
    direction = "in"
    protocol  = "udp"
    port      = "51820"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
    description = "WireGuard Inter-Cloud Mesh"
  }

  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "22"
    source_ips = [
      var.operator_admin_cidr
    ]
    description = "SSH Admin"
  }
}

# 3. Dedicated Compute Instances (CPX41: 8 vCPU, 16 GB RAM)
resource "hcloud_server" "core_validator" {
  name        = "${var.node_moniker}-core"
  server_type = "cpx41"
  image       = "ubuntu-24.04"
  location    = var.location

  network {
    network_id = hcloud_network.sovra_net.id
    ip         = "10.103.1.10"
  }
}

resource "hcloud_server" "sentry_node" {
  name         = "${var.node_moniker}-sentry"
  server_type  = "cpx41"
  image        = "ubuntu-24.04"
  location     = var.location
  firewall_ids = [hcloud_firewall.sentry_fw.id]

  network {
    network_id = hcloud_network.sovra_net.id
    ip         = "10.103.1.2"
  }
}
