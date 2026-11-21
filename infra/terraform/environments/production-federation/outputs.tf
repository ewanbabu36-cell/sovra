output "federation_topology" {
  description = "Complete 4-Node Multi-Cloud Federation Endpoint Matrix"
  value = {
    node0_aws = {
      moniker   = "validator-0"
      cloud     = "AWS"
      region    = var.aws_region
      sentry_ip = module.validator_0_aws.sentry_public_ip
    }
    node1_gcp = {
      moniker   = "validator-1"
      cloud     = "GCP"
      region    = var.gcp_region
      sentry_ip = module.validator_1_gcp.sentry_public_ip
    }
    node2_azure = {
      moniker   = "validator-2"
      cloud     = "Azure"
      region    = var.azure_location
      sentry_ip = module.validator_2_azure.sentry_public_ip
    }
    node3_hetzner = {
      moniker   = "validator-3"
      cloud     = "Hetzner"
      location  = "fsn1"
      sentry_ip = module.validator_3_hetzner.sentry_public_ip
    }
  }
}
