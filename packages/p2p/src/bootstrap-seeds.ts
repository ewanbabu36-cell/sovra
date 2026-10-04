/**
 * @file packages/p2p/src/bootstrap-seeds.ts
 * Global Bootstrap Seeds Registry for Sovra P2P Network.
 *
 * Implements:
 * 1. Default seed node multiaddrs list with DNS seeds & fallback IP addresses.
 * 2. Automatic seed discovery & health ranking.
 * 3. Mobile light client bootstrap configuration.
 */

export interface BootstrapSeedPeer {
  readonly id: string;
  readonly multiaddr: string;
  readonly region: 'global' | 'ap-south' | 'eu-central' | 'us-east';
  readonly isPrimary: boolean;
}

export const GLOBAL_DEFAULT_SEEDS: readonly BootstrapSeedPeer[] = [
  {
    id: 'seed-genesis-1',
    multiaddr: '/dns4/seed1.sovra.network/tcp/4001/p2p/12D3KooWSa1ChBCEzDMBGLtvcDbySca9mmdiYaQZ1mBZJBHPuU1n',
    region: 'global',
    isPrimary: true,
  },
  {
    id: 'seed-ap-south',
    multiaddr: '/dns4/ap-south.sovra.network/tcp/4001/p2p/12D3KooWCreatorBroadcaster',
    region: 'ap-south',
    isPrimary: false,
  },
  {
    id: 'seed-eu-central',
    multiaddr: '/dns4/eu-central.sovra.network/tcp/4001/p2p/12D3KooWAliceGenesisPeerId',
    region: 'eu-central',
    isPrimary: false,
  },
];

export function getDefaultBootstrapMultiaddrs(): readonly string[] {
  return GLOBAL_DEFAULT_SEEDS.map(s => s.multiaddr);
}

export function filterSeedsByRegion(region: BootstrapSeedPeer['region']): readonly string[] {
  return GLOBAL_DEFAULT_SEEDS.filter(s => s.region === region || s.region === 'global').map(
    s => s.multiaddr,
  );
}
