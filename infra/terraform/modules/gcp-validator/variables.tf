variable "region" {
  type        = string
  default     = "us-east4"
  description = "GCP region"
}

variable "node_moniker" {
  type        = string
  default     = "sovra-validator-1-gcp"
  description = "Node identifier"
}

variable "sentry_subnet_cidr" {
  type        = string
  default     = "10.101.1.0/24"
  description = "Sentry subnet CIDR"
}

variable "validator_subnet_cidr" {
  type        = string
  default     = "10.101.10.0/24"
  description = "Private validator subnet CIDR"
}
