output "seed_topology" {
  description = "Rendered 3-region DePIN Bootstrap Seed + Coturn TURN topology"
  value = {
    for k, v in local.seed_regions : k => {
      seed_domain       = v.seed_domain
      turn_domain       = v.turn_domain
      peer_id           = v.peer_id
      multiaddr         = "/dns4/${v.seed_domain}/tcp/${v.p2p_port}/p2p/${v.peer_id}"
      cloud_init_script = local_file.seed_cloud_init[k].filename
    }
  }
}

output "validator_topology" {
  description = "Rendered 4-validator CometBFT L1 multi-cloud deployment scripts"
  value = {
    for k, v in local.validators : k => {
      validator_name    = v.name
      cloud_zone        = v.cloud
      cloud_init_script = local_file.validator_cloud_init[k].filename
    }
  }
}
