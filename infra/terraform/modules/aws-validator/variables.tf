variable "environment" {
  type        = string
  default     = "production"
  description = "Target deployment environment"
}

variable "node_moniker" {
  type        = string
  default     = "sovra-validator-0-aws"
  description = "Human-readable node moniker"
}

variable "vpc_cidr" {
  type        = string
  default     = "10.100.0.0/16"
  description = "VPC CIDR block"
}

variable "public_subnet_cidr" {
  type        = string
  default     = "10.100.1.0/24"
  description = "Public sentry subnet CIDR"
}

variable "private_subnet_cidr" {
  type        = string
  default     = "10.100.10.0/24"
  description = "Private validator subnet CIDR"
}

variable "availability_zone" {
  type        = string
  default     = "eu-central-1a"
  description = "AWS availability zone"
}

variable "ami_id" {
  type        = string
  default     = "ami-0faab6bdbac9486fb" # Ubuntu 24.04 LTS eu-central-1
  description = "Operating system image ID"
}

variable "instance_type" {
  type        = string
  default     = "c6i.xlarge"
  description = "EC2 instance type for validator core"
}

variable "key_pair_name" {
  type        = string
  description = "SSH Key pair name for instance administration"
}

variable "operator_admin_cidr" {
  type        = string
  default     = "0.0.0.0/0"
  description = "Operator IP CIDR allowed for administrative SSH"
}
