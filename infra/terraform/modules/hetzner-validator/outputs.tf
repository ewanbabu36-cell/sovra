output "sentry_public_ip" {
  value       = hcloud_server.sentry_node.ipv4_address
  description = "Public IPv4 of Hetzner Sentry"
}

output "core_validator_private_ip" {
  value       = "10.103.1.10"
  description = "Private IP of Hetzner core validator"
}
