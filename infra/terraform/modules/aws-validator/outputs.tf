output "core_validator_private_ip" {
  value       = aws_instance.core_validator.private_ip
  description = "Private IP of core validator node"
}

output "sentry_public_ip" {
  value       = aws_eip.sentry_eip.public_ip
  description = "Public Elastic IP of Sentry node"
}

output "sentry_private_ip" {
  value       = aws_instance.sentry_node.private_ip
  description = "Private IP of Sentry node"
}

output "vpc_id" {
  value       = aws_vpc.sovra_vpc.id
  description = "VPC ID"
}
