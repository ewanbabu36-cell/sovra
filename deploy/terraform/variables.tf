variable "root_domain" {
  description = "Primary public DNS domain for Sovra platform"
  type        = string
  default     = "sovra.network"
}

variable "acme_email" {
  description = "Email address for Let's Encrypt ACME TLS certificates (Caddy & Coturn)"
  type        = string
  default     = "ops@sovra.network"
}

variable "turn_secret" {
  description = "Shared secret for RFC 5766 HMAC-SHA1 Coturn ephemeral TURN credentials (provide via TF_VAR_turn_secret)"
  type        = string
  sensitive   = true
}

variable "sovra_repo_url" {
  description = "Git repository URL containing Sovra Protocol"
  type        = string
  default     = "https://github.com/sovra-network/sovra.git"
}

variable "chain_id" {
  description = "Sovra Layer-1 CometBFT Chain ID"
  type        = string
  default     = "sovra-testnet-0"
}

variable "us_east_provider" {
  type    = string
  default = "vultr-ewr"
}

variable "eu_central_provider" {
  type    = string
  default = "hetzner-fsn1"
}

variable "ap_east_provider" {
  type    = string
  default = "digitalocean-sgp1"
}
