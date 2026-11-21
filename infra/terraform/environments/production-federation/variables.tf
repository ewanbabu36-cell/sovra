variable "aws_region" {
  type        = string
  default     = "eu-central-1"
  description = "AWS region for Node 0"
}

variable "aws_key_pair_name" {
  type        = string
  default     = "sovra-operator-aws"
  description = "AWS key pair name"
}

variable "gcp_project_id" {
  type        = string
  default     = "sovra-production-net"
  description = "GCP project ID for Node 1"
}

variable "gcp_region" {
  type        = string
  default     = "us-east4"
  description = "GCP region for Node 1"
}

variable "azure_location" {
  type        = string
  default     = "eastus2"
  description = "Azure data center location for Node 2"
}

variable "ssh_public_key" {
  type        = string
  default     = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK+SOVRA_OPERATOR_ADMIN_KEY_PHASE9 sovra-admin"
  description = "SSH public key for instance access"
}

variable "hcloud_token" {
  type        = string
  sensitive   = true
  default     = "hcloud_secret_token_placeholder"
  description = "Hetzner Cloud API token"
}

variable "operator_admin_cidr" {
  type        = string
  default     = "0.0.0.0/0"
  description = "Whitelisted IP CIDR for SSH access"
}
