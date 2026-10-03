/**
 * Product A: Sovra End-User Application Route Definitions
 * Contains regular consumer navigation and integrated Creator Studio.
 */

export interface AppRoute {
  readonly path: string;
  readonly name: string;
  readonly requiresCreatorMode: boolean;
  readonly description: string;
}

export const SOVRA_APP_ROUTES: readonly AppRoute[] = [
  {
    path: '/home',
    name: 'Home',
    requiresCreatorMode: false,
    description: 'Chronological following feed',
  },
  {
    path: '/explore',
    name: 'Explore',
    requiresCreatorMode: false,
    description: 'Decentralized topic tags',
  },
  {
    path: '/videos',
    name: 'Videos',
    requiresCreatorMode: false,
    description: 'Short clips and long-form video player',
  },
  {
    path: '/communities',
    name: 'Communities',
    requiresCreatorMode: false,
    description: 'Decentralized topic spaces',
  },
  {
    path: '/messages',
    name: 'Messages',
    requiresCreatorMode: false,
    description: 'End-to-end encrypted direct & group messaging',
  },
  {
    path: '/notifications',
    name: 'Notifications',
    requiresCreatorMode: false,
    description: 'Verified alerts and interaction proofs',
  },
  {
    path: '/profile',
    name: 'Profile',
    requiresCreatorMode: false,
    description: 'User public identity and authored signed events',
  },
  {
    path: '/settings',
    name: 'Settings',
    requiresCreatorMode: false,
    description: 'Identity keys, screen-time controls, privacy',
  },
  // INTEGRATED CREATOR STUDIO (Same application, unlocked by toggle)
  {
    path: '/studio',
    name: 'Creator Studio',
    requiresCreatorMode: true,
    description: 'Integrated upload, multi-track audio, and analytics',
  },
] as const;
