output "sentry_public_ip" {
  value       = azurerm_public_ip.sentry_pip.ip_address
  description = "Public IP of Azure Sentry node"
}

output "core_validator_private_ip" {
  value       = azurerm_network_interface.validator_nic.ip_configuration[0].private_ip_address
  description = "Private IP of Azure core validator"
}
