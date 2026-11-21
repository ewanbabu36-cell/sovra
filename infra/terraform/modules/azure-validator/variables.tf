variable "location" {
  type        = string
  default     = "eastus2"
  description = "Azure data center location"
}

variable "node_moniker" {
  type        = string
  default     = "sovra-validator-2-azure"
  description = "Node moniker"
}

variable "vnet_cidr" {
  type        = string
  default     = "10.102.0.0/16"
  description = "Virtual network address space"
}

variable "sentry_subnet_cidr" {
  type        = string
  default     = "10.102.1.0/24"
  description = "Sentry subnet prefix"
}

variable "validator_subnet_cidr" {
  type        = string
  default     = "10.102.10.0/24"
  description = "Validator subnet prefix"
}

variable "admin_ssh_public_key" {
  type        = string
  description = "SSH public key content"
}
