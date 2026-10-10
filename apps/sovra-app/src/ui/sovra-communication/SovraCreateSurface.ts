/**
 * @file apps/sovra-app/src/ui/sovra-communication/SovraCreateSurface.ts
 * Spatial Creation Modalities Configuration & Validation
 */

export interface CreationModality {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  targetSurface: string;
}

export const CREATION_MODALITIES: readonly CreationModality[] = [
  { id: 'post', title: 'Post', description: 'Share sovereign thoughts and media with your mesh circle', icon: '📝', color: '#38bdf8', targetSurface: 'post-creator' },
  { id: 'photo', title: 'Photo', description: 'Encrypted media broadcast to sovereign peers', icon: '📷', color: '#c084fc', targetSurface: 'photo-creator' },
  { id: 'video', title: 'Video', description: 'Decentralized P2P streaming broadcast', icon: '🎥', color: '#fb7185', targetSurface: 'video-creator' },
  { id: 'reel', title: 'Reel', description: 'Vertical short-form video clip', icon: '🎬', color: '#f59e0b', targetSurface: 'reel-creator' },
  { id: 'poll', title: 'Poll', description: 'Collect tamper-proof votes across peer nodes', icon: '📊', color: '#10b981', targetSurface: 'poll-creator' },
  { id: 'question', title: 'Question', description: 'Decentralized Q&A with peer verification', icon: '❓', color: '#818cf8', targetSurface: 'question-creator' },
  { id: 'channel', title: 'Channel', description: 'Broadcast channel with subscriber feed', icon: '📢', color: '#3b82f6', targetSurface: 'channel-creator' },
  { id: 'page', title: 'Page', description: 'Verified organization or brand identity', icon: '🏢', color: '#d946ef', targetSurface: 'page-creator' },
  { id: 'group', title: 'Group', description: 'Encrypted peer circle and community space', icon: '👥', color: '#22c55e', targetSurface: 'group-creator' },
];
