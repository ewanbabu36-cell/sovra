# ==============================================================================
# SOVRA MULTI-CLOUD DEPIN INFRASTRUCTURE (TERRAFORM IAC)
# Coordinates 3-Continent Seed + Coturn Cluster & 4-Validator CometBFT L1 Cluster
# Supports DigitalOcean, Hetzner Cloud, and AWS/Vultr (Cloud-Init Agnostic Blueprint)
# ==============================================================================

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.4"
    }
  }
}

locals {
  seed_regions = {
    us_east = {
      region      = "us-east"
      provider    = var.us_east_provider
      location    = "North Virginia, US"
      p2p_port    = 4001
      http_port   = 8080
      turn_domain = "turn-us-east.${var.root_domain}"
      seed_domain = "seed-us-east.${var.root_domain}"
      peer_id     = "12D3KooWJXCLpgwghVoLpDc7Ka4snWbFNq67kj6DV89uheeC3hSE"
    }
    eu_central = {
      region      = "eu-central"
      provider    = var.eu_central_provider
      location    = "Frankfurt, Germany"
      p2p_port    = 4001
      http_port   = 8080
      turn_domain = "turn-eu-central.${var.root_domain}"
      seed_domain = "seed-eu-central.${var.root_domain}"
      peer_id     = "12D3KooWC6sp1P6RikUpFEzrtMVoFBpeAbgbSCpBYqG3k1we5fbp"
    }
    ap_east = {
      region      = "ap-east"
      provider    = var.ap_east_provider
      location    = "Singapore, Asia-Pacific"
      p2p_port    = 4001
      http_port   = 8080
      turn_domain = "turn-ap-south.${var.root_domain}"
      seed_domain = "seed-ap-east.${var.root_domain}"
      peer_id     = "12D3KooWRU5jKYnrDJLGvVs7d9eCyKnFr2WnijRcovmk6gt1pPUa"
    }
  }

  validators = {
    val0 = { index = 0, name = "validator-0", cloud = "hetzner-eu", rpc_port = 26657, p2p_port = 26656 }
    val1 = { index = 1, name = "validator-1", cloud = "aws-us-east", rpc_port = 26657, p2p_port = 26656 }
    val2 = { index = 2, name = "validator-2", cloud = "do-sgp1", rpc_port = 26657, p2p_port = 26656 }
    val3 = { index = 3, name = "validator-3", cloud = "vultr-tyo", rpc_port = 26657, p2p_port = 26656 }
  }
}

# Render cloud-init provisioning scripts for each regional seed + Coturn VPS
resource "local_file" "seed_cloud_init" {
  for_each = local.seed_regions
  filename = "${path.module}/generated/cloud-init-${each.key}.sh"
  content = templatefile("${path.module}/templates/seed-cloud-init.sh.tpl", {
    region      = each.value.region
    seed_domain = each.value.seed_domain
    turn_domain = each.value.turn_domain
    root_domain = var.root_domain
    p2p_port    = each.value.p2p_port
    http_port   = each.value.http_port
    acme_email  = var.acme_email
    turn_secret = var.turn_secret
    repo_url    = var.sovra_repo_url
  })
}

# Render cloud-init provisioning scripts for each isolated BFT validator VPS
resource "local_file" "validator_cloud_init" {
  for_each = local.validators
  filename = "${path.module}/generated/cloud-init-${each.value.name}.sh"
  content = templatefile("${path.module}/templates/validator-cloud-init.sh.tpl", {
    validator_index = each.value.index
    validator_name  = each.value.name
    cloud_zone      = each.value.cloud
    chain_id        = var.chain_id
    p2p_port        = each.value.p2p_port
    rpc_port        = each.value.rpc_port
    repo_url        = var.sovra_repo_url
  })
}
