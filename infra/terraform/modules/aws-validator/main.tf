terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# 1. Isolated Virtual Private Cloud (VPC)
resource "aws_vpc" "sovra_vpc" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name        = "${var.node_moniker}-vpc"
    Environment = var.environment
    ManagedBy   = "Terraform"
    Project     = "SOVRA"
  }
}

# 2. Subnets: Public DMZ for Sentry and Private Subnet for Core Validator
resource "aws_subnet" "public_sentry" {
  vpc_id                  = aws_vpc.sovra_vpc.id
  cidr_block              = var.public_subnet_cidr
  map_public_ip_on_launch = true
  availability_zone       = var.availability_zone

  tags = {
    Name = "${var.node_moniker}-public-sentry-subnet"
  }
}

resource "aws_subnet" "private_validator" {
  vpc_id            = aws_vpc.sovra_vpc.id
  cidr_block        = var.private_subnet_cidr
  availability_zone = var.availability_zone

  tags = {
    Name = "${var.node_moniker}-private-validator-subnet"
  }
}

# 3. Internet Gateway for Public Sentry
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.sovra_vpc.id

  tags = {
    Name = "${var.node_moniker}-igw"
  }
}

resource "aws_route_table" "public_rt" {
  vpc_id = aws_vpc.sovra_vpc.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }

  tags = {
    Name = "${var.node_moniker}-public-rt"
  }
}

resource "aws_route_table_association" "public_assoc" {
  subnet_id      = aws_subnet.public_sentry.id
  route_table_id = aws_route_table.public_rt.id
}

# 4. Security Groups: Strict Zero-Trust Firewalling
resource "aws_security_group" "sentry_sg" {
  name        = "${var.node_moniker}-sentry-sg"
  description = "Allows P2P gossip, WireGuard VPN, and rate-limited RPC on Sentry Node"
  vpc_id      = aws_vpc.sovra_vpc.id

  # P2P CometBFT Gossip (26656)
  ingress {
    description = "CometBFT P2P Network"
    from_port   = 26656
    to_port     = 26656
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # WireGuard VPN Mesh (51820 UDP)
  ingress {
    description = "WireGuard Inter-Cloud Mesh"
    from_port   = 51820
    to_port     = 51820
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Administrative SSH restricted to Operator CIDR
  ingress {
    description = "SSH Admin Access"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.operator_admin_cidr]
  }

  # Outbound egress
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.node_moniker}-sentry-sg"
  }
}

resource "aws_security_group" "core_validator_sg" {
  name        = "${var.node_moniker}-core-sg"
  description = "Completely private security group for core validator signing machine"
  vpc_id      = aws_vpc.sovra_vpc.id

  # Ingress ONLY from Sentry Subnet over WireGuard / Local Subnet
  ingress {
    description     = "P2P Gossip from Sentry only"
    from_port       = 26656
    to_port         = 26656
    protocol        = "tcp"
    security_groups = [aws_security_group.sentry_sg.id]
  }

  ingress {
    description     = "WireGuard Mesh from Sentry"
    from_port       = 51820
    to_port         = 51820
    protocol        = "udp"
    security_groups = [aws_security_group.sentry_sg.id]
  }

  # Inbound SSH from Sentry bastion only
  ingress {
    description     = "SSH via Bastion"
    from_port       = 22
    to_port         = 22
    protocol        = "tcp"
    security_groups = [aws_security_group.sentry_sg.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.node_moniker}-core-validator-sg"
  }
}

# 5. Core Validator Dedicated Compute Instance (c6i.xlarge - 4 vCPU, 8 GB RAM)
resource "aws_instance" "core_validator" {
  ami                    = var.ami_id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.private_validator.id
  vpc_security_group_ids = [aws_security_group.core_validator_sg.id]
  key_name               = var.key_pair_name

  root_block_device {
    volume_size           = 100
    volume_type           = "gp3"
    iops                  = 3000
    throughput            = 125
    encrypted             = true
    delete_on_termination = false
  }

  user_data = <<-EOF
              #!/bin/bash
              set -e
              apt-get update && apt-get install -y wireguard ufw curl jq
              echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
              sysctl -p
              EOF

  tags = {
    Name        = "${var.node_moniker}-core-node"
    Role        = "Validator-Core"
    Environment = var.environment
  }
}

# 6. Public Sentry Compute Instance (t3.xlarge - 4 vCPU, 16 GB RAM)
resource "aws_instance" "sentry_node" {
  ami                    = var.ami_id
  instance_type          = "t3.xlarge"
  subnet_id              = aws_subnet.public_sentry.id
  vpc_security_group_ids = [aws_security_group.sentry_sg.id]
  key_name               = var.key_pair_name

  root_block_device {
    volume_size           = 250
    volume_type           = "gp3"
    iops                  = 3000
    throughput            = 125
    encrypted             = true
    delete_on_termination = false
  }

  tags = {
    Name        = "${var.node_moniker}-sentry-node"
    Role        = "Validator-Sentry"
    Environment = var.environment
  }
}

resource "aws_eip" "sentry_eip" {
  instance = aws_instance.sentry_node.id
  domain   = "vpc"

  tags = {
    Name = "${var.node_moniker}-sentry-eip"
  }
}
