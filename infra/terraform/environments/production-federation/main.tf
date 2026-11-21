terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
  }
}

# -----------------------------------------------------------------------------
# Provider Configurations for 4 Independent Cloud Operators
# -----------------------------------------------------------------------------
provider "aws" {
  region = var.aws_region
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

provider "azurerm" {
  features {}
}

provider "hcloud" {
  token = var.hcloud_token
}

# -----------------------------------------------------------------------------
# Node 0: AWS eu-central-1 (Frankfurt) - Operated by Foundation Custodian
# -----------------------------------------------------------------------------
module "validator_0_aws" {
  source              = "../../modules/aws-validator"
  node_moniker        = "sovra-validator-0-aws"
  availability_zone   = "${var.aws_region}a"
  key_pair_name       = var.aws_key_pair_name
  operator_admin_cidr = var.operator_admin_cidr
}

# -----------------------------------------------------------------------------
# Node 1: GCP us-east4 (Virginia) - Operated by Independent Operator Alpha
# -----------------------------------------------------------------------------
module "validator_1_gcp" {
  source       = "../../modules/gcp-validator"
  region       = var.gcp_region
  node_moniker = "sovra-validator-1-gcp"
}

# -----------------------------------------------------------------------------
# Node 2: Azure eastus2 (Virginia) - Operated by Independent Operator Beta
# -----------------------------------------------------------------------------
module "validator_2_azure" {
  source               = "../../modules/azure-validator"
  location             = var.azure_location
  node_moniker         = "sovra-validator-2-azure"
  admin_ssh_public_key = var.ssh_public_key
}

# -----------------------------------------------------------------------------
# Node 3: Hetzner Cloud fsn1 (Falkenstein) - Operated by Community Council
# -----------------------------------------------------------------------------
module "validator_3_hetzner" {
  source              = "../../modules/hetzner-validator"
  location            = "fsn1"
  node_moniker        = "sovra-validator-3-hetzner"
  operator_admin_cidr = var.operator_admin_cidr
}
