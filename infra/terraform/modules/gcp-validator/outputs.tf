output "sentry_public_ip" {
  value       = google_compute_address.sentry_static_ip.address
  description = "Static public IP for GCP Sentry"
}

output "core_validator_private_ip" {
  value       = google_compute_instance.core_validator.network_interface[0].network_ip
  description = "Private IP of core validator"
}
