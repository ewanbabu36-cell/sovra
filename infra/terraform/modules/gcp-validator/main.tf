terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

# 1. Custom VPC Network
resource "google_compute_network" "sovra_vpc" {
  name                    = "${var.node_moniker}-vpc"
  auto_create_subnetworks = false
}

# 2. Subnets: Sentry & Private Core Validator
resource "google_compute_subnetwork" "sentry_subnet" {
  name          = "${var.node_moniker}-sentry-subnet"
  ip_cidr_range = var.sentry_subnet_cidr
  region        = var.region
  network       = google_compute_network.sovra_vpc.id
}

resource "google_compute_subnetwork" "validator_subnet" {
  name          = "${var.node_moniker}-val-subnet"
  ip_cidr_range = var.validator_subnet_cidr
  region        = var.region
  network       = google_compute_network.sovra_vpc.id
}

# 3. Firewall Rules
resource "google_compute_firewall" "allow_p2p" {
  name    = "${var.node_moniker}-allow-p2p"
  network = google_compute_network.sovra_vpc.name

  allow {
    protocol = "tcp"
    ports    = ["26656"]
  }

  allow {
    protocol = "udp"
    ports    = ["51820"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["sentry-node"]
}

resource "google_compute_firewall" "allow_internal_validator" {
  name    = "${var.node_moniker}-allow-internal-val"
  network = google_compute_network.sovra_vpc.name

  allow {
    protocol = "tcp"
    ports    = ["26656", "22"]
  }

  allow {
    protocol = "udp"
    ports    = ["51820"]
  }

  source_tags = ["sentry-node"]
  target_tags = ["core-validator"]
}

# 4. Sentry Node Public IP
resource "google_compute_address" "sentry_static_ip" {
  name   = "${var.node_moniker}-sentry-ip"
  region = var.region
}

# 5. Core Validator Instance (e2-standard-4)
resource "google_compute_instance" "core_validator" {
  name         = "${var.node_moniker}-core"
  machine_type = "e2-standard-4"
  zone         = "${var.region}-b"
  tags         = ["core-validator"]

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
      size  = 200
      type  = "pd-ssd"
    }
  }

  network_interface {
    network    = google_compute_network.sovra_vpc.id
    subnetwork = google_compute_subnetwork.validator_subnet.id
    # No external access config (isolated)
  }

  metadata_startup_script = <<-EOF
    #!/bin/bash
    apt-get update && apt-get install -y wireguard ufw curl jq
  EOF
}

# 6. Sentry Node Instance
resource "google_compute_instance" "sentry_node" {
  name         = "${var.node_moniker}-sentry"
  machine_type = "e2-standard-4"
  zone         = "${var.region}-b"
  tags         = ["sentry-node"]

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
      size  = 250
      type  = "pd-ssd"
    }
  }

  network_interface {
    network    = google_compute_network.sovra_vpc.id
    subnetwork = google_compute_subnetwork.sentry_subnet.id
    access_config {
      nat_ip = google_compute_address.sentry_static_ip.address
    }
  }
}
