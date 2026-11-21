variable "location" {
  type        = string
  default     = "fsn1"
  description = "Hetzner data center location (Falkenstein)"
}

variable "node_moniker" {
  type        = string
  default     = "sovra-validator-3-hetzner"
  description = "Node moniker"
}

variable "operator_admin_cidr" {
  type        = string
  default     = "0.0.0.0/0"
  description = "Admin IP CIDR"
}
