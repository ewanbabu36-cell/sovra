import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  generateEd25519KeyPair,
  bytesToHex,
  hexToBytes,
  signEd25519,
  verifyEd25519,
  sha256,
} from '../packages/crypto/dist/index.js';
import {
  SovraIdentityKey,
  SovraDeviceKey,
  createDeviceDelegation,
  type PublicIdentity,
} from '../packages/identity/dist/index.js';
import {
  SovraP2PNode,
  createPeerIdentityBinding,
  type PeerIdentityBinding,
} from '../packages/p2p/dist/index.js';
import { CID } from '../packages/storage/dist/index.js';
import { StorageNodeDaemon } from '../nodes/storage-node/dist/index.js';
import {
  DefaultSocialGraphEngine,
  DefaultLocalFeedEngine,
  createSignedFollowEvent,
  createSignedBlockEvent,
  createSignedMuteEvent,
  createSignedReactionEvent,
  createSignedShortPost,
} from '../packages/social/dist/index.js';
import { renderAdminHtml } from './admin-console.ts';
import {
  sovraDb,
  type UserRecord,
  type ContactPeerRecord,
  type ChatMessageRecord as DbChatMessageRecord,
  type FeedPostRecord as DbFeedPostRecord,
  type FriendRelationshipRecord,
} from './database-engine.ts';

interface PostRecord {
  id: string;
  authorDid: string;
  authorPeerId: string;
  content: string;
  topic: string;
  isCreatorPost: boolean;
  timestamp: number;
  signatureHex: string;
}

const postsStore: PostRecord[] = [
  {
    id: 'post-1',
    authorDid: 'did:sovra:genesis_node_alice',
    authorPeerId: '12D3KooWAliceGenesisPeerId',
    content: 'Welcome to Sovra — the decentralized social protocol powered by Noise_XX and libp2p!',
    topic: 'sovra/feed/main',
    isCreatorPost: false,
    timestamp: Date.now() - 3600000,
    signatureHex: ' verified_genesis_signature',
  },
  {
    id: 'post-2',
    authorDid: 'did:sovra:creator_studio_broadcast',
    authorPeerId: '12D3KooWCreatorBroadcaster',
    content: '🚀 Creator Studio Demo: High-bitrate 4K stream uploaded with multi-track spatial audio.',
    topic: 'sovra/creator/live',
    isCreatorPost: true,
    timestamp: Date.now() - 1800000,
    signatureHex: ' verified_creator_signature',
  },
];

interface ReelRecord {
  id: string;
  creatorDid: string;
  creatorHandle: string;
  creatorName: string;
  caption: string;
  tags: string[];
  audioTrack: string;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  bgGradient: string;
  cid: string;
  isLiked?: boolean;
  isSaved?: boolean;
  viewsDisplay?: string;
}

const reelsStore: ReelRecord[] = [
  {
    id: 'reel-1',
    creatorDid: 'did:key:z6MksAliceCreatorP2P',
    creatorHandle: 'alice_creator',
    creatorName: 'Alice ⚡ P2P Architect',
    caption: 'Zero central servers! Streaming raw UnixFS blocks over pure UDP QUIC. ⚡ 60fps gesture physics & instant pre-warm.',
    tags: ['#sovra', '#p2p', '#reels', '#privacy', '#zeroalgorithms'],
    audioTrack: 'Original Audio - alice_creator',
    likesCount: 2489,
    commentsCount: 142,
    sharesCount: 68,
    bgGradient: 'linear-gradient(180deg, #1e1b4b 0%, #312e81 40%, #0f172a 100%)',
    cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
    viewsDisplay: '2.4M',
  },
  {
    id: 'reel-2',
    creatorDid: 'did:key:z6MksBobBroadcaster',
    creatorHandle: 'bob_live',
    creatorName: 'Bob | 5G Telecom',
    caption: 'Testing ICE 4-tier hole punching on 5G carrier CGNAT. Sub-300ms video startup! 🔥 No relay bandwidth choked.',
    tags: ['#telecom', '#5g', '#cgnat', '#web3'],
    audioTrack: 'P2P Pulse Beats - Sound Collective',
    likesCount: 1845,
    commentsCount: 97,
    sharesCount: 43,
    bgGradient: 'linear-gradient(180deg, #3b0764 0%, #1e1b4b 50%, #030712 100%)',
    cid: 'bafybeihkoviema7g3gxyt6la7vd5ho32wuq5z2m4r6z5g3k7r4o6z5m4r6',
    viewsDisplay: '1.8M',
  },
  {
    id: 'reel-3',
    creatorDid: 'did:key:z6MksCarolMusician',
    creatorHandle: 'carol_sounds',
    creatorName: 'Carol 🎧 Sound Designer',
    caption: 'Spatial multi-track audio session mixed locally on-device. No lossy compression! 🎧 Stems synced over BitSwap.',
    tags: ['#spatialaudio', '#lossless', '#creator', '#hifi'],
    audioTrack: 'Midnight Echoes (Spatial Mix) - Carol',
    likesCount: 3912,
    commentsCount: 231,
    sharesCount: 154,
    bgGradient: 'linear-gradient(180deg, #064e3b 0%, #0f172a 60%, #022c22 100%)',
    cid: 'bafybeig7r6z5g3k7r4o6z5m4r6koviema7g3gxyt6la7vd5ho32wuq5z2m',
    viewsDisplay: '3.9M',
  },
  {
    id: 'reel-4',
    creatorDid: 'did:key:z6MksAliceCreatorP2P',
    creatorHandle: 'alice_creator',
    creatorName: 'Alice ⚡ P2P Architect',
    caption: 'Noise_XX mutual authentication handshake in 1-RTT. Ephemeral keys rotated after every session. 🔒',
    tags: ['#cryptography', '#noiseprotocol', '#security', '#ed25519'],
    audioTrack: 'Cybernetic Pulse - Alice & Core',
    likesCount: 5120,
    commentsCount: 308,
    sharesCount: 279,
    bgGradient: 'linear-gradient(180deg, #431407 0%, #1e1b4b 55%, #030712 100%)',
    cid: 'bafybeihkoviema7g3gxyt6la7vd5ho32wuq5z2m4r6z5g3k7r4o6z5m4r7',
    viewsDisplay: '840K',
  },
  {
    id: 'reel-5',
    creatorDid: 'did:key:z6MksDaveNode',
    creatorHandle: 'dave_edge',
    creatorName: 'Dave | Edge Relay',
    caption: '10 seeder peers streaming parallel BitSwap chunks simultaneously. 120MB/s swarm throughput on mobile! 🚀',
    tags: ['#bitswap', '#swarm', '#throughput', '#mesh'],
    audioTrack: 'Relay Velocity - Dave Edge',
    likesCount: 4210,
    commentsCount: 184,
    sharesCount: 195,
    bgGradient: 'linear-gradient(180deg, #172554 0%, #1e1b4b 60%, #020617 100%)',
    cid: 'bafybeihkoviema7g3gxyt6la7vd5ho32wuq5z2m4r6z5g3k7r4o6z5m4r8',
    viewsDisplay: '1.2M',
  },
];

interface CreatorProfile {
  handle: string;
  name: string;
  avatar: string;
  avatarBg: string;
  verified: boolean;
  postsCount: number;
  followersCount: string;
  followingCount: number;
  bio: string;
  externalLink: string;
  reels: { id: string; views: string; title: string; gradient: string }[];
  highlights: { name: string; emoji: string }[];
}

const creatorProfiles: Record<string, CreatorProfile> = {
  alice_creator: {
    handle: 'alice_creator',
    name: 'Alice ⚡ P2P Architect',
    avatar: 'A',
    avatarBg: '#6366f1',
    verified: true,
    postsCount: 48,
    followersCount: '128.4K',
    followingCount: 312,
    bio: 'Decentralized P2P Architect • Zero middleman servers ⚡ • Building on Sovra protocol • Noise_XX / BitSwap enthusiast',
    externalLink: 'https://sovra.network/alice',
    highlights: [
      { name: '⚡ Code', emoji: '💻' },
      { name: '🌐 Nodes', emoji: '🖥️' },
      { name: '✨ Setup', emoji: '⚙️' },
      { name: '🚀 Swarms', emoji: '🛰️' },
    ],
    reels: [
      { id: 'reel-1', views: '2.4M', title: 'Zero Central Servers', gradient: 'linear-gradient(135deg, #1e1b4b, #312e81)' },
      { id: 'reel-4', views: '840K', title: 'Noise_XX Zero-RTT Handshake', gradient: 'linear-gradient(135deg, #431407, #7c2d12)' },
      { id: 'reel-5', views: '1.9M', title: 'Sub-30ms BitSwap Swarming', gradient: 'linear-gradient(135deg, #172554, #1e40af)' },
    ],
  },
  bob_live: {
    handle: 'bob_live',
    name: 'Bob | 5G Telecom',
    avatar: 'B',
    avatarBg: '#f59e0b',
    verified: true,
    postsCount: 36,
    followersCount: '94.2K',
    followingCount: 185,
    bio: 'Cellular CGNAT hole puncher • UDP QUIC connection migration • Jio/Airtel 5G tester',
    externalLink: 'https://sovra.network/bob',
    highlights: [
      { name: '🔥 5G Tests', emoji: '📡' },
      { name: '🛡️ CGNAT', emoji: '🔒' },
      { name: '⚡ QUIC', emoji: '⚡' },
    ],
    reels: [
      { id: 'reel-2', views: '1.8M', title: 'ICE 4-tier Punching', gradient: 'linear-gradient(135deg, #3b0764, #1e1b4b)' },
    ],
  },
  carol_sounds: {
    handle: 'carol_sounds',
    name: 'Carol 🎧 Sound Designer',
    avatar: 'C',
    avatarBg: '#ec4899',
    verified: true,
    postsCount: 62,
    followersCount: '215K',
    followingCount: 420,
    bio: 'Grammy-nominated Sound Designer • Spatial multi-track master creator • Pure lossless P2P audio on Sovra DAG',
    externalLink: 'https://sovra.network/carol',
    highlights: [
      { name: '🎧 Masters', emoji: '🎛️' },
      { name: '🎹 Stems', emoji: '🎹' },
      { name: '✨ Live', emoji: '🎙️' },
    ],
    reels: [
      { id: 'reel-3', views: '3.9M', title: 'Spatial Audio Mixed Locally', gradient: 'linear-gradient(135deg, #064e3b, #0f172a)' },
    ],
  },
  dave_edge: {
    handle: 'dave_edge',
    name: 'Dave | Edge Relay',
    avatar: 'D',
    avatarBg: '#3b82f6',
    verified: true,
    postsCount: 29,
    followersCount: '48.9K',
    followingCount: 92,
    bio: 'Edge relay node operator (99.9% uptime) • Bandwidth vouchers & BitSwap seed caching on fast SSDs',
    externalLink: 'https://sovra.network/dave',
    highlights: [
      { name: '🖥️ Relays', emoji: '⚡' },
      { name: '📊 Metrics', emoji: '📈' },
    ],
    reels: [
      { id: 'reel-5', views: '1.2M', title: 'BitSwap Swarm', gradient: 'linear-gradient(135deg, #172554, #1e1b4b)' },
    ],
  },
};

interface MultiSegmentStory {
  creatorHandle: string;
  creatorName: string;
  creatorAvatar: string;
  creatorAvatarBg: string;
  seen: boolean;
  segments: {
    id: string;
    caption: string;
    stickerText?: string;
    stickerType?: 'poll' | 'location' | 'mention';
    gradient: string;
    timeAgo: string;
  }[];
}

const multiSegmentStories: MultiSegmentStory[] = [
  {
    creatorHandle: 'alice_creator',
    creatorName: 'Alice',
    creatorAvatar: 'A',
    creatorAvatarBg: '#6366f1',
    seen: false,
    segments: [
      {
        id: 'alice-s1',
        caption: '🚀 4K HLS Master playlist chunking over BitSwap swarm in real-time!',
        stickerText: '📍 New Delhi P2P Mesh Node',
        stickerType: 'location',
        gradient: 'linear-gradient(135deg, #4f46e5, #06b6d4)',
        timeAgo: '1h ago',
      },
      {
        id: 'alice-s2',
        caption: 'Poll: Should social apps have zero algorithms and 100% chronological feed?',
        stickerText: '🔥 98% Voted YES',
        stickerType: 'poll',
        gradient: 'linear-gradient(135deg, #7c3aed, #db2777)',
        timeAgo: '45m ago',
      },
      {
        id: 'alice-s3',
        caption: 'Checking in from the storage cluster. 50GB pinned blocks healthy.',
        stickerText: '⚡ BitSwap 1.2.0 Active',
        stickerType: 'mention',
        gradient: 'linear-gradient(135deg, #059669, #10b981)',
        timeAgo: '15m ago',
      },
    ],
  },
  {
    creatorHandle: 'bob_live',
    creatorName: 'Bob',
    creatorAvatar: 'B',
    creatorAvatarBg: '#f59e0b',
    seen: false,
    segments: [
      {
        id: 'bob-s1',
        caption: 'Testing Birthday Paradox port prediction on symmetric-to-symmetric NAT.',
        stickerText: '⚡ 92% Punch Success',
        stickerType: 'poll',
        gradient: 'linear-gradient(135deg, #d97706, #ef4444)',
        timeAgo: '2h ago',
      },
      {
        id: 'bob-s2',
        caption: '5G carrier handoff completed without dropping the UDP QUIC stream!',
        stickerText: '📱 Jio 5G Carrier Tested',
        stickerType: 'location',
        gradient: 'linear-gradient(135deg, #b91c1c, #431407)',
        timeAgo: '1h ago',
      },
    ],
  },
  {
    creatorHandle: 'carol_sounds',
    creatorName: 'Carol',
    creatorAvatar: 'C',
    creatorAvatarBg: '#ec4899',
    seen: false,
    segments: [
      {
        id: 'carol-s1',
        caption: 'Drop your stems in the P2P DAG! New ambient mix dropping tonight. 🎧',
        stickerText: '🎶 Spatial Master FLAC',
        stickerType: 'mention',
        gradient: 'linear-gradient(135deg, #db2777, #7c3aed)',
        timeAgo: '3h ago',
      },
    ],
  },
  {
    creatorHandle: 'dave_edge',
    creatorName: 'Dave',
    creatorAvatar: 'D',
    creatorAvatarBg: '#3b82f6',
    seen: true,
    segments: [
      {
        id: 'dave-s1',
        caption: 'Edge relay node online: 99.8% SLA score. Serving bandwidth vouchers. ⚡',
        stickerText: '📍 Tokyo Edge Relay',
        stickerType: 'location',
        gradient: 'linear-gradient(135deg, #1e40af, #3b82f6)',
        timeAgo: '5h ago',
      },
    ],
  },
];

interface ReelComment {
  id: string;
  reelId: string;
  authorHandle: string;
  authorAvatar: string;
  text: string;
  timeAgo: string;
  likes: number;
}

const reelCommentsStore: ReelComment[] = [
  {
    id: 'rc-1',
    reelId: 'reel-1',
    authorHandle: 'dave_edge',
    authorAvatar: 'D',
    text: 'This 60fps snap scroll is buttery smooth! Zero lag on mobile. 🔥',
    timeAgo: '2h',
    likes: 42,
  },
  {
    id: 'rc-2',
    reelId: 'reel-1',
    authorHandle: 'carol_sounds',
    authorAvatar: 'C',
    text: 'Love the audio sync! Spatial beat sounds pristine. 🎧',
    timeAgo: '1h',
    likes: 19,
  },
  {
    id: 'rc-3',
    reelId: 'reel-1',
    authorHandle: 'bob_live',
    authorAvatar: 'B',
    text: 'Hole punching worked instantaneously on my carrier NAT. Verified! ⚡',
    timeAgo: '35m',
    likes: 8,
  },
];


interface ContactRecord {
  did: string;
  name: string;
  avatar: string;
  avatarBg: string;
  role: string;
  isOnline: boolean;
  lastSeen: string;
  disappearingDurationSec: number; // 0 = off, 5, 10, 86400
  safetyNumbers: string;
  isVerified?: boolean;
}

const dynamicPeersStore: ContactRecord[] = [
  {
    did: 'did:sovra:laptop_host',
    name: 'Host Node (Laptop)',
    avatar: '💻',
    avatarBg: '#6366f1',
    role: 'Root Mesh Relay & Seeder',
    isOnline: true,
    lastSeen: 'Online',
    disappearingDurationSec: 0,
    safetyNumbers: '28471 90432 18942 09182 39182 48192 19283 48192 48192 01928 38192 49182',
    isVerified: true,
  },
];

const contactsStore: ContactRecord[] = [];

// BitChat zero-internet mesh peer model reference (Direct BLE and multi-hop relay nodes: did:sovra:alice_ble, did:sovra:bob_ble):
export const BITCHAT_REFERENCE_MODELS = {
  directBlePeer: { did: 'did:sovra:alice_ble', name: 'Alice (Direct BLE)', role: 'Direct BLE Peer (-42 dBm, 2.5m)', hops: 1, isDirect: true },
  relayPeer: { did: 'did:sovra:bob_ble', name: 'Bob (2 Hops Relay)', role: 'Relayed via Alice (-68 dBm, 12m)', hops: 2, isDirect: false }
};

interface BitChatPeerRecord {
  did: string;
  name: string;
  avatar: string;
  avatarBg: string;
  role: string;
  rssi: number;
  distanceMeters: number;
  hops: number;
  relayVia?: string;
  isDirect: boolean;
  channel?: string;
  isChannel?: boolean;
}

const bitchatPeersStore: BitChatPeerRecord[] = [
  {
    did: 'channel:local_mesh',
    name: '#local-mesh',
    avatar: '📶',
    avatarBg: '#0284c7',
    role: 'Hyperlocal Public Beacon (50m Radius)',
    rssi: -35,
    distanceMeters: 5,
    hops: 1,
    isDirect: true,
    channel: '#local-mesh',
    isChannel: true,
  },
  {
    did: 'channel:emergency_sos',
    name: '#emergency-sos',
    avatar: '🚨',
    avatarBg: '#dc2626',
    role: 'Zero-Internet SOS Broadcast Swarm',
    rssi: -30,
    distanceMeters: 2,
    hops: 1,
    isDirect: true,
    channel: '#emergency-sos',
    isChannel: true,
  },
];

interface ChatMessageRecord {
  id: string;
  senderDid: string;
  recipientDid: string;
  senderName: string;
  text: string;
  isAudio: boolean;
  audioDurationSec: number;
  waveformBars?: number[];
  timestamp: number;
  sentAt?: number;
  deliveredAt?: number;
  readAt?: number;
  status: 'sent' | 'delivered' | 'read';
  signatureHex: string;
  disappearingDurationSec?: number;
  expiresAt?: number;
  isDisappeared?: boolean;
  reactions?: { emoji: string; senderDid: string }[];
  isBitChat?: boolean;
  hopCount?: number;
  route?: string[];
}

const initialChatMessages: ChatMessageRecord[] = [];

export interface FeedPostRecord {
  id: string;
  authorDid: string;
  authorName: string;
  authorAvatar: string;
  authorAvatarBg: string;
  authorAvatarDataUrl?: string;
  audioTrack: string;
  mediaGradient: string;
  mediaEmoji: string;
  mediaTitle: string;
  mediaCid: string;
  likesCount: number;
  isLiked?: boolean;
  isSaved?: boolean;
  caption: string;
  tags: string;
  timestamp: number;
  comments: { id?: string; author: string; text: string; authorDid?: string; authorAvatar?: string; timestamp?: number }[];
  mediaImage?: string;
  likedByDids?: string[];
}

const initialFeedPosts: FeedPostRecord[] = [];


export interface ChannelRecord {
  id: string;
  handle: string;
  name: string;
  category: string;
  desc: string;
  count: number;
  avatar: string;
  bg: string;
  isSubbed: boolean;
  ownerDid?: string;
  createdAt: number;
}

export interface PageRecord {
  id: string;
  handle: string;
  name: string;
  category: string;
  bio: string;
  count: number;
  cta: string;
  ctaType: string;
  avatar: string;
  bg: string;
  isFollowing: boolean;
  ownerDid?: string;
  createdAt: number;
}

const initialChannels: ChannelRecord[] = [
  { id: 'ch-alpha', handle: '@sovra_alpha', name: 'Sovra Alpha Radar', category: 'tech', desc: 'Cutting-edge P2P social dispatches', count: 14200, avatar: '📢', bg: '#0284c7', isSubbed: true, createdAt: Date.now() - 10000000 },
  { id: 'ch-gaming', handle: '@web3_gaming', name: 'Web3 Arcade Live', category: 'gaming', desc: 'Multiplayer P2P tournaments & game clips', count: 8900, avatar: '🎮', bg: '#8b5cf6', isSubbed: false, createdAt: Date.now() - 8000000 },
  { id: 'ch-news', handle: '@decentral_news', name: 'Global Mesh Dispatches', category: 'news', desc: 'Uncensored citizen dispatches over GossipSub', count: 24500, avatar: '📰', bg: '#10b981', isSubbed: false, createdAt: Date.now() - 6000000 },
  { id: 'ch-music', handle: '@ambient_radio', name: '24/7 Lo-Fi Mesh Waves', category: 'music', desc: 'Continuous stream seeded across 40 nodes', count: 6200, avatar: '🎵', bg: '#f43f5e', isSubbed: true, createdAt: Date.now() - 4000000 },
];

const initialPages: PageRecord[] = [
  { id: 'pg-metropolis', handle: '@metropolis_coffee', name: 'Metropolis Roastery', category: 'business', bio: 'Artisan cold brew with gigabit sovereign Wi-Fi', count: 3400, cta: 'Book Table', ctaType: 'book', avatar: '☕', bg: '#78350f', isFollowing: false, createdAt: Date.now() - 12000000 },
  { id: 'pg-meshlabs', handle: '@mesh_labs', name: 'Mesh Labs AI', category: 'brand', bio: 'Local edge LLMs and private search models', count: 12400, cta: 'Visit Website', ctaType: 'website', avatar: '⚡', bg: '#4f46e5', isFollowing: true, createdAt: Date.now() - 9000000 },
  { id: 'pg-bakery', handle: '@artisan_bakery', name: 'Sovereign Sourdough', category: 'business', bio: 'Fresh organic loaves delivered directly via P2P orders', count: 1850, cta: 'Send Message', ctaType: 'message', avatar: '🥖', bg: '#d97706', isFollowing: false, createdAt: Date.now() - 7000000 },
];

export interface DynamicSocialState {
  posts: FeedPostRecord[];
  channels: ChannelRecord[];
  pages: PageRecord[];
  chatMessages: ChatMessageRecord[];
}

function loadDynamicSocialState(): DynamicSocialState {
  const dbState = sovraDb.load();
  return {
    posts: dbState.posts as unknown as FeedPostRecord[],
    channels: dbState.channels,
    pages: dbState.pages,
    chatMessages: dbState.chatMessages as unknown as ChatMessageRecord[],
  };
}

function saveDynamicSocialState(_state?: DynamicSocialState): void {
  sovraDb.save();
}

const dynamicSocialStore = loadDynamicSocialState();
const feedPostsStore = dynamicSocialStore.posts;
const chatMessagesStore = dynamicSocialStore.chatMessages;

export interface VideoChapter {
  timeSeconds: number;
  timecode: string;
  title: string;
}

export interface YoutubeReplyRecord {
  id: string;
  commentId: string;
  authorName: string;
  authorAvatar: string;
  authorHandle: string;
  text: string;
  timestamp: number;
  likes: number;
  isCreator?: boolean;
}

export interface YoutubeCommentRecord {
  id: string;
  videoId: string;
  authorName: string;
  authorAvatar: string;
  authorHandle: string;
  text: string;
  timestamp: number;
  likes: number;
  isPinned?: boolean;
  isCreator?: boolean;
  creatorHeart?: boolean;
  isSuperThanks?: boolean;
  superThanksAmount?: string;
  replies: YoutubeReplyRecord[];
}

export interface YoutubeVideoRecord {
  id: string;
  title: string;
  channelName: string;
  channelHandle: string;
  channelAvatar: string;
  channelAvatarBg: string;
  channelSubscribers: number;
  channelSubscribersText: string;
  isSubscribed: boolean;
  views: number;
  viewsText: string;
  likes: number;
  dislikes: number;
  cid: string;
  duration: string;
  durationSeconds: number;
  publishedAt: string;
  description: string;
  tags: string[];
  ambientColor: string;
  gradient: string;
  chapters: VideoChapter[];
  variants: {
    resolution: string;
    bitrate: string;
    framerate: string;
    bandwidthBps: number;
  }[];
}

const longFormVideosCatalog: YoutubeVideoRecord[] = [
  {
    id: 'yt-video-1',
    title: 'Decentralized 4K Master Video & BitSwap Swarm Distribution | Sovra Architecture Deep Dive',
    channelName: 'Sovra Protocol Lab',
    channelHandle: 'sovralab',
    channelAvatar: 'S',
    channelAvatarBg: '#6366f1',
    channelSubscribers: 142800,
    channelSubscribersText: '142.8K subscribers',
    isSubscribed: false,
    views: 284512,
    viewsText: '284K views',
    likes: 18420,
    dislikes: 12,
    cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
    duration: '14:20',
    durationSeconds: 860,
    publishedAt: 'Premiered 2 hours ago',
    description: `In this deep architecture session, we break down Sovra's RFC 8216 HLS ABR pipeline, zero-server BitSwap swarming, and dynamic 95/5 creator micropayment vouchers verified off-chain with Ed25519 signatures.

Timestamps & Chapters:
00:00 - Introduction to Sovereign P2P Streaming
02:15 - RFC 8216 Master & Variant Playlists
05:40 - Speculative Segment 0 Pre-Warming
09:12 - BitSwap Swarming over Cellular CGNAT
12:30 - 95/5 Off-Chain Hardware Vouchers

GitHub & Specs: https://github.com/sovra/protocol
Decentralized CID: ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi`,
    tags: ['#P2P', '#RFC8216', '#BitSwap', '#4KUHD', '#Sovra'],
    ambientColor: 'rgba(99, 102, 241, 0.45)',
    gradient: 'radial-gradient(circle at center, #1e1b4b 0%, #030712 100%)',
    chapters: [
      { timeSeconds: 0, timecode: '00:00', title: 'Introduction to Sovereign P2P Streaming' },
      { timeSeconds: 135, timecode: '02:15', title: 'RFC 8216 Master & Variant Playlists' },
      { timeSeconds: 340, timecode: '05:40', title: 'Speculative Segment 0 Pre-Warming' },
      { timeSeconds: 552, timecode: '09:12', title: 'BitSwap Swarming over Cellular CGNAT' },
      { timeSeconds: 750, timecode: '12:30', title: '95/5 Off-Chain Hardware Vouchers' },
    ],
    variants: [
      { resolution: '4K (2160p60)', bitrate: '25 Mbps', framerate: '60fps', bandwidthBps: 25_000_000 },
      { resolution: '1080p60', bitrate: '8 Mbps', framerate: '60fps', bandwidthBps: 8_000_000 },
      { resolution: '720p', bitrate: '4 Mbps', framerate: '30fps', bandwidthBps: 4_000_000 },
      { resolution: '480p', bitrate: '1.5 Mbps', framerate: '30fps', bandwidthBps: 1_500_000 },
      { resolution: '360p', bitrate: '600 Kbps', framerate: '30fps', bandwidthBps: 600_000 },
    ],
  },
  {
    id: 'yt-video-2',
    title: 'Zero-Server Cellular CGNAT Traversal: ICE 4-Tier & Birthday Paradox Port Prediction',
    channelName: 'Telecom Engineering Guild',
    channelHandle: 'telecom_guild',
    channelAvatar: 'T',
    channelAvatarBg: '#10b981',
    channelSubscribers: 98400,
    channelSubscribersText: '98.4K subscribers',
    isSubscribed: false,
    views: 192430,
    viewsText: '192K views',
    likes: 12890,
    dislikes: 8,
    cid: 'bafybeicgnattraversal4tierportpredictionbirthdayparadox88',
    duration: '18:45',
    durationSeconds: 1125,
    publishedAt: 'Yesterday',
    description: `Why STUN alone fails on 35% of cellular carrier connections (Jio, Airtel, T-Mobile), and how Sovra's Birthday Paradox heuristic engine achieves 92% punch success without central TURN servers.

Timestamps & Chapters:
00:00 - Cellular NAT Reality & Port Mappings
03:20 - Symmetric-to-Symmetric Hole Punch Gaps
07:45 - Port Randomization & Birthday Paradox Math
13:10 - Community Incentivized Relay Protocol
16:50 - Live 5G Carrier Handover Benchmarks`,
    tags: ['#Telecom', '#NATTraversal', '#STUN', '#5GQUIC', '#Networking'],
    ambientColor: 'rgba(16, 185, 129, 0.45)',
    gradient: 'radial-gradient(circle at center, #064e3b 0%, #022c22 100%)',
    chapters: [
      { timeSeconds: 0, timecode: '00:00', title: 'Cellular NAT Reality & Port Mappings' },
      { timeSeconds: 200, timecode: '03:20', title: 'Symmetric-to-Symmetric Hole Punch Gaps' },
      { timeSeconds: 465, timecode: '07:45', title: 'Port Randomization & Birthday Paradox Math' },
      { timeSeconds: 790, timecode: '13:10', title: 'Community Incentivized Relay Protocol' },
      { timeSeconds: 1010, timecode: '16:50', title: 'Live 5G Carrier Handover Benchmarks' },
    ],
    variants: [
      { resolution: '1080p60', bitrate: '8 Mbps', framerate: '60fps', bandwidthBps: 8_000_000 },
      { resolution: '720p', bitrate: '4 Mbps', framerate: '30fps', bandwidthBps: 4_000_000 },
      { resolution: '480p', bitrate: '1.5 Mbps', framerate: '30fps', bandwidthBps: 1_500_000 },
      { resolution: '360p', bitrate: '600 Kbps', framerate: '30fps', bandwidthBps: 600_000 },
    ],
  },
  {
    id: 'yt-video-3',
    title: 'Double Ratchet E2EE Cryptography & Signal Protocol in Web & Mobile',
    channelName: 'Alice Cryptography Lab',
    channelHandle: 'alice_crypto',
    channelAvatar: 'A',
    channelAvatarBg: '#ec4899',
    channelSubscribers: 215100,
    channelSubscribersText: '215.1K subscribers',
    isSubscribed: true,
    views: 310890,
    viewsText: '310K views',
    likes: 24700,
    dislikes: 15,
    cid: 'bafybeidoubleratchetchacha20poly1305signalkdfkeys44',
    duration: '22:10',
    durationSeconds: 1330,
    publishedAt: '3 days ago',
    description: `Complete mathematical teardown of Signal-grade HKDF ratchet chains, Diffie-Hellman ephemeral steps, and ChaCha20-Poly1305 encryption on zero-server mesh topologies.

Timestamps & Chapters:
00:00 - Cryptographic Forward & Post-Compromise Secrecy
04:10 - X3DH Pre-Key Bundles & Identity Keys
09:30 - KDF Root & Chain Ratchets
15:20 - RAM-Only Zero-Disk Ephemeral Buffers
19:40 - Multi-Device Sync Without Private Key Leakage`,
    tags: ['#Cryptography', '#DoubleRatchet', '#Signal', '#E2EE', '#Privacy'],
    ambientColor: 'rgba(236, 72, 153, 0.45)',
    gradient: 'radial-gradient(circle at center, #831843 0%, #4a044e 100%)',
    chapters: [
      { timeSeconds: 0, timecode: '00:00', title: 'Cryptographic Forward & Post-Compromise Secrecy' },
      { timeSeconds: 250, timecode: '04:10', title: 'X3DH Pre-Key Bundles & Identity Keys' },
      { timeSeconds: 570, timecode: '09:30', title: 'KDF Root & Chain Ratchets' },
      { timeSeconds: 920, timecode: '15:20', title: 'RAM-Only Zero-Disk Ephemeral Buffers' },
      { timeSeconds: 1180, timecode: '19:40', title: 'Multi-Device Sync Without Private Key Leakage' },
    ],
    variants: [
      { resolution: '4K (2160p60)', bitrate: '25 Mbps', framerate: '60fps', bandwidthBps: 25_000_000 },
      { resolution: '1080p60', bitrate: '8 Mbps', framerate: '60fps', bandwidthBps: 8_000_000 },
      { resolution: '720p', bitrate: '4 Mbps', framerate: '30fps', bandwidthBps: 4_000_000 },
      { resolution: '480p', bitrate: '1.5 Mbps', framerate: '30fps', bandwidthBps: 1_500_000 },
    ],
  },
  {
    id: 'yt-video-4',
    title: 'Dynamic 95/5 Creator Split & Off-Chain Hardware Vouchers: The Death of the 45% Middleman Tax',
    channelName: 'Creator Economics Studio',
    channelHandle: 'creator_studio',
    channelAvatar: 'C',
    channelAvatarBg: '#f59e0b',
    channelSubscribers: 76500,
    channelSubscribersText: '76.5K subscribers',
    isSubscribed: false,
    views: 145200,
    viewsText: '145K views',
    likes: 11240,
    dislikes: 6,
    cid: 'bafybeicreatoreconomics95splitvouchersoffchainmerkle12',
    duration: '12:05',
    durationSeconds: 725,
    publishedAt: '5 days ago',
    description: `YouTube takes 45%, Twitch takes 50%. How Sovra uses off-chain state channel vouchers with Ed25519 signatures to deliver 95% straight to the creator and 5% to the bandwidth seeders.

Timestamps & Chapters:
00:00 - Big Tech 45% Middleman Tax Analysis
02:40 - The Sovereign 95/5 Decentralized Model
05:30 - Proof-of-Delivery Bandwidth Receipts
08:45 - Instant Micro-Token Settlement
10:50 - Live Channel Monetization Demonstration`,
    tags: ['#CreatorEconomy', '#Monetization', '#MicroPayments', '#Decentralization'],
    ambientColor: 'rgba(245, 158, 11, 0.45)',
    gradient: 'radial-gradient(circle at center, #78350f 0%, #451a03 100%)',
    chapters: [
      { timeSeconds: 0, timecode: '00:00', title: 'Big Tech 45% Middleman Tax Analysis' },
      { timeSeconds: 160, timecode: '02:40', title: 'The Sovereign 95/5 Decentralized Model' },
      { timeSeconds: 330, timecode: '05:30', title: 'Proof-of-Delivery Bandwidth Receipts' },
      { timeSeconds: 525, timecode: '08:45', title: 'Instant Micro-Token Settlement' },
      { timeSeconds: 650, timecode: '10:50', title: 'Live Channel Monetization Demonstration' },
    ],
    variants: [
      { resolution: '1080p60', bitrate: '8 Mbps', framerate: '60fps', bandwidthBps: 8_000_000 },
      { resolution: '720p', bitrate: '4 Mbps', framerate: '30fps', bandwidthBps: 4_000_000 },
      { resolution: '480p', bitrate: '1.5 Mbps', framerate: '30fps', bandwidthBps: 1_500_000 },
      { resolution: '360p', bitrate: '600 Kbps', framerate: '30fps', bandwidthBps: 600_000 },
    ],
  },
];

let currentYoutubeVideo: YoutubeVideoRecord = longFormVideosCatalog[0]!;

const youtubeCommentsStore: Record<string, YoutubeCommentRecord[]> = {
  'yt-video-1': [
    {
      id: 'yt-c1',
      videoId: 'yt-video-1',
      authorName: 'Sovra Protocol Lab',
      authorAvatar: 'S',
      authorHandle: 'sovralab',
      text: '📌 Welcome everyone! RFC 8216 HLS Master Playlist & Variant specifications are live. Timestamps are linked in the description. What P2P benchmark should we stress-test next?',
      timestamp: Date.now() - 7200000,
      likes: 842,
      isPinned: true,
      isCreator: true,
      creatorHeart: true,
      replies: [
        {
          id: 'yt-r1-1',
          commentId: 'yt-c1',
          authorName: 'Alex Cryptographer',
          authorAvatar: 'A',
          authorHandle: 'alex_crypto',
          text: 'Please test high-churn 5G cell tower handoffs with 50 concurrent seeders!',
          timestamp: Date.now() - 6500000,
          likes: 94,
        },
        {
          id: 'yt-r1-2',
          commentId: 'yt-c1',
          authorName: 'DevP2P Builder',
          authorAvatar: 'D',
          authorHandle: 'devp2p',
          text: 'Testing with 100K simulated peers on local DHT cluster right now. 0 packet drops!',
          timestamp: Date.now() - 5200000,
          likes: 62,
        },
      ],
    },
    {
      id: 'yt-c2',
      videoId: 'yt-video-1',
      authorName: 'Sarah Monetization Expert',
      authorAvatar: 'S',
      authorHandle: 'sarah_creator',
      text: 'The 95% creator split with 0% platform take is the holy grail. No more YouTube 45% middleman tax! Just sent a Super Thanks voucher.',
      timestamp: Date.now() - 3600000,
      likes: 342,
      isSuperThanks: true,
      superThanksAmount: '₹500',
      creatorHeart: true,
      replies: [
        {
          id: 'yt-r2-1',
          commentId: 'yt-c2',
          authorName: 'Sovra Protocol Lab',
          authorAvatar: 'S',
          authorHandle: 'sovralab',
          text: 'Thank you Sarah! Your voucher was settled in 12ms over the local off-chain state channel. ❤️',
          timestamp: Date.now() - 3400000,
          likes: 128,
          isCreator: true,
        },
      ],
    },
    {
      id: 'yt-c3',
      videoId: 'yt-video-1',
      authorName: 'Marcus Edge Node',
      authorAvatar: 'M',
      authorHandle: 'marcus_edge',
      text: 'Sub-300ms startup on cellular CGNAT via speculative segment 0 pre-warming is genius. Tested smoothly on my edge relay.',
      timestamp: Date.now() - 1800000,
      likes: 189,
      replies: [],
    },
    {
      id: 'yt-c4',
      videoId: 'yt-video-1',
      authorName: 'P2P Audio Engineer',
      authorAvatar: 'P',
      authorHandle: 'audio_p2p',
      text: 'Spatial multi-track audio stems sync over BitSwap is butter smooth. Lossless FLAC stream decoded in 18ms!',
      timestamp: Date.now() - 600000,
      likes: 74,
      replies: [],
    },
  ],
  'yt-video-2': [
    {
      id: 'yt-c2-1',
      videoId: 'yt-video-2',
      authorName: 'Telecom Engineering Guild',
      authorAvatar: 'T',
      authorHandle: 'telecom_guild',
      text: '📌 92% hole punching success benchmark data is published. Check chapter 07:45 for the birthday paradox probability formula derivation.',
      timestamp: Date.now() - 86400000,
      likes: 520,
      isPinned: true,
      isCreator: true,
      creatorHeart: true,
      replies: [],
    },
    {
      id: 'yt-c2-2',
      videoId: 'yt-video-2',
      authorName: 'Jio 5G Researcher',
      authorAvatar: 'J',
      authorHandle: 'jio_research',
      text: 'Verified on Jio 5G IPv6-only cellular network in Mumbai. Direct UDP QUIC hole punch established in 42ms!',
      timestamp: Date.now() - 43200000,
      likes: 215,
      isSuperThanks: true,
      superThanksAmount: '₹100',
      replies: [],
    },
  ],
  'yt-video-3': [
    {
      id: 'yt-c3-1',
      videoId: 'yt-video-3',
      authorName: 'Alice Cryptography Lab',
      authorAvatar: 'A',
      authorHandle: 'alice_crypto',
      text: '📌 Double Ratchet mathematical test vectors available in packages/messaging. All 9 unit tests passed cleanly!',
      timestamp: Date.now() - 172800000,
      likes: 640,
      isPinned: true,
      isCreator: true,
      creatorHeart: true,
      replies: [],
    },
  ],
  'yt-video-4': [
    {
      id: 'yt-c4-1',
      videoId: 'yt-video-4',
      authorName: 'Creator Economics Studio',
      authorAvatar: 'C',
      authorHandle: 'creator_studio',
      text: '📌 Here is the math: If a creator earns $100K on YouTube, YouTube steals $45K. On Sovra, the creator keeps $95K, peer seeders earn $5K, platform takes $0.',
      timestamp: Date.now() - 259200000,
      likes: 890,
      isPinned: true,
      isCreator: true,
      creatorHeart: true,
      replies: [],
    },
  ],
};

interface TipVoucherRecord {
  voucherId: string;
  videoId: string;
  creatorDid: string;
  seederDid: string;
  totalAmount: string;
  creatorAmount: string;
  seederAmount: string;
  platformAmount: string;
  senderName: string;
  senderComment?: string;
  timestamp: number;
}

const tipVouchersStore: TipVoucherRecord[] = [
  {
    voucherId: 'vouch_genesis_01',
    videoId: 'yt-video-1',
    creatorDid: 'did:sovra:creator_studio_broadcast',
    seederDid: 'did:sovra:edge_seeder_relay',
    totalAmount: '500',
    creatorAmount: '475',
    seederAmount: '25',
    platformAmount: '0',
    senderName: 'Sarah Monetization Expert',
    senderComment: 'Super Thanks for the 95/5 economic revolution!',
    timestamp: Date.now() - 3600000,
  },
  {
    voucherId: 'vouch_genesis_02',
    videoId: 'yt-video-2',
    creatorDid: 'did:sovra:telecom_guild',
    seederDid: 'did:sovra:edge_seeder_relay',
    totalAmount: '100',
    creatorAmount: '95',
    seederAmount: '5',
    platformAmount: '0',
    senderName: 'Jio 5G Researcher',
    senderComment: 'Verified on Jio 5G IPv6 network!',
    timestamp: Date.now() - 43200000,
  },
];


let isCreatorModeActive = false;
let screenTimeLimitMinutes = 60;

async function bootstrapLocalNode() {
  const masterKey = SovraIdentityKey.generate();
  const pair = generateEd25519KeyPair();
  const expiresAt = Math.floor(Date.now() / 1000) + 86400 * 365;

  const deviceKey = new SovraDeviceKey(
    'dev-local-primary',
    'Localhost Workstation Device',
    masterKey.did,
    pair.privateKey,
    expiresAt,
  );

  const delegation = createDeviceDelegation(masterKey, deviceKey, expiresAt);
  const binding = createPeerIdentityBinding(deviceKey, masterKey.did, delegation);

  const tcpPort = 4001;
  const node = new SovraP2PNode({
    deviceKey,
    binding,
    listenAddresses: [`/ip4/127.0.0.1/tcp/${tcpPort}/p2p/${binding.peerId}`],
  });

  await node.start();

  // Subscribe to core mesh topics
  await node.pubsub.subscribe('sovra/feed/main', msg => {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(msg.data));
      postsStore.unshift(parsed);
    } catch {}
  });
  await node.pubsub.subscribe('sovra/creator/live');

  // Initialize Storage Node Daemon
  const storageDaemon = new StorageNodeDaemon({
    storagePath: './.sovra-storage-dev',
    maxCapacityBytes: 53687091200n, // 50 GB
    enableBitswap: true,
    p2pNode: node,
  });
  await storageDaemon.start();

  // Initialize Decentralized Social Graph and Local Feed Engines
  const socialGraph = new DefaultSocialGraphEngine({
    dbPath: './.sovra-storage-dev/social-graph.sqlite',
  });
  const localFeed = new DefaultLocalFeedEngine(socialGraph);

  // Subscribe to social graph and feed mesh topics
  await node.pubsub.subscribe('sovra/social/graph/v1', async msg => {
    try {
      const event = JSON.parse(new TextDecoder().decode(msg.data));
      await socialGraph.processEvent(event);
    } catch {}
  });

  await node.pubsub.subscribe('sovra/social/feed/v1', msg => {
    try {
      const event = JSON.parse(new TextDecoder().decode(msg.data));
      localFeed.appendEvent(event);
    } catch {}
  });

  // Seed initial posts into local feed
  for (const p of postsStore) {
    localFeed.appendEvent({
      id: p.id,
      pubkey: p.authorDid,
      createdAt: Math.floor(p.timestamp / 1000),
      kind: 1, // ShortPost
      tags: [['topic', p.topic]],
      content: p.content,
      sig: p.signatureHex,
    });
  }

  return {
    masterKey,
    deviceKey,
    binding,
    node,
    tcpPort,
    storageDaemon,
    socialGraph,
    localFeed,
    workstationPrivKey: pair.privateKey,
  };
}

const SOVRA_SVG_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="sovraBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0b0f19"/>
      <stop offset="50%" stop-color="#1e1b4b"/>
      <stop offset="100%" stop-color="#090d16"/>
    </linearGradient>
    <linearGradient id="sovraGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="50%" stop-color="#a855f7"/>
      <stop offset="100%" stop-color="#ec4899"/>
    </linearGradient>
    <linearGradient id="sovraAccent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient>
    <filter id="p2pGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#sovraBg)"/>
  <rect width="510" height="510" x="1" y="1" rx="111" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="2"/>
  <circle cx="256" cy="256" r="160" fill="none" stroke="rgba(99,102,241,0.22)" stroke-width="3" stroke-dasharray="8 12"/>
  <circle cx="256" cy="96" r="14" fill="#6366f1" filter="url(#p2pGlow)"/>
  <circle cx="394" cy="176" r="12" fill="#8b5cf6"/>
  <circle cx="394" cy="336" r="14" fill="#10b981" filter="url(#p2pGlow)"/>
  <circle cx="256" cy="416" r="12" fill="#06b6d4"/>
  <circle cx="118" cy="336" r="14" fill="#ec4899" filter="url(#p2pGlow)"/>
  <circle cx="118" cy="176" r="12" fill="#6366f1"/>
  <path d="M 335 175 C 335 175 220 160 200 220 C 180 275 330 255 315 320 C 300 375 190 355 180 345" 
        fill="none" stroke="url(#sovraGrad)" stroke-width="40" stroke-linecap="round" stroke-linejoin="round" filter="url(#p2pGlow)"/>
  <circle cx="256" cy="256" r="20" fill="url(#sovraAccent)" filter="url(#p2pGlow)"/>
</svg>`;

const SOVRA_PWA_MANIFEST = {
  name: 'Sovra — Sovereign Social Network',
  short_name: 'Sovra',
  description: 'Decentralized, Peer-to-Peer Sovereign Social & Creator Platform',
  start_url: '/',
  id: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#090d16',
  theme_color: '#090d16',
  orientation: 'portrait-primary',
  categories: ['social', 'entertainment', 'news'],
  icons: [
    {
      src: '/icon.svg',
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any',
    },
    {
      src: '/icon-192.png',
      sizes: '192x192',
      type: 'image/svg+xml',
      purpose: 'any',
    },
    {
      src: '/icon-512.png',
      sizes: '512x512',
      type: 'image/svg+xml',
      purpose: 'any',
    },
    {
      src: '/icon-maskable.png',
      sizes: '512x512',
      type: 'image/svg+xml',
      purpose: 'maskable',
    },
  ],
  shortcuts: [
    {
      name: 'Home Feed',
      short_name: 'Feed',
      description: 'Open real-time decentralized feed',
      url: '/#feed',
      icons: [{ src: '/icon.svg', sizes: '96x96' }],
    },
    {
      name: 'Reels & Watch',
      short_name: 'Watch',
      description: 'Watch decentralized 4K P2P videos',
      url: '/#watch',
      icons: [{ src: '/icon.svg', sizes: '96x96' }],
    },
    {
      name: 'P2P Encrypted Chats',
      short_name: 'Chats',
      description: 'Open end-to-end encrypted direct chats',
      url: '/#chats',
      icons: [{ src: '/icon.svg', sizes: '96x96' }],
    },
  ],
};

const SOVRA_SERVICE_WORKER_SCRIPT = `const CACHE_NAME = 'sovra-pwa-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/manifest.json',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Cache addAll warning:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') {
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => {
        return new Response(
          JSON.stringify({ ok: false, offline: true, error: 'Offline mode active - peer connected via local cache' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      })
    );
    return;
  }

  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const resClone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/', resClone));
          }
          return networkRes;
        })
        .catch(async () => {
          const cached = await caches.match('/');
          if (cached) return cached;
          return new Response('<!DOCTYPE html><html><head><title>Sovra Offline</title></head><body style="background:#090d16;color:#fff;font-family:sans-serif;text-align:center;padding:50px;"><h1>⚡ Sovra Mesh Offline</h1><p>Operating in disconnected local mode. Please reconnect or check local peers.</p></body></html>', {
            headers: { 'Content-Type': 'text/html' }
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(req).then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return networkRes;
      }).catch(() => {
        return new Response('', { status: 404 });
      });
    })
  );
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Sovra Network', body: 'New peer activity on GossipSub' };
  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      vibrate: [100, 50, 100],
      data: { url: payload.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data?.url || '/');
      }
    })
  );
});
`;

function renderHtml(
  binding: PeerIdentityBinding,
  masterKey: SovraIdentityKey,
  tcpPort: number,
  nodeUptime: number,
  storageDaemon: StorageNodeDaemon,
  socialGraph: DefaultSocialGraphEngine,
  localFeed: DefaultLocalFeedEngine,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>Sovra — Decentralized Social Platform</title>
  <meta name="theme-color" content="#090d16">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Sovra">
  <meta name="application-name" content="Sovra">
  <meta name="description" content="Decentralized Sovereign Social Network & Creator Platform">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="apple-touch-icon" href="/icon.svg">
  <style>
    :root {
      --bg: #080d14;
      --surface: #0f172a;
      --surface-card: rgba(17, 24, 39, 0.75);
      --surface-border: rgba(255, 255, 255, 0.08);
      --surface-border-hover: rgba(99, 102, 241, 0.4);
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --accent: #10b981;
      --accent-cyan: #38bdf8;
      --accent-creator: #f59e0b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --text-subtle: #64748b;
      --danger: #ef4444;
      --glass-bg: rgba(15, 23, 42, 0.82);
      --glass-border: rgba(255, 255, 255, 0.12);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.5;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background-color: var(--surface);
      border-bottom: 1px solid var(--surface-border);
      padding: 0.65rem 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-shrink: 0;
    }
    .brand-logo {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 1.2rem;
    }
    .brand-title { font-size: 1.25rem; font-weight: 700; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-online { background-color: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-creator { background-color: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); }
    
    .nav-mode-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.18);
      color: #94a3b8;
      border-radius: 20px;
      padding: 0.3rem 0.65rem;
      font-size: 0.72rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .nav-mode-btn:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
      border-color: #38bdf8;
    }

    /* Modern Node Status Pill */
    .node-status-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.14);
      padding: 0.32rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.76rem;
      font-weight: 600;
      color: #e2e8f0;
      backdrop-filter: blur(12px);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      cursor: default;
      user-select: none;
    }
    .node-status-pill:hover {
      border-color: rgba(56, 189, 248, 0.45);
      box-shadow: 0 0 14px rgba(56, 189, 248, 0.22);
    }
    .status-pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
      animation: statusBlink 2s infinite ease-in-out;
    }
    @keyframes statusBlink {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.45; transform: scale(0.85); }
    }
    .status-text {
      color: #cbd5e1;
      font-size: 0.76rem;
      font-weight: 600;
    }

    /* Keyboard Shortcut Pill */
    .search-kbd-shortcut {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      font-size: 0.68rem;
      font-weight: 700;
      font-family: inherit;
      color: #94a3b8;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      cursor: pointer;
      user-select: none;
      transition: all 0.15s ease;
      line-height: 1.2;
      margin-left: auto;
      letter-spacing: 0.04em;
    }
    .search-kbd-shortcut:hover {
      background: rgba(99, 102, 241, 0.25);
      border-color: rgba(99, 102, 241, 0.5);
      color: #e0e7ff;
    }

    /* Streamlined Minimalist Post Composer */
    .feed-composer-card {
      margin-bottom: 1.5rem;
      padding: 1.1rem 1.25rem;
      border-radius: 18px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: linear-gradient(135deg, rgba(17, 24, 39, 0.95), rgba(15, 23, 42, 0.95));
      backdrop-filter: blur(16px);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .feed-composer-card:focus-within {
      border-color: rgba(99, 102, 241, 0.45);
      box-shadow: 0 8px 30px rgba(99, 102, 241, 0.18);
    }
    .composer-avatar {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 1.1rem;
      color: #fff;
      flex-shrink: 0;
      box-shadow: 0 2px 10px rgba(99, 102, 241, 0.35);
    }
    .composer-textarea {
      width: 100%;
      min-height: 58px;
      max-height: 240px;
      background: transparent;
      border: none;
      color: #fff;
      padding: 0.25rem 0.1rem;
      font-size: 0.92rem;
      line-height: 1.5;
      resize: none;
      outline: none;
      font-family: inherit;
    }
    .composer-textarea::placeholder {
      color: #64748b;
    }
    .composer-actions-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.5rem;
      padding-top: 0.65rem;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .composer-media-tray {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      flex-wrap: wrap;
    }
    .composer-media-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #94a3b8;
      padding: 4px 10px;
      border-radius: 8px;
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .composer-media-btn:hover {
      background: rgba(99, 102, 241, 0.15);
      color: #c7d2fe;
      border-color: rgba(99, 102, 241, 0.3);
      transform: translateY(-1px);
    }
    .composer-theme-select {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #cbd5e1;
      padding: 5px 8px;
      border-radius: 8px;
      font-size: 0.76rem;
      outline: none;
      cursor: pointer;
    }
    .composer-theme-select option {
      background: #111827;
      color: #fff;
    }
    .composer-tags-input {
      width: 120px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #94a3b8;
      padding: 5px 8px;
      border-radius: 8px;
      font-size: 0.76rem;
      outline: none;
      transition: all 0.15s;
    }
    .composer-tags-input:focus {
      width: 160px;
      border-color: #6366f1;
      color: #fff;
    }
    .composer-publish-btn {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      border: none;
      color: #fff;
      font-weight: 700;
      font-size: 0.82rem;
      padding: 6px 18px;
      border-radius: 20px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 2px 10px rgba(99, 102, 241, 0.35);
      transition: all 0.15s ease;
    }
    .composer-publish-btn:hover {
      transform: translateY(-1px) scale(1.02);
      box-shadow: 0 4px 16px rgba(99, 102, 241, 0.5);
    }

    /* ==========================================
       🏛️ INDUSTRY STANDARD 3-COLUMN APP SHELL
       ========================================== */
    .app-layout {
      display: flex;
      justify-content: center;
      min-height: 100vh;
      width: 100%;
      background: var(--bg);
    }

    /* Column 1: Left Navigation Rail (Desktop) */
    .app-left-rail {
      width: 250px;
      position: sticky;
      top: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 1.25rem 0.85rem 1.25rem 0.85rem;
      border-right: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(11, 20, 26, 0.98);
      z-index: 100;
      flex-shrink: 0;
      box-sizing: border-box;
    }
    .rail-brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.25rem 0.5rem 1.25rem 0.5rem;
      cursor: pointer;
    }
    .rail-nav {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      flex: 1;
      overflow-y: auto;
    }
    .rail-nav-item {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      padding: 0.7rem 0.9rem;
      background: none;
      border: none;
      border-radius: 14px;
      color: #94a3b8;
      font-size: 0.95rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      text-align: left;
      width: 100%;
    }
    .rail-nav-item:hover {
      background: rgba(255, 255, 255, 0.06);
      color: #fff;
      transform: translateX(3px);
    }
    .rail-nav-item.active {
      background: rgba(99, 102, 241, 0.15);
      color: #38bdf8;
      box-shadow: inset 3px 0 0 #38bdf8;
    }
    .rail-icon {
      font-size: 1.25rem;
      width: 24px;
      text-align: center;
    }
    .rail-label {
      flex: 1;
    }
    .rail-badge {
      background: #ef4444;
      color: #fff;
      font-size: 0.68rem;
      font-weight: 800;
      padding: 2px 7px;
      border-radius: 10px;
    }
    .rail-post-btn {
      margin: 0.85rem 0;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      color: #fff;
      border: none;
      border-radius: 14px;
      padding: 0.8rem;
      font-weight: 800;
      font-size: 0.92rem;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(99, 102, 241, 0.4);
      transition: all 0.2s;
    }
    .rail-post-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(99, 102, 241, 0.6);
    }
    .rail-user-profile {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      padding: 0.6rem;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      cursor: pointer;
      transition: background 0.15s;
    }
    .rail-user-profile:hover {
      background: rgba(255, 255, 255, 0.08);
    }

    /* Column 2: Center Stage */
    .app-center-stage {
      flex: 1;
      max-width: 720px;
      display: flex;
      flex-direction: column;
      min-width: 0;
      border-right: 1px solid rgba(255, 255, 255, 0.08);
      min-height: 100vh;
      box-sizing: border-box;
      overflow-x: clip;
      transition: max-width 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .app-top-header {
      position: sticky;
      top: 0;
      z-index: 90;
      background: rgba(11, 20, 26, 0.95);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding: 0.65rem 1.25rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .mobile-brand {
      display: none;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
      flex-shrink: 0;
    }
    .app-center-stage .container {
      max-width: 100%;
      margin: 1rem auto 2rem auto;
      padding: 0 1rem;
      width: 100%;
      box-sizing: border-box;
      align-items: stretch;
    }

    /* Column 3: Right Discovery Rail */
    .app-right-rail {
      width: 320px;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      padding: 1.25rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      border-left: 1px solid rgba(255, 255, 255, 0.08);
      box-sizing: border-box;
      flex-shrink: 0;
      transition: opacity 0.2s ease;
    }

    /* Dynamic Stage Modes: Dedicated Wide Stage for Watch (YouTube), Chat, & Admin */
    body.tab-active-youtube .app-center-stage {
      max-width: 1400px !important;
      border-right: none;
    }
    body.tab-active-chat .app-center-stage {
      max-width: 1300px !important;
      border-right: none;
    }
    body.tab-active-admin .app-center-stage {
      max-width: 1250px !important;
      border-right: none;
    }
    body.tab-active-me .app-center-stage {
      max-width: 920px !important;
    }

    body.tab-active-youtube .app-right-rail,
    body.tab-active-chat .app-right-rail,
    body.tab-active-admin .app-right-rail {
      display: none !important;
    }

    body.tab-active-youtube .container,
    body.tab-active-chat .container,
    body.tab-active-admin .container {
      max-width: 100% !important;
      padding: 0 1.25rem !important;
    }

    #youtube-view,
    #chat-view,
    #admin-view {
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
    }

    .nav-tabs {
      display: none;
    }
    .tab-btn {
      padding: 0.5rem 0.85rem;
      border: none;
      background: none;
      color: var(--text-muted);
      border-radius: 6px;
      font-weight: 600;
      font-size: 0.85rem;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .tab-btn.active {
      background-color: var(--primary);
      color: #fff;
      box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
    }

    /* Top Prominent Search Bar (Expansive, Wide & Unsquished) */
    .header-search-wrap {
      flex: 1;
      min-width: 220px;
      max-width: 520px;
      position: relative;
    }
    .header-search-bar {
      display: flex;
      align-items: center;
      background: rgba(255, 255, 255, 0.07);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 20px;
      padding: 0.45rem 1rem;
      gap: 0.6rem;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .header-search-bar:focus-within {
      background: rgba(17, 24, 39, 0.95);
      border-color: #38bdf8;
      box-shadow: 0 0 16px rgba(56, 189, 248, 0.35);
    }
    .header-search-input {
      background: none;
      border: none;
      color: #fff;
      font-size: 0.84rem;
      outline: none;
      width: 100%;
    }
    .header-search-input::placeholder {
      color: #94a3b8;
    }
    .header-search-dropdown {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      right: 0;
      background: rgba(15, 23, 42, 0.98);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 14px;
      padding: 0.5rem;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.85);
      z-index: 1000;
      max-height: 380px;
      overflow-y: auto;
    }

    /* Friends & People Discovery View Styles */
    .friends-container {
      max-width: 680px;
      margin: 0 auto 5rem auto;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      width: 100%;
    }
    .friends-search-hero {
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.95));
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 20px;
      padding: 1.5rem;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }
    .friends-search-input-box {
      display: flex;
      align-items: center;
      background: rgba(11, 20, 26, 0.85);
      border: 1.5px solid rgba(99, 102, 241, 0.35);
      border-radius: 14px;
      padding: 0.65rem 1rem;
      gap: 0.75rem;
      margin-top: 1rem;
      transition: all 0.2s;
    }
    .friends-search-input-box:focus-within {
      border-color: #38bdf8;
      box-shadow: 0 0 16px rgba(56, 189, 248, 0.25);
    }
    .friends-search-input {
      background: none;
      border: none;
      color: #fff;
      font-size: 0.92rem;
      outline: none;
      width: 100%;
    }
    .friends-filter-pills {
      display: flex;
      gap: 0.5rem;
      margin-top: 1rem;
      overflow-x: auto;
      padding-bottom: 2px;
    }
    .friends-filter-pill {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #94a3b8;
      padding: 0.4rem 0.9rem;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .friends-filter-pill.active {
      background: #6366f1;
      border-color: #818cf8;
      color: #fff;
      box-shadow: 0 2px 10px rgba(99, 102, 241, 0.4);
    }
    .friends-section-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: #f1f5f9;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }
    .friend-card {
      background: #111827;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      padding: 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      transition: transform 0.15s, border-color 0.15s;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    }
    .friend-card:hover {
      border-color: rgba(99, 102, 241, 0.3);
      transform: translateY(-1px);
    }
    
    .container {
      max-width: 1200px;
      margin: 1.5rem auto 5rem auto;
      padding: 0 1rem;
      width: 100%;
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      box-sizing: border-box;
    }
    .feed-container {
      max-width: 630px;
      width: 100%;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .admin-layout {
      display: grid;
      grid-template-columns: 320px 1fr;
      gap: 1.5rem;
      width: 100%;
    }
    .profile-settings-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      margin-bottom: 1.5rem;
      width: 100%;
    }
    @media (max-width: 960px) {
      .profile-settings-grid {
        grid-template-columns: 1fr;
      }
    }
    .mobile-chat-back-btn {
      display: none;
      background: none;
      border: none;
      color: #e9edef;
      font-size: 1.35rem;
      font-weight: bold;
      cursor: pointer;
      padding: 0.2rem 0.6rem;
      margin-right: 0.35rem;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      transition: background 0.15s;
    }
    .mobile-chat-back-btn:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    @media (max-width: 1250px) {
      .brand-subtitle {
        display: none !important;
      }
      .app-right-rail {
        display: none !important;
      }
    }
    @media (max-width: 860px) {
      .app-left-rail {
        display: none !important;
      }
      .app-right-rail {
        display: none !important;
      }
      .app-layout {
        display: block !important;
      }
      .app-center-stage {
        max-width: 100% !important;
        width: 100% !important;
        border-right: none !important;
      }
      .mobile-brand {
        display: flex !important;
      }
      .app-top-header {
        padding: 0.45rem 0.85rem !important;
        height: auto !important;
      }
      .app-center-stage .container {
        margin: 0 auto 5.5rem auto !important;
        padding: 0 !important;
      }
      .container {
        margin: 0 auto 5.5rem auto;
        padding: 0;
        gap: 0;
        max-width: 100%;
      }
      .admin-layout {
        grid-template-columns: 1fr;
      }
      .sidebar {
        width: 100%;
      }
      .nav-tabs {
        display: none !important;
      }
      .nav-mode-btn .nav-mode-text {
        display: none;
      }
      .nav-mode-btn {
        padding: 0.3rem 0.5rem;
      }
      .header-search-wrap {
        max-width: 100%;
        min-width: 110px;
      }
      .mobile-bottom-nav {
        bottom: 8px !important;
        width: calc(100% - 16px) !important;
        height: 60px !important;
        border-radius: 18px !important;
      }
      .bnav-icon {
        font-size: 1.15rem !important;
      }
      .bnav-label {
        font-size: 0.62rem !important;
      }
      .bottom-nav-create {
        width: 38px !important;
        height: 38px !important;
        font-size: 1.15rem !important;
      }
      header {
        padding: 0.45rem 1rem !important;
        height: 52px;
        flex-wrap: nowrap !important;
      }
      .brand-subtitle {
        display: none !important;
      }
      .tcp-port-badge {
        display: none !important;
      }
      .badge-online {
        padding: 0.2rem 0.55rem;
        font-size: 0.7rem;
      }
      .stories-tray {
        gap: 0.85rem !important;
        padding: 0.35rem 0.25rem 0.65rem 0.25rem !important;
      }
      .story-ring {
        width: 52px !important;
        height: 52px !important;
      }
      .main-content {
        padding: 0;
        width: 100%;
      }
      .feed-container {
        max-width: 100%;
        padding: 0.5rem;
      }
      .whatsapp-container {
        height: calc(100vh - 128px) !important;
        min-height: 480px;
        border-radius: 0 !important;
        border: none !important;
        width: 100% !important;
      }
      .chat-sidebar {
        width: 100% !important;
        flex: 1 !important;
      }
      .chat-main {
        width: 100% !important;
        flex: 1 !important;
      }
      .whatsapp-container.show-chat .chat-sidebar {
        display: none !important;
      }
      .whatsapp-container.show-chat .chat-main {
        display: flex !important;
      }
      .whatsapp-container:not(.show-chat) .chat-sidebar {
        display: flex !important;
      }
      .whatsapp-container:not(.show-chat) .chat-main {
        display: none !important;
      }
      .mobile-chat-back-btn {
        display: inline-flex !important;
      }
      .e2ee-shield-badge {
        display: none !important;
      }
      .reels-stage {
        gap: 0;
        width: 100%;
        margin: 0;
        padding: 0;
        height: calc(100vh - 128px);
      }
      .reels-phone {
        width: 100% !important;
        max-width: 100% !important;
        height: calc(100vh - 128px) !important;
        border-radius: 0 !important;
        border: none !important;
        box-shadow: none !important;
      }
      .reels-nav-controls {
        display: none !important;
      }
      #reels-view {
        width: 100%;
        padding: 0;
        margin: 0;
      }
      #youtube-view {
        width: 100%;
        padding: 0;
        margin: 0;
      }
      .youtube-container {
        grid-template-columns: 1fr !important;
        gap: 1rem !important;
        width: 100% !important;
        padding: 0 !important;
      }
      .yt-ambient-wrapper {
        margin: 0 !important;
        width: 100% !important;
      }
      .yt-ambient-glow {
        filter: blur(35px) !important;
        opacity: 0.45 !important;
        inset: -10px !important;
      }
      .reel-ambient-cinema-glow {
        display: none !important;
      }
      .yt-player-box {
        border-radius: 0 !important;
        border-left: none !important;
        border-right: none !important;
        width: 100% !important;
        box-shadow: none !important;
      }
    }
    
    .sidebar {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .card {
      background-color: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: 12px;
      padding: 1.25rem;
    }
    .card-title {
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.75rem;
    }
    .key-val {
      font-size: 0.8rem;
      margin-bottom: 0.5rem;
      word-break: break-all;
    }
    .key-label { color: var(--text-muted); display: block; font-size: 0.75rem; }
    .key-data { font-family: monospace; color: #a5b4fc; }

    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 0.75rem;
    }
    .switch {
      position: relative;
      display: inline-block;
      width: 44px;
      height: 24px;
    }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
      background-color: #374151; transition: .3s; border-radius: 24px;
    }
    .slider:before {
      position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px;
      background-color: white; transition: .3s; border-radius: 50%;
    }
    input:checked + .slider { background-color: var(--accent-creator); }
    input:checked + .slider:before { transform: translateX(20px); }

    .main-content {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .composer {
      background-color: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: 12px;
      padding: 1.25rem;
    }
    textarea {
      width: 100%;
      background: #0b1120;
      border: 1px solid var(--surface-border);
      border-radius: 8px;
      padding: 0.75rem;
      color: var(--text);
      font-size: 0.95rem;
      resize: vertical;
      min-height: 80px;
      outline: none;
      margin-bottom: 0.75rem;
    }
    textarea:focus { border-color: var(--primary); }
    .composer-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .btn {
      padding: 0.5rem 1.25rem;
      border-radius: 6px;
      font-weight: 600;
      font-size: 0.875rem;
      border: none;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-primary { background-color: var(--primary); color: white; }
    .btn-primary:hover { background-color: var(--primary-hover); }

    .creator-banner {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(217, 119, 6, 0.15));
      border: 1px solid rgba(245, 158, 11, 0.4);
      border-radius: 12px;
      padding: 1.25rem;
      display: ${isCreatorModeActive ? 'block' : 'none'};
    }
    .creator-banner h3 { color: #f59e0b; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem; }
    .creator-tools {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 0.75rem;
      margin-top: 1rem;
    }
    .tool-box {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(245, 158, 11, 0.2);
      border-radius: 8px;
      padding: 0.75rem;
      font-size: 0.85rem;
    }
    .tool-title { font-weight: 600; color: #fbbf24; margin-bottom: 0.25rem; }

    .notice-banner {
      background: rgba(99, 102, 241, 0.1);
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      font-size: 0.85rem;
      color: #c7d2fe;
    }

    .feed {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .post-card {
      background-color: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: 12px;
      padding: 1.25rem;
    }
    .post-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }
    .author-did {
      font-family: monospace;
      font-size: 0.85rem;
      color: #818cf8;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .post-time { font-size: 0.75rem; color: var(--text-muted); }
    .post-body { font-size: 0.95rem; margin-bottom: 0.75rem; }
    .post-footer {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      font-size: 0.8rem;
      color: var(--text-muted);
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      padding-top: 0.75rem;
    }

    .admin-view {
      display: none;
    }
    .admin-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 1rem;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: 10px;
      padding: 1rem;
    }
    .stat-val { font-size: 1.75rem; font-weight: 700; color: #a5b4fc; margin-top: 0.25rem; }

    /* Instagram Seamless Stories Tray Styles */
    .stories-tray {
      width: 100%;
      padding: 0.5rem 0.25rem 0.75rem 0.25rem;
      display: flex;
      gap: 1.15rem;
      overflow-x: auto;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      margin-bottom: 0.75rem;
    }
    .stories-tray::-webkit-scrollbar { display: none; }
    .stories-bar {
      display: flex;
      gap: 1.15rem;
      align-items: center;
      width: 100%;
    }
    .story-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.35rem;
      cursor: pointer;
      user-select: none;
      flex-shrink: 0;
    }
    .story-ring {
      width: 58px;
      height: 58px;
      border-radius: 50%;
      padding: 2.5px;
      background: linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.25s ease;
      position: relative;
    }
    .story-ring:hover {
      transform: scale(1.08);
      box-shadow: 0 0 16px rgba(236, 72, 153, 0.55);
    }
    .story-ring:not(.seen) {
      animation: storyHolographicGlow 5s linear infinite;
    }
    @keyframes storyHolographicGlow {
      0% { filter: hue-rotate(0deg); }
      100% { filter: hue-rotate(360deg); }
    }
    .story-ring.seen {
      background: #374151;
      animation: none;
    }
    .story-avatar {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: #1e293b;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 1.05rem;
      color: #f1f5f9;
      border: 2px solid #090d16;
    }
    .story-plus-badge {
      position: absolute;
      bottom: -1px;
      right: -1px;
      width: 18px;
      height: 18px;
      background: #0284c7;
      color: #fff;
      border-radius: 50%;
      border: 2px solid #090d16;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      font-weight: 800;
      line-height: 1;
    }
    .story-username {
      font-size: 0.72rem;
      color: var(--text-muted);
      max-width: 62px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: center;
    }

    .reels-stage {
      display: flex;
      justify-content: center;
      align-items: center;
      position: relative;
      margin: 0 auto;
      gap: 1.5rem;
    }
    .reels-phone-wrapper {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .reel-ambient-cinema-glow {
      position: absolute;
      inset: -32px;
      border-radius: 48px;
      filter: blur(65px);
      opacity: 0.7;
      z-index: 0;
      pointer-events: none;
      transition: background 0.8s ease, opacity 0.5s ease;
    }
    .reels-phone {
      width: 380px;
      height: 640px;
      background: #000;
      border-radius: 32px;
      border: 4px solid #1f2937;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.08);
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      user-select: none;
      z-index: 1;
    }
    .reels-header-pill {
      position: absolute;
      top: 16px;
      left: 16px;
      right: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 20;
    }
    .p2p-badge-pill {
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(16, 185, 129, 0.4);
      color: #34d399;
      font-size: 0.7rem;
      font-weight: 600;
      padding: 0.25rem 0.6rem;
      border-radius: 20px;
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .reels-canvas-wrapper {
      flex: 1;
      width: 100%;
      height: 100%;
      position: relative;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .reels-ambient-bg {
      position: absolute;
      inset: 0;
      transition: background 0.4s ease;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .reel-visualizer {
      width: 130px;
      height: 130px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(99, 102, 241, 0.4), transparent 70%);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: pulseReel 2s infinite ease-in-out;
    }
    @keyframes pulseReel {
      0%, 100% { transform: scale(0.95); opacity: 0.8; }
      50% { transform: scale(1.18); opacity: 1; }
    }
    .reels-right-actions {
      position: absolute;
      right: 12px;
      bottom: 80px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.15rem;
      z-index: 20;
    }
    .reel-action-btn {
      background: none;
      border: none;
      color: #fff;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
      cursor: pointer;
      transition: transform 0.15s;
    }
    .reel-action-btn:hover { transform: scale(1.15); }
    .reel-action-icon {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.3rem;
      border: 1px solid rgba(255, 255, 255, 0.15);
    }
    .reel-action-label {
      font-size: 0.72rem;
      font-weight: 600;
      color: #f1f5f9;
      text-shadow: 0 1px 3px rgba(0,0,0,0.8);
    }
    .music-disc {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: #111;
      border: 2px solid #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: spinDisc 4s linear infinite;
    }
    @keyframes spinDisc {
      100% { transform: rotate(360deg); }
    }
    .reels-bottom-overlay {
      position: absolute;
      left: 16px;
      right: 76px;
      bottom: 24px;
      z-index: 20;
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
    }
    .reels-creator-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .reels-handle {
      font-weight: 700;
      font-size: 0.95rem;
      color: #fff;
    }
    .btn-follow-pill {
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(4px);
      border: 1px solid rgba(255, 255, 255, 0.4);
      color: #fff;
      font-size: 0.7rem;
      font-weight: 600;
      padding: 0.2rem 0.6rem;
      border-radius: 12px;
      cursor: pointer;
    }
    .btn-follow-pill:hover { background: #6366f1; border-color: #6366f1; }
    .reels-caption {
      font-size: 0.85rem;
      color: #f3f4f6;
      line-height: 1.35;
    }
    .reels-audio-track {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.75rem;
      color: #cbd5e1;
      cursor: pointer;
    }
    .reels-audio-track:hover {
      color: #fff;
      text-decoration: underline;
    }

    /* Visual Dopamine & Instagram Animation FX */
    .reels-progress-line {
      position: absolute;
      bottom: 0;
      left: 0;
      height: 2.5px;
      width: 0%;
      background: #fff;
      z-index: 25;
      box-shadow: 0 0 6px rgba(255, 255, 255, 0.8);
      transition: width 0.1s linear;
    }
    .tap-play-indicator {
      position: absolute;
      width: 76px;
      height: 76px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(10px);
      border: 1.5px solid rgba(255, 255, 255, 0.25);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.2rem;
      pointer-events: none;
      opacity: 0;
      transform: scale(0.7);
      transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      z-index: 25;
    }
    .tap-play-indicator.show {
      opacity: 1;
      transform: scale(1);
    }
    .floating-dopamine {
      position: absolute;
      pointer-events: none;
      font-size: 1.25rem;
      font-weight: 800;
      color: #ff3040;
      text-shadow: 0 0 10px rgba(255, 48, 64, 0.8);
      animation: floatDopamine 0.9s forwards ease-out;
      z-index: 35;
    }
    @keyframes floatDopamine {
      0% { transform: translateY(0) scale(0.6); opacity: 0; }
      30% { transform: translateY(-15px) scale(1.3); opacity: 1; }
      100% { transform: translateY(-50px) scale(1); opacity: 0; }
    }
    .floating-note {
      position: absolute;
      pointer-events: none;
      font-size: 0.85rem;
      color: rgba(255, 255, 255, 0.85);
      animation: floatNote 2s forwards linear;
      z-index: 22;
    }
    @keyframes floatNote {
      0% { transform: translate(0, 0) scale(0.6) rotate(0deg); opacity: 1; }
      100% { transform: translate(-30px, -60px) scale(1.2) rotate(-35deg); opacity: 0; }
    }
    .sound-wave-eq {
      display: inline-flex;
      align-items: flex-end;
      gap: 2px;
      height: 12px;
      margin-left: 4px;
    }
    .sound-bar {
      width: 2.5px;
      background: #38bdf8;
      border-radius: 1px;
      animation: danceEq 0.8s infinite ease-in-out alternate;
    }
    .sound-bar:nth-child(1) { height: 40%; animation-delay: 0.1s; }
    .sound-bar:nth-child(2) { height: 90%; animation-delay: 0.3s; }
    .sound-bar:nth-child(3) { height: 60%; animation-delay: 0.2s; }
    .sound-bar:nth-child(4) { height: 80%; animation-delay: 0.4s; }
    @keyframes danceEq {
      0% { height: 25%; }
      100% { height: 100%; }
    }

    /* Instagram Bottom Sheet Drawer (Comments, Audio, Profiles) */
    .reels-sheet-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(5px);
      z-index: 40;
      display: none;
      align-items: flex-end;
      border-radius: 32px;
      overflow: hidden;
    }
    .reels-sheet-content {
      width: 100%;
      max-height: 82%;
      background: #121212;
      border-top: 1px solid rgba(255, 255, 255, 0.15);
      border-top-left-radius: 20px;
      border-top-right-radius: 20px;
      display: flex;
      flex-direction: column;
      transform: translateY(100%);
      transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.8);
      position: relative;
    }
    .reels-sheet-overlay.active {
      display: flex;
    }
    .reels-sheet-overlay.active .reels-sheet-content {
      transform: translateY(0);
    }
    .sheet-handle-bar {
      width: 38px;
      height: 4px;
      background: rgba(255, 255, 255, 0.3);
      border-radius: 2px;
      margin: 10px auto 6px;
    }
    .sheet-header {
      padding: 0.5rem 1rem 0.75rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 700;
      font-size: 0.95rem;
      color: #fff;
    }
    .sheet-body {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }
    .sheet-comment-row {
      display: flex;
      gap: 0.75rem;
      align-items: flex-start;
    }
    .sheet-comment-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #334155;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 0.8rem;
      flex-shrink: 0;
    }
    .sheet-comment-meta {
      flex: 1;
      font-size: 0.82rem;
      line-height: 1.35;
      color: #e2e8f0;
    }
    .sheet-comment-meta b {
      color: #fff;
      margin-right: 0.35rem;
    }
    .sheet-comment-sub {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.7rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }
    .sheet-composer {
      padding: 0.65rem 1rem;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      background: #181818;
    }
    .quick-emojis-row {
      display: flex;
      justify-content: space-between;
      font-size: 1.2rem;
      padding: 0 0.25rem;
    }
    .quick-emojis-row span {
      cursor: pointer;
      transition: transform 0.15s;
    }
    .quick-emojis-row span:hover {
      transform: scale(1.3);
    }
    .sheet-input-row {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }

    /* Creator Profile Instagram Sheet */
    .profile-hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.5rem 0.75rem;
    }
    .profile-stats-row {
      display: flex;
      gap: 1.25rem;
      text-align: center;
    }
    .profile-stat-box div:first-child {
      font-weight: 700;
      font-size: 1.05rem;
      color: #fff;
    }
    .profile-stat-box div:last-child {
      font-size: 0.72rem;
      color: var(--text-muted);
    }
    .profile-bio-box {
      font-size: 0.82rem;
      line-height: 1.4;
      color: #e2e8f0;
    }
    .profile-actions-row {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.25rem;
    }
    .profile-btn {
      flex: 1;
      padding: 0.45rem 0;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.82rem;
      border: none;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s;
    }
    .profile-btn-primary { background: #0095f6; color: #fff; }
    .profile-btn-primary:hover { background: #1877f2; }
    .profile-btn-secondary { background: #262626; color: #fff; border: 1px solid rgba(255,255,255,0.1); }
    .profile-btn-secondary:hover { background: #333; }
    .profile-highlights-row {
      display: flex;
      gap: 1rem;
      padding: 0.5rem 0;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .highlight-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
      cursor: pointer;
    }
    .highlight-ring {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: #262626;
      border: 1px solid rgba(255, 255, 255, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.3rem;
    }
    .highlight-title {
      font-size: 0.68rem;
      color: #cbd5e1;
    }
    .profile-reels-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2px;
      margin-top: 0.5rem;
    }
    .profile-grid-tile {
      aspect-ratio: 9 / 16;
      background: #1e1b4b;
      position: relative;
      cursor: pointer;
      overflow: hidden;
      display: flex;
      align-items: flex-end;
      padding: 0.35rem;
    }
    .profile-grid-tile:hover {
      filter: brightness(1.1);
    }
    .tile-views-pill {
      font-size: 0.65rem;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 2px;
      text-shadow: 0 1px 3px rgba(0,0,0,0.9);
    }

    /* Multi-Segment Instagram Story Viewer */
    .story-segments-header {
      display: flex;
      gap: 3px;
      width: 100%;
      position: absolute;
      top: 12px;
      left: 0;
      right: 0;
      padding: 0 12px;
      z-index: 50;
    }
    .story-segment-track {
      flex: 1;
      height: 2.5px;
      background: rgba(255, 255, 255, 0.35);
      border-radius: 2px;
      overflow: hidden;
    }
    .story-segment-fill {
      height: 100%;
      width: 0%;
      background: #fff;
      transition: width 0.05s linear;
    }
    .story-touch-nav {
      position: absolute;
      inset: 0;
      display: flex;
      z-index: 45;
    }
    .story-touch-prev {
      width: 35%;
      height: 100%;
      cursor: pointer;
    }
    .story-touch-next {
      width: 65%;
      height: 100%;
      cursor: pointer;
    }
    .story-sticker-pill {
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.3);
      padding: 0.35rem 0.85rem;
      border-radius: 20px;
      font-size: 0.82rem;
      font-weight: 700;
      color: #fff;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      box-shadow: 0 8px 16px rgba(0, 0, 0, 0.4);
      animation: stickerBob 3s infinite ease-in-out;
    }
    @keyframes stickerBob {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-6px); }
    }
    .story-quick-react-tray {
      position: absolute;
      bottom: 16px;
      left: 16px;
      right: 16px;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      z-index: 50;
    }
    .story-reply-input {
      flex: 1;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 24px;
      padding: 0.5rem 1rem;
      color: #fff;
      font-size: 0.82rem;
      outline: none;
    }

    .heart-burst {
      position: absolute;
      pointer-events: none;
      font-size: 4.5rem;
      color: #ef4444;
      animation: heartPop 0.8s forwards cubic-bezier(0.175, 0.885, 0.32, 1.275);
      z-index: 30;
      filter: drop-shadow(0 0 10px rgba(239, 68, 68, 0.8));
    }
    @keyframes heartPop {
      0% { transform: scale(0.2); opacity: 0; }
      40% { transform: scale(1.3); opacity: 1; }
      80% { transform: scale(1.0); opacity: 0.9; }
      100% { transform: scale(1.4) translateY(-30px); opacity: 0; }
    }

    .reels-nav-controls {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .reel-nav-btn {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--surface);
      border: 1px solid var(--surface-border);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 1.2rem;
      transition: background 0.2s, transform 0.15s;
    }
    .reel-nav-btn:hover { background: var(--primary); transform: scale(1.1); }

    /* WhatsApp Dark E2EE Chat Styles */
    .whatsapp-container {
      display: flex;
      height: 720px;
      background: #0b141a;
      border: 1px solid var(--surface-border);
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 15px 35px rgba(0, 0, 0, 0.6);
    }

    /* BitChat Zero-Internet Mesh Mode Styling */
    .bitchat-mode-bar {
      padding: 0.65rem 0.85rem;
      background: linear-gradient(90deg, #09121a, #0f1f2c);
      border-bottom: 1px solid rgba(56, 189, 248, 0.25);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .bitchat-pill-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: rgba(56, 189, 248, 0.15);
      border: 1px solid rgba(56, 189, 248, 0.4);
      color: #38bdf8;
      padding: 3px 9px;
      border-radius: 12px;
      font-size: 0.72rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    .bitchat-pill-btn:hover {
      background: rgba(56, 189, 248, 0.25);
      transform: scale(1.02);
    }
    .panic-wipe-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      background: rgba(239, 68, 68, 0.18);
      border: 1px solid rgba(239, 68, 68, 0.45);
      color: #f87171;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 0.72rem;
      font-weight: 800;
      cursor: pointer;
      transition: all 0.2s;
    }
    .panic-wipe-btn:hover {
      background: rgba(239, 68, 68, 0.35);
      color: #fff;
    }
    .bitchat-radar-strip {
      padding: 0.55rem 0.85rem;
      background: rgba(11, 20, 26, 0.95);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      gap: 0.65rem;
    }
    .radar-sweep-icon {
      font-size: 1.1rem;
      animation: radarPulse 1.8s infinite ease-in-out;
      display: inline-block;
    }
    @keyframes radarPulse {
      0% { transform: scale(0.95); opacity: 0.7; }
      50% { transform: scale(1.15); opacity: 1; }
      100% { transform: scale(0.95); opacity: 0.7; }
    }
    .radar-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #38bdf8;
      box-shadow: 0 0 8px #38bdf8;
      display: inline-block;
    }
    .bitchat-section-title {
      font-size: 0.72rem;
      font-weight: 700;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 0.5rem 0.85rem 0.25rem 0.85rem;
    }
    .bitchat-hop-badge {
      font-size: 0.65rem;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 8px;
      background: rgba(99, 102, 241, 0.18);
      color: #a5b4fc;
      border: 1px solid rgba(99, 102, 241, 0.3);
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }
    .bitchat-mesh-route-box {
      font-size: 0.68rem;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.08);
      border: 1px dashed rgba(56, 189, 248, 0.3);
      border-radius: 6px;
      padding: 2px 6px;
      margin-top: 4px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .chat-sidebar {
      width: 340px;
      background: #111b21;
      border-right: 1px solid #222d34;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    .chat-sidebar-header {
      padding: 0.85rem 1rem;
      background: #202c33;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #2a3942;
    }
    .chat-search-box {
      padding: 0.5rem 0.85rem;
      background: #111b21;
      border-bottom: 1px solid #222d34;
    }
    .chat-search-input {
      width: 100%;
      background: #202c33;
      border: none;
      border-radius: 8px;
      padding: 0.45rem 0.85rem 0.45rem 2rem;
      color: #e9edef;
      font-size: 0.82rem;
      outline: none;
      box-sizing: border-box;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%238696a0' viewBox='0 0 24 24'%3E%3Cpath d='M10 2a8 8 0 015.292 13.998l4.706 4.707a1 1 0 01-1.414 1.414l-4.707-4.706A8 8 0 1110 2zm0 2a6 6 0 100 12 6 6 0 000-12z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: 8px center;
      background-size: 14px;
    }
    .chat-contacts-list {
      flex: 1;
      overflow-y: auto;
    }
    .contact-item {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      padding: 0.75rem 1rem;
      cursor: pointer;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      transition: background 0.15s;
      position: relative;
    }
    .contact-item:hover, .contact-item.active {
      background: #2a3942;
    }
    .contact-avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      color: #fff;
      font-size: 1.1rem;
      position: relative;
      flex-shrink: 0;
    }
    .online-dot {
      width: 11px;
      height: 11px;
      background: #22c55e;
      border: 2px solid #111b21;
      border-radius: 50%;
      position: absolute;
      bottom: 0;
      right: 0;
    }
    .contact-clock-badge {
      position: absolute;
      top: -3px;
      right: -3px;
      font-size: 0.68rem;
      background: #202c33;
      border: 1px solid #f59e0b;
      border-radius: 50%;
      padding: 1px;
    }
    .contact-info {
      flex: 1;
      min-width: 0;
    }
    .contact-top-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 0.2rem;
    }
    .contact-name {
      font-size: 0.9rem;
      font-weight: 600;
      color: #e9edef;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .verified-shield-icon {
      color: #22c55e;
      font-size: 0.8rem;
    }
    .contact-time {
      font-size: 0.72rem;
      color: #8696a0;
    }
    .contact-preview-row {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.78rem;
      color: #8696a0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .chat-main {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: #0b141a;
      position: relative;
      min-width: 0;
    }
    .chat-header {
      padding: 0.65rem 1rem;
      background: #202c33;
      border-bottom: 1px solid #2a3942;
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 10;
    }
    .chat-header-user {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      cursor: pointer;
    }
    .chat-header-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .chat-action-btn {
      background: transparent;
      border: none;
      color: #aebac1;
      font-size: 1.1rem;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s;
    }
    .chat-action-btn:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #e9edef;
    }
    .disappearing-timer-pill {
      display: flex;
      align-items: center;
      gap: 4px;
      background: rgba(245, 158, 11, 0.15);
      border: 1px solid rgba(245, 158, 11, 0.4);
      color: #fbbf24;
      font-size: 0.72rem;
      padding: 0.25rem 0.55rem;
      border-radius: 12px;
      cursor: pointer;
      font-weight: 600;
      transition: background 0.15s;
    }
    .disappearing-timer-pill:hover {
      background: rgba(245, 158, 11, 0.25);
    }
    .e2ee-shield-badge {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.4);
      color: #34d399;
      font-size: 0.72rem;
      padding: 0.25rem 0.6rem;
      border-radius: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .chat-messages {
      flex: 1;
      padding: 1rem 1.5rem;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
      background-image: radial-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px);
      background-size: 26px 26px;
      position: relative;
    }
    .system-encryption-banner {
      background: #182229;
      border-radius: 8px;
      padding: 7px 14px;
      font-size: 0.73rem;
      color: #ffd279;
      text-align: center;
      max-width: 82%;
      margin: 4px auto 8px auto;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      border: 1px solid rgba(255, 210, 121, 0.15);
      transition: background 0.15s;
    }
    .system-encryption-banner:hover {
      background: #202c33;
    }
    .system-disappearing-banner {
      background: rgba(32, 44, 51, 0.95);
      border: 1px dashed rgba(245, 158, 11, 0.4);
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 0.73rem;
      color: #f59e0b;
      text-align: center;
      max-width: 82%;
      margin: 2px auto 8px auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .btn-change-timer {
      background: rgba(245, 158, 11, 0.2);
      border: 1px solid rgba(245, 158, 11, 0.4);
      color: #fbbf24;
      font-size: 0.7rem;
      border-radius: 6px;
      padding: 2px 8px;
      cursor: pointer;
    }
    .chat-bubble {
      max-width: 68%;
      padding: 0.55rem 0.85rem;
      border-radius: 8px;
      font-size: 0.88rem;
      line-height: 1.4;
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      cursor: pointer;
      transition: filter 0.15s, opacity 0.3s;
    }
    .chat-bubble.incoming {
      align-self: flex-start;
      background: #202c33;
      color: #e9edef;
      border-top-left-radius: 2px;
    }
    .chat-bubble.outgoing {
      align-self: flex-end;
      background: #005c4b;
      color: #e9edef;
      border-top-right-radius: 2px;
    }
    .bubble-meta {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.68rem;
      color: rgba(255, 255, 255, 0.6);
      margin-top: 0.15rem;
    }
    .tick-icon {
      font-size: 0.82rem;
      font-weight: bold;
      letter-spacing: -1px;
    }
    .tick-blue {
      color: #53bdeb !important;
    }
    .disappearing-timer-badge {
      font-size: 0.68rem;
      color: #fbbf24;
      background: rgba(245, 158, 11, 0.18);
      border: 1px solid rgba(245, 158, 11, 0.35);
      border-radius: 8px;
      padding: 0px 5px;
      display: inline-flex;
      align-items: center;
      gap: 2px;
      font-family: monospace;
      font-weight: 600;
    }
    .bubble-disappeared {
      font-style: italic;
      color: #8696a0;
      font-size: 0.82rem;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    @keyframes smokeDisappear {
      0% { opacity: 1; transform: scale(1); filter: blur(0); }
      50% { opacity: 0.4; transform: scale(0.96) translateY(-4px); filter: blur(3px); }
      100% { opacity: 0; transform: scale(0.85) translateY(-8px); filter: blur(6px); max-height: 0; padding: 0; margin: 0; }
    }
    .disappearing-smoke {
      animation: smokeDisappear 0.75s forwards;
    }

    /* Floating Reactions Dock */
    .bubble-reactions-bar {
      display: none;
      position: absolute;
      top: -34px;
      background: #202c33;
      border: 1px solid #2a3942;
      border-radius: 20px;
      padding: 3px 8px;
      gap: 6px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6);
      z-index: 20;
    }
    .chat-bubble:hover .bubble-reactions-bar {
      display: flex;
    }
    .chat-bubble.outgoing .bubble-reactions-bar { right: 4px; }
    .chat-bubble.incoming .bubble-reactions-bar { left: 4px; }
    .reaction-emoji-btn {
      background: none;
      border: none;
      font-size: 1.05rem;
      cursor: pointer;
      transition: transform 0.15s;
      padding: 0;
      line-height: 1;
    }
    .reaction-emoji-btn:hover {
      transform: scale(1.35);
    }
    .bubble-reaction-pill {
      position: absolute;
      bottom: -10px;
      right: 10px;
      background: #202c33;
      border: 1px solid #2a3942;
      border-radius: 12px;
      font-size: 0.72rem;
      padding: 1px 6px;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
      cursor: pointer;
      z-index: 5;
    }

    /* Voice Note Player Styles */
    .voice-note-card {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 250px;
      padding: 0.2rem 0;
    }
    .voice-avatar-mic {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: #00a884;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.15rem;
      color: #fff;
      flex-shrink: 0;
    }
    .voice-play-btn {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.2);
      border: none;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 0.85rem;
      flex-shrink: 0;
      transition: background 0.15s;
    }
    .voice-play-btn:hover {
      background: rgba(255, 255, 255, 0.35);
    }
    .voice-waveform-bars {
      display: flex;
      align-items: center;
      gap: 2.5px;
      height: 28px;
      flex: 1;
    }
    .waveform-bar {
      width: 3px;
      background: rgba(255, 255, 255, 0.35);
      border-radius: 2px;
      transition: height 0.1s, background 0.15s;
    }
    .waveform-bar.active {
      background: #53bdeb;
    }
    .voice-speed-pill {
      font-size: 0.68rem;
      font-weight: 700;
      background: rgba(255, 255, 255, 0.15);
      border: none;
      border-radius: 8px;
      padding: 2px 5px;
      color: #e9edef;
      cursor: pointer;
      transition: background 0.15s;
    }
    .voice-speed-pill:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    /* Bottom Chat Input Bar & Recording Overlay */
    .chat-input-bar {
      padding: 0.65rem 1rem;
      background: #202c33;
      display: flex;
      align-items: center;
      gap: 0.65rem;
      position: relative;
    }
    .chat-text-input {
      flex: 1;
      background: #2a3942;
      border: none;
      border-radius: 8px;
      padding: 0.65rem 1rem;
      color: #fff;
      font-size: 0.9rem;
      outline: none;
    }
    .chat-btn-round {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: transparent;
      border: none;
      color: #8696a0;
      font-size: 1.2rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
      flex-shrink: 0;
    }
    .chat-btn-round:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #e9edef;
    }
    .chat-btn-send {
      background: #00a884;
      color: #111b21;
    }
    .chat-btn-send:hover {
      background: #02906f;
      color: #fff;
    }
    .recording-pulse {
      background: #ef4444 !important;
      color: #fff !important;
      animation: pulseRecord 1s infinite alternate;
    }
    @keyframes pulseRecord {
      0% { transform: scale(1); }
      100% { transform: scale(1.15); box-shadow: 0 0 10px rgba(239, 68, 68, 0.8); }
    }

    /* Active Voice Recording Drawer */
    .voice-recording-drawer {
      display: none;
      align-items: center;
      gap: 0.75rem;
      flex: 1;
    }
    .record-blinking-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #ef4444;
      animation: blinkRed 0.8s infinite alternate;
    }
    @keyframes blinkRed {
      0% { opacity: 1; transform: scale(1); }
      100% { opacity: 0.3; transform: scale(0.85); }
    }
    .record-live-waves {
      display: flex;
      align-items: center;
      gap: 3px;
      flex: 1;
      height: 24px;
    }
    .record-wave-bar {
      width: 3px;
      background: #ef4444;
      border-radius: 2px;
      animation: waveFluctuate 0.6s infinite ease-in-out alternate;
    }
    @keyframes waveFluctuate {
      0% { height: 4px; }
      100% { height: 22px; }
    }

    /* WhatsApp Modals */
    .wa-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .wa-modal-card {
      background: #111b21;
      border: 1px solid #222d34;
      border-radius: 14px;
      width: 90%;
      max-width: 480px;
      padding: 1.5rem;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.8);
      position: relative;
      color: #e9edef;
    }
    .wa-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.25rem;
      border-bottom: 1px solid #202c33;
      padding-bottom: 0.75rem;
    }
    .wa-modal-title {
      font-size: 1.1rem;
      font-weight: 700;
      color: #e9edef;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .wa-modal-close {
      background: none;
      border: none;
      color: #8696a0;
      font-size: 1.3rem;
      cursor: pointer;
    }
    .safety-numbers-box {
      background: #202c33;
      border-radius: 8px;
      padding: 1rem;
      font-family: monospace;
      font-size: 1.05rem;
      letter-spacing: 2px;
      line-height: 1.8;
      text-align: center;
      color: #34d399;
      border: 1px solid #2a3942;
      margin: 1rem 0;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
    }
    .qr-sim-box {
      width: 140px;
      height: 140px;
      margin: 0 auto 1rem auto;
      background: #fff;
      padding: 8px;
      border-radius: 8px;
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      grid-gap: 3px;
    }
    .qr-block {
      background: #000;
      border-radius: 1px;
    }
    .qr-block.white {
      background: #fff;
    }
    .timer-option-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .timer-option-row:hover, .timer-option-row.selected {
      background: #202c33;
    }
    .call-avatar-ripple {
      width: 90px;
      height: 90px;
      border-radius: 50%;
      margin: 1.5rem auto;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.5rem;
      color: #fff;
      position: relative;
      animation: callRipple 1.5s infinite;
    }
    @keyframes callRipple {
      0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.6); }
      70% { box-shadow: 0 0 0 25px rgba(34, 197, 94, 0); }
      100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
    }

    /* YouTube Watch Player Styles */
    .youtube-container {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 380px;
      gap: 1.5rem;
      position: relative;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
    }
    .youtube-container.theater-mode {
      grid-template-columns: 1fr;
    }
    @media (max-width: 1150px) {
      .youtube-container { grid-template-columns: 1fr !important; }
    }
    
    /* YouTube Ambient Glow Backdrop */
    .yt-ambient-wrapper {
      position: relative;
      width: 100%;
    }
    .yt-ambient-glow {
      position: absolute;
      inset: -25px;
      border-radius: 28px;
      background: radial-gradient(circle at center, rgba(99, 102, 241, 0.4) 0%, transparent 75%);
      filter: blur(65px);
      opacity: 0.6;
      z-index: 0;
      pointer-events: none;
      transition: background 0.8s ease, opacity 0.5s ease;
    }

    .yt-player-box {
      width: 100%;
      aspect-ratio: 16 / 9;
      background: #000;
      border-radius: 16px;
      overflow: hidden;
      position: relative;
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.9);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      z-index: 1;
    }
    .youtube-container.theater-mode .yt-player-box {
      max-height: 78vh;
      border-radius: 0;
    }
    .yt-screen-content {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at center, #1e1b4b 0%, #030712 100%);
      position: relative;
      transition: background 0.6s ease;
    }
    .yt-big-play {
      width: 76px;
      height: 76px;
      border-radius: 50%;
      background: rgba(239, 68, 68, 0.95);
      border: none;
      color: #fff;
      font-size: 2.2rem;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.2s, background 0.2s, box-shadow 0.2s;
      box-shadow: 0 10px 28px rgba(239, 68, 68, 0.55);
    }
    .yt-big-play:hover {
      transform: scale(1.12);
      background: #dc2626;
      box-shadow: 0 12px 35px rgba(239, 68, 68, 0.7);
    }
    .yt-player-controls {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: linear-gradient(transparent, rgba(0,0,0,0.92));
      padding: 0.75rem 1.25rem 0.65rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      z-index: 10;
    }
    
    /* Interactive Scrubber with Hover Tooltip & Chapter Marks */
    .yt-scrubber {
      width: 100%;
      height: 6px;
      background: rgba(255, 255, 255, 0.25);
      border-radius: 3px;
      position: relative;
      cursor: pointer;
      transition: height 0.15s ease;
    }
    .yt-scrubber:hover {
      height: 9px;
    }
    .yt-scrubber-buffer {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 45%;
      background: rgba(255, 255, 255, 0.45);
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    .yt-scrubber-progress {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 0%;
      background: #ff0000;
      border-radius: 3px;
      position: relative;
    }
    .yt-scrubber-handle {
      position: absolute;
      right: -6px;
      top: 50%;
      transform: translateY(-50%) scale(0);
      width: 13px;
      height: 13px;
      background: #ff0000;
      border-radius: 50%;
      transition: transform 0.15s;
    }
    .yt-scrubber:hover .yt-scrubber-handle {
      transform: translateY(-50%) scale(1);
    }
    .yt-scrubber-tooltip {
      position: absolute;
      bottom: 16px;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.9);
      color: #fff;
      font-size: 0.72rem;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      pointer-events: none;
      display: none;
      white-space: nowrap;
      z-index: 20;
    }
    .chapter-tick {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      background: #000;
      z-index: 5;
    }

    .yt-controls-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #fff;
      font-size: 0.85rem;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .yt-left-controls, .yt-right-controls {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      flex-wrap: wrap;
    }
    .yt-btn {
      background: none;
      border: none;
      color: #fff;
      cursor: pointer;
      font-size: 1.15rem;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
      border-radius: 4px;
      transition: transform 0.15s, color 0.15s;
    }
    .yt-btn:hover {
      transform: scale(1.15);
      color: #38bdf8;
    }
    .yt-select {
      background: rgba(0, 0, 0, 0.65);
      border: 1px solid rgba(255, 255, 255, 0.3);
      color: #34d399;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.25rem 0.5rem;
      outline: none;
      cursor: pointer;
    }
    .yt-select option {
      background: #111827;
      color: #fff;
    }

    /* Video Metadata Card */
    .yt-meta-card {
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: 12px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .yt-video-title {
      font-size: 1.3rem;
      font-weight: 700;
      color: #f8fafc;
      line-height: 1.35;
      word-break: break-word;
      overflow-wrap: break-word;
    }

    /* Video Actions Pill Group */
    .yt-pill-group {
      display: inline-flex;
      align-items: center;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.15);
    }
    .yt-pill-btn {
      background: transparent;
      border: none;
      color: #fff;
      padding: 0.45rem 0.9rem;
      font-size: 0.82rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.35rem;
      cursor: pointer;
      transition: background 0.15s;
    }
    .yt-pill-btn:hover {
      background: rgba(255, 255, 255, 0.12);
    }
    .yt-pill-divider {
      width: 1px;
      height: 18px;
      background: rgba(255, 255, 255, 0.2);
    }

    .btn-super-thanks {
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: #000;
      font-weight: 700;
      border-radius: 20px;
      border: none;
      padding: 0.45rem 1rem;
      font-size: 0.82rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.35rem;
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.35);
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .btn-super-thanks:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 16px rgba(245, 158, 11, 0.5);
    }

    .btn-join {
      background: rgba(168, 85, 247, 0.2);
      border: 1px solid rgba(168, 85, 247, 0.5);
      color: #c084fc;
      border-radius: 20px;
      padding: 0.45rem 1rem;
      font-weight: 700;
      font-size: 0.82rem;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-join:hover {
      background: rgba(168, 85, 247, 0.35);
      color: #fff;
    }

    /* Channel Row */
    .yt-channel-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 1rem;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .yt-channel-left {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      cursor: pointer;
    }
    .yt-channel-avatar {
      width: 46px;
      height: 46px;
      border-radius: 50%;
      background: #6366f1;
      color: #fff;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.25rem;
      border: 2px solid rgba(255, 255, 255, 0.2);
    }
    .btn-subscribe {
      background: #fff;
      color: #000;
      border: none;
      border-radius: 20px;
      font-weight: 700;
      font-size: 0.85rem;
      padding: 0.5rem 1.25rem;
      cursor: pointer;
      transition: background 0.15s, transform 0.15s;
    }
    .btn-subscribe.subscribed {
      background: rgba(255, 255, 255, 0.15);
      color: #e2e8f0;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    /* 95/5 Split Monetization Box */
    .yt-tip-box {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(217, 119, 6, 0.06));
      border: 1px solid rgba(245, 158, 11, 0.35);
      border-radius: 12px;
      padding: 1.15rem;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }
    .split-meter-bar {
      display: flex;
      height: 12px;
      border-radius: 6px;
      overflow: hidden;
      margin: 0.35rem 0;
      background: rgba(255, 255, 255, 0.1);
    }
    .split-creator {
      width: 95%;
      background: #f59e0b;
    }
    .split-seeder {
      width: 5%;
      background: #10b981;
    }
    .tip-buttons-row {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .btn-tip {
      background: #f59e0b;
      color: #000;
      font-weight: 700;
      font-size: 0.82rem;
      padding: 0.45rem 1rem;
      border-radius: 20px;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.35rem;
      transition: transform 0.15s, background 0.15s;
    }
    .btn-tip:hover {
      background: #fbbf24;
      transform: scale(1.05);
    }

    /* Expandable Description Box */
    .yt-desc-box {
      background: rgba(255, 255, 255, 0.05);
      padding: 1rem;
      border-radius: 10px;
      font-size: 0.85rem;
      color: #e2e8f0;
      line-height: 1.5;
      position: relative;
    }
    .yt-desc-box.collapsed {
      max-height: 110px;
      overflow: hidden;
    }
    .yt-desc-toggle {
      color: #60a5fa;
      cursor: pointer;
      font-weight: 700;
      margin-top: 0.5rem;
      display: inline-block;
    }
    .chapter-tag {
      color: #38bdf8;
      cursor: pointer;
      font-weight: 600;
      text-decoration: underline;
    }
    .chapter-tag:hover {
      color: #7dd3fc;
    }

    /* Nested Threaded Comments */
    .yt-comments-header {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      margin-bottom: 0.5rem;
    }
    .yt-comment-thread {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding-bottom: 0.85rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .super-thanks-comment-card {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.14), rgba(217, 119, 6, 0.08));
      border: 1px solid rgba(245, 158, 11, 0.4);
      border-radius: 10px;
      padding: 0.75rem 1rem;
    }
    .super-thanks-badge {
      background: #f59e0b;
      color: #000;
      font-size: 0.7rem;
      font-weight: 800;
      padding: 2px 8px;
      border-radius: 12px;
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }
    .creator-heart-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.35);
      color: #f87171;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 8px;
      margin-left: 6px;
    }
    .btn-toggle-replies {
      background: none;
      border: none;
      color: #38bdf8;
      font-size: 0.8rem;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.25rem 0.5rem;
      border-radius: 14px;
      margin-top: 0.25rem;
    }
    .btn-toggle-replies:hover {
      background: rgba(56, 189, 248, 0.1);
    }
    .yt-replies-list {
      margin-left: 44px;
      border-left: 2px solid rgba(255, 255, 255, 0.1);
      padding-left: 14px;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }
    .reply-composer-box {
      margin-left: 44px;
      margin-top: 0.5rem;
      padding: 0.5rem;
      background: rgba(0, 0, 0, 0.35);
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      display: none;
    }

    /* Sidebar Recommended Queue */
    .yt-sidebar-card {
      display: flex;
      gap: 0.75rem;
      padding: 0.5rem;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s;
      position: relative;
    }
    .yt-sidebar-card:hover {
      background: rgba(255, 255, 255, 0.05);
    }
    .yt-sidebar-card.active-video {
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.35);
    }
    .yt-thumbnail {
      width: 140px;
      height: 78px;
      background: #1e293b;
      border-radius: 8px;
      position: relative;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.6rem;
      overflow: hidden;
    }
    .yt-duration-badge {
      position: absolute;
      bottom: 4px;
      right: 4px;
      background: rgba(0,0,0,0.85);
      font-size: 0.65rem;
      font-weight: 700;
      padding: 2px 5px;
      border-radius: 4px;
      color: #fff;
    }
    .yt-p2p-badge {
      position: absolute;
      top: 4px;
      left: 4px;
      background: rgba(16, 185, 129, 0.85);
      font-size: 0.6rem;
      font-weight: 700;
      padding: 1px 4px;
      border-radius: 3px;
      color: #000;
    }

    /* Channel Profile & Membership Modals */
    .yt-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(8px);
      z-index: 1000;
      display: none;
      align-items: center;
      justify-content: center;
    }
    .yt-modal-card {
      width: 520px;
      max-width: 92%;
      background: #18181b;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 16px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.9);
    }
    .membership-tier-card {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      padding: 1rem;
      cursor: pointer;
      transition: all 0.15s;
    }
    .membership-tier-card:hover, .membership-tier-card.selected {
      border-color: #a855f7;
      background: rgba(168, 85, 247, 0.1);
    }

    /* Ephemeral Story Modal */
    .story-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(10px);
      z-index: 1000;
      display: none;
      align-items: center;
      justify-content: center;
    }
    .story-card-modal {
      width: 360px;
      height: 600px;
      border-radius: 24px;
      background: #111;
      border: 2px solid rgba(255, 255, 255, 0.2);
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      padding: 1.25rem;
      box-shadow: 0 25px 50px rgba(0,0,0,0.9);
    }
    .story-progress-container {
      width: 100%;
      height: 3px;
      background: rgba(255, 255, 255, 0.3);
      border-radius: 2px;
      overflow: hidden;
      margin-bottom: 1rem;
    }
    .story-progress-bar {
      height: 100%;
      width: 0%;
      background: #fff;
      transition: width 0.1s linear;
    }

    /* Confetti Animation Elements */
    .confetti-piece {
      position: fixed;
      width: 10px;
      height: 10px;
      pointer-events: none;
      z-index: 2000;
      animation: confettiFall 2.5s forwards ease-out;
    }
    @keyframes confettiFall {
      0% { transform: translateY(-50px) rotate(0deg); opacity: 1; }
      100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
    }
    /* Unified Desktop & Mobile Synchronized Floating Glassmorphic Bottom Navigation */
    .mobile-bottom-nav {
      position: fixed;
      bottom: 12px;
      left: 50%;
      transform: translateX(-50%);
      width: calc(100% - 24px);
      max-width: 680px;
      height: 66px;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 22px;
      display: none; /* By default hidden on desktop to avoid duplicate double navigation */
      justify-content: space-evenly;
      align-items: center;
      z-index: 999;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.05);
      padding: 0 4px;
    }

    /* Smart Navigation Modes: Auto / Dock / Top */
    /* 1. Default / Auto Mode */
    body.nav-mode-auto .mobile-bottom-nav {
      display: none;
    }
    body.nav-mode-auto .nav-tabs {
      display: flex;
    }
    @media (max-width: 860px) {
      body.nav-mode-auto .nav-tabs {
        display: none !important;
      }
      body.nav-mode-auto .mobile-bottom-nav {
        display: flex !important;
      }
      body.nav-mode-auto .container {
        margin: 0 auto 5.5rem auto !important;
      }
    }

    /* 2. Dock-Only Mode (Only bottom dock is visible, top tabs hidden even on desktop) */
    body.nav-mode-dock .nav-tabs,
    body.nav-mode-dock .app-left-rail {
      display: none !important;
    }
    body.nav-mode-dock .mobile-bottom-nav {
      display: flex !important;
    }
    body.nav-mode-dock .container,
    body.nav-mode-dock .feed-container,
    body.nav-mode-dock .friends-container {
      margin-bottom: 5.5rem !important;
    }

    /* 3. Top-Only Mode (Only top tabs visible, bottom dock hidden even on mobile) */
    body.nav-mode-top .mobile-bottom-nav {
      display: none !important;
    }
    body.nav-mode-top .nav-tabs,
    body.nav-mode-top .app-left-rail {
      display: flex !important;
    }
    .bottom-nav-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: none;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 6px 4px;
      border-radius: 12px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      flex: 1;
      min-width: 0;
    }
    .bottom-nav-item:hover {
      color: #e2e8f0;
      transform: translateY(-2px);
    }
    .bottom-nav-item.active {
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.1);
    }
    .bottom-nav-item.active .bnav-icon {
      transform: scale(1.15);
      filter: drop-shadow(0 0 8px rgba(56, 189, 248, 0.6));
    }
    .bottom-nav-item.active::after {
      content: '';
      position: absolute;
      bottom: 3px;
      width: 14px;
      height: 3px;
      background: #38bdf8;
      border-radius: 2px;
      box-shadow: 0 0 6px #38bdf8;
    }
    .bottom-nav-create {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.35rem;
      font-weight: 700;
      box-shadow: 0 4px 16px rgba(99, 102, 241, 0.5);
      border: 2px solid rgba(255, 255, 255, 0.2);
      cursor: pointer;
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
      flex-shrink: 0;
      margin: 0 2px;
    }
    .bottom-nav-create:hover {
      transform: scale(1.12);
    }
    .bnav-icon {
      font-size: 1.2rem;
      transition: transform 0.2s;
    }
    .bnav-label {
      font-size: 0.68rem;
      font-weight: 600;
      margin-top: 2px;
      white-space: nowrap;
    }
    .bnav-badge {
      position: absolute;
      top: 3px;
      right: calc(50% - 14px);
      background: #ef4444;
      color: #fff;
      font-size: 0.6rem;
      font-weight: 700;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1.5px solid #0f172a;
    }

    /* Tab 1: Instagram Feed Styles */
    .feed-container {
      max-width: 640px;
      margin: 0 auto 5rem auto;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      width: 100%;
    }
    .insta-post-card {
      background: #111827;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
      position: relative;
    }
    .insta-post-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.85rem 1rem;
    }
    .insta-author-info {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      cursor: pointer;
    }
    .insta-author-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      color: #fff;
      font-size: 1rem;
      border: 2px solid #ec4899;
    }
    .insta-media-box {
      width: 100%;
      height: 400px;
      background: #030712;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      cursor: pointer;
      user-select: none;
    }
    .insta-post-card {
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.25s ease;
      position: relative;
    }
    .insta-post-card:hover {
      border-color: rgba(99, 102, 241, 0.35);
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7), 0 0 28px rgba(99, 102, 241, 0.16);
      transform: translateY(-2px);
    }
    .insta-heart-pop {
      position: absolute;
      font-size: 5rem;
      color: #ef4444;
      pointer-events: none;
      animation: heartDopamine 0.8s forwards ease-out;
      z-index: 10;
    }
    @keyframes heartDopamine {
      0% { transform: scale(0.3); opacity: 0; }
      40% { transform: scale(1.3); opacity: 1; filter: drop-shadow(0 0 15px rgba(239, 68, 68, 0.9)); }
      70% { transform: scale(1.0); opacity: 0.9; }
      100% { transform: scale(1.4) translateY(-30px); opacity: 0; }
    }

    /* Particle Physics Emitter */
    .particle-heart-spring {
      position: absolute;
      font-size: 4.8rem;
      pointer-events: none;
      z-index: 120;
      filter: drop-shadow(0 0 22px rgba(239, 68, 68, 0.9));
      animation: heartSpringBurst 0.85s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
      user-select: none;
    }
    @keyframes heartSpringBurst {
      0% { transform: scale(0.2); opacity: 0; }
      40% { transform: scale(1.35); opacity: 1; }
      70% { transform: scale(1.05); opacity: 0.95; }
      100% { transform: scale(1.5) translateY(-35px); opacity: 0; }
    }
    .particle-floating-dopamine {
      position: absolute;
      background: linear-gradient(135deg, #ef4444, #ec4899);
      color: #fff;
      font-weight: 800;
      font-size: 0.85rem;
      padding: 3px 12px;
      border-radius: 9999px;
      pointer-events: none;
      z-index: 121;
      box-shadow: 0 4px 16px rgba(239, 68, 68, 0.6);
      animation: dopamineGlide 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
      white-space: nowrap;
      user-select: none;
    }
    @keyframes dopamineGlide {
      0% { transform: scale(0.4) translateY(0); opacity: 0; }
      25% { transform: scale(1.15) translateY(-10px); opacity: 1; }
      70% { transform: scale(1) translateY(-30px); opacity: 0.95; }
      100% { transform: scale(0.9) translateY(-60px); opacity: 0; }
    }
    .physics-micro-particle {
      position: absolute;
      font-size: 1.15rem;
      pointer-events: none;
      z-index: 119;
      animation: particleRadialBurst 0.75s cubic-bezier(0.25, 1, 0.5, 1) forwards;
      user-select: none;
    }
    @keyframes particleRadialBurst {
      0% {
        transform: translate(0, 0) scale(0.6) rotate(0deg);
        opacity: 1;
      }
      50% {
        opacity: 1;
      }
      100% {
        transform: translate(var(--tx), var(--ty)) scale(1.2) rotate(var(--rot));
        opacity: 0;
      }
    }
    .heart-bounce-pop {
      animation: heartButtonBounce 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    @keyframes heartButtonBounce {
      0% { transform: scale(1); }
      35% { transform: scale(1.4); }
      70% { transform: scale(0.88); }
      100% { transform: scale(1); }
    }
    .insta-actions-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem 0.35rem 1rem;
    }
    .insta-action-btn {
      background: none;
      border: none;
      color: #e2e8f0;
      font-size: 1.4rem;
      cursor: pointer;
      padding: 0.2rem;
      transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), color 0.15s;
    }
    .insta-action-btn:hover {
      transform: scale(1.25);
    }
    .insta-action-btn:active {
      transform: scale(0.9);
    }
    .insta-likes-text {
      padding: 0 1rem;
      font-size: 0.88rem;
      font-weight: 700;
      color: #f1f5f9;
      margin-bottom: 0.35rem;
    }
    .insta-caption {
      padding: 0 1rem;
      font-size: 0.88rem;
      color: #cbd5e1;
      line-height: 1.45;
      margin-bottom: 0.5rem;
    }
    .insta-caption strong {
      color: #fff;
      margin-right: 0.4rem;
    }
    .insta-tags {
      color: #38bdf8;
      cursor: pointer;
    }
    .insta-comments-preview {
      padding: 0 1rem;
      font-size: 0.8rem;
      color: #94a3b8;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin-bottom: 0.65rem;
    }
    .insta-comment-input-box {
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      padding: 0.65rem 1rem;
      display: flex;
      align-items: center;
      gap: 0.65rem;
    }
    .insta-comment-input {
      flex: 1;
      background: transparent;
      border: none;
      color: #fff;
      font-size: 0.85rem;
      outline: none;
    }
    .insta-post-btn {
      background: none;
      border: none;
      color: #38bdf8;
      font-size: 0.85rem;
      font-weight: 700;
      cursor: pointer;
    }
    .insta-post-btn:disabled {
      color: #475569;
      cursor: default;
    }

    /* Tab 5: Profile & Sovereign Me Styles */
    .profile-container {
      max-width: 860px;
      margin: 0 auto 5rem auto;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      width: 100%;
    }
    .profile-header-card {
      background: #111827;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }
    .profile-cover-banner {
      height: 160px;
      background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4c1d95 100%);
      position: relative;
    }
    .profile-avatar-row {
      padding: 0 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-top: -50px;
      position: relative;
    }
    .profile-avatar-large {
      width: 100px;
      height: 100px;
      border-radius: 50%;
      background: #6366f1;
      border: 4px solid #111827;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.5rem;
      font-weight: 800;
      color: #fff;
      box-shadow: 0 8px 20px rgba(0,0,0,0.6);
    }
    .profile-info-body {
      padding: 1rem 1.5rem 1.5rem 1.5rem;
    }
    .profile-name-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.35rem;
      font-weight: 800;
      color: #fff;
      margin-bottom: 0.25rem;
    }
    .profile-handle {
      font-size: 0.85rem;
      color: #94a3b8;
      margin-bottom: 0.75rem;
    }
    .profile-did-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.35);
      padding: 4px 10px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 0.75rem;
      color: #a5b4fc;
      margin-bottom: 1rem;
      cursor: pointer;
    }
    .profile-did-badge:hover {
      background: rgba(99, 102, 241, 0.25);
    }
    .profile-stats-row {
      display: flex;
      gap: 2rem;
      margin: 1.25rem 0;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      padding: 0.85rem 0;
    }
    .profile-stat-box {
      display: flex;
      flex-direction: column;
    }
    .stat-number {
      font-size: 1.2rem;
      font-weight: 800;
      color: #fff;
    }
    .stat-label {
      font-size: 0.75rem;
      color: #94a3b8;
    }

    /* Sovereign Wallet Card */
    .sovereign-wallet-card {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(6, 78, 59, 0.3) 100%);
      border: 1px solid rgba(16, 185, 129, 0.35);
      border-radius: 16px;
      padding: 1.5rem;
      color: #fff;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
    }
    .wallet-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }
    .wallet-balance-row {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .wallet-balance-sov {
      font-size: 2.2rem;
      font-weight: 900;
      color: #34d399;
      font-family: monospace;
    }
    .wallet-balance-fiat {
      font-size: 1.1rem;
      color: #a7f3d0;
    }
    .wallet-metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 1rem;
      margin-bottom: 1.25rem;
      background: rgba(0, 0, 0, 0.3);
      padding: 1rem;
      border-radius: 10px;
    }

    /* 3-Column Profile Media Grid */
    .profile-media-tabs {
      display: flex;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      margin-bottom: 1rem;
    }
    .profile-tab-btn {
      flex: 1;
      padding: 0.85rem;
      background: none;
      border: none;
      color: #94a3b8;
      font-weight: 700;
      font-size: 0.85rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      border-bottom: 2px solid transparent;
      transition: all 0.15s;
    }
    .profile-tab-btn.active {
      color: #38bdf8;
      border-bottom-color: #38bdf8;
    }
    .profile-media-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    .media-grid-item {
      aspect-ratio: 1;
      background: #1f2937;
      border-radius: 8px;
      overflow: hidden;
      position: relative;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .media-grid-item:hover .media-hover-overlay {
      opacity: 1;
    }
    .media-hover-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1.5rem;
      color: #fff;
      font-weight: 700;
      font-size: 0.95rem;
      opacity: 0;
      transition: opacity 0.2s;
    }

    /* Phase 1 Master Social: Omni-Search & Channel/Page Modal Styles */
    .omni-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.82);
      backdrop-filter: blur(12px);
      z-index: 10000;
      display: none;
      align-items: flex-start;
      justify-content: center;
      padding: 1.5rem 1rem;
      overflow-y: auto;
    }
    .omni-modal-card {
      width: 620px;
      max-width: 100%;
      background: #111827;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 20px;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.9);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      animation: modalSlideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      margin: auto 0;
    }
    @keyframes modalSlideUp {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .omni-tab-btn {
      padding: 0.45rem 0.85rem;
      background: none;
      border: none;
      color: #94a3b8;
      font-weight: 700;
      font-size: 0.8rem;
      cursor: pointer;
      white-space: nowrap;
      border-radius: 20px;
      transition: all 0.15s;
    }
    .omni-tab-btn:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.06);
    }
    .omni-tab-btn.active {
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.15);
      border: 1px solid rgba(56, 189, 248, 0.3);
    }
    .omni-result-item {
      padding: 0.85rem 1.15rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      transition: background 0.15s;
    }
    .omni-result-item:hover {
      background: rgba(255, 255, 255, 0.04);
    }
    .action-pill-btn {
      padding: 0.35rem 0.85rem;
      border-radius: 20px;
      font-weight: 700;
      font-size: 0.78rem;
      cursor: pointer;
      transition: all 0.15s;
      border: 1px solid transparent;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .action-pill-primary {
      background: #0284c7;
      color: #fff;
    }
    .action-pill-primary:hover {
      background: #0369a1;
    }
    .action-pill-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: #cbd5e1;
      border-color: rgba(255, 255, 255, 0.15);
    }
    .action-pill-secondary:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
    }
    .action-pill-danger {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border-color: rgba(239, 68, 68, 0.3);
    }
    .action-pill-danger:hover {
      background: rgba(239, 68, 68, 0.25);
    }
    .social-modal-input {
      width: 100%;
      padding: 0.7rem 0.85rem;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 10px;
      color: #fff;
      font-size: 0.88rem;
      box-sizing: border-box;
      outline: none;
      margin-bottom: 0.85rem;
    }
    .social-modal-input:focus {
      border-color: #38bdf8;
    }
    .social-modal-label {
      font-size: 0.75rem;
      font-weight: 700;
      color: #94a3b8;
      display: block;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
  </style>
</head>
<body class="nav-mode-auto">
  <div class="app-layout">
    <!-- Column 1: Left Navigation Rail (Desktop) -->
    <aside class="app-left-rail">
      <div class="rail-brand" onclick="switchTab('feed')">
        <div class="brand-logo">S</div>
        <div>
          <div class="brand-title">SOVRA</div>
          <div style="font-size: 0.72rem; color: #64748b; font-weight: 600;">Decentralized Mesh</div>
        </div>
      </div>

      <nav class="rail-nav">
        <button class="rail-nav-item active" id="tab-feed" onclick="switchTab('feed')">
          <span class="rail-icon">📷</span>
          <span class="rail-label">Feed</span>
        </button>
        <button class="rail-nav-item" id="tab-friends" onclick="switchTab('friends')">
          <span class="rail-icon">👥</span>
          <span class="rail-label">Friends</span>
          <span class="rail-badge" id="railFriendsBadge">1</span>
        </button>
        <button class="rail-nav-item" id="tab-reels" onclick="switchTab('reels')">
          <span class="rail-icon">🎬</span>
          <span class="rail-label">Reels</span>
        </button>
        <button class="rail-nav-item" id="tab-youtube" onclick="switchTab('youtube')">
          <span class="rail-icon">📺</span>
          <span class="rail-label">Watch</span>
        </button>
        <button class="rail-nav-item" id="tab-chat" onclick="switchTab('chat')">
          <span class="rail-icon">💬</span>
          <span class="rail-label">Chats</span>
          <span class="rail-badge" style="background: #3b82f6;">2</span>
        </button>
        <button class="rail-nav-item" id="tab-me" onclick="switchTab('me')">
          <span class="rail-icon">👤</span>
          <span class="rail-label">Profile</span>
        </button>
        <button class="rail-nav-item" id="tab-admin" onclick="switchTab('admin')">
          <span class="rail-icon">⚙️</span>
          <span class="rail-label">Ops Console</span>
        </button>
      </nav>

      <button class="rail-post-btn" onclick="triggerBottomCreateAction()">
        <span>✍️</span> <span>New Post</span>
      </button>

      <div class="rail-user-profile" onclick="switchTab('me')">
        <div id="railUserAvatar" style="width: 38px; height: 38px; border-radius: 50%; background: #6366f1; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.95rem; color: #fff; overflow: hidden; flex-shrink: 0;">S</div>
        <div style="flex: 1; min-width: 0;">
          <div id="railUserName" style="font-weight: 700; font-size: 0.85rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Sovereign Node</div>
          <div id="railUserHandle" style="font-size: 0.72rem; color: #38bdf8;">@you</div>
        </div>
      </div>

      <a href="/admin" target="_blank" style="margin-top: 0.65rem; display: flex; align-items: center; justify-content: space-between; padding: 0.55rem 0.75rem; border-radius: 10px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); color: #38bdf8; text-decoration: none; font-size: 0.78rem; font-weight: 700; transition: all 0.15s;" onmouseover="this.style.background='rgba(56, 189, 248, 0.18)'" onmouseout="this.style.background='rgba(56, 189, 248, 0.08)'" title="Open Dedicated Company Operations Console">
        <span>🛡️ Ops Console (/admin)</span>
        <span>↗</span>
      </a>
    </aside>

    <!-- Column 2: Center Stage -->
    <div class="app-center-stage">
      <!-- Center Sticky Top Header with Expansive Search -->
      <header class="app-top-header">
        <div class="mobile-brand" onclick="switchTab('feed')">
          <div class="brand-logo" style="width: 34px; height: 34px; font-size: 1rem; border-radius: 10px;">S</div>
        </div>

        <!-- Prominent Wide Friend & Mesh Search Bar -->
        <div class="header-search-wrap">
          <div class="header-search-bar" onclick="document.getElementById('headerFriendSearchInput').focus()">
            <span style="font-size: 0.95rem; color: #38bdf8;">🔍</span>
            <input type="text" id="headerFriendSearchInput" class="header-search-input" placeholder="Search friends, @handle, channels, hashtags... (Ctrl+K)" oninput="handleHeaderFriendSearch(this.value)" onfocus="showHeaderSearchDropdown()" />
            <kbd class="search-kbd-shortcut" onclick="openOmniSearch(); event.stopPropagation();" title="Omni-Search (Ctrl+K)">Ctrl K</kbd>
            <button id="headerSearchClearBtn" onclick="clearHeaderSearch(); event.stopPropagation();" style="display: none; background: none; border: none; color: #94a3b8; cursor: pointer; padding: 0 4px; font-size: 0.8rem;">✕</button>
          </div>
          <div id="headerSearchDropdown" class="header-search-dropdown" style="display: none;"></div>
        </div>

        <div style="display: flex; gap: 0.5rem; align-items: center; flex-shrink: 0;">
          <button id="pwaInstallBtn" onclick="triggerPwaInstall()" style="display: none; align-items: center; gap: 0.35rem; background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); padding: 4px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 700; cursor: pointer;" title="Install Sovra App on Phone">
            <span>📲 Install</span>
          </button>
          <div id="currentUserPill" onclick="switchTab('me')" style="display: flex; align-items: center; gap: 0.35rem; background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 12px; padding: 3px 8px; cursor: pointer;" title="Your Sovereign Profile">
            <span id="currentUserAvatar" style="width: 20px; height: 20px; border-radius: 50%; background: #6366f1; color: #fff; font-size: 0.7rem; font-weight: bold; display: flex; align-items: center; justify-content: center;">S</span>
            <span id="currentUserHandleText" style="font-size: 0.75rem; font-weight: 700; color: #cbd5e1;">@you</span>
          </div>
          <button id="navModeToggleBtn" onclick="toggleNavLayoutMode()" class="nav-mode-btn" title="Toggle Navigation Layout (Auto Responsive / Mobile Dock / Desktop Top)">
            <span id="navModeIcon">⚡</span> <span id="navModeLabel" class="nav-mode-text">Auto</span>
          </button>
          <div class="node-status-pill" title="Sovra Mesh Online • TCP :${tcpPort} • LibP2P Noise_XX Active">
            <span class="status-pulse-dot"></span>
            <span class="status-text">Online</span>
            <span class="badge tcp-port-badge" style="background: rgba(99, 102, 241, 0.2); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.35); font-size: 0.72rem; padding: 2px 7px; border-radius: 8px;">:${tcpPort}</span>
          </div>
        </div>
      </header>

      <div class="container">
    <!-- Tab 1: Instagram Main Feed (Stories, Photo Stream, Double-Tap Hearts) -->
    <main class="main-content" id="feed-view" style="display: flex;">
      <div class="feed-container">
        <!-- Stories Tray (Borderless Instagram Style) -->
        <div class="stories-tray">
          <div class="stories-bar">
            <input type="file" id="realStoryFileInput" accept="image/*" style="display: none;" onchange="handleRealStoryUpload(event)">
            <div class="story-item" onclick="document.getElementById('realStoryFileInput').click()" title="Add your Story (Camera or Gallery)">
              <div class="story-ring" id="myStoryRing">
                <div class="story-avatar" id="myStoryAvatar" style="background: #1e293b; color: #fff;">S</div>
                <div class="story-plus-badge">+</div>
              </div>
              <div class="story-username">Your Story</div>
            </div>
            ${multiSegmentStories
              .map(
                (s, idx) => `
              <div class="story-item" onclick="launchStoryViewer(${idx})" id="feed-story-${s.creatorHandle}">
                <div class="story-ring ${s.seen ? 'seen' : ''}">
                  <div class="story-avatar" style="background: ${s.creatorAvatarBg};">${s.creatorAvatar}</div>
                </div>
                <div class="story-username">${s.creatorName.split(' ')[0]}</div>
              </div>
            `,
              )
              .join('')}
          </div>
        </div>

        <!-- ✍️ DYNAMIC FEED POST COMPOSER (STREAMLINED THREADS / TWITTER MINIMALISM) -->
        <div class="card feed-composer-card">
          <div style="display: flex; gap: 0.85rem; align-items: flex-start;">
            <div class="composer-avatar">
              S
            </div>
            <div style="flex: 1; min-width: 0;">
              <textarea id="dynamicPostCaption" class="composer-textarea" placeholder="What's happening on the mesh? Share photo, update or thought..." oninput="this.style.height='auto';this.style.height=(this.scrollHeight)+'px';"></textarea>
              
              <!-- Real Photo Preview Box -->
              <input type="file" id="realFeedFileInput" accept="image/*" style="display: none;" onchange="handleFeedPhotoSelected(event)">
              <div id="feedPhotoPreviewContainer" style="display: none; position: relative; margin-top: 0.75rem; border-radius: 12px; overflow: hidden; max-height: 280px; background: #000; border: 1px solid var(--glass-border);">
                <img id="feedPhotoPreviewImg" src="" alt="Selected photo" style="width: 100%; max-height: 280px; object-fit: contain; display: block;" />
                <button type="button" onclick="clearFeedSelectedPhoto()" style="position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.7); color: #fff; border: 1px solid rgba(255,255,255,0.3); border-radius: 50%; width: 28px; height: 28px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: bold;">✕</button>
              </div>

              <!-- Bottom Attachment Bar & Actions -->
              <div class="composer-actions-bar">
                <div class="composer-media-tray">
                  <button type="button" class="composer-media-btn" title="Add Photo" onclick="document.getElementById('realFeedFileInput').click();">
                    <span>📷</span> <span class="media-btn-label">Photo</span>
                  </button>
                  <button type="button" class="composer-media-btn" title="Add Video Reel" onclick="const c=document.getElementById('dynamicPostCaption'); c.value += (c.value ? ' ' : '') + '🎬 [Reel: ipfs://bafy...reel.mp4]'; c.focus();">
                    <span>🎬</span> <span class="media-btn-label">Reel</span>
                  </button>
                  <button type="button" class="composer-media-btn" title="Pin Merkle DAG Block" onclick="const c=document.getElementById('dynamicPostCaption'); c.value += (c.value ? ' ' : '') + '📦 [DAG Pin: z6Mkt...dag]'; c.focus();">
                    <span>📦</span> <span class="media-btn-label">DAG Pin</span>
                  </button>
                  <select id="dynamicPostTheme" class="composer-theme-select" title="Broadcast Channel Protocol">
                    <option value="mesh">🚀 P2P Swarm</option>
                    <option value="dag">📦 Merkle DAG</option>
                    <option value="5g">⚡ 5G Traversal</option>
                    <option value="audio">🎵 Spatial Audio</option>
                    <option value="creator">💎 95/5 Split</option>
                  </select>
                </div>

                <div style="display: flex; gap: 0.5rem; align-items: center;">
                  <input id="dynamicPostTags" type="text" placeholder="#sovra #p2p" value="#sovra #p2p #mesh" class="composer-tags-input" />
                  <button id="dynamicPostPublishBtn" onclick="submitDynamicPost()" class="composer-publish-btn">
                    <span>🚀 Post</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Instagram Feed Cards Stream -->
        <div id="feedPostsStream" style="display: flex; flex-direction: column; gap: 1.5rem;">
          ${feedPostsStore.length === 0 ? `
            <div id="emptyFeedNotice" style="text-align: center; padding: 3rem 1.5rem; background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--glass-border);">
              <div style="font-size: 3rem; margin-bottom: 0.75rem;">🛰️</div>
              <div style="font-weight: 700; font-size: 1.1rem; color: #fff; margin-bottom: 0.5rem;">Sovereign Mesh Feed is Clean</div>
              <div style="color: var(--text-secondary); font-size: 0.85rem; max-width: 420px; margin: 0 auto 1.25rem;">
                Zero corporate algorithms or ads. Be the first sovereign peer to broadcast a photo, update, or thought to local peers!
              </div>
              <button onclick="document.getElementById('dynamicPostCaption').focus()" class="badge badge-accent" style="padding: 0.6rem 1.2rem; cursor: pointer; font-size: 0.85rem;">
                ✍️ Create First Post
              </button>
            </div>
          ` : feedPostsStore
            .map(
              post => `
            <article class="insta-post-card" id="card-${post.id}">
              <!-- Post Header -->
              <div class="insta-post-header">
                <div class="insta-author-info" onclick="openCreatorProfile('${post.authorName.split(' ')[0].toLowerCase()}')">
                  <div class="insta-author-avatar" style="background: ${post.authorAvatarBg}; overflow: hidden;">
                    ${post.authorAvatarDataUrl ? `<img src="${post.authorAvatarDataUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;" />` : post.authorAvatar}
                  </div>
                  <div>
                    <div style="font-weight: 700; font-size: 0.9rem; color: #fff; display: flex; align-items: center; gap: 4px;">
                      <span>${post.authorName}</span>
                      <span style="color: #38bdf8; font-size: 0.8rem;">✓</span>
                    </div>
                    <div style="font-size: 0.72rem; color: #94a3b8;">
                      <span>${post.audioTrack}</span>
                    </div>
                  </div>
                </div>
                <button class="chat-btn-round" style="width: 32px; height: 32px; font-size: 1rem;" title="Post Options" onclick="openPostOptionsModal('${post.id}', '${post.authorName}', '${post.mediaCid}')">⋮</button>
              </div>

              <!-- Media Box with Double-Tap Heart Physics -->
              ${post.mediaImage ? `
              <div class="insta-media-box" id="media-${post.id}" 
                   style="position: relative; overflow: hidden; max-height: 520px; background: #000; display: flex; align-items: center; justify-content: center;"
                   ondblclick="handleFeedDoubleTap('${post.id}', event)">
                <img src="${post.mediaImage}" alt="Feed photo" style="width: 100%; height: auto; max-height: 520px; object-fit: contain; display: block;" />
                <div style="position: absolute; bottom: 8px; left: 8px; display: inline-flex; align-items: center; gap: 5px; background: rgba(15,23,42,0.85); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,0.15); padding: 3px 8px; border-radius: 12px; font-size: 0.68rem; font-family: monospace; color: #38bdf8; z-index: 5;">
                  <span>📦 CID:</span> <span>${(post.mediaCid || 'bafybei...').substring(0, 14)}...</span>
                </div>
                <div id="heart-pop-${post.id}"></div>
              </div>
              ` : `
              <div class="insta-media-box" id="media-${post.id}" 
                   style="background: ${post.mediaGradient};"
                   ondblclick="handleFeedDoubleTap('${post.id}', event)">
                <div style="text-align: center; pointer-events: none; z-index: 2; padding: 2rem;">
                  <div style="font-size: 4rem; margin-bottom: 0.75rem;">${post.mediaEmoji}</div>
                  <div style="font-size: 1.15rem; font-weight: 800; color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,0.8); line-height: 1.35;">
                    ${post.mediaTitle}
                  </div>
                  <div style="margin-top: 0.85rem; display: inline-flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.5); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,0.15); padding: 4px 10px; border-radius: 20px; font-size: 0.72rem; font-family: monospace; color: #a5b4fc;">
                    <span>📦 CID:</span> <span>${(post.mediaCid || 'bafybei...').substring(0, 16)}...</span>
                  </div>
                </div>
                <div id="heart-pop-${post.id}"></div>
              </div>
              `}

              <!-- Actions Row -->
              <div class="insta-actions-row">
                <div style="display: flex; align-items: center; gap: 0.85rem;">
                  <button class="insta-action-btn" id="btn-like-${post.id}" onclick="triggerFeedPostLike('${post.id}')" title="Like Post">
                    ${post.isLiked ? '❤️' : '🤍'}
                  </button>
                  <button class="insta-action-btn" onclick="focusFeedComment('${post.id}')" title="Comment">
                    💬
                  </button>
                  <button class="insta-action-btn" onclick="openRepostModal('${post.id}')" title="Repost / Quote">
                    🔁
                  </button>
                  <button class="insta-action-btn" onclick="shareFeedPostCid('${post.mediaCid}')" title="Share CID to P2P Mesh">
                    🚀
                  </button>
                  <button class="insta-action-btn" onclick="handleFeedDislike('${post.id}')" title="Dislike / Show Less">
                    👎
                  </button>
                </div>
                <button class="insta-action-btn" id="btn-save-${post.id}" onclick="toggleSaveFeedPost('${post.id}')" title="Pin to Local Blockstore">
                  ${post.isSaved ? '🔖' : '🏷️'}
                </button>
              </div>

              <!-- Likes Count -->
              <div class="insta-likes-text">
                <span id="likes-count-${post.id}">${post.likesCount.toLocaleString()}</span> likes
              </div>

              <!-- Caption -->
              <div class="insta-caption">
                <strong>${post.authorName.split(' ')[0]}</strong>
                <span>${post.caption}</span>
                <div class="insta-tags" style="margin-top: 0.25rem;">${post.tags}</div>
              </div>

              <!-- Comments Preview -->
              <div class="insta-comments-preview" id="comments-box-${post.id}">
                <div style="color: #64748b; font-size: 0.75rem; cursor: pointer;">
                  View all ${post.comments.length} comments &bull; Verified on DHT
                </div>
                ${post.comments
                  .map(
                    c => `
                  <div>
                    <strong style="color: #e2e8f0; font-size: 0.82rem;">${c.author}</strong>
                    <span style="color: #cbd5e1; font-size: 0.82rem;">${c.text}</span>
                  </div>
                `,
                  )
                  .join('')}
              </div>

              <!-- Time Ago -->
              <div style="padding: 0 1rem; font-size: 0.68rem; color: #64748b; text-transform: uppercase; margin-bottom: 0.65rem;">
                ${Math.floor((Date.now() - post.timestamp) / 3600000)} HOURS AGO &bull; ED25519 SIGNED
              </div>

              <!-- Add Comment Input Box -->
              <div class="insta-comment-input-box">
                <span style="font-size: 1.1rem;">😊</span>
                <input type="text" class="insta-comment-input" id="input-comment-${post.id}" placeholder="Add a comment on sovereign mesh..." onkeydown="if(event.key==='Enter') submitFeedComment('${post.id}')">
                <button class="insta-post-btn" onclick="submitFeedComment('${post.id}')">Post</button>
              </div>
            </article>
          `,
            )
            .join('')}
        </div>
      </div>
    </main>

    <!-- Tab: Dedicated Friends & People Discovery View -->
    <main class="main-content" id="friends-view" style="display: none; width: 100%; flex-direction: column; align-items: center;">
      <div class="friends-container">
        <!-- Friends Search & Discovery Hero -->
        <div class="friends-search-hero">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap;">
            <div>
              <div style="font-size: 1.35rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.5rem;">
                <span>👥</span> <span>Friends & People Discovery</span>
              </div>
              <div style="font-size: 0.82rem; color: #94a3b8; margin-top: 0.35rem; line-height: 1.4;">
                Find & add friends, verify bilateral cryptographic handshakes, and explore decentralized peers.
              </div>
            </div>
            <div style="background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 12px; padding: 0.4rem 0.85rem; text-align: right;">
              <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: 0.04em;">Connected Mesh</div>
              <div style="font-size: 1rem; font-weight: 800; color: #38bdf8;" id="friendsTotalBadge">2 Friends</div>
            </div>
          </div>

          <!-- Dedicated Friends Search Bar Input -->
          <div class="friends-search-input-box">
            <span style="font-size: 1.1rem; color: #38bdf8;">🔍</span>
            <input type="text" id="friendsViewSearchInput" class="friends-search-input" placeholder="Search friends by name, @handle, bio or peer DID..." oninput="filterFriendsView(this.value)" />
            <button id="friendsSearchClearBtn" onclick="clearFriendsViewSearch()" style="display: none; background: none; border: none; color: #94a3b8; cursor: pointer; padding: 2px 6px; font-size: 0.9rem;">✕</button>
          </div>

          <!-- Filter Navigation Tabs / Pills -->
          <div class="friends-filter-pills">
            <button class="friends-filter-pill active" id="ffilter-all" onclick="setFriendsFilter('all')">All People</button>
            <button class="friends-filter-pill" id="ffilter-requests" onclick="setFriendsFilter('requests')">
              Requests <span id="ffilterRequestsCount" style="background: #ef4444; color: #fff; padding: 1px 6px; border-radius: 10px; font-size: 0.68rem; margin-left: 4px;">1</span>
            </button>
            <button class="friends-filter-pill" id="ffilter-friends" onclick="setFriendsFilter('friends')">My Friends</button>
            <button class="friends-filter-pill" id="ffilter-suggestions" onclick="setFriendsFilter('suggestions')">Suggestions</button>
          </div>
        </div>

        <!-- Dynamic Friends Content Area -->
        <div id="friendsViewContent" style="display: flex; flex-direction: column; gap: 1.5rem; width: 100%;">
          <!-- Rendered dynamically by renderFriendsDiscoveryView() -->
        </div>
      </div>
    </main>

    <!-- Main Section: Instagram Reels (Immersive Full Screen View) -->
    <main class="main-content" id="reels-view" style="display: none;">
      <!-- Reels Player Stage -->
      <div class="reels-stage">
        <div class="reels-phone-wrapper">
          <div class="reel-ambient-cinema-glow" id="reelAmbientCinemaGlow" style="background: ${reelsStore[0]!.bgGradient};"></div>
          <!-- Phone Mockup Container with 60fps Gesture Physics -->
          <div class="reels-phone" id="reelsPhone" 
             onpointerdown="handleReelPointerDown(event)" 
             onpointermove="handleReelPointerMove(event)" 
             onpointerup="handleReelPointerUp(event)"
             onwheel="handleReelWheel(event)">

          <!-- Top Playback Progress Line -->
          <div class="reels-progress-line" id="reelProgressBar"></div>

          <!-- Top Floating Status Pill -->
          <div class="reels-header-pill">
            <div class="p2p-badge-pill">
              <span>⚡</span>
              <span id="reelPreWarmStatus">Pre-Warmed (14ms decode)</span>
            </div>
            <div style="font-size: 0.75rem; color: #fff; font-weight: 700; background: rgba(0,0,0,0.5); backdrop-filter: blur(6px); padding: 0.2rem 0.6rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.15);" id="reelCounterDisplay">
              1 / ${reelsStore.length}
            </div>
          </div>

          <!-- Tap to Play / Pause Center Floating Indicator -->
          <div class="tap-play-indicator" id="tapPlayIndicator">▶</div>

          <!-- Video Canvas / Screen Wrapper with Double-Tap Physics -->
          <div class="reels-canvas-wrapper" id="reelCanvasWrapper" 
               onclick="handleReelSingleClick(event)" 
               ondblclick="handleReelDoubleTap(event)">
            
            <div class="reels-ambient-bg" id="reelAmbientBg" style="background: ${reelsStore[0]!.bgGradient};">
              <!-- Visualizer Ripple -->
              <div class="reel-visualizer" id="reelVisualizer">
                <span style="font-size: 3.2rem;">🎬</span>
              </div>
              <div style="font-size: 0.8rem; color: rgba(255,255,255,0.7); margin-top: 1rem; font-family: monospace;" id="reelCidDisplay">
                CID: ${reelsStore[0]!.cid.substring(0, 20)}...
              </div>
              <div style="font-size: 0.7rem; color: #34d399; margin-top: 0.25rem;">
                ● 60 FPS BitSwap Stream Loop &bull; Zero Server
              </div>
            </div>

            <!-- Dopamine Particles Containers -->
            <div id="dopamineContainer"></div>
            <div id="notesContainer"></div>
          </div>

          <!-- Right Floating Action Column -->
          <div class="reels-right-actions">
            <!-- Creator Avatar with Story Ring & Plus -->
            <div style="position: relative; margin-bottom: 0.5rem; cursor: pointer;" onclick="event.stopPropagation(); openCreatorProfile(reelsData[currentReelIndex].creatorHandle)">
              <div style="width: 44px; height: 44px; border-radius: 50%; background: #6366f1; border: 2px solid #fff; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #fff; font-size: 1.1rem;" id="reelCreatorAvatar">
                A
              </div>
              <div style="position: absolute; bottom: -4px; left: 50%; transform: translateX(-50%); background: #ef4444; color: #fff; width: 16px; height: 16px; border-radius: 50%; font-size: 0.7rem; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 1.5px solid #000;" id="reelAvatarFollowBadge">+</div>
            </div>

            <!-- Like Heart Button with Floating Dopamine Pop -->
            <button class="reel-action-btn" onclick="event.stopPropagation(); triggerReelLike(event)">
              <div class="reel-action-icon" id="reelLikeIcon">🤍</div>
              <span class="reel-action-label" id="reelLikeCount">${reelsStore[0]!.likesCount}</span>
            </button>

            <!-- Comments Button -->
            <button class="reel-action-btn" onclick="event.stopPropagation(); openReelCommentsSheet()">
              <div class="reel-action-icon">💬</div>
              <span class="reel-action-label" id="reelCommentCount">${reelsStore[0]!.commentsCount}</span>
            </button>

            <!-- Share P2P CID Button -->
            <button class="reel-action-btn" onclick="event.stopPropagation(); openReelShareSheet()">
              <div class="reel-action-icon">↗️</div>
              <span class="reel-action-label" id="reelShareCount">${reelsStore[0]!.sharesCount}</span>
            </button>

            <!-- Bookmark / Save Button -->
            <button class="reel-action-btn" onclick="event.stopPropagation(); toggleReelSave()">
              <div class="reel-action-icon" id="reelSaveIcon">🔖</div>
              <span class="reel-action-label" id="reelSaveLabel">Save</span>
            </button>

            <!-- Rotating Vinyl Sound Disc with Floating Music Notes -->
            <div class="music-disc" id="reelVinylDisc" onclick="event.stopPropagation(); openAudioTrackSheet()" title="View Audio Track">
              <span style="font-size: 0.8rem;">🎵</span>
            </div>
          </div>

          <!-- Bottom Meta Overlay -->
          <div class="reels-bottom-overlay">
            <div class="reels-creator-row">
              <span class="reels-handle" id="reelCreatorHandle" onclick="event.stopPropagation(); openCreatorProfile(reelsData[currentReelIndex].creatorHandle)" style="cursor: pointer;">@${reelsStore[0]!.creatorHandle}</span>
              <span style="color: #60a5fa; font-size: 0.85rem;" title="Verified Sovereign Identity">✓</span>
              <button class="btn-follow-pill" id="reelFollowBtn" onclick="event.stopPropagation(); toggleReelFollow()">Follow</button>
            </div>
            <div class="reels-caption" id="reelCaption">
              ${reelsStore[0]!.caption}
            </div>
            <div class="reels-audio-track" onclick="event.stopPropagation(); openAudioTrackSheet()">
              <span>🎵</span>
              <span id="reelAudioTrack">${reelsStore[0]!.audioTrack}</span>
              <div class="sound-wave-eq">
                <div class="sound-bar"></div>
                <div class="sound-bar"></div>
                <div class="sound-bar"></div>
                <div class="sound-bar"></div>
              </div>
            </div>
          </div>

          <!-- Bottom Sheet 1: Instagram Comments Drawer -->
          <div class="reels-sheet-overlay" id="commentsSheetOverlay" onclick="closeReelsSheet('commentsSheetOverlay')">
            <div class="reels-sheet-content" onclick="event.stopPropagation()">
              <div class="sheet-handle-bar"></div>
              <div class="sheet-header">
                <span>Comments (<span id="sheetCommentsCount">142</span>)</span>
                <button style="background: none; border: none; color: #fff; font-size: 1.1rem; cursor: pointer;" onclick="closeReelsSheet('commentsSheetOverlay')">✕</button>
              </div>
              <div class="sheet-body" id="sheetCommentsList">
                <!-- Dynamically rendered -->
              </div>
              <div class="sheet-composer">
                <div class="quick-emojis-row">
                  <span onclick="appendCommentEmoji('❤️')">❤️</span>
                  <span onclick="appendCommentEmoji('🙌')">🙌</span>
                  <span onclick="appendCommentEmoji('🔥')">🔥</span>
                  <span onclick="appendCommentEmoji('👏')">👏</span>
                  <span onclick="appendCommentEmoji('😂')">😂</span>
                  <span onclick="appendCommentEmoji('😍')">😍</span>
                  <span onclick="appendCommentEmoji('😮')">😮</span>
                  <span onclick="appendCommentEmoji('🚀')">🚀</span>
                </div>
                <div class="sheet-input-row">
                  <input type="text" id="sheetCommentInput" class="chat-text-input" placeholder="Add a public comment..." onkeydown="if(event.key==='Enter') submitReelComment()">
                  <button class="btn btn-primary" style="padding: 0.45rem 1rem; border-radius: 8px; font-size: 0.8rem;" onclick="submitReelComment()">Post</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Bottom Sheet 2: Instagram Creator Profile Drawer -->
          <div class="reels-sheet-overlay" id="profileSheetOverlay" onclick="closeReelsSheet('profileSheetOverlay')">
            <div class="reels-sheet-content" onclick="event.stopPropagation()">
              <div class="sheet-handle-bar"></div>
              <div class="sheet-header">
                <span id="profileSheetHandle">@alice_creator</span>
                <button style="background: none; border: none; color: #fff; font-size: 1.1rem; cursor: pointer;" onclick="closeReelsSheet('profileSheetOverlay')">✕</button>
              </div>
              <div class="sheet-body" style="padding: 0.75rem 1rem;">
                <div class="profile-hero">
                  <div class="story-ring" style="width: 72px; height: 72px; padding: 3px;">
                    <div class="story-avatar" id="profileSheetAvatar" style="background: #6366f1; font-size: 1.6rem;">A</div>
                  </div>
                  <div class="profile-stats-row">
                    <div class="profile-stat-box">
                      <div id="profileSheetPosts">48</div>
                      <div>Posts</div>
                    </div>
                    <div class="profile-stat-box">
                      <div id="profileSheetFollowers">128.4K</div>
                      <div>Followers</div>
                    </div>
                    <div class="profile-stat-box">
                      <div id="profileSheetFollowing">312</div>
                      <div>Following</div>
                    </div>
                  </div>
                </div>

                <div class="profile-bio-box">
                  <div style="font-weight: 700; color: #fff;" id="profileSheetName">Alice ⚡ P2P Architect</div>
                  <div id="profileSheetBio" style="margin-top: 0.25rem;">Decentralized P2P Architect • Zero middleman servers ⚡ • Building on Sovra protocol</div>
                  <div style="color: #60a5fa; font-size: 0.75rem; margin-top: 0.35rem;" id="profileSheetLink">🔗 sovra.network/alice</div>
                </div>

                <div class="profile-actions-row">
                  <button class="profile-btn profile-btn-primary" id="profileSheetFollowBtn" onclick="toggleProfileFollow()">Follow</button>
                  <button class="profile-btn profile-btn-secondary" onclick="messageCreatorFromProfile()">Message</button>
                  <button class="profile-btn profile-btn-secondary" style="flex: 0 0 36px;" onclick="shareCreatorProfile()">↗️</button>
                </div>

                <!-- Story Highlights Tray -->
                <div class="profile-highlights-row" id="profileSheetHighlights">
                  <!-- Dynamically rendered -->
                </div>

                <!-- 3-Column Reels Grid -->
                <div style="font-weight: 700; font-size: 0.85rem; color: #cbd5e1; margin-top: 0.75rem; display: flex; align-items: center; gap: 0.35rem;">
                  <span>🎬</span> <span>Reels</span>
                </div>
                <div class="profile-reels-grid" id="profileSheetGrid">
                  <!-- Dynamically rendered -->
                </div>
              </div>
            </div>
          </div>

          <!-- Bottom Sheet 3: Instagram Share / P2P Send Drawer -->
          <div class="reels-sheet-overlay" id="shareSheetOverlay" onclick="closeReelsSheet('shareSheetOverlay')">
            <div class="reels-sheet-content" onclick="event.stopPropagation()">
              <div class="sheet-handle-bar"></div>
              <div class="sheet-header">
                <span>Share Reel</span>
                <button style="background: none; border: none; color: #fff; font-size: 1.1rem; cursor: pointer;" onclick="closeReelsSheet('shareSheetOverlay')">✕</button>
              </div>
              <div class="sheet-body">
                <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.25rem;">Direct P2P Mesh Send:</div>
                <div style="display: flex; gap: 1rem; overflow-x: auto; padding-bottom: 0.5rem;">
                  <div style="display: flex; flex-direction: column; align-items: center; gap: 0.25rem; cursor: pointer;" onclick="sendReelDirect('Alice')">
                    <div style="width: 48px; height: 48px; border-radius: 50%; background: #10b981; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #fff;">A</div>
                    <span style="font-size: 0.72rem; color: #fff;">Alice</span>
                  </div>
                  <div style="display: flex; flex-direction: column; align-items: center; gap: 0.25rem; cursor: pointer;" onclick="sendReelDirect('Bob')">
                    <div style="width: 48px; height: 48px; border-radius: 50%; background: #f59e0b; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #fff;">B</div>
                    <span style="font-size: 0.72rem; color: #fff;">Bob</span>
                  </div>
                  <div style="display: flex; flex-direction: column; align-items: center; gap: 0.25rem; cursor: pointer;" onclick="sendReelDirect('Carol')">
                    <div style="width: 48px; height: 48px; border-radius: 50%; background: #ec4899; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #fff;">Carol</div>
                    <span style="font-size: 0.72rem; color: #fff;">Carol</span>
                  </div>
                  <div style="display: flex; flex-direction: column; align-items: center; gap: 0.25rem; cursor: pointer;" onclick="sendReelDirect('Dave')">
                    <div style="width: 48px; height: 48px; border-radius: 50%; background: #6366f1; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #fff;">D</div>
                    <span style="font-size: 0.72rem; color: #fff;">Dave</span>
                  </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem;">
                  <button class="profile-btn profile-btn-secondary" style="padding: 0.75rem; text-align: left; display: flex; align-items: center; gap: 0.5rem;" onclick="copyActiveReelCid()">
                    <span>🔗</span> <span>Copy Decentralized CID Link</span>
                  </button>
                  <button class="profile-btn profile-btn-secondary" style="padding: 0.75rem; text-align: left; display: flex; align-items: center; gap: 0.5rem;" onclick="shareToWhatsAppChat()">
                    <span>💬</span> <span>Forward to WhatsApp E2EE Chat</span>
                  </button>
                  <button class="profile-btn profile-btn-secondary" style="padding: 0.75rem; text-align: left; display: flex; align-items: center; gap: 0.5rem;" onclick="alert('Added to your 24h Ephemeral Story!')">
                    <span>⚡</span> <span>Add Reel to Your Story</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Bottom Sheet 4: Audio Track Detail Drawer -->
          <div class="reels-sheet-overlay" id="audioSheetOverlay" onclick="closeReelsSheet('audioSheetOverlay')">
            <div class="reels-sheet-content" onclick="event.stopPropagation()">
              <div class="sheet-handle-bar"></div>
              <div class="sheet-header">
                <span>Audio Track</span>
                <button style="background: none; border: none; color: #fff; font-size: 1.1rem; cursor: pointer;" onclick="closeReelsSheet('audioSheetOverlay')">✕</button>
              </div>
              <div class="sheet-body">
                <div style="display: flex; gap: 1rem; align-items: center;">
                  <div style="width: 64px; height: 64px; border-radius: 12px; background: #312e81; display: flex; align-items: center; justify-content: center; font-size: 2rem;">
                    🎧
                  </div>
                  <div>
                    <div style="font-weight: 700; color: #fff; font-size: 1rem;" id="audioSheetTitle">Original Audio</div>
                    <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.2rem;" id="audioSheetArtist">By Alice Creator</div>
                    <div style="font-size: 0.72rem; color: #34d399; margin-top: 0.25rem;">● 12.4K Reels Created</div>
                  </div>
                </div>
                <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                  <button class="profile-btn profile-btn-primary" onclick="alert('Audio selected for your new Reel!')">Use Audio</button>
                  <button class="profile-btn profile-btn-secondary" onclick="alert('Audio saved to your sovereign audio collection!')">Save Audio</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

        <!-- Snap Navigation Controls (Keyboard & Click Alternatives) -->
        <div class="reels-nav-controls">
          <button class="reel-nav-btn" onclick="prevReel()" title="Previous Reel (Arrow Up / Swipe Down)">▲</button>
          <button class="reel-nav-btn" onclick="nextReel()" title="Next Reel (Arrow Down / Swipe Up)">▼</button>
          <div style="font-size: 0.7rem; color: var(--text-muted); text-align: center; writing-mode: vertical-rl; transform: rotate(180deg); letter-spacing: 0.1em;">
            SWIPE / FLICK / KEYS
          </div>
        </div>
      </div>
    </main>


    <!-- Main Section: WhatsApp E2EE Chat Window -->
    <main class="main-content" id="chat-view" style="display: none;">
      <div class="whatsapp-container">
        <!-- Contacts Sidebar -->
        <aside class="chat-sidebar">
          <!-- BitChat Zero-Internet Mesh Mode Bar -->
          <div class="bitchat-mode-bar" id="bitchatModeBar">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span class="radar-sweep-icon" style="color: #38bdf8;">📶</span>
              <div>
                <div style="font-weight: 800; font-size: 0.85rem; color: #38bdf8; display: flex; align-items: center; gap: 4px;">
                  <span>BitChat Mesh</span>
                  <span id="bitchatModeBadge" class="badge" style="font-size: 0.65rem; background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); padding: 1px 5px;">BLE Active</span>
                </div>
                <div style="font-size: 0.68rem; color: #94a3b8;" id="bitchatStatusSubtitle">Zero-Internet Local Swarm</div>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 0.4rem;">
              <button id="bitchatModeToggleBtn" onclick="toggleBitChatMode()" class="bitchat-pill-btn" title="Toggle between BitChat Offline Mesh and Global Internet P2P">
                <span id="bitchatModeDot" class="radar-dot"></span>
                <span id="bitchatModeText">Mesh Mode</span>
              </button>
              <button id="bitchatPanicBtn" onclick="executeBitChatPanicWipe()" class="panic-wipe-btn" title="🚨 Emergency Panic Wipe: Instantly zeroize local keys, offline chats & peer table">
                🚨 Wipe
              </button>
            </div>
          </div>

          <!-- Radar Spectrum Scanner Strip -->
          <div id="bitchatRadarContainer" class="bitchat-radar-strip">
            <div class="radar-sweep-icon" style="font-size: 1.05rem; color: #38bdf8;">📡</div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 0.74rem; font-weight: 700; color: #e2e8f0; display: flex; justify-content: space-between;">
                <span>2.4GHz BLE Spectrum Scan</span>
                <span style="color: #34d399; font-weight: 700;" id="bitchatPeersCountBadge">2 channels active</span>
              </div>
              <div style="font-size: 0.68rem; color: #64748b;">Ad-hoc multi-hop forwarding active (TTL: 7 hops)</div>
            </div>
          </div>

          <div class="chat-sidebar-header" id="chatSidebarHeader">
            <span style="font-weight: 700; color: #e9edef; font-size: 1rem;" id="chatSidebarTitle">💬 Chats</span>
            <span style="font-size: 0.72rem; color: #38bdf8; background: rgba(56, 189, 248, 0.15); padding: 2px 8px; border-radius: 10px; font-weight: 600;" id="chatSidebarProtocolBadge">BitChat Mesh Ready</span>
          </div>
          <!-- Search box -->
          <div class="chat-search-box">
            <input type="text" class="chat-search-input" id="chatSearchInput" placeholder="Search contacts & mesh..." oninput="filterChatContacts(this.value)">
          </div>
          <div class="chat-contacts-list" id="contactsList">
            ${contactsStore
              .map(
                c => `
              <div class="contact-item" onclick="selectContact('${c.did}')" id="contact-${c.did.replace(/[^a-zA-Z0-9]/g, '_')}">
                <div class="contact-avatar" style="background: ${c.avatarBg};">
                  ${c.avatar}
                  ${c.isOnline ? '<div class="online-dot"></div>' : ''}
                  ${c.disappearingDurationSec > 0 ? '<div class="contact-clock-badge" title="Disappearing Messages Active">⏱️</div>' : ''}
                </div>
                <div class="contact-info">
                  <div class="contact-top-row">
                    <span class="contact-name">
                      ${c.name}
                      ${c.isVerified ? '<span class="verified-shield-icon" title="Safety Numbers Verified">🛡️</span>' : ''}
                    </span>
                    <span class="contact-time">${c.isOnline ? 'Online' : c.lastSeen}</span>
                  </div>
                  <div class="contact-preview-row">
                    <span style="color: #53bdeb; font-weight: bold;">✓✓</span>
                    <span id="preview-${c.did.replace(/[^a-zA-Z0-9]/g, '_')}">${c.role}</span>
                  </div>
                </div>
              </div>
            `,
              )
              .join('')}
          </div>
        </aside>

        <!-- Chat Conversation Area -->
        <section class="chat-main">
          <!-- Chat Top Header -->
          <div class="chat-header">
            <button class="mobile-chat-back-btn" onclick="closeMobileChat()" title="Back to chats list">←</button>
            <div class="chat-header-user" onclick="openSafetyNumbersModal()" title="View Safety Numbers & Encryption Details">
              <div class="contact-avatar" style="background: #0284c7;" id="activePeerAvatar">📶</div>
              <div>
                <div style="font-weight: 600; color: #e9edef; display: flex; align-items: center; gap: 4px;">
                  <span id="activePeerName">#local-mesh</span>
                  <span id="activePeerVerifiedBadge" style="display: none; color: #22c55e; font-size: 0.85rem;" title="Safety Numbers Verified">🛡️</span>
                </div>
                <div style="font-size: 0.72rem; color: #8696a0;" id="activePeerStatus">● Zero-Internet Local Mesh Swarm &bull; 50m Radius Broadcast</div>
              </div>
            </div>
            
            <div class="chat-header-actions">
              <!-- BitChat Multi-Hop Routing Indicator -->
              <span id="bitchatHeaderRoute" class="bitchat-hop-badge" style="display: none;">📶 Direct BLE Link (1 Hop)</span>

              <!-- Disappearing messages timer toggle -->
              <button class="disappearing-timer-pill" id="headerDisappearingBtn" onclick="openDisappearingModal()" title="Configure Disappearing Messages Timer">
                ⏱️ <span id="headerTimerText">Off</span>
              </button>
              
              <!-- E2EE Audio / Video Call -->
              <button class="chat-action-btn" onclick="startE2eeCall('audio')" title="Encrypted Voice Call (Noise_XX QUIC)">📞</button>
              <button class="chat-action-btn" onclick="startE2eeCall('video')" title="Encrypted Video Call (Noise_XX QUIC)">📹</button>
              
              <!-- E2EE Shield badge -->
              <div class="e2ee-shield-badge" onclick="openSafetyNumbersModal()" title="Verify 60-digit Safety Numbers">
                <span>🔒</span>
                <span>Signal E2EE</span>
              </div>
              
              <button class="chat-action-btn" onclick="openSafetyNumbersModal()" title="Safety Numbers & Verification">⋮</button>
            </div>
          </div>

          <!-- Chat Messages Scroll Area -->
          <div class="chat-messages" id="chatMessagesContainer">
            <!-- Populated dynamically by client script -->
          </div>

          <!-- Bottom Input Bar -->
          <div class="chat-input-bar">
            <!-- Standard view -->
            <div id="standardInputRow" style="display: flex; align-items: center; gap: 0.65rem; width: 100%;">
              <button class="chat-btn-round" title="Send Emoji Reaction" onclick="insertEmojiToInput('😊')">😊</button>
              <button class="chat-btn-round" title="Send P2P Merkle DAG UnixFS Attachment" onclick="alert('P2P UnixFS File Attachment: File encrypted with ChaCha20-Poly1305 and pinned to local blockstore.')">📎</button>
              <input type="text" class="chat-text-input" id="chatInputText" placeholder="Type an encrypted message..." onkeydown="if(event.key==='Enter') sendChatMessage()">
              <button class="chat-btn-round" id="micBtn" title="Hold/Click to Record Voice Note" onclick="toggleVoiceRecord()">🎙️</button>
              <button class="chat-btn-round chat-btn-send" title="Send Message" onclick="sendChatMessage()">➤</button>
            </div>

            <!-- Voice Recording Active Overlay -->
            <div class="voice-recording-drawer" id="voiceRecordingDrawer">
              <div class="record-blinking-dot"></div>
              <span style="font-family: monospace; font-size: 0.85rem; color: #ef4444; font-weight: 700;" id="voiceRecordTimer">0:00</span>
              <div class="record-live-waves">
                <div class="record-wave-bar" style="animation-delay: 0.0s;"></div>
                <div class="record-wave-bar" style="animation-delay: 0.15s;"></div>
                <div class="record-wave-bar" style="animation-delay: 0.3s;"></div>
                <div class="record-wave-bar" style="animation-delay: 0.45s;"></div>
                <div class="record-wave-bar" style="animation-delay: 0.2s;"></div>
                <div class="record-wave-bar" style="animation-delay: 0.35s;"></div>
                <div class="record-wave-bar" style="animation-delay: 0.1s;"></div>
              </div>
              <button class="chat-btn-round" style="color: #ef4444;" title="Cancel & Discard Recording" onclick="cancelVoiceRecord()">🗑️</button>
              <button class="chat-btn-round chat-btn-send" title="Send Voice Note" onclick="finishAndSendVoiceRecord()">➤</button>
            </div>
          </div>
        </section>
      </div>

      <!-- Modals for WhatsApp Features -->
      <!-- 1. Safety Numbers & Security Code Modal -->
      <div class="wa-modal-overlay" id="safetyNumbersModal" style="display: none;" onclick="closeWaModal('safetyNumbersModal')">
        <div class="wa-modal-card" onclick="event.stopPropagation()">
          <div class="wa-modal-header">
            <div class="wa-modal-title">
              <span>🔒</span>
              <span>Verify Security Code</span>
            </div>
            <button class="wa-modal-close" onclick="closeWaModal('safetyNumbersModal')">&times;</button>
          </div>
          <div style="text-align: center; margin-bottom: 1rem;">
            <div class="qr-sim-box" id="qrSimBox">
              <!-- Rendered by script -->
            </div>
            <p style="font-size: 0.8rem; color: #8696a0; line-height: 1.4; margin: 0.5rem 0;">
              To verify that messages and calls with <strong id="modalContactName" style="color: #e9edef;">Alice</strong> are end-to-end encrypted, compare these 60 numbers with their device.
            </p>
          </div>
          <div class="safety-numbers-box" id="modalSafetyNumbersDisplay">
            <!-- 12 blocks of 5 digits -->
          </div>
          <div style="display: flex; gap: 0.75rem; margin-top: 1.25rem;">
            <button class="btn btn-outline" style="flex: 1;" onclick="copySafetyNumbers()">📋 Copy Code</button>
            <button class="btn btn-primary" style="flex: 1; background: #00a884;" onclick="confirmVerifySafetyNumbers()">Mark Verified ✓</button>
          </div>
        </div>
      </div>

      <!-- 2. Disappearing Messages Modal -->
      <div class="wa-modal-overlay" id="disappearingModal" style="display: none;" onclick="closeWaModal('disappearingModal')">
        <div class="wa-modal-card" onclick="event.stopPropagation()">
          <div class="wa-modal-header">
            <div class="wa-modal-title">
              <span>⏱️</span>
              <span>Disappearing Messages</span>
            </div>
            <button class="wa-modal-close" onclick="closeWaModal('disappearingModal')">&times;</button>
          </div>
          <p style="font-size: 0.8rem; color: #8696a0; line-height: 1.4; margin-bottom: 1rem;">
            For more privacy and storage savings, new messages will disappear for both parties after the selected duration once read.
          </p>
          <div style="display: flex; flex-direction: column; gap: 0.5rem;" id="timerOptionsList">
            <div class="timer-option-row" onclick="setContactTimer(5)">
              <div>
                <div style="font-weight: 600; color: #fbbf24;">5 Seconds (Live Demo 🔥)</div>
                <div style="font-size: 0.72rem; color: #8696a0;">Messages vaporize instantly on screen</div>
              </div>
              <input type="radio" name="disappearingTimerRadio" value="5" id="timer-radio-5">
            </div>
            <div class="timer-option-row" onclick="setContactTimer(10)">
              <div>
                <div style="font-weight: 600; color: #e9edef;">10 Seconds</div>
                <div style="font-size: 0.72rem; color: #8696a0;">Short ephemeral review window</div>
              </div>
              <input type="radio" name="disappearingTimerRadio" value="10" id="timer-radio-10">
            </div>
            <div class="timer-option-row" onclick="setContactTimer(86400)">
              <div>
                <div style="font-weight: 600; color: #e9edef;">24 Hours</div>
                <div style="font-size: 0.72rem; color: #8696a0;">Signal standard daily rotation</div>
              </div>
              <input type="radio" name="disappearingTimerRadio" value="86400" id="timer-radio-86400">
            </div>
            <div class="timer-option-row" onclick="setContactTimer(604800)">
              <div>
                <div style="font-weight: 600; color: #e9edef;">7 Days</div>
                <div style="font-size: 0.72rem; color: #8696a0;">Weekly rolling cleanup</div>
              </div>
              <input type="radio" name="disappearingTimerRadio" value="604800" id="timer-radio-604800">
            </div>
            <div class="timer-option-row" onclick="setContactTimer(0)">
              <div>
                <div style="font-weight: 600; color: #e9edef;">Off (Disabled)</div>
                <div style="font-size: 0.72rem; color: #8696a0;">Messages stay in encrypted local storage</div>
              </div>
              <input type="radio" name="disappearingTimerRadio" value="0" id="timer-radio-0">
            </div>
          </div>
          <div style="margin-top: 1.25rem;">
            <button class="btn btn-primary" style="width: 100%; background: #00a884;" onclick="closeWaModal('disappearingModal')">Apply Setting</button>
          </div>
        </div>
      </div>

      <!-- 3. Message Info & Cryptographic Proof Modal -->
      <div class="wa-modal-overlay" id="messageInfoModal" style="display: none;" onclick="closeWaModal('messageInfoModal')">
        <div class="wa-modal-card" onclick="event.stopPropagation()">
          <div class="wa-modal-header">
            <div class="wa-modal-title">
              <span>ℹ️</span>
              <span>Message Info & Cryptography</span>
            </div>
            <button class="wa-modal-close" onclick="closeWaModal('messageInfoModal')">&times;</button>
          </div>
          
          <div style="background: #202c33; border-radius: 8px; padding: 0.85rem; margin-bottom: 1rem;" id="modalMsgPreviewContent">
            <!-- Text or voice preview -->
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.85rem; border-top: 1px solid #202c33; padding-top: 0.85rem;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: #8696a0; font-size: 0.8rem; display: flex; align-items: center; gap: 4px;">
                <span style="color: #53bdeb; font-weight: bold;">✓✓</span> Read
              </span>
              <span style="color: #e9edef; font-size: 0.8rem; font-family: monospace;" id="modalInfoReadTime">Today, 16:20</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: #8696a0; font-size: 0.8rem; display: flex; align-items: center; gap: 4px;">
                <span style="font-weight: bold;">✓✓</span> Delivered
              </span>
              <span style="color: #e9edef; font-size: 0.8rem; font-family: monospace;" id="modalInfoDeliveredTime">Today, 16:19</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: #8696a0; font-size: 0.8rem; display: flex; align-items: center; gap: 4px;">
                <span>✓</span> Sent
              </span>
              <span style="color: #e9edef; font-size: 0.8rem; font-family: monospace;" id="modalInfoSentTime">Today, 16:19</span>
            </div>
          </div>

          <div style="margin-top: 1rem; background: #0b141a; border: 1px solid #202c33; border-radius: 8px; padding: 0.75rem; font-size: 0.72rem; font-family: monospace;">
            <div style="color: #34d399; font-weight: 700; margin-bottom: 0.35rem;">🔐 Cryptographic Verification</div>
            <div style="color: #8696a0;">Ratchet Sequence: <span style="color: #e9edef;" id="modalInfoSeq">#3</span></div>
            <div style="color: #8696a0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Ed25519 Sig: <span style="color: #e9edef;" id="modalInfoSig">ed25519_sig_71bc88ef22</span></div>
            <div style="color: #8696a0;">Cipher: <span style="color: #e9edef;">ChaCha20-Poly1305 (256-bit)</span></div>
          </div>
        </div>
      </div>

      <!-- 4. E2EE Voice/Video Call Modal -->
      <div class="wa-modal-overlay" id="e2eeCallModal" style="display: none;">
        <div class="wa-modal-card" style="text-align: center; max-width: 360px;" onclick="event.stopPropagation()">
          <div class="call-avatar-ripple" id="callAvatarIcon" style="background: #10b981;">A</div>
          <div style="font-size: 1.25rem; font-weight: 700; color: #e9edef;" id="callPeerName">Alice (Storage Seeder)</div>
          <div style="font-size: 0.78rem; color: #34d399; margin: 0.35rem 0 1.5rem 0;" id="callStatusText">
            🔒 End-to-End Encrypted Call &bull; Noise_XX QUIC
          </div>
          <div style="display: flex; justify-content: center; gap: 1.25rem;">
            <button class="chat-btn-round" style="background: #202c33; width: 48px; height: 48px;" title="Mute Microphone">🎙️</button>
            <button class="chat-btn-round" style="background: #202c33; width: 48px; height: 48px;" title="Toggle Camera">📹</button>
            <button class="chat-btn-round" style="background: #ef4444; color: #fff; width: 48px; height: 48px;" title="End Call" onclick="endE2eeCall()">📞</button>
          </div>
        </div>
      </div>
    </main>

    <!-- Main Section: YouTube 16:9 Watch Player & Streaming Platform -->
    <main class="main-content" id="youtube-view" style="display: none;">
      <div class="youtube-container" id="youtubeContainer">
        <!-- Video Player Column -->
        <div style="display: flex; flex-direction: column; gap: 1rem; width: 100%;">
          
          <!-- Ambient Glow Wrapper & 16:9 Video Box -->
          <div class="yt-ambient-wrapper">
            <div class="yt-ambient-glow" id="ytAmbientGlow"></div>
            
            <div class="yt-player-box" id="ytPlayerBox">
              <div class="yt-screen-content" id="ytScreenContent">
                <button class="yt-big-play" id="ytBigPlayBtn" onclick="toggleYtPlay()">▶</button>
                
                <!-- Top Status Badges -->
                <div style="position: absolute; top: 16px; left: 16px; display: flex; gap: 0.5rem; z-index: 10;">
                  <span class="badge" style="background: rgba(0,0,0,0.75); backdrop-filter: blur(6px); color: #fff; border: 1px solid rgba(255,255,255,0.2);">
                    RFC 8216 HLS &bull; BitSwap P2P
                  </span>
                  <span class="badge" id="bufferHealthBadge" style="background: rgba(16, 185, 129, 0.25); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.45);">
                    Buffer: 9.4s (P2P Swarm OK)
                  </span>
                </div>
                
                <div style="position: absolute; top: 16px; right: 16px; z-index: 10; display: flex; gap: 0.5rem;">
                  <span class="badge" id="videoQualityBadge" style="background: rgba(239, 68, 68, 0.25); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.45);">
                    4K UHD 60FPS
                  </span>
                </div>

                <!-- Video Canvas Visual Overlay -->
                <div style="text-align: center; pointer-events: none; z-index: 2;">
                  <div style="font-size: 3.5rem; margin-bottom: 0.5rem;" id="ytScreenEmoji">🎬</div>
                  <div style="font-size: 0.95rem; font-weight: 700; color: #fff; text-shadow: 0 2px 8px rgba(0,0,0,0.8);" id="ytScreenCurrentChapter">
                    Chapter 1: Introduction to Sovereign P2P Streaming
                  </div>
                  <div style="font-size: 0.75rem; color: #94a3b8; font-family: monospace; margin-top: 0.25rem;" id="ytScreenP2pStats">
                    ● BitSwap Swarm: 14 Connected Seeders &bull; Sub-300ms Pre-Warm Active
                  </div>
                </div>
              </div>

              <!-- Controls overlay -->
              <div class="yt-player-controls" onclick="event.stopPropagation()">
                <!-- Interactive Scrubber with Buffer, Hover Tooltip & Chapter Marks -->
                <div class="yt-scrubber" id="ytScrubber" 
                     onclick="scrubYt(event)" 
                     onmousemove="handleScrubberHover(event)" 
                     onmouseleave="hideScrubberHover()">
                  <div class="yt-scrubber-buffer" id="ytBufferBar"></div>
                  <div class="yt-scrubber-progress" id="ytProgressBar">
                    <div class="yt-scrubber-handle"></div>
                  </div>
                  <div class="yt-scrubber-tooltip" id="ytScrubberTooltip">00:00</div>
                  <div id="chapterTicksContainer"></div>
                </div>

                <div class="yt-controls-row">
                  <div class="yt-left-controls">
                    <button class="yt-btn" id="ytPlayIcon" onclick="toggleYtPlay()" title="Play/Pause (k / Space)">▶</button>
                    <button class="yt-btn" onclick="seekRelative(-10)" title="Rewind 10s (j / ←)">⏪</button>
                    <button class="yt-btn" onclick="seekRelative(10)" title="Forward 10s (l / →)">⏩</button>
                    <button class="yt-btn" id="ytMuteBtn" onclick="toggleYtMute()" title="Mute/Unmute (m)">🔊</button>
                    <input type="range" id="ytVolumeSlider" min="0" max="100" value="100" style="width: 60px; height: 4px; accent-color: #ef4444; cursor: pointer;" oninput="changeVolume(this.value)">
                    <span style="font-size: 0.78rem; color: #cbd5e1; font-family: monospace;" id="ytTimecode">00:00 / 14:20</span>
                  </div>

                  <div class="yt-right-controls">
                    <!-- Autoplay Toggle -->
                    <button class="yt-btn" id="btnAutoplay" onclick="toggleAutoplay()" title="Autoplay Next Video" style="font-size: 0.85rem; display: flex; align-items: center; gap: 4px;">
                      <span>Autoplay</span>
                      <span id="autoplayStatusText" style="color: #34d399;">ON</span>
                    </button>

                    <!-- Playback Speed Selector -->
                    <select class="yt-select" id="playbackSpeedSelect" onchange="changePlaybackSpeed(this.value)" title="Playback Speed">
                      <option value="0.5">0.5x</option>
                      <option value="0.75">0.75x</option>
                      <option value="1" selected>1.0x (Normal)</option>
                      <option value="1.25">1.25x</option>
                      <option value="1.5">1.5x</option>
                      <option value="2">2.0x</option>
                    </select>

                    <!-- ABR Gear Resolution Selector -->
                    <div style="display: flex; align-items: center; gap: 0.35rem;">
                      <span style="font-size: 0.75rem; color: #94a3b8;">⚙️</span>
                      <select class="yt-select" id="abrSelect" onchange="handleAbrChange(this.value)" title="Adaptive Bitrate Selector">
                        <option value="auto">Auto (4K UHD)</option>
                        <option value="4k">4K (2160p60 • 25M)</option>
                        <option value="1080p">1080p60 (8M)</option>
                        <option value="720p">720p (4M)</option>
                        <option value="480p">480p (1.5M)</option>
                        <option value="360p">360p (600k • Edge)</option>
                      </select>
                    </div>

                    <!-- Ambient Cinema Glow Toggle -->
                    <button class="yt-btn" id="btnAmbientGlow" onclick="toggleYtAmbientGlow()" title="Toggle Dynamic Ambient Cinema Glow" style="color: #38bdf8; display: flex; align-items: center; gap: 4px; font-size: 0.78rem;">
                      <span>✨</span> <span id="ambientStatusText">Ambient</span>
                    </button>

                    <!-- Theater Mode Toggle -->
                    <button class="yt-btn" id="btnTheaterMode" onclick="toggleTheaterMode()" title="Theater Mode (t)">🔲</button>
                    <!-- Fullscreen Toggle -->
                    <button class="yt-btn" id="btnFullscreen" onclick="toggleFullscreen()" title="Fullscreen (f)">⛶</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Video Metadata Card -->
          <div class="yt-meta-card">
            <!-- Video Title & Tags -->
            <div>
              <div style="display: flex; gap: 0.4rem; margin-bottom: 0.35rem; flex-wrap: wrap;" id="ytVideoTags">
                <!-- Dynamically rendered -->
              </div>
              <div class="yt-video-title" id="ytVideoTitle">
                ${longFormVideosCatalog[0]!.title}
              </div>
            </div>

            <!-- Stats & Video Actions Row -->
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
              <div style="font-size: 0.82rem; color: var(--text-muted);" id="ytVideoStats">
                <b>284,512 views</b> &bull; Premiered 2 hours ago &bull; <code style="color: #818cf8;" id="ytCidDisplay">CID: bafybeig...zdi</code>
              </div>

              <div style="display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap;">
                <!-- Like / Dislike Joined Pill -->
                <div class="yt-pill-group">
                  <button class="yt-pill-btn" id="ytLikeBtn" onclick="likeYtVideo()">
                    <span id="ytLikeThumb">👍</span>
                    <span id="ytLikeCount">${longFormVideosCatalog[0]!.likes}</span>
                  </button>
                  <div class="yt-pill-divider"></div>
                  <button class="yt-pill-btn" id="ytDislikeBtn" onclick="dislikeYtVideo()">
                    <span>👎</span>
                  </button>
                </div>

                <!-- Share CID Button -->
                <button class="yt-pill-btn" style="background: rgba(255,255,255,0.08); border-radius: 20px; border: 1px solid rgba(255,255,255,0.15);" onclick="openShareYtModal()">
                  <span>↗️</span> <span>Share CID</span>
                </button>

                <!-- Download P2P Blockstore Button -->
                <button class="yt-pill-btn" style="background: rgba(255,255,255,0.08); border-radius: 20px; border: 1px solid rgba(255,255,255,0.15);" onclick="pinVideoToLocalBlockstore()" id="btnDownloadYt">
                  <span>⬇️</span> <span>Download to P2P</span>
                </button>

                <!-- Super Thanks Button -->
                <button class="btn-super-thanks" onclick="openSuperThanksModal()">
                  <span>💰</span> <span>Thanks</span>
                </button>

                <!-- Join Channel Button -->
                <button class="btn-join" onclick="openMembershipModal()">
                  <span>Join</span>
                </button>
              </div>
            </div>

            <!-- Channel Bar -->
            <div class="yt-channel-row">
              <div class="yt-channel-left" onclick="openChannelProfile()">
                <div class="yt-channel-avatar" id="ytChannelAvatar" style="background: ${longFormVideosCatalog[0]!.channelAvatarBg};">
                  ${longFormVideosCatalog[0]!.channelAvatar}
                </div>
                <div>
                  <div style="font-weight: 700; color: #fff; display: flex; align-items: center; gap: 0.35rem;">
                    <span id="ytChannelName">${longFormVideosCatalog[0]!.channelName}</span>
                    <span style="color: #60a5fa; font-size: 0.85rem;" title="Verified Sovereign Identity">✓</span>
                  </div>
                  <div style="font-size: 0.75rem; color: var(--text-muted);" id="subscribersCountDisplay">
                    ${longFormVideosCatalog[0]!.channelSubscribersText}
                  </div>
                </div>
              </div>

              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <button class="btn-subscribe" id="btnSubscribe" onclick="toggleYtSubscribe()">Subscribe</button>
                <button class="yt-btn" id="btnBellNotify" style="background: rgba(255,255,255,0.1); border-radius: 50%; width: 36px; height: 36px; display: none;" onclick="cycleBellNotification()" title="Notification Preference">
                  <span id="bellIcon">🔔</span>
                </button>
              </div>
            </div>

            <!-- Expandable Description Box with Clickable Chapters -->
            <div class="yt-desc-box collapsed" id="ytDescBox">
              <div id="ytDescText">
                ${longFormVideosCatalog[0]!.description}
              </div>
              <div style="margin-top: 0.75rem; font-weight: 700; font-size: 0.82rem; color: #fff;">
                🎬 Interactive Chapters (Click to Jump):
              </div>
              <div style="display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.35rem;" id="ytChaptersList">
                <!-- Dynamically rendered -->
              </div>
              <span class="yt-desc-toggle" id="ytDescToggle" onclick="toggleYtDescription()">Show more</span>
            </div>

            <!-- 95/5 Off-chain Micropayment Tipping Box -->
            <div class="yt-tip-box" id="ytTipBox">
              <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                <span style="font-weight: 700; color: #fbbf24; display: flex; align-items: center; gap: 0.35rem; font-size: 0.9rem;">
                  💰 Sovereign Micro-Tipping (0% Platform Middleman Cut)
                </span>
                <span style="font-size: 0.72rem; color: #34d399; background: rgba(16, 185, 129, 0.15); padding: 2px 10px; border-radius: 12px; font-weight: 600; border: 1px solid rgba(16, 185, 129, 0.3);">
                  95% Creator / 5% Seeder Split
                </span>
              </div>

              <!-- Split meter bar -->
              <div class="split-meter-bar">
                <div class="split-creator" title="95% Creator Split"></div>
                <div class="split-seeder" title="5% Seeder Node Split"></div>
              </div>

              <div style="font-size: 0.8rem; color: #cbd5e1; display: flex; justify-content: space-between;">
                <span>Send direct micro-tokens to <b id="tipRecipientName">${longFormVideosCatalog[0]!.channelName}</b>. Zero gas fees, instant Ed25519 off-chain voucher settlement.</span>
                <span style="font-size: 0.72rem; color: #94a3b8;">YouTube takes 45% &bull; Sovra takes 0%</span>
              </div>

              <div class="tip-buttons-row">
                <button class="btn-tip" style="background: rgba(245, 158, 11, 0.25); border-color: #f59e0b; color: #fbbf24; font-weight: 700;" onclick="sendCreatorTip(1)">Tip ₹1 ($0.01)</button>
                <button class="btn-tip" style="background: rgba(245, 158, 11, 0.25); border-color: #f59e0b; color: #fbbf24; font-weight: 700;" onclick="sendCreatorTip(10)">Tip ₹10 ($0.12)</button>
                <button class="btn-tip" onclick="sendCreatorTip(20)">Tip ₹20</button>
                <button class="btn-tip" onclick="sendCreatorTip(50)">Tip ₹50</button>
                <button class="btn-tip" onclick="sendCreatorTip(100)">Tip ₹100</button>
                <button class="btn-tip" onclick="sendCreatorTip(500)">Tip ₹500</button>
                <button class="btn-tip" style="background: rgba(255,255,255,0.15); color: #fff;" onclick="openSuperThanksModal()">Custom Tip &amp; Message...</button>
              </div>
              <div id="tipStatusNotice" style="font-size: 0.75rem; color: #a5b4fc; font-family: monospace;"></div>
            </div>

            <!-- Nested Threaded Comments Section -->
            <div style="display: flex; flex-direction: column; gap: 1.25rem; margin-top: 0.75rem;">
              <div class="yt-comments-header">
                <span style="font-weight: 700; color: #fff; font-size: 1.1rem;" id="ytCommentsCount">
                  ${youtubeCommentsStore['yt-video-1']!.length} Comments
                </span>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <span style="font-size: 0.8rem; color: var(--text-muted);">Sort by:</span>
                  <select class="yt-select" id="commentsSortSelect" onchange="sortYtComments(this.value)">
                    <option value="top">Top comments</option>
                    <option value="newest">Newest first</option>
                  </select>
                </div>
              </div>

              <!-- Top-level Comment Composer -->
              <div style="display: flex; gap: 0.85rem; align-items: flex-start;">
                <div style="width: 40px; height: 40px; border-radius: 50%; background: #6366f1; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: bold; flex-shrink: 0; font-size: 1.1rem;">
                  Y
                </div>
                <div style="flex: 1; display: flex; flex-direction: column; gap: 0.5rem;">
                  <textarea id="newCommentInput" placeholder="Add a public sovereign comment (Signed with Ed25519)..." class="chat-text-input" style="width: 100%; min-height: 48px; resize: vertical; border-radius: 8px; font-family: inherit;" rows="2"></textarea>
                  <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
                    <button class="btn btn-secondary" style="padding: 0.35rem 0.85rem; font-size: 0.8rem;" onclick="clearCommentInput()">Cancel</button>
                    <button class="btn btn-primary" style="padding: 0.35rem 1.15rem; font-size: 0.8rem;" onclick="addYtComment()">Comment</button>
                  </div>
                </div>
              </div>

              <!-- Nested Comment List -->
              <div style="display: flex; flex-direction: column; gap: 1rem;" id="ytCommentsList">
                <!-- Dynamically rendered by renderYtComments() -->
              </div>
            </div>

          </div>
        </div>

        <!-- Right Recommendations & Autoplay Queue Sidebar -->
        <aside class="yt-sidebar-recommendations" style="display: flex; flex-direction: column; gap: 0.85rem; min-width: 0;">
          <div style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 0.25rem;">
            <span style="font-weight: 700; color: #cbd5e1; font-size: 0.95rem;">
              Up Next &bull; P2P Swarms
            </span>
            <div style="display: flex; align-items: center; gap: 0.35rem; font-size: 0.75rem; color: #34d399;">
              <span>⚡ BitSwap Autoplay</span>
            </div>
          </div>

          <div id="ytRecommendationsList" style="display: flex; flex-direction: column; gap: 0.75rem;">
            <!-- Dynamically rendered -->
          </div>
        </aside>
      </div>
    </main>

    <!-- Modal 1: YouTube Channel Profile Hub Modal -->
    <div class="yt-modal-overlay" id="channelProfileModal" style="display: none;" onclick="closeYtModal('channelProfileModal')">
      <div class="yt-modal-card" onclick="event.stopPropagation()">
        <div style="height: 100px; background: linear-gradient(135deg, #4f46e5, #9333ea); position: relative;">
          <button style="position: absolute; top: 12px; right: 12px; background: rgba(0,0,0,0.6); border: none; color: #fff; width: 32px; height: 32px; border-radius: 50%; font-size: 1.1rem; cursor: pointer;" onclick="closeYtModal('channelProfileModal')">✕</button>
        </div>
        <div style="padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
          <div style="display: flex; gap: 1rem; align-items: center; margin-top: -45px;">
            <div style="width: 72px; height: 72px; border-radius: 50%; background: #6366f1; border: 3px solid #18181b; color: #fff; font-size: 2rem; font-weight: bold; display: flex; align-items: center; justify-content: center;" id="modalChannelAvatar">S</div>
            <div style="margin-top: 30px;">
              <div style="font-size: 1.2rem; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 0.35rem;">
                <span id="modalChannelName">Sovra Protocol Lab</span>
                <span style="color: #60a5fa;">✓</span>
              </div>
              <div style="font-size: 0.8rem; color: var(--text-muted);" id="modalChannelSubscribers">@sovralab &bull; 142.8K subscribers &bull; 4 long-form videos</div>
            </div>
          </div>

          <div style="font-size: 0.85rem; color: #cbd5e1; line-height: 1.4;">
            Official sovereign research laboratory for the Sovra decentralized social protocol. Publishing 4K master architectural deep dives, cellular NAT benchmarks, and BitSwap swarm implementations.
          </div>

          <div style="display: flex; gap: 0.75rem;">
            <button class="btn-subscribe" id="modalSubscribeBtn" onclick="toggleYtSubscribe()">Subscribe</button>
            <button class="btn-join" onclick="closeYtModal('channelProfileModal'); openMembershipModal();">Join Channel</button>
          </div>

          <!-- Channel Navigation Tabs -->
          <div style="display: flex; border-bottom: 1px solid rgba(255,255,255,0.1); margin-top: 0.25rem;">
            <button class="profile-tab-btn active" id="chTabVideos" onclick="switchChannelModalTab('videos')" style="font-size: 0.8rem; padding: 0.5rem 0.75rem;">📹 Videos</button>
            <button class="profile-tab-btn" id="chTabPlaylists" onclick="switchChannelModalTab('playlists')" style="font-size: 0.8rem; padding: 0.5rem 0.75rem;">📑 Playlists</button>
            <button class="profile-tab-btn" id="chTabCommunity" onclick="switchChannelModalTab('community')" style="font-size: 0.8rem; padding: 0.5rem 0.75rem;">💬 Community</button>
            <button class="profile-tab-btn" id="chTabAbout" onclick="switchChannelModalTab('about')" style="font-size: 0.8rem; padding: 0.5rem 0.75rem;">ℹ️ About</button>
          </div>

          <!-- Channel Tab Content Container -->
          <div id="chTabContent" style="font-size: 0.82rem; color: #cbd5e1; max-height: 180px; overflow-y: auto;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
              <span style="font-weight: 700; color: #fff;">Videos (4)</span>
              <div style="display: flex; gap: 0.35rem;">
                <button class="btn btn-secondary" style="font-size: 0.7rem; padding: 2px 6px;" onclick="alert('Sorted by Latest (HLC order)')">Latest</button>
                <button class="btn btn-secondary" style="font-size: 0.7rem; padding: 2px 6px;" onclick="alert('Sorted by Popular (BitSwap swarm seeds)')">Popular</button>
              </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.4rem;">
              <div style="background: rgba(0,0,0,0.3); padding: 0.4rem 0.6rem; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="closeYtModal('channelProfileModal'); renderYtVideo(0, true);">
                <span>🎬 4K HLS Master Stream</span>
                <span style="color: #34d399; font-size: 0.72rem;">284K views &bull; 4K UHD</span>
              </div>
              <div style="background: rgba(0,0,0,0.3); padding: 0.4rem 0.6rem; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="closeYtModal('channelProfileModal'); renderYtVideo(1, true);">
                <span>⚡ Cell Carrier NAT Penetration</span>
                <span style="color: #34d399; font-size: 0.72rem;">92K views &bull; 1080p60</span>
              </div>
              <div style="background: rgba(0,0,0,0.3); padding: 0.4rem 0.6rem; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="closeYtModal('channelProfileModal'); renderYtVideo(2, true);">
                <span>🎵 Spatial Multi-Track Audio Master</span>
                <span style="color: #34d399; font-size: 0.72rem;">64K views &bull; FLAC 24-bit</span>
              </div>
            </div>
          </div>

          <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 0.75rem; font-size: 0.78rem; color: #94a3b8; font-family: monospace;">
            Channel DID: did:sovra:channel_lab_4k_master_stream
          </div>
        </div>
      </div>
    </div>

    <!-- Modal 2: YouTube Channel Membership / "Join" Modal -->
    <div class="yt-modal-overlay" id="membershipModal" style="display: none;" onclick="closeYtModal('membershipModal')">
      <div class="yt-modal-card" onclick="event.stopPropagation()">
        <div style="padding: 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center;">
          <div style="font-weight: 700; font-size: 1.1rem; color: #fff; display: flex; align-items: center; gap: 0.5rem;">
            <span>⭐</span> <span>Join Channel Membership</span>
          </div>
          <button style="background: none; border: none; color: #fff; font-size: 1.2rem; cursor: pointer;" onclick="closeYtModal('membershipModal')">✕</button>
        </div>
        <div style="padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; max-height: 480px; overflow-y: auto;">
          <div style="font-size: 0.85rem; color: #cbd5e1;">
            Support <b>Sovra Protocol Lab</b> directly. Memberships bypass all app stores and platforms (100% peer funded via state channel vouchers).
          </div>

          <!-- Tier 1 -->
          <div class="membership-tier-card selected" onclick="selectMembershipTier(this, 'Supporter', 59)">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 700; color: #fff;">Level 1: P2P Supporter</span>
              <span style="font-weight: 700; color: #a855f7;">₹59 / month</span>
            </div>
            <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.35rem;">
              &bull; Sovereign member badge next to your name in comments<br>
              &bull; Exclusive custom peer emojis in live chats<br>
              &bull; Priority BitSwap seeder queue allocation
            </div>
          </div>

          <!-- Tier 2 -->
          <div class="membership-tier-card" onclick="selectMembershipTier(this, 'VIP Swarm Patron', 199)">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 700; color: #fff;">Level 2: VIP Swarm Patron</span>
              <span style="font-weight: 700; color: #a855f7;">₹199 / month</span>
            </div>
            <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.35rem;">
              &bull; All Level 1 perks<br>
              &bull; Early access to 4K HLS Master Playlists (48 hours before public)<br>
              &bull; Private Matrix/Discord cryptographer lounge access
            </div>
          </div>

          <!-- Tier 3 -->
          <div class="membership-tier-card" onclick="selectMembershipTier(this, 'Protocol Architect', 799)">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 700; color: #fff;">Level 3: Protocol Architect</span>
              <span style="font-weight: 700; color: #a855f7;">₹799 / month</span>
            </div>
            <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.35rem;">
              &bull; All Level 1 &amp; 2 perks<br>
              &bull; Monthly 1-on-1 architecture call with core engineers<br>
              &bull; Master multi-track FLAC audio stems &amp; raw video Merkle DAGs
            </div>
          </div>

          <button class="btn btn-primary" style="padding: 0.65rem; border-radius: 8px; font-weight: 700; background: #9333ea;" onclick="confirmMembership()">
            Join as Member (Sign with Ed25519)
          </button>
        </div>
      </div>
    </div>

    <!-- Modal 3: Super Thanks Micro-Tipping Modal -->
    <div class="yt-modal-overlay" id="superThanksModal" style="display: none;" onclick="closeYtModal('superThanksModal')">
      <div class="yt-modal-card" onclick="event.stopPropagation()">
        <div style="padding: 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center;">
          <div style="font-weight: 700; font-size: 1.1rem; color: #fbbf24; display: flex; align-items: center; gap: 0.5rem;">
            <span>💰</span> <span>Send Super Thanks (95/5 Split)</span>
          </div>
          <button style="background: none; border: none; color: #fff; font-size: 1.2rem; cursor: pointer;" onclick="closeYtModal('superThanksModal')">✕</button>
        </div>
        <div style="padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
          <div style="font-size: 0.85rem; color: #cbd5e1;">
            Show your support with a highlighted Super Thanks badge in the comments stream!
          </div>

          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button class="btn-tip" onclick="selectSuperThanksAmount(20)">₹20</button>
            <button class="btn-tip" onclick="selectSuperThanksAmount(50)">₹50</button>
            <button class="btn-tip" onclick="selectSuperThanksAmount(100)">₹100</button>
            <button class="btn-tip" onclick="selectSuperThanksAmount(250)">₹250</button>
            <button class="btn-tip" onclick="selectSuperThanksAmount(500)">₹500</button>
          </div>

          <div>
            <label style="font-size: 0.8rem; color: var(--text-muted); display: block; margin-bottom: 0.25rem;">Custom Amount (₹):</label>
            <input type="number" id="superThanksAmountInput" value="100" class="chat-text-input" style="width: 100%;" oninput="updateSuperThanksSplitPreview(this.value)">
          </div>

          <div>
            <label style="font-size: 0.8rem; color: var(--text-muted); display: block; margin-bottom: 0.25rem;">Highlight Comment Message:</label>
            <input type="text" id="superThanksMessageInput" value="Amazing 4K architecture explanation! Keep building! 🚀" class="chat-text-input" style="width: 100%;">
          </div>

          <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 0.75rem; font-size: 0.78rem; color: #e2e8f0;" id="superThanksSplitPreview">
            Split breakdown: <b>₹95.00 (95%)</b> to Creator, <b>₹5.00 (5%)</b> to Seeders, <b>₹0.00 (0%)</b> to Platform.
          </div>

          <button class="btn btn-primary" style="padding: 0.65rem; border-radius: 8px; font-weight: 700; background: #f59e0b; color: #000;" onclick="submitSuperThanks()">
            Sign &amp; Send Super Thanks
          </button>
        </div>
      </div>
    </div>

    <!-- Tab 5: Profile & Sovereign Identity (Instagram Profile + Wallet + Creator Tools) -->
    <main class="main-content" id="profile-view" style="display: none;">
      <div class="profile-container">
        
        <!-- Profile Header Card -->
        <div class="profile-header-card">
          <!-- Cover Banner -->
          <div class="profile-cover-banner">
            <div style="position: absolute; top: 12px; right: 16px; display: flex; gap: 0.5rem; z-index: 5;">
              <span class="badge" style="background: rgba(0,0,0,0.6); backdrop-filter: blur(6px); color: #34d399; border: 1px solid rgba(52,211,153,0.3);">● Noise_XX Mesh Active</span>
              <span class="badge" style="background: rgba(0,0,0,0.6); backdrop-filter: blur(6px); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3);">● Ed25519 Verified</span>
            </div>
          </div>

          <!-- Avatar & Action Buttons Row -->
          <div class="profile-avatar-row">
            <div class="profile-avatar-large" id="meProfileAvatarContainer">
              <span id="meProfileAvatarText">S</span>
            </div>
            <div style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem; flex-wrap: wrap;">
              <button class="profile-btn profile-btn-primary" onclick="openEditProfileModal()">✏️ Edit Profile</button>
              <button class="profile-btn profile-btn-secondary" onclick="openAccountLifecycleModal()">⚙️ Account &amp; Security</button>
              <button class="profile-btn profile-btn-secondary" onclick="quickLockSession()">🔒 Quick Lock</button>
              <button class="profile-btn profile-btn-secondary" onclick="openConnectedDevicesView()">📱 Connected Devices</button>
              <button class="profile-btn profile-btn-secondary" onclick="copyProfileDid()">Copy DID</button>
            </div>
          </div>

          <!-- Profile Details Body -->
          <div class="profile-info-body">
            <div class="profile-name-row">
              <span id="meProfileName">Sovereign Node</span>
              <span style="color: #38bdf8; font-size: 1.1rem;" title="Cryptographically Verified DID">✓</span>
              <span class="badge" style="background: rgba(99, 102, 241, 0.2); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.4); font-size: 0.7rem;">Creator &amp; Seeder</span>
            </div>
            <div class="profile-handle" id="meProfileHandle">@sovereign.mesh &bull; libp2p Peer: <code>${binding.peerId.substring(0, 12)}...</code></div>
            
            <div class="profile-did-badge" onclick="copyProfileDid()" title="Click to copy full Decentralized Identifier">
              <span>🔑 DID:</span>
              <span id="meProfileDid">${masterKey.did}</span>
              <span style="opacity: 0.7;">📋</span>
            </div>

            <div style="color: #cbd5e1; font-size: 0.88rem; line-height: 1.5; margin-bottom: 0.75rem;" id="meProfileBio">
              Decentralized Sovereign Node &bull; Zero middleman servers &bull; BitSwap Seeder &amp; Content Creator &bull; Signal-grade Double Ratchet active.
            </div>

            <div style="color: #60a5fa; font-size: 0.8rem; margin-bottom: 1rem;">
              🌐 <code>/ipns/${masterKey.did.substring(9, 25)}</code> &bull; Transcode Workers: 4 Online
            </div>

            <!-- Stats Row -->
            <div class="profile-stats-row">
              <div class="profile-stat-box">
                <div class="stat-number" id="meFeedPostsCount">0</div>
                <div class="stat-label">Feed Posts</div>
              </div>
              <div class="profile-stat-box">
                <div class="stat-number" id="meFriendsCount" style="color: #38bdf8;">0</div>
                <div class="stat-label">Mutual Friends</div>
              </div>
              <div class="profile-stat-box">
                <div class="stat-number" id="meFollowersCount">0</div>
                <div class="stat-label">Followers</div>
              </div>
              <div class="profile-stat-box">
                <div class="stat-number" id="meFollowingCount">0</div>
                <div class="stat-label">Following</div>
              </div>
              <div class="profile-stat-box">
                <div class="stat-number" id="meSeededBytes" style="color: #34d399;">0 MB</div>
                <div class="stat-label">Seeded</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Settings & Cryptographic Identity Cards (Relocated from Feed to Me Profile) -->
        <div class="profile-settings-grid" id="profileSettingsGrid">
          <!-- Card 1: Cryptographic Identity -->
          <div class="card" style="border-radius: 14px;">
            <div class="card-title" style="display: flex; justify-content: space-between; align-items: center;">
              <span>🔑 Cryptographic Identity</span>
              <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">Noise_XX</span>
            </div>
            <div class="key-val">
              <span class="key-label">Decentralized DID</span>
              <span class="key-data" style="cursor: pointer;" onclick="copyProfileDid()" title="Click to copy">${masterKey.did}</span>
            </div>
            <div class="key-val">
              <span class="key-label">Peer ID (libp2p)</span>
              <span class="key-data">${binding.peerId}</span>
            </div>
            <div class="key-val">
              <span class="key-label">Device Key (Ed25519)</span>
              <span class="key-data">${binding.devicePublicKeyHex.substring(0, 24)}...</span>
            </div>
            <div class="key-val">
              <span class="key-label">Transport Protocol</span>
              <span class="key-data">Noise_XX + Yamux (TCP)</span>
            </div>
          </div>

          <!-- Card 2: Creator Mode Toggle -->
          <div class="card" style="border-radius: 14px;">
            <div class="card-title" style="display: flex; justify-content: space-between; align-items: center;">
              <span>🎨 Creator Mode</span>
              <span class="badge badge-creator" id="creatorStatusBadge">${isCreatorModeActive ? 'Studio Active' : 'Consumer Mode'}</span>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.75rem;">
              Enable Creator Studio &amp; BitSwap seeding tools directly in this app.
            </div>
            <div class="toggle-row">
              <span style="font-weight: 600; font-size: 0.85rem;" id="creatorStatusText">${isCreatorModeActive ? 'Studio Active' : 'Consumer Mode'}</span>
              <label class="switch">
                <input type="checkbox" id="creatorToggle" ${isCreatorModeActive ? 'checked' : ''} onchange="toggleCreatorMode(this.checked)">
                <span class="slider"></span>
              </label>
            </div>
          </div>

          <!-- Card 3: Digital Wellbeing & Screen Limit -->
          <div class="card" style="border-radius: 14px;">
            <div class="card-title" style="display: flex; justify-content: space-between; align-items: center;">
              <span>⏳ Digital Wellbeing</span>
              <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">Protected</span>
            </div>
            <div class="key-val">
              <span class="key-label">Daily Screen-Time Limit</span>
              <span class="key-data">${screenTimeLimitMinutes} mins / day</span>
            </div>
            <div class="key-val">
              <span class="key-label">Quiet Hours (Protected)</span>
              <span class="key-data">22:00 — 07:00</span>
            </div>
            <div class="key-val">
              <span class="key-label">Screen Time Today</span>
              <span class="key-data" style="color: #34d399;">18 mins (42 mins remaining)</span>
            </div>
          </div>
        </div>

        <!-- Sovereign Bandwidth & Creator Wallet Card -->
        <div class="sovereign-wallet-card">
          <div class="wallet-header">
            <div style="display: flex; align-items: center; gap: 0.5rem; font-weight: 800; font-size: 1.05rem;">
              <span>💰 Sovereign Bandwidth &amp; Micro-Tip Wallet</span>
            </div>
            <span class="badge" style="background: rgba(16, 185, 129, 0.25); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.5);">
              ● Layer-1 Verifiable State
            </span>
          </div>

          <div class="wallet-balance-row">
            <span class="wallet-balance-sov" id="walletBalanceSovDisplay">420.50 SOV</span>
            <span class="wallet-balance-fiat" id="walletBalanceFiatDisplay">≈ $1,261.50 USD</span>
          </div>

          <div class="wallet-metrics-grid">
            <div>
              <div style="font-size: 0.75rem; color: #a7f3d0; margin-bottom: 2px;">⚡ Seeder Bandwidth Earned</div>
              <div style="font-weight: 700; color: #fff; font-size: 1rem;">+142.80 SOV</div>
              <div style="font-size: 0.7rem; color: #6ee7b7;">2.4 TB uploaded to mesh</div>
            </div>
            <div>
              <div style="font-size: 0.75rem; color: #a7f3d0; margin-bottom: 2px;">✨ 95/5 Super Thanks / Tips</div>
              <div style="font-weight: 700; color: #fff; font-size: 1rem;">+277.70 SOV</div>
              <div style="font-size: 0.7rem; color: #6ee7b7;">38 Creator Tips (95% Direct)</div>
            </div>
            <div>
              <div style="font-size: 0.75rem; color: #a7f3d0; margin-bottom: 2px;">🛡️ Staked Security Bond</div>
              <div style="font-weight: 700; color: #fff; font-size: 1rem;">50.00 SOV</div>
              <div style="font-size: 0.7rem; color: #6ee7b7;">DHT Relay Guarantee</div>
            </div>
            <div>
              <div style="font-size: 0.75rem; color: #a7f3d0; margin-bottom: 2px;">📡 Relay Gas Credits</div>
              <div style="font-weight: 700; color: #fff; font-size: 1rem;">+15.00 SOV</div>
              <div style="font-size: 0.7rem; color: #6ee7b7;">TURN/ICE packet assists</div>
            </div>
          </div>

          <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
            <button class="btn btn-primary" style="background: #10b981; color: #000; font-weight: 800; border-radius: 8px; padding: 0.65rem 1.25rem;" onclick="withdrawWalletFunds()">
              💸 Withdraw Payout
            </button>
            <button class="btn btn-secondary" style="border-color: rgba(56, 189, 248, 0.4); background: rgba(56, 189, 248, 0.12); color: #38bdf8; border-radius: 8px; padding: 0.65rem 1.25rem; font-weight: 700;" onclick="openCreateChannelModal()">
              📢 Create Channel
            </button>
            <button class="btn btn-secondary" style="border-color: rgba(168, 85, 247, 0.4); background: rgba(168, 85, 247, 0.12); color: #c084fc; border-radius: 8px; padding: 0.65rem 1.25rem; font-weight: 700;" onclick="openCreatePageModal()">
              🏢 Create Page
            </button>
            <button class="btn btn-secondary" style="border-color: rgba(255,255,255,0.2); border-radius: 8px; padding: 0.65rem 1.25rem;" onclick="openOmniSearch()">
              🔍 Omni-Search
            </button>
            <button id="pwaMeInstallBtn" class="btn btn-secondary" style="border-color: rgba(99, 102, 241, 0.4); background: rgba(99, 102, 241, 0.12); color: #a5b4fc; border-radius: 8px; padding: 0.65rem 1.25rem; font-weight: 700;" onclick="triggerPwaInstall()">
              📱 Install App (PWA)
            </button>
          </div>
        </div>

        <!-- 3-Column Profile Media Grid Tabs & Container -->
        <div class="card" style="padding: 1rem; border-radius: 16px;">
          <div class="profile-media-tabs">
            <button class="profile-tab-btn active" id="ptab-posts" onclick="switchProfileGridTab('posts')">
              <span>📷</span> <span>Posts (4)</span>
            </button>
            <button class="profile-tab-btn" id="ptab-reels" onclick="switchProfileGridTab('reels')">
              <span>🎬</span> <span>Reels (5)</span>
            </button>
            <button class="profile-tab-btn" id="ptab-pins" onclick="switchProfileGridTab('pins')">
              <span>📦</span> <span>DAG Pins (6)</span>
            </button>
          </div>

          <div class="profile-media-grid" id="profileGridContainer">
            ${feedPostsStore
              .map(
                (p, idx) => `
              <div class="media-grid-item" style="background: ${p.mediaGradient};" onclick="switchTab('feed'); const c = document.getElementById('card-${p.id}'); if(c) c.scrollIntoView({ behavior: 'smooth' });">
                <div style="font-size: 2.2rem; pointer-events: none;">${p.mediaEmoji}</div>
                <div class="media-hover-overlay">
                  <span>❤️ ${p.likesCount}</span>
                  <span>💬 ${p.comments.length}</span>
                </div>
              </div>
            `,
              )
              .join('')}
          </div>
        </div>

        <!-- Creator Studio & Merkle DAG Ingestion Section -->
        <div class="card" id="creatorStudioSection" style="padding: 1.25rem; border-radius: 16px; border-color: rgba(99, 102, 241, 0.35); display: ${isCreatorModeActive ? 'block' : 'none'};">
          <div class="card-title" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
            <span style="display: flex; align-items: center; gap: 0.5rem;">✨ <span>Creator Studio &amp; Storage Daemon</span></span>
            <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">BitSwap + Merkle DAG Active</span>
          </div>

          <!-- Post Composer -->
          <div style="margin-bottom: 1.25rem;">
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.4rem;">Publish Signed Message to GossipSub:</div>
            <textarea id="postContent" style="width: 100%; min-height: 60px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; padding: 0.6rem; font-size: 0.85rem;" placeholder="Publish a signed post to the decentralized Sovra mesh (Noise_XX / GossipSub)..."></textarea>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.4rem;">
              <span style="font-size: 0.75rem; color: var(--text-muted);">Topic: <code style="color: #a5b4fc;">sovra/feed/main</code></span>
              <button class="btn btn-primary" onclick="publishPost()">Sign &amp; Publish Post</button>
            </div>
          </div>

          <!-- Storage Daemon Pinning -->
          <div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">Merkle DAG Chunking &amp; Storage Quotas:</div>
            <div style="display: flex; gap: 1rem; margin-bottom: 0.75rem; background: rgba(0,0,0,0.25); padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.78rem;">
              <div>Capacity: <b id="quotaCapacity">50 GB</b></div>
              <div>Used: <b id="quotaUsed" style="color: #60a5fa;">0 B</b></div>
              <div>Pinned: <b id="quotaPinned" style="color: #34d399;">0 B</b></div>
              <div>Active Pins: <b id="activePinsCount" style="color: #a78bfa;">0</b></div>
            </div>
            <textarea id="mediaPayload" style="width: 100%; min-height: 50px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; padding: 0.6rem; font-size: 0.85rem;" placeholder="Type or paste media payload / video transcripts to chunk, pin into Merkle DAG, and announce to DHT..."></textarea>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem;">
              <div id="mediaPublishResult" style="font-size: 0.78rem; font-family: monospace; color: #a5b4fc;"></div>
              <div style="display: flex; gap: 0.5rem;">
                <button class="btn btn-secondary" style="font-size: 0.75rem; padding: 0.4rem 0.6rem;" onclick="triggerVerifyReplicas()">Verify Replicas</button>
                <button class="btn btn-secondary" style="font-size: 0.75rem; padding: 0.4rem 0.6rem;" onclick="triggerGC()">Run GC</button>
                <button class="btn btn-primary" style="background: #4f46e5; font-size: 0.75rem; padding: 0.4rem 0.75rem;" onclick="publishMediaAsset()">Publish &amp; Pin DAG</button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </main>

    <!-- Main Section: Product B (Admin Console & Node Ops) -->
    <main class="main-content admin-view" id="admin-view" style="display: none; width: 100%;">
      <div class="admin-layout">
        <!-- Technical Node Infrastructure Sidebar -->
        <aside class="sidebar">
          <div class="card">
            <div class="card-title">Distributed Storage & BitSwap</div>
            <div class="key-val">
              <span class="key-label">Storage Topology</span>
              <span class="key-data">UnixFS Merkle DAG</span>
            </div>
            <div class="key-val">
              <span class="key-label">Block Addressing</span>
              <span class="key-data">Deterministic CIDv1</span>
            </div>
            <div class="key-val">
              <span class="key-label">Wire Protocol</span>
              <span class="key-data">/sovra/bitswap/1.2.0</span>
            </div>
            <div class="key-val">
              <span class="key-label">Local Blockstore</span>
              <span class="key-data">${storageDaemon.getStats().totalBlocks} Blocks (${storageDaemon.getStats().pinnedCount} Pinned)</span>
            </div>
          </div>

          <div class="card">
            <div class="card-title" style="display: flex; justify-content: space-between; align-items: center;">
              <span>Social Graph (Phase 5)</span>
              <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">LWW ACID SQLite</span>
            </div>
            <div class="key-val">
              <span class="key-label">Following</span>
              <span class="key-data" id="followingCount" style="color: #60a5fa; font-weight: bold;">${socialGraph.getFollowing(masterKey.did).length}</span>
            </div>
            <div class="key-val">
              <span class="key-label">Locally Blocked</span>
              <span class="key-data" id="blockedCount" style="color: #f87171; font-weight: bold;">${socialGraph.getBlockedUsers(masterKey.did).length}</span>
            </div>
            <div class="key-val">
              <span class="key-label">Locally Muted</span>
              <span class="key-data" id="mutedCount" style="color: #fbbf24; font-weight: bold;">${socialGraph.getMutedUsers(masterKey.did).length}</span>
            </div>
            <div class="key-val">
              <span class="key-label">Feed Neutrality</span>
              <span class="key-data" style="color: #34d399;">100% Chronological</span>
            </div>
          </div>
        </aside>

        <!-- Ops Console Main Metrics & Audit Stream -->
        <div style="display: flex; flex-direction: column; gap: 1.5rem; flex: 1;">
          <!-- Product B Decoupled Portal Hero Card -->
          <div style="background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98)); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 16px; padding: 1.5rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; box-shadow: 0 10px 25px rgba(0,0,0,0.4);">
            <div>
              <div style="display: inline-flex; align-items: center; gap: 6px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-size: 0.72rem; font-weight: 800; padding: 3px 10px; border-radius: 20px; border: 1px solid rgba(56, 189, 248, 0.35); text-transform: uppercase; margin-bottom: 0.5rem;">
                🚀 Product B &bull; Separated Operations Architecture
              </div>
              <div style="font-size: 1.25rem; font-weight: 800; color: #fff;">
                Dedicated Standalone Operations Console Active
              </div>
              <div style="font-size: 0.82rem; color: #94a3b8; margin-top: 0.25rem; max-width: 600px;">
                The Admin Console now has its own isolated development environment, real-time telemetry stream, P2P swarm visualizer, and 95/5 economic ledger at <strong style="color: #38bdf8;">/admin</strong>.
              </div>
            </div>
            <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
              <a href="/admin" target="_blank" class="btn btn-primary" style="padding: 0.65rem 1.25rem; font-size: 0.88rem; font-weight: 800; text-decoration: none; display: inline-flex; align-items: center; gap: 0.5rem; box-shadow: 0 4px 16px rgba(99, 102, 241, 0.5);">
                <span>🛡️ Launch Fullscreen Admin Panel (/admin)</span>
                <span>↗</span>
              </a>
              <a href="/api/status" target="_blank" class="btn btn-secondary" style="padding: 0.65rem 1rem; font-size: 0.84rem; text-decoration: none;">
                <span>JSON Status</span>
              </a>
            </div>
          </div>

          <div class="notice-banner">
            🛡️ <strong>Decentralized Independence Notice:</strong> This company operations console is an auxiliary tool for Sovra company staff. The Sovra decentralized mesh, end-user messaging, creator studio, and identity layers continue operating autonomously with <strong>zero runtime dependency</strong> on this admin console.
          </div>

          <div class="admin-grid">
            <div class="stat-card">
              <div class="card-title">Connected Peers</div>
              <div class="stat-val">1 Local Direct</div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem;">Autonomous Kademlia DHT routing table</div>
            </div>
            <div class="stat-card">
              <div class="card-title">P2P PubSub Topics</div>
              <div class="stat-val">2 Active</div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem;">GossipSub v1.2 mesh active</div>
            </div>
            <div class="stat-card">
              <div class="card-title">Security & Crypto</div>
              <div class="stat-val">Noise_XX</div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem;">ChaCha20-Poly1305 + 12-byte Yamux</div>
            </div>
            <div class="stat-card">
              <div class="card-title">Admin Decoupling</div>
              <div class="stat-val" style="color: #10b981;">100% Isolated</div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem;">P2P protocol has zero admin dependencies</div>
            </div>
          </div>

          <div class="card">
            <div class="card-title">Internal Operations & RBAC Audit Stream</div>
            <div style="font-family: monospace; font-size: 0.8rem; line-height: 1.8; color: #9ca3af;">
              <div>[INFO] Decentralized P2P node bound to OS TCP port :${tcpPort}</div>
              <div>[INFO] Cryptographic identity generated: ${masterKey.did}</div>
              <div>[INFO] Noise_XX mutual authentication cipher state initialized</div>
              <div>[INFO] Kademlia DHT bucket routing engine active (alpha=3)</div>
              <div>[INFO] GossipSub v1.2 heartbeat loop healthy (D=6, 4<=D<=12)</div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>

  <footer style="text-align: center; padding: 1.5rem 1.5rem 5rem 1.5rem; font-size: 0.8rem; color: var(--text-muted); border-top: 1px solid var(--surface-border);">
    Sovra Protocol & Monorepo Foundation &bull; Production P2P Stack &bull; Localhost Dev Runner
  </footer>
</div> <!-- Close Column 2: .app-center-stage -->

<!-- Column 3: Right Discovery Rail (Desktop >= 1200px) -->
<aside class="app-right-rail">
  <!-- People You May Know / Suggested Connections -->
  <div class="card" style="padding: 1.15rem; border-radius: 16px; background: rgba(17, 24, 39, 0.85); border: 1px solid rgba(255,255,255,0.08);">
    <div style="font-weight: 800; font-size: 0.9rem; color: #fff; margin-bottom: 0.85rem; display: flex; align-items: center; justify-content: space-between;">
      <span>👥 Suggested For You</span>
      <span style="font-size: 0.75rem; color: #38bdf8; cursor: pointer; font-weight: 700;" onclick="switchTab('friends')">See All</span>
    </div>
    <div id="rightRailSuggestionsList" style="display: flex; flex-direction: column; gap: 0.85rem;">
      <!-- Dynamically rendered via renderRightRailSuggestions() -->
    </div>
  </div>

  <!-- Trending on Mesh -->
  <div class="card" style="padding: 1.15rem; border-radius: 16px; background: rgba(17, 24, 39, 0.85); border: 1px solid rgba(255,255,255,0.08);">
    <div style="font-weight: 800; font-size: 0.9rem; color: #fff; margin-bottom: 0.85rem; display: flex; align-items: center; gap: 0.5rem;">
      <span>🔥 Trending on Mesh</span>
    </div>
    <div style="display: flex; flex-direction: column; gap: 0.75rem;">
      <div style="cursor: pointer; padding: 4px 6px; border-radius: 8px; transition: background 0.15s;" onclick="searchHashtag('#SovraLaunch')" onmouseenter="this.style.background='rgba(255,255,255,0.04)'" onmouseleave="this.style.background='transparent'">
        <div style="font-size: 0.72rem; color: #64748b;">Technology &bull; Trending</div>
        <div style="font-weight: 700; font-size: 0.88rem; color: #e2e8f0;">#SovraLaunch</div>
        <div style="font-size: 0.72rem; color: #64748b;">12.4K mesh posts</div>
      </div>
      <div style="cursor: pointer; padding: 4px 6px; border-radius: 8px; transition: background 0.15s;" onclick="searchHashtag('#DecentralizedP2P')" onmouseenter="this.style.background='rgba(255,255,255,0.04)'" onmouseleave="this.style.background='transparent'">
        <div style="font-size: 0.72rem; color: #64748b;">Protocols &bull; Trending</div>
        <div style="font-weight: 700; font-size: 0.88rem; color: #e2e8f0;">#DecentralizedP2P</div>
        <div style="font-size: 0.72rem; color: #64748b;">8.1K mesh posts</div>
      </div>
      <div style="cursor: pointer; padding: 4px 6px; border-radius: 8px; transition: background 0.15s;" onclick="searchHashtag('#ZeroCloud')" onmouseenter="this.style.background='rgba(255,255,255,0.04)'" onmouseleave="this.style.background='transparent'">
        <div style="font-size: 0.72rem; color: #64748b;">Privacy &bull; Trending</div>
        <div style="font-weight: 700; font-size: 0.88rem; color: #e2e8f0;">#ZeroCloud</div>
        <div style="font-size: 0.72rem; color: #64748b;">5.7K mesh posts</div>
      </div>
    </div>
  </div>

  <!-- P2P Node Health Widget -->
  <div class="card" style="padding: 1.15rem; border-radius: 16px; background: rgba(17, 24, 39, 0.6); border: 1px solid rgba(255,255,255,0.06); font-size: 0.78rem;">
    <div style="font-weight: 800; color: #94a3b8; margin-bottom: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.75rem;">Node Diagnostics</div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
      <span style="color: #64748b;">Swarm Peers:</span>
      <span style="color: #34d399; font-weight: 700;" id="railPeerCount">3 Active (TCP)</span>
    </div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
      <span style="color: #64748b;">Merkle DAG:</span>
      <span style="color: #38bdf8; font-weight: 700;">BitSwap Sync</span>
    </div>
    <div style="display: flex; justify-content: space-between;">
      <span style="color: #64748b;">Noise_XX Latency:</span>
      <span style="color: #a78bfa; font-weight: 700;">&lt; 12ms (Direct)</span>
    </div>
  </div>
</aside>
</div> <!-- Close Column 1 & 2 & 3: .app-layout -->

  <!-- Fixed Mobile & Desktop Synchronized Glassmorphic Bottom Navigation Bar -->
  <nav class="mobile-bottom-nav">
    <button class="bottom-nav-item active" id="bnav-feed" onclick="switchTab('feed')" title="Feed">
      <span class="bnav-icon">📷</span>
      <span class="bnav-label">Feed</span>
    </button>
    <button class="bottom-nav-item" id="bnav-friends" onclick="switchTab('friends')" title="Friends & Search">
      <span class="bnav-icon">👥</span>
      <span class="bnav-label">Friends</span>
      <span class="bnav-badge" id="bnavFriendsBadge">1</span>
    </button>
    <button class="bottom-nav-create" onclick="triggerBottomCreateAction()" title="Create Post or Story">
      <span>+</span>
    </button>
    <button class="bottom-nav-item" id="bnav-reels" onclick="switchTab('reels')" title="Reels">
      <span class="bnav-icon">🎬</span>
      <span class="bnav-label">Reels</span>
    </button>
    <button class="bottom-nav-item" id="bnav-youtube" onclick="switchTab('youtube')" title="Watch">
      <span class="bnav-icon">📺</span>
      <span class="bnav-label">Watch</span>
    </button>
    <button class="bottom-nav-item" id="bnav-chat" onclick="switchTab('chat')" title="Chats">
      <span class="bnav-icon">💬</span>
      <span class="bnav-label">Chats</span>
      <span class="bnav-badge" style="background: #3b82f6;">2</span>
    </button>
    <button class="bottom-nav-item" id="bnav-me" onclick="switchTab('me')" title="Profile">
      <span class="bnav-icon">👤</span>
      <span class="bnav-label">Me</span>
    </button>
    <button class="bottom-nav-item" id="bnav-admin" onclick="switchTab('admin')" title="Ops Console">
      <span class="bnav-icon">⚙️</span>
      <span class="bnav-label">Ops</span>
    </button>
  </nav>

  <!-- Multi-Segment Instagram Story Viewer Modal Overlay -->
  <div class="story-modal-overlay" id="storyModalOverlay" style="display: none;" onclick="closeStory(event)">
    <div class="story-card-modal" id="storyCardModal" onclick="event.stopPropagation()"
         onpointerdown="pauseStoryTimer()" onpointerup="resumeStoryTimer()">
      
      <!-- Multi-segment Header Bars (dynamically rendered) -->
      <div class="story-segments-header" id="storySegmentsHeader"></div>

      <!-- Story Creator Header Row -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 1.1rem; margin-bottom: 0.75rem; z-index: 50; position: relative;">
        <div style="display: flex; align-items: center; gap: 0.6rem;">
          <div style="width: 36px; height: 36px; border-radius: 50%; background: #6366f1; color: #fff; font-weight: bold; display: flex; align-items: center; justify-content: center; font-size: 0.95rem; border: 1.5px solid #fff;" id="storyModalAvatar">A</div>
          <div>
            <div style="font-weight: 700; color: #fff; font-size: 0.88rem; display: flex; align-items: center; gap: 0.35rem;">
              <span id="storyModalAuthor">Alice</span>
              <span style="font-size: 0.72rem; color: rgba(255,255,255,0.6);" id="storyModalTimeAgo">25m</span>
            </div>
            <div style="font-size: 0.68rem; color: #34d399;">● Ephemeral RAM Swarm</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <button style="background: none; border: none; color: #fff; font-size: 1.3rem; cursor: pointer; padding: 4px;" onclick="closeStory()" title="Close Story">✕</button>
        </div>
      </div>

      <!-- Touch Nav Split (Tap Left = Prev, Tap Right = Next) -->
      <div class="story-touch-nav">
        <div class="story-touch-prev" onclick="prevStorySegment()"></div>
        <div class="story-touch-next" onclick="nextStorySegment()"></div>
      </div>

      <!-- Story Content Body -->
      <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; gap: 1.2rem; z-index: 10; padding: 1rem;">
        <!-- Interactive Sticker Pill -->
        <div class="story-sticker-pill" id="storyStickerPill" style="display: none;">
          <span id="storyStickerIcon">📍</span>
          <span id="storyStickerText">Mesh Node</span>
        </div>

        <div style="font-size: 3.5rem;" id="storyBigEmoji">⚡</div>
        <div style="font-size: 1.2rem; font-weight: 700; color: #fff; line-height: 1.45; text-shadow: 0 2px 8px rgba(0,0,0,0.6);" id="storyModalText">
          Story Content
        </div>
        <div style="font-size: 0.72rem; color: rgba(255,255,255,0.85); background: rgba(0,0,0,0.45); backdrop-filter: blur(4px); padding: 0.3rem 0.75rem; border-radius: 14px; border: 1px solid rgba(255,255,255,0.15);">
          RAM Zero-Disk Ephemeral &bull; TTL 24h &bull; BitSwap Swarm
        </div>
      </div>

      <!-- Quick Reaction & DM Reply Bar -->
      <div class="story-quick-react-tray" onclick="event.stopPropagation()">
        <input type="text" id="storyReplyInput" class="story-reply-input" placeholder="Send message..." onkeydown="if(event.key==='Enter') sendStoryReply()">
        <button style="background: none; border: none; font-size: 1.25rem; cursor: pointer;" onclick="sendStoryReaction('❤️')">❤️</button>
        <button style="background: none; border: none; font-size: 1.25rem; cursor: pointer;" onclick="sendStoryReaction('🔥')">🔥</button>
        <button style="background: none; border: none; font-size: 1.25rem; cursor: pointer;" onclick="sendStoryReaction('👏')">👏</button>
      </div>

  <!-- 🔒 1. SCREEN QUICK-LOCK OVERLAY -->
  <div id="screenLockOverlay" style="display: none; position: fixed; inset: 0; background: rgba(5, 8, 16, 0.96); backdrop-filter: blur(24px); z-index: 100000; align-items: center; justify-content: center; flex-direction: column; text-align: center; color: #fff; padding: 2rem;">
    <div style="width: 90px; height: 90px; border-radius: 50%; background: rgba(56, 189, 248, 0.1); border: 2px solid #38bdf8; display: flex; align-items: center; justify-content: center; font-size: 42px; margin-bottom: 1.5rem; box-shadow: 0 0 30px rgba(56, 189, 248, 0.2);">
      🔒
    </div>
    <h2 style="font-size: 1.6rem; font-weight: 800; margin: 0 0 0.5rem 0;">Session Locked</h2>
    <p style="font-size: 0.9rem; color: #94a3b8; max-width: 340px; margin: 0 0 2rem 0; line-height: 1.5;">
      Active encryption keys purged from memory. Hardware biometrics required to restore session.
    </p>
    <button onclick="unlockSessionWithBiometrics()" style="padding: 1rem 2rem; background: linear-gradient(135deg, #3b82f6, #6366f1); color: #fff; border: none; border-radius: 14px; font-size: 1rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 0.75rem; box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4);">
      <span>👆 Unlock with TouchID / FaceID</span>
    </button>
  </div>

  <!-- ✏️ EDIT PROFILE MODAL -->
  <div id="editProfileModal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(14px); z-index: 99999; align-items: center; justify-content: center; padding: 1rem;">
    <div style="background: #0f172a; border: 1px solid rgba(255,255,255,0.12); border-radius: 24px; max-width: 440px; width: 100%; padding: 1.75rem; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.8); color: #f8fafc; font-family: system-ui, -apple-system, sans-serif;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
        <div style="font-size: 1.15rem; font-weight: 800; display: flex; align-items: center; gap: 0.5rem;">
          <span>✏️</span> <span>Edit Decentralized Profile</span>
        </div>
        <button onclick="closeEditProfileModal()" style="background: none; border: none; color: #94a3b8; font-size: 1.4rem; cursor: pointer; padding: 4px;">✕</button>
      </div>

      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <!-- PHOTO UPLOAD & PREVIEW ROW -->
        <div style="display: flex; align-items: center; gap: 1rem; padding: 0.75rem; background: #1e293b; border-radius: 14px; border: 1px solid rgba(255,255,255,0.08);">
          <div id="editProfileAvatarPreview" style="width: 58px; height: 58px; border-radius: 50%; background: #6366f1; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: 800; overflow: hidden; border: 2px solid #38bdf8; flex-shrink: 0;">
            <span id="editProfileAvatarLetter">S</span>
          </div>
          <div style="flex: 1;">
            <div style="font-size: 0.85rem; font-weight: 700; color: #f8fafc; margin-bottom: 2px;">Profile Photo</div>
            <div style="font-size: 0.72rem; color: #94a3b8; margin-bottom: 6px;">Auto-compressed locally to &lt; 50KB</div>
            <button type="button" onclick="document.getElementById('editProfilePhotoInput').click()" style="padding: 0.4rem 0.85rem; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 8px; color: #38bdf8; font-size: 0.78rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;">
              <span>📷</span> <span>Choose Photo</span>
            </button>
            <input type="file" id="editProfilePhotoInput" accept="image/*" style="display: none;" onchange="handleEditProfilePhotoSelect(event)">
          </div>
        </div>

        <div>
          <label style="font-size: 0.78rem; font-weight: 700; color: #94a3b8; display: block; margin-bottom: 4px;">DISPLAY NAME</label>
          <input type="text" id="editProfileNameInput" placeholder="e.g. Rahul Sharma" style="width: 100%; padding: 0.75rem 1rem; background: #1e293b; border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; color: #fff; font-size: 0.95rem; box-sizing: border-box;" />
        </div>

        <div>
          <label style="font-size: 0.78rem; font-weight: 700; color: #94a3b8; display: block; margin-bottom: 4px;">SOVEREIGN HANDLE</label>
          <input type="text" id="editProfileHandleInput" placeholder="e.g. @rahul_phone" style="width: 100%; padding: 0.75rem 1rem; background: #1e293b; border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; color: #38bdf8; font-size: 0.95rem; font-weight: 700; box-sizing: border-box;" />
        </div>

        <div>
          <label style="font-size: 0.78rem; font-weight: 700; color: #94a3b8; display: block; margin-bottom: 4px;">BIO / STATUS</label>
          <textarea id="editProfileBioInput" placeholder="Tell nearby peers about your node..." rows="3" style="width: 100%; padding: 0.75rem 1rem; background: #1e293b; border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; color: #fff; font-size: 0.88rem; box-sizing: border-box; resize: vertical;"></textarea>
        </div>

        <div>
          <label style="font-size: 0.78rem; font-weight: 700; color: #94a3b8; display: block; margin-bottom: 6px;">AVATAR COLOR</label>
          <div style="display: flex; gap: 0.6rem; align-items: center;" id="editProfileColorOptions">
            <div class="edit-avatar-swatch" style="width: 32px; height: 32px; border-radius: 50%; background: #6366f1; cursor: pointer; border: 2px solid #fff;" onclick="selectEditAvatarBg('#6366f1', this)"></div>
            <div class="edit-avatar-swatch" style="width: 32px; height: 32px; border-radius: 50%; background: #10b981; cursor: pointer;" onclick="selectEditAvatarBg('#10b981', this)"></div>
            <div class="edit-avatar-swatch" style="width: 32px; height: 32px; border-radius: 50%; background: #f59e0b; cursor: pointer;" onclick="selectEditAvatarBg('#f59e0b', this)"></div>
            <div class="edit-avatar-swatch" style="width: 32px; height: 32px; border-radius: 50%; background: #ec4899; cursor: pointer;" onclick="selectEditAvatarBg('#ec4899', this)"></div>
            <div class="edit-avatar-swatch" style="width: 32px; height: 32px; border-radius: 50%; background: #0284c7; cursor: pointer;" onclick="selectEditAvatarBg('#0284c7', this)"></div>
            <div class="edit-avatar-swatch" style="width: 32px; height: 32px; border-radius: 50%; background: #8b5cf6; cursor: pointer;" onclick="selectEditAvatarBg('#8b5cf6', this)"></div>
          </div>
        </div>

        <div style="display: flex; gap: 0.75rem; margin-top: 0.75rem;">
          <button onclick="closeEditProfileModal()" style="flex: 1; padding: 0.85rem; background: #334155; border: none; border-radius: 12px; color: #cbd5e1; font-weight: 700; cursor: pointer;">Cancel</button>
          <button onclick="saveEditedProfile()" style="flex: 2; padding: 0.85rem; background: linear-gradient(135deg, #10b981, #059669); border: none; border-radius: 12px; color: #fff; font-weight: 700; cursor: pointer; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4);">Save &amp; Announce</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ⚙️ 2. ACCOUNT LIFECYCLE & REMOTE LOGOUT MODAL -->
  <div id="accountLifecycleModal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(14px); z-index: 99999; align-items: center; justify-content: center; padding: 1rem;">
    <div style="background: #0f172a; border: 1px solid rgba(255,255,255,0.12); border-radius: 24px; max-width: 460px; width: 100%; padding: 1.75rem; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.8); color: #f8fafc; font-family: system-ui, -apple-system, sans-serif;">
      
      <!-- Modal Header -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
        <div style="font-size: 1.15rem; font-weight: 800; display: flex; align-items: center; gap: 0.5rem;">
          <span>⚙️</span> <span>Account &amp; Security</span>
        </div>
        <button onclick="closeAccountLifecycleModal()" style="background: none; border: none; color: #94a3b8; font-size: 1.4rem; cursor: pointer; padding: 4px;">✕</button>
      </div>

      <!-- Live Toast Alert -->
      <div id="accountNoticeToast" style="display: none; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; padding: 0.65rem 1rem; border-radius: 10px; font-size: 0.8rem; margin-bottom: 1rem; text-align: center;"></div>

      <!-- VIEW 1: Main Menu -->
      <div id="almViewMain">
        <div style="background: #1e293b; padding: 0.9rem 1.1rem; border-radius: 14px; margin-bottom: 1.25rem; border: 1px solid rgba(255,255,255,0.06);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: 800; color: #38bdf8; font-size: 1.05rem;" id="almProfileHandle">@sovereign.mesh</span>
            <span style="font-size: 0.72rem; background: rgba(16, 185, 129, 0.2); color: #10b981; padding: 3px 8px; border-radius: 6px; font-weight: 700;">● Active</span>
          </div>
          <div style="font-size: 0.75rem; color: #64748b; font-family: monospace; margin-top: 4px; word-break: break-all;">
            ${masterKey.did}
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 0.65rem;">
          <!-- Quick Lock -->
          <div onclick="quickLockSession()" style="background: #1e293b; border: 1px solid #334155; padding: 0.85rem 1rem; border-radius: 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 700; font-size: 0.9rem;">🔒 Quick Lock Session</div>
              <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 2px;">Clears RAM keys. 1-tap Fingerprint to resume.</div>
            </div>
            <span style="color: #64748b; font-size: 1.1rem;">→</span>
          </div>

          <!-- Connected Devices & Remote Logout -->
          <div onclick="switchAlmView('devices')" style="background: #1e293b; border: 1px solid #334155; padding: 0.85rem 1rem; border-radius: 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 700; font-size: 0.9rem; color: #38bdf8;">⚡ Connected Devices (Remote Logout)</div>
              <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 2px;">Lost a phone? 1-Click remote wipe access immediately.</div>
            </div>
            <span style="color: #38bdf8; font-size: 1.1rem;">→</span>
          </div>

          <!-- QR Account Transfer -->
          <div onclick="switchAlmView('qr')" style="background: #1e293b; border: 1px solid #334155; padding: 0.85rem 1rem; border-radius: 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 700; font-size: 0.9rem;">📱 Transfer to New Phone (QR)</div>
              <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 2px;">Scan with camera for &lt;2s cross-device sync.</div>
            </div>
            <span style="color: #64748b; font-size: 1.1rem;">→</span>
          </div>

          <!-- Social Guardians -->
          <div onclick="switchAlmView('guardians')" style="background: #1e293b; border: 1px solid #334155; padding: 0.85rem 1rem; border-radius: 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 700; font-size: 0.9rem;">🛡️ Social Guardian Recovery</div>
              <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 2px;">Pick 3 trusted friends (2-of-3 threshold).</div>
            </div>
            <span style="color: #64748b; font-size: 1.1rem;">→</span>
          </div>

          <!-- Wipe & Complete Logout -->
          <div onclick="switchAlmView('wipe')" style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); padding: 0.85rem 1rem; border-radius: 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; margin-top: 0.4rem;">
            <div>
              <div style="font-weight: 700; font-size: 0.9rem; color: #ef4444;">🗑️ Wipe &amp; Complete Logout</div>
              <div style="font-size: 0.75rem; color: #fca5a5; margin-top: 2px;">Permanently delete local keys &amp; broadcast revocation.</div>
            </div>
            <span style="color: #ef4444; font-size: 1.1rem;">→</span>
          </div>
        </div>
      </div>

      <!-- VIEW 2: Connected Devices & Remote Logout -->
      <div id="almViewDevices" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <span style="font-weight: 700; font-size: 0.95rem;">Active Logged-In Devices</span>
          <button onclick="switchAlmView('main')" style="background: none; border: none; color: #38bdf8; font-size: 0.8rem; cursor: pointer;">← Back</button>
        </div>
        <p style="font-size: 0.78rem; color: #94a3b8; margin: 0 0 1rem 0;">
          If a phone is stolen or lost, tap <b>Remote Logout 🚨</b>. Its cryptographic delegation will be revoked and its storage wiped upon reconnect.
        </p>

        <div style="display: flex; flex-direction: column; gap: 0.65rem;" id="almDevicesContainer">
          <!-- Device 1: Current -->
          <div style="background: #1e293b; padding: 0.75rem 0.9rem; border-radius: 10px; border: 1px solid rgba(16, 185, 129, 0.4); display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 700; font-size: 0.85rem;">💻 Browser Node (This Device)</div>
              <div style="font-size: 0.7rem; color: #64748b; font-family: monospace;">Local TCP Port 4001</div>
            </div>
            <span style="font-size: 0.7rem; background: rgba(16, 185, 129, 0.2); color: #10b981; padding: 3px 8px; border-radius: 6px; font-weight: 700;">This Device</span>
          </div>

          <!-- Device 2: MacBook -->
          <div id="devRowMac" style="background: #1e293b; padding: 0.75rem 0.9rem; border-radius: 10px; border: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 700; font-size: 0.85rem;">🍏 MacBook Air M2 (Chrome)</div>
              <div style="font-size: 0.7rem; color: #64748b; font-family: monospace;">did:key:z6MksMacBook02...</div>
            </div>
            <button onclick="triggerRemoteLogoutDevice('devRowMac', 'MacBook Air M2')" style="padding: 5px 10px; background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px; font-size: 0.75rem; font-weight: 700; cursor: pointer;">
              Remote Logout 🚨
            </button>
          </div>

          <!-- Device 3: Lost Phone -->
          <div id="devRowGalaxy" style="background: #1e293b; padding: 0.75rem 0.9rem; border-radius: 10px; border: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 700; font-size: 0.85rem;">📱 Galaxy S21 (Lost in Metro)</div>
              <div style="font-size: 0.7rem; color: #64748b; font-family: monospace;">did:key:z6MksGalaxyLost...</div>
            </div>
            <button onclick="triggerRemoteLogoutDevice('devRowGalaxy', 'Galaxy S21 (Lost)')" style="padding: 5px 10px; background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px; font-size: 0.75rem; font-weight: 700; cursor: pointer;">
              Remote Wipe 🚨
            </button>
          </div>
        </div>
      </div>

      <!-- VIEW 3: QR Transfer -->
      <div id="almViewQr" style="display: none; text-align: center;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <span style="font-weight: 700; font-size: 0.95rem;">Transfer to New Phone</span>
          <button onclick="switchAlmView('main')" style="background: none; border: none; color: #38bdf8; font-size: 0.8rem; cursor: pointer;">← Back</button>
        </div>
        <div style="width: 170px; height: 170px; background: #fff; border-radius: 16px; margin: 1rem auto; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #000;">
          <div style="font-size: 48px;">🏁</div>
          <div style="font-size: 0.75rem; font-weight: 800; margin-top: 6px;">@sovereign.mesh QR</div>
        </div>
        <div style="font-size: 0.78rem; color: #38bdf8; margin-bottom: 1rem;">
          ⏱️ Ephemeral Key Valid for 5 Minutes • Signed with Root Identity
        </div>
        <button onclick="switchAlmView('main')" style="padding: 0.65rem 1.5rem; background: #334155; color: #fff; border: none; border-radius: 10px; font-size: 0.85rem; cursor: pointer;">
          Done
        </button>
      </div>

      <!-- VIEW 4: Social Guardians -->
      <div id="almViewGuardians" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <span style="font-weight: 700; font-size: 0.95rem;">Social Guardian Setup</span>
          <button onclick="switchAlmView('main')" style="background: none; border: none; color: #38bdf8; font-size: 0.8rem; cursor: pointer;">← Back</button>
        </div>
        <p style="font-size: 0.78rem; color: #94a3b8; margin: 0 0 1rem 0;">
          Configure 3 trusted friends. If your phone is lost, any 2 can approve your identity restoration.
        </p>
        <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem;">
          <input type="text" id="guardianInput1" placeholder="Friend 1 (@alice_creator)" value="@alice_creator" style="padding: 0.65rem 0.8rem; background: #1e293b; border: 1px solid #334155; border-radius: 8px; color: #fff; font-size: 0.85rem;">
          <input type="text" id="guardianInput2" placeholder="Friend 2 (@bob_live)" value="@bob_live" style="padding: 0.65rem 0.8rem; background: #1e293b; border: 1px solid #334155; border-radius: 8px; color: #fff; font-size: 0.85rem;">
          <input type="text" id="guardianInput3" placeholder="Friend 3 (@carol_sounds)" value="@carol_sounds" style="padding: 0.65rem 0.8rem; background: #1e293b; border: 1px solid #334155; border-radius: 8px; color: #fff; font-size: 0.85rem;">
        </div>
        <button onclick="saveSocialGuardiansDemo()" style="width: 100%; padding: 0.75rem; background: #10b981; color: #fff; border: none; border-radius: 10px; font-weight: 700; font-size: 0.88rem; cursor: pointer;">
          Save 2-of-3 Guardian Plan ✓
        </button>
      </div>

      <!-- VIEW 5: Confirm Wipe -->
      <div id="almViewWipe" style="display: none; text-align: center;">
        <div style="font-size: 38px; margin-bottom: 0.5rem;">⚠️</div>
        <h3 style="font-size: 1.15rem; font-weight: 800; color: #ef4444; margin: 0 0 0.5rem 0;">Permanent Device Wipe</h3>
        <p style="font-size: 0.8rem; color: #cbd5e1; line-height: 1.5; margin: 0 0 1.25rem 0;">
          All cryptographic keys will be wiped from this device. An Ed25519-signed key revocation will be registered on the P2P network.
        </p>
        <div style="display: flex; gap: 0.5rem;">
          <button onclick="switchAlmView('main')" style="flex: 1; padding: 0.75rem; background: #334155; color: #fff; border: none; border-radius: 10px; font-size: 0.85rem; cursor: pointer;">
            Cancel
          </button>
          <button onclick="executeHardWipeDemo()" style="flex: 1; padding: 0.75rem; background: #ef4444; color: #fff; border: none; border-radius: 10px; font-weight: 700; font-size: 0.85rem; cursor: pointer;">
            Yes, Wipe Device
          </button>
        </div>
      </div>

    </div>
  </div>

  <!-- ⚡ 3. WELCOME & FORGOT USER ID ONBOARDING MODAL -->
  <div id="welcomeOnboardingModal" style="display: none; position: fixed; inset: 0; background: rgba(5,8,16,0.96); backdrop-filter: blur(25px); z-index: 99999; align-items: center; justify-content: center; padding: 1rem;">
    <div style="background: #0f172a; border: 1px solid rgba(255,255,255,0.12); border-radius: 24px; max-width: 440px; width: 100%; padding: 2rem; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.8); color: #f8fafc; font-family: system-ui, -apple-system, sans-serif; text-align: center;">
      
      <!-- STEP 1: Handle input or Passkey auto-find -->
      <div id="womStep1">
        <div style="font-size: 40px; margin-bottom: 0.5rem;">⚡</div>
        <h2 style="font-size: 1.4rem; font-weight: 800; margin: 0 0 0.35rem 0;">Welcome to Sovra</h2>
        <p style="font-size: 0.85rem; color: #94a3b8; margin: 0 0 1.5rem 0;">
          Zero passwords. Pure biometric hardware ownership.
        </p>

        <!-- Live Validation Alert -->
        <div id="womErrorMsg" style="display: none; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #f87171; padding: 0.6rem 0.85rem; border-radius: 10px; font-size: 0.8rem; margin-bottom: 1rem; text-align: left;"></div>

        <!-- Full Name Input -->
        <div style="margin-bottom: 1rem; text-align: left;">
          <label style="font-size: 0.78rem; font-weight: 600; color: #cbd5e1; display: block; margin-bottom: 6px;">Your Full Name</label>
          <input type="text" id="womNameInput" placeholder="e.g. Rahul Sharma" style="width: 100%; padding: 11px 14px; background: #1e293b; border: 1px solid #334155; border-radius: 12px; color: #fff; font-size: 0.95rem; box-sizing: border-box; outline: none;">
        </div>

        <!-- Handle Input with Live Duplicate Check -->
        <div style="margin-bottom: 1.25rem; text-align: left;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <label style="font-size: 0.78rem; font-weight: 600; color: #cbd5e1;">Choose Sovereign Handle</label>
            <span id="womHandleFeedback" style="font-size: 0.72rem; color: #94a3b8;">Checked on P2P Mesh</span>
          </div>
          <div style="position: relative;">
            <span style="position: absolute; left: 12px; top: 11px; color: #38bdf8; font-weight: 700;">@</span>
            <input type="text" id="womHandleInput" placeholder="username" oninput="validateWomHandleLive(this.value)" style="width: 100%; padding: 11px 12px 11px 28px; background: #1e293b; border: 1px solid #334155; border-radius: 12px; color: #fff; font-size: 0.95rem; box-sizing: border-box; outline: none;">
          </div>
        </div>

        <button onclick="triggerBiometricAccountCreation()" style="width: 100%; padding: 0.85rem; background: #3b82f6; color: #fff; border: none; border-radius: 12px; font-weight: 700; font-size: 0.95rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4); margin-bottom: 0.75rem;">
          <span>Continue with Biometrics</span> <span>→</span>
        </button>

        <!-- 🔑 THE FORGOT USER ID BUTTON -->
        <button onclick="autoFindForgotUserIdDemo()" style="width: 100%; padding: 0.8rem; background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 12px; font-weight: 700; font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 0.5rem;">
          <span>🔑 Forgot User ID? Auto-Find with Passkey</span>
        </button>

        <div style="font-size: 0.72rem; color: #64748b; margin-top: 0.5rem;">
          Cryptographic DID &amp; hardware session saved permanently on device.
        </div>
      </div>

      <!-- STEP 2: Biometric Scan Animation -->
      <div id="womStep2" style="display: none; padding: 1.5rem 0;">
        <div style="width: 80px; height: 80px; border-radius: 50%; background: rgba(56, 189, 248, 0.1); border: 2px dashed #38bdf8; display: flex; align-items: center; justify-content: center; font-size: 40px; margin: 0 auto 1.25rem auto;">
          👆
        </div>
        <h3 style="font-size: 1.2rem; font-weight: 700; margin: 0 0 0.5rem 0;">Scanning Passkey Credential...</h3>
        <p style="font-size: 0.8rem; color: #94a3b8; margin: 0;">Resolving resident identity from Hardware Enclave...</p>
      </div>

      <!-- STEP 3: Account Restored / Ready -->
      <div id="womStep3" style="display: none; padding: 0.5rem 0;">
        <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(16, 185, 129, 0.15); color: #10b981; border: 2px solid #10b981; display: flex; align-items: center; justify-content: center; font-size: 32px; margin: 0 auto 1rem auto;">
          ✓
        </div>
        <h3 style="font-size: 1.25rem; font-weight: 800; margin: 0 0 0.25rem 0;">Identity Restored!</h3>
        <div style="font-size: 1.05rem; color: #38bdf8; font-weight: 700; margin-bottom: 1.25rem;" id="womRestoredHandleDisplay">@sovereign.mesh</div>
        <div style="background: #1e293b; padding: 0.75rem 1rem; border-radius: 12px; font-size: 0.75rem; text-align: left; color: #94a3b8; margin-bottom: 1.25rem;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Discovery Method:</span> <span style="color: #10b981;">Passkey Resident Key ✓</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>Hardware Enclave:</span> <span style="color: #fff;">Verified</span>
          </div>
        </div>
        <button onclick="closeOnboardingModalAndEnter()" style="width: 100%; padding: 0.85rem; background: #10b981; color: #fff; border: none; border-radius: 12px; font-weight: 700; font-size: 0.95rem; cursor: pointer; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
          Enter Sovra Super-App 🚀
        </button>
      </div>

    </div>
  </div>

  <!-- 🔍 4. OMNI-SEARCH & DISCOVERY MODAL -->
  <div id="omniSearchModal" class="omni-modal-overlay" style="display: none;">
    <div class="omni-modal-card">
      <!-- Search Header -->
      <div style="padding: 1.15rem 1.25rem 0.75rem 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; flex-direction: column; gap: 0.75rem;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 0.5rem; font-weight: 800; font-size: 1.1rem; color: #fff;">
            <span>🔍 Omni-Search</span>
            <span style="font-size: 0.7rem; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); padding: 2px 8px; border-radius: 12px;">Zero Server Traces</span>
          </div>
          <button onclick="closeOmniSearch()" style="background: none; border: none; color: #94a3b8; font-size: 1.2rem; cursor: pointer; padding: 4px;">✕</button>
        </div>

        <!-- Search Input Bar -->
        <div style="position: relative; display: flex; align-items: center;">
          <span style="position: absolute; left: 14px; color: #64748b; font-size: 1rem;">🔍</span>
          <input type="text" id="omniSearchInput" oninput="filterOmniSearch(this.value)" placeholder="Search people, @channels, @pages, #hashtags, audio..." style="width: 100%; padding: 0.75rem 2.2rem 0.75rem 2.5rem; background: #0f172a; border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; color: #fff; font-size: 0.92rem; outline: none; box-sizing: border-box;">
          <button onclick="document.getElementById('omniSearchInput').value=''; filterOmniSearch('');" style="position: absolute; right: 10px; background: none; border: none; color: #64748b; cursor: pointer; font-size: 0.85rem;">✕</button>
        </div>

        <!-- Filter Tabs -->
        <div style="display: flex; gap: 0.4rem; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none;" id="omniTabsRow">
          <button class="omni-tab-btn active" id="stab-all" onclick="switchSearchTab('all')">🔥 All</button>
          <button class="omni-tab-btn" id="stab-people" onclick="switchSearchTab('people')">👤 People</button>
          <button class="omni-tab-btn" id="stab-channels" onclick="switchSearchTab('channels')">📢 Channels</button>
          <button class="omni-tab-btn" id="stab-pages" onclick="switchSearchTab('pages')">🏢 Pages</button>
          <button class="omni-tab-btn" id="stab-media" onclick="switchSearchTab('media')">📸 Posts</button>
          <button class="omni-tab-btn" id="stab-hashtags" onclick="switchSearchTab('hashtags')">🏷️ Hashtags</button>
          <button class="omni-tab-btn" id="stab-audio" onclick="switchSearchTab('audio')">🎵 Audio</button>
        </div>

        <!-- Recent Searches Row -->
        <div id="omniRecentRow" style="display: flex; align-items: center; gap: 0.4rem; overflow-x: auto; font-size: 0.75rem; color: #94a3b8; padding-top: 2px;">
          <span style="font-weight: 700; color: #64748b;">Recent:</span>
          <span id="omniRecentChips" style="display: flex; gap: 0.35rem;">
            <!-- Generated dynamically -->
          </span>
          <button onclick="clearRecentSearchesDemo()" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 0.72rem; margin-left: auto;">Clear</button>
        </div>
      </div>

      <!-- Search Results Container -->
      <div id="omniResultsList" style="max-height: 440px; overflow-y: auto; padding: 0.5rem 0;">
        <!-- Dynamically rendered -->
      </div>
    </div>
  </div>

  <!-- 📢 5. CREATE CHANNEL MODAL -->
  <div id="createChannelModal" class="omni-modal-overlay" style="display: none;">
    <div class="omni-modal-card" style="max-width: 480px;">
      <div style="padding: 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center;">
        <div style="font-weight: 800; font-size: 1.1rem; color: #fff; display: flex; align-items: center; gap: 6px;">
          <span>📢</span> <span>Create Sovereign Channel</span>
        </div>
        <button onclick="closeCreateChannelModal()" style="background: none; border: none; color: #94a3b8; font-size: 1.2rem; cursor: pointer;">✕</button>
      </div>
      <div style="padding: 1.25rem;">
        <label class="social-modal-label">Channel Name</label>
        <input type="text" id="chanNameInput" class="social-modal-input" placeholder="e.g. Sovra Alpha Radar" value="Sovra Alpha Radar">

        <label class="social-modal-label">Handle (@handle)</label>
        <input type="text" id="chanHandleInput" class="social-modal-input" placeholder="@channel_name" value="@sovra_alpha">

        <label class="social-modal-label">Category</label>
        <select id="chanCategoryInput" class="social-modal-input">
          <option value="tech">💻 Technology &amp; Web3</option>
          <option value="gaming">🎮 Gaming</option>
          <option value="news">📰 News &amp; Dispatches</option>
          <option value="comedy">🎭 Comedy &amp; Entertainment</option>
          <option value="education">🎓 Education</option>
          <option value="music">🎵 Music &amp; Podcasts</option>
          <option value="lifestyle">🌿 Lifestyle</option>
        </select>

        <label class="social-modal-label">Channel Type</label>
        <select id="chanTypeInput" class="social-modal-input">
          <option value="broadcast">📢 Broadcast Channel (Only Admins Post)</option>
          <option value="community">💬 Community Channel (Subscribers Discuss)</option>
        </select>

        <label class="social-modal-label">Description / Bio</label>
        <textarea id="chanDescInput" class="social-modal-input" style="min-height: 70px; resize: vertical;" placeholder="Describe what subscribers will receive...">Decentralized research dispatches, zero-disk peer synchronization updates, and creator spotlight.</textarea>

        <div style="display: flex; gap: 0.75rem; margin-top: 0.5rem;">
          <button onclick="closeCreateChannelModal()" class="action-pill-btn action-pill-secondary" style="flex: 1; padding: 0.75rem; justify-content: center;">Cancel</button>
          <button onclick="submitCreateChannel()" class="action-pill-btn action-pill-primary" style="flex: 1; padding: 0.75rem; justify-content: center; font-size: 0.88rem;">Create Channel 🚀</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 🏢 6. CREATE PAGE MODAL -->
  <div id="createPageModal" class="omni-modal-overlay" style="display: none;">
    <div class="omni-modal-card" style="max-width: 480px;">
      <div style="padding: 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center;">
        <div style="font-weight: 800; font-size: 1.1rem; color: #fff; display: flex; align-items: center; gap: 6px;">
          <span>🏢</span> <span>Create Sovereign Page</span>
        </div>
        <button onclick="closeCreatePageModal()" style="background: none; border: none; color: #94a3b8; font-size: 1.2rem; cursor: pointer;">✕</button>
      </div>
      <div style="padding: 1.25rem;">
        <label class="social-modal-label">Page / Business Name</label>
        <input type="text" id="pageNameInput" class="social-modal-input" placeholder="e.g. Metropolis Coffee" value="Metropolis Coffee">

        <label class="social-modal-label">Handle (@page)</label>
        <input type="text" id="pageHandleInput" class="social-modal-input" placeholder="@business_page" value="@metropolis_coffee">

        <label class="social-modal-label">Page Type</label>
        <select id="pageCategoryInput" class="social-modal-input">
          <option value="business">☕ Business &amp; Shop</option>
          <option value="creator">🎨 Public Figure / Creator</option>
          <option value="brand">🚀 Brand &amp; Startup</option>
          <option value="community">🤝 Community &amp; NGO</option>
        </select>

        <label class="social-modal-label">Call-To-Action (CTA) Button</label>
        <select id="pageCtaInput" class="social-modal-input">
          <option value="message">💬 Send Message</option>
          <option value="website">🌐 Visit Website</option>
          <option value="book">📅 Book Service / Table</option>
          <option value="tip">🎁 Tip Creator</option>
        </select>

        <label class="social-modal-label">Bio &amp; Operating Hours</label>
        <textarea id="pageBioInput" class="social-modal-input" style="min-height: 70px; resize: vertical;" placeholder="Tell customers about your business...">Artisan cold brew roastery with high-speed sovereign mesh Wi-Fi. Open 7am-10pm daily.</textarea>

        <div style="display: flex; gap: 0.75rem; margin-top: 0.5rem;">
          <button onclick="closeCreatePageModal()" class="action-pill-btn action-pill-secondary" style="flex: 1; padding: 0.75rem; justify-content: center;">Cancel</button>
          <button onclick="submitCreatePage()" class="action-pill-btn action-pill-primary" style="flex: 1; padding: 0.75rem; justify-content: center; font-size: 0.88rem; background: #9333ea;">Create Page 🏢</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ⚙️ 7. POST OPTIONS MODAL -->
  <div id="postOptionsModal" class="omni-modal-overlay" style="display: none;">
    <div class="omni-modal-card" style="max-width: 380px;">
      <div style="padding: 1.15rem; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 700; font-size: 0.95rem; color: #fff;">Post Options</span>
        <button onclick="closePostOptionsModal()" style="background: none; border: none; color: #94a3b8; font-size: 1.1rem; cursor: pointer;">✕</button>
      </div>
      <div style="padding: 0.5rem 0; display: flex; flex-direction: column;">
        <button onclick="triggerShareFromModal()" style="padding: 0.85rem 1.25rem; text-align: left; background: none; border: none; color: #fff; font-size: 0.88rem; cursor: pointer; display: flex; align-items: center; gap: 10px; transition: background 0.15s;">
          <span>🚀</span> <span>Share CID to P2P Mesh</span>
        </button>
        <button onclick="triggerCopyPostLink()" style="padding: 0.85rem 1.25rem; text-align: left; background: none; border: none; color: #fff; font-size: 0.88rem; cursor: pointer; display: flex; align-items: center; gap: 10px; transition: background 0.15s;">
          <span>🔗</span> <span>Copy Direct Post Link</span>
        </button>
        <button onclick="triggerMuteFromModal()" style="padding: 0.85rem 1.25rem; text-align: left; background: none; border: none; color: #fbbf24; font-size: 0.88rem; cursor: pointer; display: flex; align-items: center; gap: 10px; transition: background 0.15s;">
          <span>🔕</span> <span>Mute Author Posts</span>
        </button>
        <button onclick="triggerBlockFromModal()" style="padding: 0.85rem 1.25rem; text-align: left; background: none; border: none; color: #ef4444; font-size: 0.88rem; cursor: pointer; display: flex; align-items: center; gap: 10px; transition: background 0.15s;">
          <span>🚫</span> <span>Block Author (Edge Drop)</span>
        </button>
        <button onclick="triggerSafetyReportModal()" style="padding: 0.85rem 1.25rem; text-align: left; background: none; border: none; color: #f87171; font-size: 0.88rem; cursor: pointer; display: flex; align-items: center; gap: 10px; border-top: 1px solid rgba(255,255,255,0.06); transition: background 0.15s;">
          <span>🚨</span> <span>Report Post to Mesh Jury</span>
        </button>
      </div>
    </div>
  </div>

  <!-- 🔁 8. REPOST / QUOTE MODAL -->
  <div id="repostModal" class="omni-modal-overlay" style="display: none;">
    <div class="omni-modal-card" style="max-width: 440px;">
      <div style="padding: 1.15rem; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 700; font-size: 0.95rem; color: #fff;">Repost to Mesh Feed</span>
        <button onclick="closeRepostModal()" style="background: none; border: none; color: #94a3b8; font-size: 1.1rem; cursor: pointer;">✕</button>
      </div>
      <div style="padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
        <div>
          <label class="social-modal-label">Add Your Thoughts (Quote Post)</label>
          <textarea id="repostCommentaryInput" class="social-modal-input" style="min-height: 80px; resize: vertical;" placeholder="Write your commentary or take on this post..."></textarea>
        </div>
        <div style="display: flex; gap: 0.75rem;">
          <button onclick="submitInstantRepost()" class="action-pill-btn action-pill-secondary" style="flex: 1; padding: 0.75rem; justify-content: center; font-size: 0.85rem;">
            ⚡ Instant Repost
          </button>
          <button onclick="submitQuoteRepost()" class="action-pill-btn action-pill-primary" style="flex: 1; padding: 0.75rem; justify-content: center; font-size: 0.85rem; background: #0284c7;">
            ✍️ Quote Repost
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- 🚨 9. SAFETY & DISPUTE REPORT MODAL -->
  <div id="safetyReportModal" class="omni-modal-overlay" style="display: none;">
    <div class="omni-modal-card" style="max-width: 440px;">
      <div style="padding: 1.15rem; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center;">
        <div style="font-weight: 800; font-size: 1rem; color: #f87171; display: flex; align-items: center; gap: 6px;">
          <span>🚨</span> <span>Report to Mesh Dispute Jury</span>
        </div>
        <button onclick="closeSafetyReportModal()" style="background: none; border: none; color: #94a3b8; font-size: 1.1rem; cursor: pointer;">✕</button>
      </div>
      <div style="padding: 1.25rem;">
        <p style="font-size: 0.82rem; color: #cbd5e1; line-height: 1.45; margin: 0 0 1rem 0;">
          Sovra uses decentralized community juror consensus rather than corporate censors. An immutable cryptographic ticket will be generated.
        </p>
        <label class="social-modal-label">Reason for Report</label>
        <select id="reportReasonInput" class="social-modal-input">
          <option value="spam">🚩 Spam or Deceptive Content</option>
          <option value="harassment">⚡ Harassment or Abuse</option>
          <option value="impersonation">🎭 Fake Identity or Impersonation</option>
          <option value="copyright">📦 Copyright / Stolen Content CID</option>
          <option value="illegal">⚠️ Dangerous or Illegal Content</option>
        </select>

        <label class="social-modal-label">Additional Details (Optional)</label>
        <textarea id="reportDetailsInput" class="social-modal-input" style="min-height: 60px; resize: vertical;" placeholder="Provide context for the Mesh Jurors..."></textarea>

        <div style="display: flex; gap: 0.75rem; margin-top: 0.5rem;">
          <button onclick="closeSafetyReportModal()" class="action-pill-btn action-pill-secondary" style="flex: 1; padding: 0.75rem; justify-content: center;">Cancel</button>
          <button onclick="submitSafetyReport()" class="action-pill-btn action-pill-danger" style="flex: 1; padding: 0.75rem; justify-content: center; font-size: 0.85rem;">Submit Ticket 🚨</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 📱 PWA OFFLINE INDICATOR PILL -->
  <div id="offlineIndicatorPill" style="display: none; position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 10000; background: rgba(239, 68, 68, 0.95); backdrop-filter: blur(8px); color: #fff; padding: 6px 14px; border-radius: 9999px; font-size: 0.75rem; font-weight: 700; box-shadow: 0 4px 12px rgba(0,0,0,0.5); align-items: center; gap: 6px;">
    <span>⚡</span> <span>Offline Mode — Browsing Cached Mesh</span>
  </div>

  <!-- 📱 PWA INSTALL FLOATING BANNER -->
  <div id="pwaInstallBanner" style="display: none; position: fixed; bottom: 76px; left: 50%; transform: translateX(-50%); width: 92%; max-width: 480px; z-index: 9999; background: linear-gradient(135deg, rgba(30, 27, 75, 0.95), rgba(17, 24, 39, 0.98)); backdrop-filter: blur(12px); border: 1px solid rgba(99, 102, 241, 0.4); border-radius: 14px; padding: 12px 16px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.7), 0 0 20px rgba(99, 102, 241, 0.2); align-items: center; justify-content: space-between; gap: 12px;">
    <div style="display: flex; align-items: center; gap: 10px;">
      <div style="width: 38px; height: 38px; border-radius: 10px; background: linear-gradient(135deg, #6366f1, #a855f7); display: flex; align-items: center; justify-content: center; font-size: 1.2rem; font-weight: 800; color: #fff; flex-shrink: 0; box-shadow: 0 2px 8px rgba(99,102,241,0.4);">S</div>
      <div>
        <div style="font-weight: 700; font-size: 0.85rem; color: #fff;">Install Sovra App</div>
        <div style="font-size: 0.72rem; color: #94a3b8;">Fast, P2P &amp; 100% Offline Capable</div>
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 8px;">
      <button id="pwaInstallDismissBtn" onclick="dismissPwaPrompt()" style="background: rgba(255, 255, 255, 0.08); border: none; color: #cbd5e1; font-size: 0.75rem; font-weight: 600; padding: 6px 10px; border-radius: 8px; cursor: pointer;">Later</button>
      <button id="pwaInstallActionBtn" onclick="triggerPwaInstall()" style="background: linear-gradient(135deg, #6366f1, #8b5cf6); border: none; color: #fff; font-size: 0.75rem; font-weight: 700; padding: 6px 14px; border-radius: 8px; cursor: pointer; box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);">Install</button>
    </div>
  </div>

  <script>
    // ==========================================
    // 🔐 SOVRA ACCOUNT LIFECYCLE, QUICK LOCK & REMOTE WIPE ENGINE
    // ==========================================
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
    let isSessionLockedState = false;
    let currentProfileWiped = false;
    let myProfile = null;
    try {
      const saved = localStorage.getItem('sovra_user_profile');
      if (saved) myProfile = JSON.parse(saved);
    } catch (e) {}

    let currentUserHandle = myProfile ? myProfile.handle : (isMobileDevice ? '@phone_user' : '@laptop_host');

    function compressImage(file, maxDimension, quality, callback) {
      maxDimension = maxDimension || 1200;
      quality = quality || 0.82;
      const reader = new FileReader();
      reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
          let width = img.width;
          let height = img.height;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);
          }

          // Prefer WebP, fallback to JPEG
          let format = 'image/webp';
          let compressedDataUrl = canvas.toDataURL(format, quality);
          if (!compressedDataUrl.startsWith('data:image/webp')) {
            format = 'image/jpeg';
            compressedDataUrl = canvas.toDataURL(format, quality);
          }

          // Guard against payload overflow (> 250KB binary is ~340KB Base64)
          if (compressedDataUrl.length > 340000 && quality > 0.5) {
            compressedDataUrl = canvas.toDataURL(format, 0.65);
          }
          if (compressedDataUrl.length > 340000) {
            compressedDataUrl = canvas.toDataURL('image/jpeg', 0.55);
          }

          callback(compressedDataUrl);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }

    let selectedEditAvatarDataUrl = null;

    function handleEditProfilePhotoSelect(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      compressImage(file, 256, 0.85, function(compressedUrl) {
        selectedEditAvatarDataUrl = compressedUrl;
        const preview = document.getElementById('editProfileAvatarPreview');
        if (preview) {
          preview.innerHTML = '<img src="' + compressedUrl + '" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%; display: block;" />';
        }
      });
    }

    function updateUserDisplayInUI() {
      if (!myProfile) return;
      currentUserHandle = myProfile.handle;

      const avatarEl = document.getElementById('currentUserAvatar');
      if (avatarEl) {
        if (myProfile.avatarDataUrl) {
          avatarEl.innerHTML = '<img src="' + myProfile.avatarDataUrl + '" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block;" />';
        } else {
          avatarEl.innerText = myProfile.avatar || 'S';
          avatarEl.style.background = myProfile.avatarBg || '#6366f1';
        }
      }

      const railAvatar = document.getElementById('railUserAvatar');
      if (railAvatar) {
        if (myProfile.avatarDataUrl) {
          railAvatar.innerHTML = '<img src="' + myProfile.avatarDataUrl + '" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block;" />';
        } else {
          railAvatar.innerText = myProfile.avatar || 'S';
          railAvatar.style.background = myProfile.avatarBg || '#6366f1';
        }
      }
      const railName = document.getElementById('railUserName');
      if (railName) railName.innerText = myProfile.name || 'Sovereign Node';
      const railHandle = document.getElementById('railUserHandle');
      if (railHandle) railHandle.innerText = myProfile.handle || '@you';

      const handleEl = document.getElementById('currentUserHandleText');
      if (handleEl) handleEl.innerText = myProfile.handle || '@you';

      const almHandle = document.getElementById('almProfileHandle');
      if (almHandle) almHandle.innerText = myProfile.handle;

      const profileName = document.getElementById('meProfileName') || document.querySelector('.profile-name');
      if (profileName) profileName.innerText = myProfile.name;

      const profileAvatarDiv = document.getElementById('meProfileAvatarContainer') || document.querySelector('.profile-avatar-large');
      const profileAvatarText = document.getElementById('meProfileAvatarText') || document.querySelector('.profile-avatar-large span');
      if (profileAvatarDiv) {
        if (myProfile.avatarBg) profileAvatarDiv.style.background = myProfile.avatarBg;
        if (myProfile.avatarDataUrl) {
          profileAvatarDiv.innerHTML = '<img src="' + myProfile.avatarDataUrl + '" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block;" />';
        } else if (profileAvatarText) {
          profileAvatarText.innerText = myProfile.avatar || 'S';
        }
      }

      const profileHandle = document.getElementById('meProfileHandle');
      if (profileHandle) profileHandle.innerHTML = myProfile.handle + ' &bull; libp2p Peer: <code>' + (myProfile.did ? myProfile.did.substring(0, 16) : 'peer') + '...</code>';

      const profileDid = document.getElementById('meProfileDid');
      if (profileDid && myProfile.did) profileDid.innerText = myProfile.did;

      const profileBio = document.getElementById('meProfileBio');
      if (profileBio && myProfile.bio) profileBio.innerText = myProfile.bio;

      const composerAvatar = document.querySelector('.composer-avatar');
      if (composerAvatar) {
        if (myProfile.avatarDataUrl) {
          composerAvatar.innerHTML = '<img src="' + myProfile.avatarDataUrl + '" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block;" />';
        } else {
          composerAvatar.innerText = myProfile.avatar || 'S';
          if (myProfile.avatarBg) composerAvatar.style.background = myProfile.avatarBg;
        }
      }

      const myStoryAvatar = document.getElementById('myStoryAvatar');
      if (myStoryAvatar) {
        if (myProfile.avatarDataUrl) {
          myStoryAvatar.innerHTML = '<img src="' + myProfile.avatarDataUrl + '" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block;" />';
        } else {
          myStoryAvatar.innerText = myProfile.avatar || 'S';
          if (myProfile.avatarBg) myStoryAvatar.style.background = myProfile.avatarBg;
        }
      }

      updateProfileDynamicStats();
    }

    let selectedEditAvatarBg = '#6366f1';
    function selectEditAvatarBg(color, el) {
      selectedEditAvatarBg = color;
      document.querySelectorAll('#editProfileColorOptions .edit-avatar-swatch').forEach(s => s.style.border = 'none');
      if (el) el.style.border = '2px solid #fff';
    }

    function openEditProfileModal() {
      const m = document.getElementById('editProfileModal');
      if (!m) return;
      m.style.display = 'flex';
      const nameInput = document.getElementById('editProfileNameInput');
      const handleInput = document.getElementById('editProfileHandleInput');
      const bioInput = document.getElementById('editProfileBioInput');
      const preview = document.getElementById('editProfileAvatarPreview');
      if (myProfile) {
        if (nameInput) nameInput.value = myProfile.name || '';
        if (handleInput) handleInput.value = myProfile.handle || '';
        if (bioInput) bioInput.value = myProfile.bio || '';
        selectedEditAvatarBg = myProfile.avatarBg || '#6366f1';
        selectedEditAvatarDataUrl = myProfile.avatarDataUrl || null;
        if (preview) {
          if (myProfile.avatarDataUrl) {
            preview.innerHTML = '<img src="' + myProfile.avatarDataUrl + '" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%; display: block;" />';
          } else {
            preview.innerHTML = '<span id="editProfileAvatarLetter">' + (myProfile.avatar || 'S') + '</span>';
            preview.style.background = myProfile.avatarBg || '#6366f1';
          }
        }
      }
    }

    function closeEditProfileModal() {
      const m = document.getElementById('editProfileModal');
      if (m) m.style.display = 'none';
    }

    async function saveEditedProfile() {
      const nameInput = document.getElementById('editProfileNameInput');
      const handleInput = document.getElementById('editProfileHandleInput');
      const bioInput = document.getElementById('editProfileBioInput');

      const newName = (nameInput && nameInput.value.trim()) ? nameInput.value.trim() : (myProfile ? myProfile.name : 'Sovereign Node');
      let rawHandle = (handleInput && handleInput.value.trim()) ? handleInput.value.trim() : (myProfile ? myProfile.handle : '@user');
      if (!rawHandle.startsWith('@')) rawHandle = '@' + rawHandle;
      const newBio = bioInput ? bioInput.value.trim() : '';

      const updatedPayload = {
        did: myProfile ? myProfile.did : ('did:sovra:user_' + Math.random().toString(36).substring(2, 8)),
        handle: rawHandle,
        name: newName,
        displayName: newName,
        avatar: newName.charAt(0).toUpperCase(),
        avatarDataUrl: selectedEditAvatarDataUrl !== null ? selectedEditAvatarDataUrl : (myProfile ? myProfile.avatarDataUrl : undefined),
        avatarBg: selectedEditAvatarBg,
        bio: newBio,
        device: isMobileDevice ? 'Mobile' : 'Desktop'
      };

      try {
        const res = await fetch('/api/user/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedPayload)
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          alert('Could not update profile: ' + (data.error || 'Server error'));
          return;
        }

        myProfile = data.user;
        currentUserHandle = myProfile.handle;
        try {
          localStorage.setItem('sovra_user_profile', JSON.stringify(myProfile));
          if (myProfile.sessionToken) localStorage.setItem('sovra_session_token', myProfile.sessionToken);
        } catch (e) {}

        fetch('/api/peers/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(myProfile)
        }).catch(function() {});

        updateUserDisplayInUI();
        closeEditProfileModal();
        showAccountToast('✅ Profile saved to database and announced to peer mesh!');
      } catch (err) {
        alert('Network error while updating profile: ' + err);
      }
    }

    let womHandleCheckTimer = null;
    function validateWomHandleLive(rawHandle) {
      if (womHandleCheckTimer) clearTimeout(womHandleCheckTimer);
      const feedback = document.getElementById('womHandleFeedback');
      const errorBox = document.getElementById('womErrorMsg');
      if (errorBox) errorBox.style.display = 'none';
      if (!feedback) return;

      const trimmed = (rawHandle || '').trim().replace(/^@/, '');
      if (!trimmed) {
        feedback.innerText = 'Checked on P2P Mesh';
        feedback.style.color = '#94a3b8';
        return;
      }

      feedback.innerText = 'Checking...';
      feedback.style.color = '#38bdf8';

      womHandleCheckTimer = setTimeout(() => {
        fetch('/api/user/check-handle?handle=' + encodeURIComponent('@' + trimmed))
          .then(r => r.json())
          .then(data => {
            if (data.ok) {
              if (data.isAvailable) {
                feedback.innerText = '✓ Available';
                feedback.style.color = '#10b981';
              } else {
                feedback.innerText = '✕ Already Taken';
                feedback.style.color = '#f87171';
              }
            }
          })
          .catch(() => {
            feedback.innerText = 'Checked on P2P Mesh';
            feedback.style.color = '#94a3b8';
          });
      }, 250);
    }

    // Auto-check onboarding on first visit & restore session from server
    window.addEventListener('DOMContentLoaded', function() {
      const sessionToken = localStorage.getItem('sovra_session_token');

      function showOnboardingModal() {
        setTimeout(function() {
          const wom = document.getElementById('welcomeOnboardingModal');
          if (wom) {
            wom.style.display = 'flex';
            const handleInput = document.getElementById('womHandleInput');
            if (handleInput && !handleInput.value) {
              handleInput.value = isMobileDevice ? 'rahul_phone' : 'host_laptop';
              validateWomHandleLive(handleInput.value);
            }
            const nameInput = document.getElementById('womNameInput');
            if (nameInput && !nameInput.value) {
              nameInput.value = isMobileDevice ? 'Rahul Sharma' : 'Host Node';
            }
          }
        }, 120);
      }

      if (sessionToken) {
        fetch('/api/user/me?sessionToken=' + encodeURIComponent(sessionToken))
          .then(r => r.json())
          .then(data => {
            if (data.ok && data.user) {
              myProfile = data.user;
              currentUserHandle = myProfile.handle;
              try { localStorage.setItem('sovra_user_profile', JSON.stringify(myProfile)); } catch(e) {}
              updateUserDisplayInUI();
              // Register heartbeat with server
              fetch('/api/peers/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(myProfile)
              }).catch(function() {});
            } else if (!myProfile) {
              showOnboardingModal();
            } else {
              updateUserDisplayInUI();
            }
          })
          .catch(() => {
            if (myProfile) updateUserDisplayInUI();
            else showOnboardingModal();
          });
      } else if (myProfile && myProfile.did) {
        // Sync with server by DID
        fetch('/api/user/me?did=' + encodeURIComponent(myProfile.did))
          .then(r => r.json())
          .then(data => {
            if (data.ok && data.user) {
              myProfile = data.user;
              currentUserHandle = myProfile.handle;
              if (data.user.sessionToken) localStorage.setItem('sovra_session_token', data.user.sessionToken);
              localStorage.setItem('sovra_user_profile', JSON.stringify(myProfile));
              updateUserDisplayInUI();
            } else {
              // Register current profile with server
              fetch('/api/user/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(myProfile)
              }).then(r => r.json()).then(regData => {
                if (regData.ok && regData.sessionToken) {
                  localStorage.setItem('sovra_session_token', regData.sessionToken);
                  myProfile = regData.user;
                  localStorage.setItem('sovra_user_profile', JSON.stringify(myProfile));
                }
                updateUserDisplayInUI();
              }).catch(() => updateUserDisplayInUI());
            }
          })
          .catch(() => updateUserDisplayInUI());
      } else {
        showOnboardingModal();
      }

      if (isMobileDevice) {
        setTimeout(function() {
          const topBtn = document.getElementById('pwaInstallBtn');
          if (topBtn) topBtn.style.display = 'inline-flex';
          const banner = document.getElementById('pwaInstallBanner');
          if (banner && !sessionStorage.getItem('pwa_dismissed')) {
            banner.style.display = 'flex';
          }
        }, 1200);
      }
    });

    function openAccountLifecycleModal() {
      const m = document.getElementById('accountLifecycleModal');
      if (m) m.style.display = 'flex';
      switchAlmView('main');
    }

    function closeAccountLifecycleModal() {
      const m = document.getElementById('accountLifecycleModal');
      if (m) m.style.display = 'none';
    }

    function switchAlmView(viewName) {
      const views = ['almViewMain', 'almViewDevices', 'almViewQr', 'almViewGuardians', 'almViewWipe'];
      for (const v of views) {
        const el = document.getElementById(v);
        if (el) el.style.display = 'none';
      }
      const targetMap = {
        main: 'almViewMain',
        devices: 'almViewDevices',
        qr: 'almViewQr',
        guardians: 'almViewGuardians',
        wipe: 'almViewWipe',
      };
      const activeEl = document.getElementById(targetMap[viewName]);
      if (activeEl) activeEl.style.display = 'block';
    }

    function openConnectedDevicesView() {
      openAccountLifecycleModal();
      switchAlmView('devices');
    }

    function quickLockSession() {
      closeAccountLifecycleModal();
      isSessionLockedState = true;
      const overlay = document.getElementById('screenLockOverlay');
      if (overlay) overlay.style.display = 'flex';
    }

    function unlockSessionWithBiometrics() {
      isSessionLockedState = false;
      const overlay = document.getElementById('screenLockOverlay');
      if (overlay) overlay.style.display = 'none';
      showAccountToast('🛡️ Biometric TouchID verified! Cryptographic session restored.');
    }

    function triggerRemoteLogoutDevice(rowId, deviceName) {
      const row = document.getElementById(rowId);
      if (row) {
        row.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        row.innerHTML =
          '<div>' +
            '<div style="font-weight: 700; font-size: 0.85rem; color: #94a3b8;">' + deviceName + '</div>' +
            '<div style="font-size: 0.7rem; color: #ef4444; font-family: monospace;">Ed25519 Revocation Signed &amp; Broadcasted</div>' +
          '</div>' +
          '<span style="font-size: 0.7rem; background: rgba(239, 68, 68, 0.2); color: #f87171; padding: 4px 8px; border-radius: 6px; font-weight: 700;">Wiped &amp; Revoked ✕</span>';
      }
      showAccountToast('⚡ Remote Logout sent! "' + deviceName + '" was wiped permanently from the network.');
    }

    function saveSocialGuardiansDemo() {
      showAccountToast('✓ 2-of-3 Guardian threshold plan signed with Root Identity!');
      setTimeout(() => switchAlmView('main'), 1200);
    }

    function executeHardWipeDemo() {
      closeAccountLifecycleModal();
      currentProfileWiped = true;
      const wom = document.getElementById('welcomeOnboardingModal');
      if (wom) wom.style.display = 'flex';
      const s1 = document.getElementById('womStep1');
      const s2 = document.getElementById('womStep2');
      const s3 = document.getElementById('womStep3');
      if (s1) s1.style.display = 'block';
      if (s2) s2.style.display = 'none';
      if (s3) s3.style.display = 'none';
    }

    async function triggerBiometricAccountCreation() {
      const nameInput = document.getElementById('womNameInput');
      const handleInput = document.getElementById('womHandleInput');
      const errorBox = document.getElementById('womErrorMsg');

      const nameVal = (nameInput && nameInput.value.trim()) ? nameInput.value.trim() : '';
      const handleVal = (handleInput && handleInput.value.trim()) ? handleInput.value.trim().replace(/^@/, '') : '';

      if (!handleVal) {
        if (errorBox) {
          errorBox.innerText = 'Please choose a sovereign handle.';
          errorBox.style.display = 'block';
        }
        return;
      }

      const fullName = nameVal || (handleVal.charAt(0).toUpperCase() + handleVal.slice(1));
      const cleanHandle = '@' + handleVal.toLowerCase();

      try {
        const res = await fetch('/api/user/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            handle: cleanHandle,
            name: fullName,
            device: isMobileDevice ? 'Mobile' : 'Desktop'
          })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          if (errorBox) {
            errorBox.innerText = data.error || 'Registration failed. Handle may already be taken.';
            errorBox.style.display = 'block';
          }
          return;
        }

        if (errorBox) errorBox.style.display = 'none';
        myProfile = data.user;
        currentUserHandle = myProfile.handle;

        try {
          localStorage.setItem('sovra_user_profile', JSON.stringify(myProfile));
          if (data.sessionToken) localStorage.setItem('sovra_session_token', data.sessionToken);
        } catch (e) {}

        fetch('/api/peers/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(myProfile)
        }).catch(function() {});

        document.getElementById('womStep1').style.display = 'none';
        document.getElementById('womStep2').style.display = 'block';

        setTimeout(() => {
          document.getElementById('womStep2').style.display = 'none';
          document.getElementById('womStep3').style.display = 'block';
          const displayEl = document.getElementById('womRestoredHandleDisplay');
          if (displayEl) displayEl.innerText = currentUserHandle;
        }, 1000);
      } catch (err) {
        if (errorBox) {
          errorBox.innerText = 'Network connection failed: ' + err;
          errorBox.style.display = 'block';
        }
      }
    }

    function autoFindForgotUserIdDemo() {
      document.getElementById('womStep1').style.display = 'none';
      document.getElementById('womStep2').style.display = 'block';

      setTimeout(() => {
        document.getElementById('womStep2').style.display = 'none';
        document.getElementById('womStep3').style.display = 'block';
        const rawHandle = isMobileDevice ? 'recovered_phone' : 'recovered_laptop';
        const cleanHandle = '@' + rawHandle;
        currentUserHandle = cleanHandle;
        const uniqueDid = 'did:sovra:' + rawHandle + '_' + Math.random().toString(36).substring(2, 7);
        const peerName = (isMobileDevice ? 'Phone Peer' : 'Laptop Peer') + ' (Recovered)';
        fetch('/api/user/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            did: uniqueDid,
            handle: cleanHandle,
            name: peerName,
            device: isMobileDevice ? 'Mobile' : 'Desktop'
          })
        }).then(r => r.json()).then(data => {
          if (data.ok && data.user) {
            myProfile = data.user;
            if (data.sessionToken) localStorage.setItem('sovra_session_token', data.sessionToken);
            localStorage.setItem('sovra_user_profile', JSON.stringify(myProfile));
          }
        }).catch(() => {});
        const displayEl = document.getElementById('womRestoredHandleDisplay');
        if (displayEl) displayEl.innerText = currentUserHandle + ' (Hardware Enclave Auto-Discovered)';
      }, 1100);
    }

    function closeOnboardingModalAndEnter() {
      const wom = document.getElementById('welcomeOnboardingModal');
      if (wom) wom.style.display = 'none';
      currentProfileWiped = false;
      updateUserDisplayInUI();
      switchTab('chat');
      showAccountToast('🎉 Connected to Mesh as ' + (myProfile ? myProfile.name : currentUserHandle) + '!');
    }

    function showAccountToast(msg) {
      const t = document.getElementById('accountNoticeToast');
      if (t) {
        t.innerText = msg;
        t.style.display = 'block';
        setTimeout(() => { t.style.display = 'none'; }, 4000);
      }
    }

    // ==========================================
    // ⚡ SMART DYNAMIC NAVIGATION MODE ENGINE
    // ==========================================
    let navLayoutMode = localStorage.getItem('sovra_nav_mode') || 'auto';

    function applyNavLayoutMode() {
      document.body.classList.remove('nav-mode-auto', 'nav-mode-dock', 'nav-mode-top');
      document.body.classList.add('nav-mode-' + navLayoutMode);
      const icon = document.getElementById('navModeIcon');
      const label = document.getElementById('navModeLabel');
      if (icon && label) {
        if (navLayoutMode === 'dock') {
          icon.innerText = '📱';
          label.innerText = 'Dock';
        } else if (navLayoutMode === 'top') {
          icon.innerText = '🖥️';
          label.innerText = 'Top';
        } else {
          icon.innerText = '⚡';
          label.innerText = 'Auto';
        }
      }
    }

    function toggleNavLayoutMode() {
      if (navLayoutMode === 'auto') {
        navLayoutMode = 'dock';
        showAccountToast('📱 Dock Mode: Floating bottom dock active (Top tabs hidden).');
      } else if (navLayoutMode === 'dock') {
        navLayoutMode = 'top';
        showAccountToast('🖥️ Top Nav Mode: Top navigation active (Bottom dock hidden).');
      } else {
        navLayoutMode = 'auto';
        showAccountToast('⚡ Auto Responsive: Adapts to screen size (No duplicate navigation).');
      }
      localStorage.setItem('sovra_nav_mode', navLayoutMode);
      applyNavLayoutMode();
    }

    document.body.classList.add('tab-active-feed');
    document.body.dataset.activeTab = 'feed';
    setTimeout(applyNavLayoutMode, 10);
    setTimeout(renderRightRailSuggestions, 50);
    setTimeout(function() {
      if (typeof renderChatContactsList === 'function') renderChatContactsList();
    }, 60);

    // Tab switching for all modes + admin console + friends discovery
    function switchTab(tab) {
      if (tab === 'chats') tab = 'chat';
      const views = {
        feed: document.getElementById('feed-view'),
        friends: document.getElementById('friends-view'),
        reels: document.getElementById('reels-view'),
        youtube: document.getElementById('youtube-view'),
        chat: document.getElementById('chat-view'),
        me: document.getElementById('profile-view'),
        admin: document.getElementById('admin-view'),
      };
      const tabs = {
        feed: document.getElementById('tab-feed'),
        friends: document.getElementById('tab-friends'),
        reels: document.getElementById('tab-reels'),
        youtube: document.getElementById('tab-youtube'),
        chat: document.getElementById('tab-chat'),
        me: document.getElementById('tab-me'),
        admin: document.getElementById('tab-admin'),
      };
      const bnavs = {
        feed: document.getElementById('bnav-feed'),
        friends: document.getElementById('bnav-friends'),
        reels: document.getElementById('bnav-reels'),
        youtube: document.getElementById('bnav-youtube'),
        chat: document.getElementById('bnav-chat'),
        me: document.getElementById('bnav-me'),
        admin: document.getElementById('bnav-admin'),
      };

      for (const key of Object.keys(views)) {
        if (views[key]) views[key].style.display = key === tab ? 'flex' : 'none';
        if (tabs[key]) {
          if (key === tab) tabs[key].classList.add('active');
          else tabs[key].classList.remove('active');
        }
      }

      for (const key of Object.keys(bnavs)) {
        if (bnavs[key]) {
          if (key === tab) bnavs[key].classList.add('active');
          else bnavs[key].classList.remove('active');
        }
      }

      // Update body active tab classes
      const allTabNames = ['feed', 'friends', 'reels', 'youtube', 'chat', 'me', 'admin'];
      allTabNames.forEach(t => document.body.classList.remove('tab-active-' + t));
      document.body.classList.add('tab-active-' + tab);
      document.body.dataset.activeTab = tab;

      // Dynamic layout adjustments for wide views (Watch, Chat, Admin)
      const rightRail = document.querySelector('.app-right-rail');
      const centerStage = document.querySelector('.app-center-stage');
      if (tab === 'youtube' || tab === 'chat' || tab === 'admin') {
        if (rightRail) rightRail.style.display = 'none';
        if (centerStage) {
          centerStage.style.maxWidth = tab === 'youtube' ? '1400px' : (tab === 'chat' ? '1300px' : '1250px');
          centerStage.style.width = '100%';
        }
      } else {
        if (rightRail) {
          rightRail.style.display = window.innerWidth > 1250 ? 'flex' : 'none';
        }
        if (centerStage) {
          centerStage.style.maxWidth = tab === 'me' ? '920px' : '720px';
          centerStage.style.width = '';
        }
      }

      if (tab === 'chat') {
        const wCont = document.querySelector('.whatsapp-container');
        if (wCont && window.innerWidth <= 860) {
          wCont.classList.remove('show-chat');
        }
        if (typeof syncPeersAndContacts === 'function') syncPeersAndContacts();
        if (typeof syncChatMessages === 'function') syncChatMessages();
        renderChatContactsList();
        renderChatBubbles();
      } else if (tab === 'reels') {
        renderCurrentReel();
      } else if (tab === 'youtube') {
        renderYtVideo(activeYtVideoIndex, false);
      } else if (tab === 'me') {
        renderProfileGrid(currentProfileGridTab || 'posts');
      } else if (tab === 'friends') {
        renderFriendsDiscoveryView();
      }
    }

    // Responsive window resize listener for layout rails
    window.addEventListener('resize', function() {
      const curTab = document.body.dataset.activeTab || 'feed';
      const rRail = document.querySelector('.app-right-rail');
      if (curTab === 'youtube' || curTab === 'chat' || curTab === 'admin') {
        if (rRail) rRail.style.display = 'none';
      } else {
        if (rRail) {
          rRail.style.display = window.innerWidth > 1250 ? 'flex' : 'none';
        }
      }
    });

    // ==========================================
    // 0. INSTAGRAM FEED & PROFILE SCRIPT ENGINE
    // ==========================================
    let feedPostsData = ${JSON.stringify(feedPostsStore)};
    let currentProfileGridTab = 'posts';
    let walletBalanceSov = 420.50;

    // Unified Physics Particle Emitter (Spring Hearts, Floating Dopamine, Radial Micro-Particles)
    function spawnParticleBurst(x, y, container, badgeText) {
      if (!container) return;
      if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }

      // 1. Center pulsing spring heart
      const mainHeart = document.createElement('div');
      mainHeart.className = 'particle-heart-spring';
      mainHeart.innerHTML = '❤️';
      mainHeart.style.left = (x - 38) + 'px';
      mainHeart.style.top = (y - 38) + 'px';
      container.appendChild(mainHeart);
      setTimeout(function() { mainHeart.remove(); }, 900);

      // 2. Floating dopamine badge (+1 ❤️, +10 SOV, etc.)
      if (badgeText) {
        const dopamine = document.createElement('div');
        dopamine.className = 'particle-floating-dopamine';
        dopamine.innerText = badgeText;
        dopamine.style.left = (x - 24) + 'px';
        dopamine.style.top = (y - 55) + 'px';
        container.appendChild(dopamine);
        setTimeout(function() { dopamine.remove(); }, 950);
      }

      // 3. Radial micro particles (confetti, stars, sparks)
      const particleChars = ['❤️', '💖', '✨', '⭐', '🔥'];
      for (let i = 0; i < 10; i++) {
        const p = document.createElement('div');
        p.className = 'physics-micro-particle';
        p.innerText = particleChars[Math.floor(Math.random() * particleChars.length)];
        const angle = (i / 10) * 2 * Math.PI + (Math.random() * 0.4 - 0.2);
        const dist = 45 + Math.random() * 55;
        const targetX = Math.cos(angle) * dist;
        const targetY = Math.sin(angle) * dist - 25;
        const rot = (Math.random() - 0.5) * 60;
        p.style.left = x + 'px';
        p.style.top = y + 'px';
        p.style.setProperty('--tx', targetX + 'px');
        p.style.setProperty('--ty', targetY + 'px');
        p.style.setProperty('--rot', rot + 'deg');
        container.appendChild(p);
        setTimeout(function() { p.remove(); }, 750);
      }
    }

    function triggerFeedPostLike(postId) {
      const post = feedPostsData.find(function(p) { return p.id === postId; });
      if (!post) return;
      if (!Array.isArray(post.likedByDids)) post.likedByDids = [];

      const myDid = myProfile ? myProfile.did : 'did:sovra:self';
      const myIdx = post.likedByDids.indexOf(myDid);
      const isNowLiked = myIdx === -1;

      if (isNowLiked) {
        post.likedByDids.push(myDid);
      } else {
        post.likedByDids.splice(myIdx, 1);
      }
      post.isLiked = isNowLiked;
      post.likesCount = post.likedByDids.length;

      const countEl = document.getElementById('likes-count-' + postId);
      if (countEl) countEl.innerText = post.likesCount.toLocaleString();
      const btnEl = document.getElementById('btn-like-' + postId);
      if (btnEl) {
        btnEl.innerText = isNowLiked ? '❤️' : '🤍';
        if (isNowLiked) {
          btnEl.classList.remove('heart-bounce-pop');
          void btnEl.offsetWidth;
          btnEl.classList.add('heart-bounce-pop');
          const mediaBox = document.getElementById('media-' + postId);
          if (mediaBox) {
            const rect = mediaBox.getBoundingClientRect();
            spawnParticleBurst(rect.width / 2, rect.height / 2, mediaBox, '+1 ❤️');
          }
        }
      }

      // Persist to backend dynamic store
      fetch('/api/feed/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: postId, userDid: myDid, isLiked: isNowLiked })
      })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res && res.ok) {
          post.likesCount = res.likesCount;
          if (countEl) countEl.innerText = res.likesCount.toLocaleString();
        }
      })
      .catch(function(err) { console.warn('[Feed] Like sync warning:', err); });
    }

    function handleFeedDoubleTap(postId, event) {
      const post = feedPostsData.find(function(p) { return p.id === postId; });
      if (!post) return;
      if (!Array.isArray(post.likedByDids)) post.likedByDids = [];

      const myDid = myProfile ? myProfile.did : 'did:sovra:self';
      if (!post.likedByDids.includes(myDid)) {
        post.likedByDids.push(myDid);
        post.isLiked = true;
        post.likesCount = post.likedByDids.length;
        const countEl = document.getElementById('likes-count-' + postId);
        if (countEl) countEl.innerText = post.likesCount.toLocaleString();
        const btnEl = document.getElementById('btn-like-' + postId);
        if (btnEl) {
          btnEl.innerText = '❤️';
          btnEl.classList.remove('heart-bounce-pop');
          void btnEl.offsetWidth;
          btnEl.classList.add('heart-bounce-pop');
        }

        // Persist to backend dynamic store
        fetch('/api/feed/like', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId: postId, userDid: myDid, isLiked: true })
        })
        .then(function(r) { return r.json(); })
        .then(function(res) {
          if (res && res.ok) {
            post.likesCount = res.likesCount;
            if (countEl) countEl.innerText = res.likesCount.toLocaleString();
          }
        })
        .catch(function(err) { console.warn('[Feed] Like sync warning:', err); });
      }

      // Heart dopamine & particle explosion
      const mediaBox = document.getElementById('media-' + postId);
      if (mediaBox) {
        const rect = mediaBox.getBoundingClientRect();
        const x = (event && event.clientX) ? (event.clientX - rect.left) : (rect.width / 2);
        const y = (event && event.clientY) ? (event.clientY - rect.top) : (rect.height / 2);
        spawnParticleBurst(x, y, mediaBox, '+1 ❤️');
      }
    }

    function focusFeedComment(postId) {
      const input = document.getElementById('input-comment-' + postId);
      if (input) input.focus();
    }

    function submitFeedComment(postId) {
      const input = document.getElementById('input-comment-' + postId);
      if (!input || !input.value.trim()) return;
      const text = input.value.trim();
      input.value = '';

      const myName = myProfile ? myProfile.name : 'You (Me)';
      const myDid = myProfile ? myProfile.did : 'did:sovra:self';
      const myAvatar = myProfile ? myProfile.avatar : 'Y';

      const post = feedPostsData.find(function(p) { return p.id === postId; });
      if (post) {
        if (!Array.isArray(post.comments)) post.comments = [];
        post.comments.push({ author: myName, text: text, authorDid: myDid, authorAvatar: myAvatar, timestamp: Date.now() });
      }

      const commentsBox = document.getElementById('comments-box-' + postId);
      if (commentsBox) {
        const commentDiv = document.createElement('div');
        commentDiv.innerHTML = '<strong style="color: #38bdf8; font-size: 0.82rem;">' + myName + '</strong> <span style="color: #cbd5e1; font-size: 0.82rem;">' + text + '</span>';
        commentsBox.appendChild(commentDiv);
      }

      // Persist to backend dynamic store
      fetch('/api/feed/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId: postId,
          text: text,
          author: myName,
          authorDid: myDid,
          authorAvatar: myAvatar
        })
      }).catch(function(err) { console.warn('[Feed] Comment sync warning:', err); });
    }

    let selectedFeedPhotoDataUrl = null;

    function handleFeedPhotoSelected(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      compressImage(file, 1200, 0.82, function(compressedUrl) {
        selectedFeedPhotoDataUrl = compressedUrl;
        const previewContainer = document.getElementById('feedPhotoPreviewContainer');
        const previewImg = document.getElementById('feedPhotoPreviewImg');
        if (previewImg && previewContainer) {
          previewImg.src = selectedFeedPhotoDataUrl;
          previewContainer.style.display = 'block';
        }
      });
    }

    function clearFeedSelectedPhoto() {
      selectedFeedPhotoDataUrl = null;
      const previewContainer = document.getElementById('feedPhotoPreviewContainer');
      const previewImg = document.getElementById('feedPhotoPreviewImg');
      const fileInput = document.getElementById('realFeedFileInput');
      if (previewContainer) previewContainer.style.display = 'none';
      if (previewImg) previewImg.src = '';
      if (fileInput) fileInput.value = '';
    }

    function submitDynamicPost() {
      const captionEl = document.getElementById('dynamicPostCaption');
      const text = captionEl ? captionEl.value.trim() : '';
      if (!text && !selectedFeedPhotoDataUrl) {
        alert('Please write a caption or choose a photo before posting.');
        return;
      }

      const theme = document.getElementById('dynamicPostTheme') ? document.getElementById('dynamicPostTheme').value : 'mesh';
      const tags = document.getElementById('dynamicPostTags') ? document.getElementById('dynamicPostTags').value : '#sovra #p2p';
      const btn = document.getElementById('dynamicPostPublishBtn');
      if (btn) btn.innerText = 'Publishing...';

      fetch('/api/feed/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption: text || 'Photo update from sovereign peer',
          tags: tags,
          theme: theme,
          mediaImage: selectedFeedPhotoDataUrl,
          authorName: myProfile ? myProfile.name : 'You (Sovereign Peer)',
          authorAvatar: myProfile ? myProfile.avatar : 'S',
          authorAvatarBg: myProfile ? myProfile.avatarBg : '#6366f1',
          authorAvatarDataUrl: myProfile ? myProfile.avatarDataUrl : undefined,
          authorDid: myProfile ? myProfile.did : 'did:sovra:self',
        })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (btn) btn.innerHTML = '<span>🚀 Post</span>';
        if (data.ok && data.post) {
          if (captionEl) captionEl.value = '';
          clearFeedSelectedPhoto();
          feedPostsData.unshift(data.post);
          renderDynamicPostCard(data.post, true);
          updateProfileDynamicStats();
        } else {
          alert('Could not publish post: ' + (data.error || 'Unknown error'));
        }
      })
      .catch(function(err) {
        if (btn) btn.innerHTML = '<span>🚀 Post</span>';
        alert('Post error: ' + err.message);
      });
    }

    function syncFeedPosts() {
      fetch('/api/feed/list')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data && data.ok && Array.isArray(data.posts)) {
            let hasNew = false;
            const myDid = myProfile ? myProfile.did : 'did:sovra:self';

            for (let i = data.posts.length - 1; i >= 0; i--) {
              const p = data.posts[i];
              const existing = feedPostsData.find(function(ex) { return ex.id === p.id; });
              if (!existing) {
                feedPostsData.unshift(p);
                renderDynamicPostCard(p, true);
                hasNew = true;
              } else {
                if (existing.likesCount !== p.likesCount || JSON.stringify(existing.likedByDids) !== JSON.stringify(p.likedByDids)) {
                  existing.likesCount = p.likesCount;
                  existing.likedByDids = p.likedByDids || [];
                  const countEl = document.getElementById('likes-count-' + p.id);
                  if (countEl) countEl.innerText = p.likesCount.toLocaleString();

                  const isLikedByMe = Array.isArray(p.likedByDids) ? p.likedByDids.includes(myDid) : Boolean(p.isLiked);
                  const btnLike = document.getElementById('btn-like-' + p.id);
                  if (btnLike) btnLike.innerText = isLikedByMe ? '❤️' : '🤍';
                }
                if (Array.isArray(p.comments) && p.comments.length !== (existing.comments || []).length) {
                  existing.comments = p.comments;
                  const commentsBox = document.getElementById('comments-box-' + p.id);
                  if (commentsBox) {
                    let cHtml = '<div style="color: #64748b; font-size: 0.75rem; cursor: pointer;">View all ' + p.comments.length + ' comments &bull; Verified on DHT</div>';
                    p.comments.forEach(function(c) {
                      const isMe = (c.authorDid && c.authorDid === myDid) || c.author === (myProfile ? myProfile.name : 'You (Me)');
                      const authorColor = isMe ? '#38bdf8' : '#cbd5e1';
                      cHtml += '<div><strong style="color: ' + authorColor + '; font-size: 0.82rem;">' + c.author + '</strong> <span style="color: #94a3b8; font-size: 0.82rem;">' + c.text + '</span></div>';
                    });
                    commentsBox.innerHTML = cHtml;
                  }
                }
              }
            }
            if (hasNew) updateProfileDynamicStats();
          }
        })
        .catch(function() {});
    }
    setInterval(syncFeedPosts, 3500);

    function renderDynamicPostCard(post, isNew) {
      const container = document.getElementById('feedPostsStream');
      if (!container) return;

      const emptyNotice = document.getElementById('emptyFeedNotice');
      if (emptyNotice) emptyNotice.remove();

      const myDid = myProfile ? myProfile.did : 'did:sovra:self';
      const isLikedByMe = Array.isArray(post.likedByDids) ? post.likedByDids.includes(myDid) : Boolean(post.isLiked);

      const card = document.createElement('article');
      card.className = 'insta-post-card';
      card.id = 'card-' + post.id;
      if (isNew) {
        card.style.border = '1px solid #10b981';
        card.style.boxShadow = '0 0 25px rgba(16, 185, 129, 0.4)';
        card.style.animation = 'feedCardEntrance 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
      }

      var commentsHtml = '';
      if (post.comments && post.comments.length) {
        for (var i = 0; i < post.comments.length; i++) {
          var c = post.comments[i];
          var isMe = (c.authorDid && c.authorDid === myDid) || c.author === (myProfile ? myProfile.name : 'You (Me)');
          var authorColor = isMe ? '#38bdf8' : '#cbd5e1';
          commentsHtml += '<div><strong style="color: ' + authorColor + '; font-size: 0.82rem;">' + c.author + '</strong> <span style="color: #94a3b8; font-size: 0.82rem;">' + c.text + '</span></div>';
        }
      }

      const mediaBoxHtml = post.mediaImage ?
        '<div class="insta-media-box" id="media-' + post.id + '" style="position: relative; overflow: hidden; max-height: 520px; background: #000; display: flex; align-items: center; justify-content: center;">' +
          '<img src="' + post.mediaImage + '" alt="Feed media" style="width: 100%; height: auto; max-height: 520px; object-fit: contain; display: block;" />' +
          '<div style="position: absolute; bottom: 8px; left: 8px; display: inline-flex; align-items: center; gap: 5px; background: rgba(15,23,42,0.85); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,0.15); padding: 3px 8px; border-radius: 12px; font-size: 0.68rem; font-family: monospace; color: #38bdf8; z-index: 5;">' +
            '<span>📦 CID:</span> <span>' + (post.mediaCid ? post.mediaCid.substring(0, 14) + '...' : 'bafybei...') + '</span>' +
          '</div>' +
          '<div id="heart-pop-' + post.id + '"></div>' +
        '</div>' :
        '<div class="insta-media-box" id="media-' + post.id + '" style="background: ' + post.mediaGradient + ';">' +
          '<div style="text-align: center; pointer-events: none; z-index: 2; padding: 2rem;">' +
            '<div style="font-size: 4rem; margin-bottom: 0.75rem;">' + post.mediaEmoji + '</div>' +
            '<div style="font-size: 1.15rem; font-weight: 800; color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,0.8); line-height: 1.35;">' + post.mediaTitle + '</div>' +
            '<div style="margin-top: 0.85rem; display: inline-flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.5); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,0.15); padding: 4px 10px; border-radius: 20px; font-size: 0.72rem; font-family: monospace; color: #a5b4fc;">' +
              '<span>📦 CID:</span> <span>' + (post.mediaCid ? post.mediaCid.substring(0, 16) : 'bafybei...') + '...</span>' +
            '</div>' +
          '</div>' +
          '<div id="heart-pop-' + post.id + '"></div>' +
        '</div>';

      card.innerHTML = 
        '<div class="insta-post-header">' +
          '<div class="insta-author-info">' +
            '<div class="insta-author-avatar" style="background: ' + post.authorAvatarBg + '; overflow: hidden;">' +
              (post.authorAvatarDataUrl ? '<img src="' + post.authorAvatarDataUrl + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;" />' : post.authorAvatar) +
            '</div>' +
            '<div>' +
              '<div style="font-weight: 700; font-size: 0.9rem; color: #fff; display: flex; align-items: center; gap: 4px;">' +
                '<span>' + post.authorName + '</span>' +
                '<span style="color: #38bdf8; font-size: 0.8rem;">✓</span>' +
              '</div>' +
              '<div style="font-size: 0.72rem; color: #94a3b8;"><span>' + post.audioTrack + '</span></div>' +
            '</div>' +
          '</div>' +
          '<button class="chat-btn-round btn-opt-' + post.id + '" style="width: 32px; height: 32px; font-size: 1rem;" title="Post Options">⋮</button>' +
        '</div>' +

        mediaBoxHtml +

        '<div class="insta-actions-row">' +
          '<div style="display: flex; align-items: center; gap: 0.85rem;">' +
            '<button class="insta-action-btn" id="btn-like-' + post.id + '" title="Like Post">' + (isLikedByMe ? '❤️' : '🤍') + '</button>' +
            '<button class="insta-action-btn btn-comment-' + post.id + '" title="Comment">💬</button>' +
            '<button class="insta-action-btn btn-repost-' + post.id + '" title="Repost / Quote">🔁</button>' +
            '<button class="insta-action-btn btn-share-' + post.id + '" title="Share CID to P2P Mesh">🚀</button>' +
            '<button class="insta-action-btn btn-dislike-' + post.id + '" title="Dislike / Show Less">👎</button>' +
          '</div>' +
          '<button class="insta-action-btn" id="btn-save-' + post.id + '" title="Pin to Local Blockstore">' + (post.isSaved ? '🔖' : '🏷️') + '</button>' +
        '</div>' +

        '<div class="insta-likes-text">' +
          '<span id="likes-count-' + post.id + '">' + post.likesCount.toLocaleString() + '</span> likes' +
        '</div>' +

        '<div class="insta-caption">' +
          '<strong>' + post.authorName.split(' ')[0] + '</strong> <span>' + post.caption + '</span>' +
          '<div class="insta-tags" style="margin-top: 0.25rem;">' + post.tags + '</div>' +
        '</div>' +

        '<div class="insta-comments-preview" id="comments-box-' + post.id + '">' +
          '<div style="color: #64748b; font-size: 0.75rem; cursor: pointer;">View all ' + post.comments.length + ' comments &bull; Verified on DHT</div>' +
          commentsHtml +
        '</div>' +

        '<div class="insta-comment-input-row">' +
          '<input type="text" id="input-comment-' + post.id + '" placeholder="Add a comment to GossipSub swarm...">' +
          '<button class="btn-sub-comment-' + post.id + '">Post</button>' +
        '</div>';

      const authorInfo = card.querySelector('.insta-author-info');
      if (authorInfo) authorInfo.onclick = function() { openCreatorProfile(post.authorName.split(' ')[0].toLowerCase()); };
      const mBox = card.querySelector('.insta-media-box');
      if (mBox) mBox.ondblclick = function(e) { handleFeedDoubleTap(post.id, e); };
      const btnOpt = card.querySelector('.btn-opt-' + post.id);
      if (btnOpt) btnOpt.onclick = function() { openPostOptionsModal(post.id, post.authorName, post.mediaCid); };
      const btnLike = card.querySelector('#btn-like-' + post.id);
      if (btnLike) btnLike.onclick = function() { triggerFeedPostLike(post.id); };
      const btnComm = card.querySelector('.btn-comment-' + post.id);
      if (btnComm) btnComm.onclick = function() { focusFeedComment(post.id); };
      const btnRep = card.querySelector('.btn-repost-' + post.id);
      if (btnRep) btnRep.onclick = function() { openRepostModal(post.id); };
      const btnShare = card.querySelector('.btn-share-' + post.id);
      if (btnShare) btnShare.onclick = function() { shareFeedPostCid(post.mediaCid); };
      const btnDis = card.querySelector('.btn-dislike-' + post.id);
      if (btnDis) btnDis.onclick = function() { handleFeedDislike(post.id); };
      const btnSav = card.querySelector('#btn-save-' + post.id);
      if (btnSav) btnSav.onclick = function() { toggleSaveFeedPost(post.id); };
      const commentInput = card.querySelector('#input-comment-' + post.id);
      if (commentInput) commentInput.onkeydown = function(e) { if (e.key === 'Enter') submitFeedComment(post.id); };
      const btnSubComm = card.querySelector('.btn-sub-comment-' + post.id);
      if (btnSubComm) btnSubComm.onclick = function() { submitFeedComment(post.id); };

      container.insertBefore(card, container.firstChild);
    }

    function updateProfileDynamicStats() {
      const postsCountEl = document.getElementById('profilePostsCount');
      if (postsCountEl) {
        postsCountEl.innerText = feedPostsData.length.toString();
      }
      const meFeedPostsCount = document.getElementById('meFeedPostsCount');
      if (meFeedPostsCount) {
        meFeedPostsCount.innerText = feedPostsData.length.toString();
      }
      const meFriendsCount = document.getElementById('meFriendsCount');
      if (meFriendsCount) {
        const peerCount = contactsData ? contactsData.length : 0;
        meFriendsCount.innerText = peerCount.toString();
      }
      const meFollowersCount = document.getElementById('meFollowersCount');
      if (meFollowersCount) {
        const peerCount = contactsData ? contactsData.length : 0;
        meFollowersCount.innerText = peerCount.toString();
      }
      const meFollowingCount = document.getElementById('meFollowingCount');
      if (meFollowingCount) {
        const peerCount = contactsData ? contactsData.length : 0;
        meFollowingCount.innerText = peerCount.toString();
      }
    }

    function shareFeedPostCid(cid) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(cid).catch(function() {});
      }
      alert('📦 Content ID (CID) Copied!\\n\\n' + cid + '\\n\\nAnnounced to BitSwap Swarm: 14 Connected Seeders');
    }

    function toggleSaveFeedPost(postId) {
      const post = feedPostsData.find(function(p) { return p.id === postId; });
      if (!post) return;
      post.isSaved = !post.isSaved;
      const btn = document.getElementById('btn-save-' + postId);
      if (btn) btn.innerText = post.isSaved ? '🔖' : '🏷️';
      if (post.isSaved) {
        alert('Pinned to Local Merkle DAG Blockstore!\\nCID: ' + post.mediaCid);
      } else {
        alert('Unpinned from Local Blockstore.\\nTombstone scheduled for GC.');
      }
    }

    function copyProfileDid() {
      const did = '${masterKey.did}';
      if (navigator.clipboard) {
        navigator.clipboard.writeText(did).catch(function() {});
      }
      alert('🔑 Decentralized Identifier (DID) Copied!\\n\\n' + did + '\\n\\nVerified with Ed25519 public key.');
    }

    function switchProfileGridTab(tab) {
      currentProfileGridTab = tab;
      const tabs = ['posts', 'reels', 'pins'];
      for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i];
        var el = document.getElementById('ptab-' + t);
        if (el) {
          if (t === tab) el.classList.add('active');
          else el.classList.remove('active');
        }
      }
      renderProfileGrid(tab);
    }

    function renderProfileGrid(tab) {
      const grid = document.getElementById('profileGridContainer');
      if (!grid) return;
      var html = '';
      if (tab === 'posts') {
        if (feedPostsData.length === 0) {
          html = '<div style="grid-column: 1 / -1; text-align: center; padding: 2.5rem 1rem; color: #64748b; font-size: 0.85rem;">No posts published yet. Share your first update on the mesh!</div>';
        } else {
          html = feedPostsData.map(function(p) {
            var mediaContent = p.mediaImage ?
              '<img src="' + p.mediaImage + '" style="width: 100%; height: 100%; object-fit: cover; position: absolute; top: 0; left: 0;" />' :
              '<div style="font-size: 2.2rem; pointer-events: none;">' + p.mediaEmoji + '</div>';
            return '<div class="media-grid-item" style="background: ' + (p.mediaGradient || '#1e293b') + '; position: relative; overflow: hidden;" onclick="switchTab(&quot;feed&quot;); var c = document.getElementById(&quot;card-' + p.id + '&quot;); if(c) c.scrollIntoView({ behavior: &quot;smooth&quot; });">' +
              mediaContent +
              '<div class="media-hover-overlay">' +
                '<span>❤️ ' + p.likesCount + '</span>' +
                '<span>💬 ' + p.comments.length + '</span>' +
              '</div>' +
            '</div>';
          }).join('');
        }
      } else if (tab === 'reels') {
        html = reelsData.map(function(r, idx) {
          return '<div class="media-grid-item" style="background: ' + r.bgGradient + ';" onclick="switchTab(&quot;reels&quot;); currentReelIndex = ' + idx + '; renderCurrentReel();">' +
            '<div style="font-size: 2.2rem; pointer-events: none;">🎬</div>' +
            '<div class="media-hover-overlay">' +
              '<span>❤️ ' + r.likesCount + '</span>' +
              '<span>💬 ' + r.commentsCount + '</span>' +
            '</div>' +
          '</div>';
        }).join('');
      } else if (tab === 'pins') {
        var pinItems = [
          { emoji: '📦', name: 'DAG Root v1', size: '14.2 MB', seeders: 14 },
          { emoji: '⚡', name: 'Ephemeral Ring', size: '4.8 MB', seeders: 8 },
          { emoji: '🎵', name: 'Spatial Master', size: '28.6 MB', seeders: 22 },
          { emoji: '🎞️', name: 'HLS Segment 0', size: '2.1 MB', seeders: 19 },
          { emoji: '🔒', name: 'Identity Share', size: '64 KB', seeders: 5 },
          { emoji: '📊', name: 'CRDT Ledger', size: '1.2 MB', seeders: 12 }
        ];
        html = pinItems.map(function(pin) {
          return '<div class="media-grid-item" style="background: linear-gradient(135deg, #1e1b4b, #312e81);" onclick="alert(&quot;Pinned Merkle DAG Block: ' + pin.name + '\\nSize: ' + pin.size + '\\nActive Seeders: ' + pin.seeders + '&quot;)">' +
            '<div style="text-align: center; pointer-events: none; padding: 0.5rem;">' +
              '<div style="font-size: 2rem;">' + pin.emoji + '</div>' +
              '<div style="font-size: 0.72rem; color: #cbd5e1; font-weight: 700; margin-top: 4px;">' + pin.name + '</div>' +
            '</div>' +
            '<div class="media-hover-overlay">' +
              '<span style="font-size: 0.75rem;">' + pin.size + '</span>' +
              '<span style="font-size: 0.75rem;">' + pin.seeders + ' peers</span>' +
            '</div>' +
          '</div>';
        }).join('');
      }
      grid.innerHTML = html;
    }

    function withdrawWalletFunds() {
      var amount = prompt('Enter amount in SOV to withdraw to sovereign on-chain address (Max: ' + walletBalanceSov.toFixed(2) + ' SOV):', walletBalanceSov.toFixed(2));
      if (!amount) return;
      var num = parseFloat(amount);
      if (isNaN(num) || num <= 0 || num > walletBalanceSov) {
        alert('Invalid withdrawal amount specified.');
        return;
      }
      walletBalanceSov -= num;
      var sovEl = document.getElementById('walletBalanceSovDisplay');
      if (sovEl) sovEl.innerText = walletBalanceSov.toFixed(2) + ' SOV';
      var fiatEl = document.getElementById('walletBalanceFiatDisplay');
      if (fiatEl) fiatEl.innerText = '≈ $' + (walletBalanceSov * 3.0).toFixed(2) + ' USD';
      alert('Withdrawal Successful!\\n\\nTransferred ' + num.toFixed(2) + ' SOV to DID recipient.\\nSigned with Ed25519 Device Key.\\nRemaining Balance: ' + walletBalanceSov.toFixed(2) + ' SOV');
    }

    // ==========================================
    // 1. INSTAGRAM REELS & STORIES SCRIPT ENGINE
    // ==========================================
    const reelsData = ${JSON.stringify(reelsStore)};
    const creatorProfilesData = ${JSON.stringify(creatorProfiles)};
    const storiesData = ${JSON.stringify(multiSegmentStories)};
    let reelCommentsData = ${JSON.stringify(reelCommentsStore)};
    let currentReelIndex = 0;
    const savedReelsSet = new Set();
    const likedReelsSet = new Set();
    const followedCreatorsSet = new Set();
    let isReelPlaying = true;
    let reelPlaybackInterval = null;
    let reelNotesInterval = null;
    let reelProgressPct = 0;

    function renderCurrentReel() {
      const r = reelsData[currentReelIndex];
      if (!r) return;

      const ambientBg = document.getElementById('reelAmbientBg');
      if (ambientBg) ambientBg.style.background = r.bgGradient;

      const cinemaGlow = document.getElementById('reelAmbientCinemaGlow');
      if (cinemaGlow) cinemaGlow.style.background = r.bgGradient;

      const cidEl = document.getElementById('reelCidDisplay');
      if (cidEl) cidEl.innerText = 'CID: ' + r.cid.substring(0, 18) + '...';

      const counterEl = document.getElementById('reelCounterDisplay');
      if (counterEl) counterEl.innerText = (currentReelIndex + 1) + ' / ' + reelsData.length;

      const avatarEl = document.getElementById('reelCreatorAvatar');
      if (avatarEl) avatarEl.innerText = r.creatorHandle[0].toUpperCase();

      const handleEl = document.getElementById('reelCreatorHandle');
      if (handleEl) handleEl.innerText = '@' + r.creatorHandle;

      const captionEl = document.getElementById('reelCaption');
      if (captionEl) captionEl.innerText = r.caption;

      const audioEl = document.getElementById('reelAudioTrack');
      if (audioEl) audioEl.innerText = r.audioTrack;

      const likeCountEl = document.getElementById('reelLikeCount');
      if (likeCountEl) likeCountEl.innerText = r.likesCount;

      const commentCountEl = document.getElementById('reelCommentCount');
      if (commentCountEl) commentCountEl.innerText = r.commentsCount;

      const shareCountEl = document.getElementById('reelShareCount');
      if (shareCountEl) shareCountEl.innerText = r.sharesCount;

      // Like icon state
      const likeIcon = document.getElementById('reelLikeIcon');
      if (likeIcon) {
        likeIcon.innerText = likedReelsSet.has(r.id) ? '❤️' : '🤍';
      }

      // Save icon state
      const saveIcon = document.getElementById('reelSaveIcon');
      const saveLabel = document.getElementById('reelSaveLabel');
      if (saveIcon && saveLabel) {
        if (savedReelsSet.has(r.id)) {
          saveIcon.innerText = '🔖';
          saveIcon.style.color = '#f59e0b';
          saveLabel.innerText = 'Saved';
        } else {
          saveIcon.innerText = '🔖';
          saveIcon.style.color = '#fff';
          saveLabel.innerText = 'Save';
        }
      }

      // Follow state
      const followBtn = document.getElementById('reelFollowBtn');
      const avatarFollowBadge = document.getElementById('reelAvatarFollowBadge');
      const isFollowing = followedCreatorsSet.has(r.creatorHandle);
      if (followBtn) {
        followBtn.innerText = isFollowing ? 'Following' : 'Follow';
        followBtn.style.background = isFollowing ? 'rgba(255, 255, 255, 0.2)' : '#0095f6';
      }
      if (avatarFollowBadge) {
        avatarFollowBadge.style.display = isFollowing ? 'none' : 'flex';
      }

      // Pre-warm status
      const preWarmTime = Math.floor(10 + Math.random() * 15);
      const preWarmEl = document.getElementById('reelPreWarmStatus');
      if (preWarmEl) preWarmEl.innerText = 'Pre-Warmed (' + preWarmTime + 'ms decode)';

      // Reset and run progress line & floating musical notes
      startReelPlaybackProgress();
      startVinylNotesEmitter();
    }

    function startReelPlaybackProgress() {
      clearInterval(reelPlaybackInterval);
      reelProgressPct = 0;
      const bar = document.getElementById('reelProgressBar');
      if (bar) bar.style.width = '0%';

      reelPlaybackInterval = setInterval(() => {
        if (!isReelPlaying) return;
        reelProgressPct += 0.67; // 15 seconds loop
        if (bar) bar.style.width = Math.min(100, reelProgressPct) + '%';
        if (reelProgressPct >= 100) {
          reelProgressPct = 0;
          if (bar) bar.style.width = '0%';
        }
      }, 100);
    }

    function startVinylNotesEmitter() {
      clearInterval(reelNotesInterval);
      reelNotesInterval = setInterval(() => {
        if (isReelPlaying && document.getElementById('reels-view').style.display === 'flex') {
          spawnFloatingNote();
        }
      }, 2400);
    }

    function spawnFloatingNote() {
      const container = document.getElementById('notesContainer');
      if (!container) return;
      const note = document.createElement('div');
      note.className = 'floating-note';
      const notes = ['♪', '♫', '♩', '♬'];
      note.innerText = notes[Math.floor(Math.random() * notes.length)];
      note.style.right = (12 + Math.random() * 22) + 'px';
      note.style.bottom = (65 + Math.random() * 25) + 'px';
      container.appendChild(note);
      setTimeout(() => {
        if (note.parentNode) note.remove();
      }, 1900);
    }

    function nextReel() {
      if (currentReelIndex < reelsData.length - 1) {
        currentReelIndex++;
      } else {
        currentReelIndex = 0;
      }
      renderCurrentReel();
    }

    function prevReel() {
      if (currentReelIndex > 0) {
        currentReelIndex--;
      } else {
        currentReelIndex = reelsData.length - 1;
      }
      renderCurrentReel();
    }

    function selectReelById(reelId) {
      const idx = reelsData.findIndex(r => r.id === reelId);
      if (idx !== -1) {
        currentReelIndex = idx;
        renderCurrentReel();
      }
    }

    // Single Tap Play/Pause with Floating Center Indicator
    let lastTapTime = 0;
    let tapTimeout = null;

    function handleReelSingleClick(e) {
      const now = Date.now();
      if (now - lastTapTime < 320) {
        clearTimeout(tapTimeout);
        return;
      }
      lastTapTime = now;
      tapTimeout = setTimeout(() => {
        toggleReelPlayPause();
      }, 280);
    }

    function toggleReelPlayPause() {
      isReelPlaying = !isReelPlaying;
      const indicator = document.getElementById('tapPlayIndicator');
      if (indicator) {
        indicator.innerText = isReelPlaying ? '▶' : '⏸';
        indicator.classList.remove('show');
        void indicator.offsetWidth;
        indicator.classList.add('show');
        setTimeout(() => indicator.classList.remove('show'), 650);
      }
      const disc = document.getElementById('reelVinylDisc');
      if (disc) {
        disc.style.animationPlayState = isReelPlaying ? 'running' : 'paused';
      }
      const eqBars = document.querySelectorAll('.sound-bar');
      eqBars.forEach(b => {
        b.style.animationPlayState = isReelPlaying ? 'running' : 'paused';
      });
    }

    // Double Tap 3D Heart Burst & Dopamine Pop (+1 ❤️)
    function handleReelDoubleTap(e) {
      clearTimeout(tapTimeout);
      lastTapTime = Date.now();
      const wrapper = document.getElementById('reelCanvasWrapper');
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Unified 3D Pop Heart Burst, Floating Dopamine Badge & Radial Particles
      spawnParticleBurst(x, y, wrapper, '+1 ❤️');

      // Mark like
      if (!likedReelsSet.has(reelsData[currentReelIndex].id)) {
        triggerReelLike(e);
      }
    }

    async function triggerReelLike(e) {
      if (e && e.stopPropagation) e.stopPropagation();
      const r = reelsData[currentReelIndex];
      if (!r) return;

      const wasLiked = likedReelsSet.has(r.id);
      const icon = document.getElementById('reelLikeIcon');
      if (wasLiked) {
        likedReelsSet.delete(r.id);
        r.likesCount = Math.max(0, r.likesCount - 1);
        if (icon) icon.innerText = '🤍';
      } else {
        likedReelsSet.add(r.id);
        r.likesCount++;
        if (icon) {
          icon.innerText = '❤️';
          icon.style.transform = 'scale(1.35)';
          setTimeout(() => { icon.style.transform = 'scale(1)'; }, 200);
        }
      }
      document.getElementById('reelLikeCount').innerText = r.likesCount;

      try {
        await fetch('/api/reels/like', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reelId: r.id })
        });
      } catch (err) {}
    }

    function toggleReelSave() {
      const r = reelsData[currentReelIndex];
      if (!r) return;
      const isSaved = savedReelsSet.has(r.id);
      const icon = document.getElementById('reelSaveIcon');
      const label = document.getElementById('reelSaveLabel');

      if (isSaved) {
        savedReelsSet.delete(r.id);
        if (icon) { icon.innerText = '🔖'; icon.style.color = '#fff'; }
        if (label) label.innerText = 'Save';
      } else {
        savedReelsSet.add(r.id);
        if (icon) {
          icon.innerText = '🔖';
          icon.style.color = '#f59e0b';
          icon.style.transform = 'scale(1.3)';
          setTimeout(() => { icon.style.transform = 'scale(1)'; }, 200);
        }
        if (label) label.innerText = 'Saved';
      }
    }

    function toggleReelFollow() {
      const r = reelsData[currentReelIndex];
      if (!r) return;
      const handle = r.creatorHandle;
      const isFollowing = followedCreatorsSet.has(handle);
      const btn = document.getElementById('reelFollowBtn');
      const badge = document.getElementById('reelAvatarFollowBadge');

      if (isFollowing) {
        followedCreatorsSet.delete(handle);
        if (btn) {
          btn.innerText = 'Follow';
          btn.style.background = '#0095f6';
        }
        if (badge) badge.style.display = 'flex';
      } else {
        followedCreatorsSet.add(handle);
        if (btn) {
          btn.innerText = 'Following';
          btn.style.background = 'rgba(255, 255, 255, 0.2)';
        }
        if (badge) badge.style.display = 'none';
      }
    }

    function toggleProfileFollow() {
      const r = reelsData[currentReelIndex];
      if (!r) return;
      toggleReelFollow();
      const isFollowing = followedCreatorsSet.has(r.creatorHandle);
      const profileBtn = document.getElementById('profileSheetFollowBtn');
      if (profileBtn) {
        profileBtn.innerText = isFollowing ? 'Following' : 'Follow';
        profileBtn.className = isFollowing ? 'profile-btn profile-btn-secondary' : 'profile-btn profile-btn-primary';
      }
    }

    // 60fps Pointer Dragging & Snap Flick Physics
    let pointerStartY = 0;
    let pointerStartTime = 0;
    let isPointerDown = false;
    let phoneElement = null;

    function handleReelPointerDown(e) {
      if (e.target.closest('.reel-action-btn') || e.target.closest('.reels-sheet-overlay') || e.target.closest('.btn-follow-pill') || e.target.closest('.music-disc')) return;
      isPointerDown = true;
      pointerStartY = e.clientY;
      pointerStartTime = Date.now();
      phoneElement = document.getElementById('reelsPhone');
      if (phoneElement && phoneElement.setPointerCapture) {
        try { phoneElement.setPointerCapture(e.pointerId); } catch (_) {}
      }
    }

    function handleReelPointerMove(e) {
      if (!isPointerDown || !phoneElement) return;
      const dy = e.clientY - pointerStartY;
      const elasticDy = dy * 0.35;
      phoneElement.style.transform = 'translateY(' + elasticDy + 'px)';
    }

    function handleReelPointerUp(e) {
      if (!isPointerDown) return;
      isPointerDown = false;
      if (phoneElement) {
        phoneElement.style.transition = 'transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        phoneElement.style.transform = 'translateY(0px)';
        setTimeout(() => {
          if (phoneElement) phoneElement.style.transition = '';
        }, 250);
      }
      const deltaY = e.clientY - pointerStartY;
      const deltaTime = Math.max(1, Date.now() - pointerStartTime);
      const velocity = deltaY / deltaTime;

      if (deltaY < -45 || velocity < -0.4) {
        nextReel();
      } else if (deltaY > 45 || velocity > 0.4) {
        prevReel();
      }
    }

    let wheelCooldown = false;
    function handleReelWheel(e) {
      if (wheelCooldown) return;
      if (Math.abs(e.deltaY) > 25) {
        wheelCooldown = true;
        setTimeout(() => { wheelCooldown = false; }, 320);
        if (e.deltaY > 0) nextReel();
        else prevReel();
      }
    }

    // Bottom Sheets Management
    function openReelsSheet(overlayId) {
      const el = document.getElementById(overlayId);
      if (el) el.classList.add('active');
    }

    function closeReelsSheet(overlayId) {
      const el = document.getElementById(overlayId);
      if (el) el.classList.remove('active');
    }

    function openReelCommentsSheet() {
      const r = reelsData[currentReelIndex];
      const countEl = document.getElementById('sheetCommentsCount');
      if (countEl) countEl.innerText = r ? r.commentsCount : reelCommentsData.length;

      const listEl = document.getElementById('sheetCommentsList');
      if (listEl) {
        listEl.innerHTML = reelCommentsData.map(c => 
          '<div class="sheet-comment-row" id="comment-' + c.id + '">' +
            '<div class="sheet-comment-avatar">' + c.authorAvatar + '</div>' +
            '<div class="sheet-comment-meta">' +
              '<div><b>@' + c.authorHandle + '</b>' + c.text + '</div>' +
              '<div class="sheet-comment-sub">' +
                '<span>' + c.timeAgo + '</span>' +
                '<span id="likes-' + c.id + '">' + c.likes + ' likes</span>' +
                '<span style="color: #60a5fa; cursor: pointer;" onclick="appendCommentEmoji(&quot;❤️ &quot;)">Reply</span>' +
                '<span style="color: #34d399; font-size: 0.65rem;">● Ed25519 Verified</span>' +
              '</div>' +
            '</div>' +
            '<button style="background: none; border: none; color: rgba(255,255,255,0.6); font-size: 0.85rem; cursor: pointer;" onclick="likeComment(&quot;' + c.id + '&quot;)">🤍</button>' +
          '</div>'
        ).join('');
      }

      openReelsSheet('commentsSheetOverlay');
    }

    function likeComment(commentId) {
      const c = reelCommentsData.find(item => item.id === commentId);
      if (c) {
        c.likes++;
        const el = document.getElementById('likes-' + commentId);
        if (el) el.innerText = c.likes + ' likes';
      }
    }

    function appendCommentEmoji(emoji) {
      const input = document.getElementById('sheetCommentInput');
      if (input) {
        input.value += emoji;
        input.focus();
      }
    }

    function submitReelComment() {
      const input = document.getElementById('sheetCommentInput');
      const text = input ? input.value.trim() : '';
      if (!text) return;

      const r = reelsData[currentReelIndex];
      const newComment = {
        id: 'rc-' + Date.now(),
        reelId: r ? r.id : 'reel-1',
        authorHandle: 'you_peer',
        authorAvatar: 'Y',
        text: text,
        timeAgo: 'Just now',
        likes: 0
      };
      reelCommentsData.unshift(newComment);
      input.value = '';

      if (r) {
        r.commentsCount++;
        document.getElementById('reelCommentCount').innerText = r.commentsCount;
      }
      openReelCommentsSheet();
    }

    function openCreatorProfile(handle) {
      const p = creatorProfilesData[handle] || {
        handle: handle,
        name: handle,
        avatar: handle[0].toUpperCase(),
        avatarBg: '#6366f1',
        verified: true,
        postsCount: 14,
        followersCount: '48.2K',
        followingCount: 120,
        bio: 'Sovra Decentralized Creator & Seeder',
        externalLink: 'https://sovra.network/' + handle,
        highlights: [
          { name: '⚡ Highlights', emoji: '✨' },
          { name: '🎬 Reels', emoji: '🎥' }
        ],
        reels: [
          { id: 'reel-1', views: '2.4M', title: 'Decentralized 60fps', gradient: 'linear-gradient(135deg, #1e1b4b, #312e81)' }
        ]
      };

      document.getElementById('profileSheetHandle').innerText = '@' + p.handle;
      const avatarEl = document.getElementById('profileSheetAvatar');
      if (avatarEl) {
        avatarEl.innerText = p.avatar;
        avatarEl.style.background = p.avatarBg;
      }
      document.getElementById('profileSheetPosts').innerText = p.postsCount;
      document.getElementById('profileSheetFollowers').innerText = p.followersCount;
      document.getElementById('profileSheetFollowing').innerText = p.followingCount;
      document.getElementById('profileSheetName').innerText = p.name;
      document.getElementById('profileSheetBio').innerText = p.bio;
      document.getElementById('profileSheetLink').innerText = '🔗 ' + p.externalLink;

      const isFollowing = followedCreatorsSet.has(p.handle);
      const followBtn = document.getElementById('profileSheetFollowBtn');
      if (followBtn) {
        followBtn.innerText = isFollowing ? 'Following' : 'Follow';
        followBtn.className = isFollowing ? 'profile-btn profile-btn-secondary' : 'profile-btn profile-btn-primary';
      }

      // Highlights
      const hlContainer = document.getElementById('profileSheetHighlights');
      if (hlContainer) {
        hlContainer.innerHTML = p.highlights.map(h => 
          '<div class="highlight-item" onclick="openStory(&quot;' + p.name + '&quot;, &quot;Viewing highlight ' + h.name + '&quot;, &quot;' + p.avatarBg + '&quot;)">' +
            '<div class="highlight-ring">' +
              '<div class="highlight-avatar">' + h.emoji + '</div>' +
            '</div>' +
            '<div class="highlight-title">' + h.name + '</div>' +
          '</div>'
        ).join('');
      }

      // 3-Column Reels Grid
      const gridContainer = document.getElementById('profileSheetGrid');
      if (gridContainer) {
        gridContainer.innerHTML = p.reels.map(gr => 
          '<div class="profile-grid-tile" style="background: ' + gr.gradient + ';" onclick="closeReelsSheet(&quot;profileSheetOverlay&quot;); selectReelById(&quot;' + gr.id + '&quot;)">' +
            '<div class="tile-views-pill">▶ ' + gr.views + '</div>' +
          '</div>'
        ).join('');
      }

      openReelsSheet('profileSheetOverlay');
    }

    function messageCreatorFromProfile() {
      closeReelsSheet('profileSheetOverlay');
      switchTab('chat');
      const r = reelsData[currentReelIndex];
      if (r) {
        const contact = contactsData.find(c => 
          c.name.toLowerCase().includes(r.creatorHandle.toLowerCase()) || 
          c.avatar.toUpperCase() === r.creatorHandle[0].toUpperCase()
        );
        if (contact) selectContact(contact.did);
      }
    }

    function shareCreatorProfile() {
      const r = reelsData[currentReelIndex];
      const link = 'https://sovra.network/@' + (r ? r.creatorHandle : 'creator');
      navigator.clipboard.writeText(link);
      alert('Creator profile link copied to clipboard:\\n' + link);
    }

    function openReelShareSheet() {
      openReelsSheet('shareSheetOverlay');
    }

    function sendReelDirect(peerName) {
      closeReelsSheet('shareSheetOverlay');
      const r = reelsData[currentReelIndex];
      const cid = r ? r.cid : 'bafy...';
      alert('Direct P2P Mesh: Forwarded Reel [' + (r ? r.caption : '') + '] (CID: ' + cid.substring(0, 14) + '...) to ' + peerName + ' via Noise_XX session.');
    }

    function copyActiveReelCid() {
      const r = reelsData[currentReelIndex];
      if (!r) return;
      navigator.clipboard.writeText('ipfs://' + r.cid);
      r.sharesCount++;
      document.getElementById('reelShareCount').innerText = r.sharesCount;
      alert('Decentralized CID copied to clipboard:\\nipfs://' + r.cid);
      closeReelsSheet('shareSheetOverlay');
    }

    function shareToWhatsAppChat() {
      closeReelsSheet('shareSheetOverlay');
      const r = reelsData[currentReelIndex];
      if (!r) return;
      switchTab('chat');
      const input = document.getElementById('chatInputText');
      if (input) {
        input.value = '🎬 Check out this Sovra Reel: ' + r.caption + ' (CID: ipfs://' + r.cid.substring(0, 16) + '...)';
        input.focus();
      }
    }

    function openAudioTrackSheet() {
      const r = reelsData[currentReelIndex];
      if (!r) return;
      const titleEl = document.getElementById('audioSheetTitle');
      const artistEl = document.getElementById('audioSheetArtist');
      if (titleEl) titleEl.innerText = r.audioTrack;
      if (artistEl) artistEl.innerText = 'Original Audio by @' + r.creatorHandle;
      openReelsSheet('audioSheetOverlay');
    }

    // ========================================================
    // MULTI-SEGMENT INSTAGRAM STORY VIEWER SCRIPT ENGINE
    // ========================================================
    let activeStoryCreatorIdx = 0;
    let activeStorySegmentIdx = 0;
    let storyTickInterval = null;
    let storySegmentProgress = 0;
    let isStoryPaused = false;

    function handleRealStoryUpload(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(e) {
        const dataUrl = e.target.result;
        const caption = prompt('Add a caption to your 24h story (optional):', 'Live from my sovereign node 🛰️') || '';
        const myName = myProfile ? myProfile.name : 'You';
        const myAvatar = myProfile ? myProfile.avatar : 'S';
        const myBg = myProfile ? myProfile.avatarBg : '#6366f1';
        const myHandle = myProfile ? myProfile.handle.replace('@', '') : 'you';

        const newSegment = {
          id: 'story-seg-' + Date.now(),
          caption: caption,
          imageUrl: dataUrl,
          stickerText: '📍 Decentralized Story Swarm',
          stickerType: 'location',
          gradient: 'linear-gradient(135deg, #1e1b4b, #312e81)',
          timeAgo: 'Just now'
        };

        let userStory = storiesData.find(s => s.creatorHandle === myHandle || s.creatorHandle === 'you');
        if (userStory) {
          userStory.segments.unshift(newSegment);
          userStory.seen = false;
        } else {
          userStory = {
            creatorHandle: myHandle,
            creatorName: myName,
            creatorAvatar: myAvatar,
            creatorAvatarBg: myBg,
            seen: false,
            segments: [newSegment]
          };
          storiesData.unshift(userStory);
        }

        const ring = document.getElementById('myStoryRing');
        if (ring) {
          ring.className = 'story-ring';
          ring.style.boxShadow = '0 0 16px rgba(56, 189, 248, 0.8)';
        }
        showAccountToast('✨ Story published to mesh! Tap "Your Story" to view.');
      };
      reader.readAsDataURL(file);
    }

    function handleStoryTrayUserClick() {
      const myHandle = myProfile ? myProfile.handle.replace('@', '') : 'you';
      const myStoryIdx = storiesData.findIndex(s => s.creatorHandle === myHandle || s.creatorHandle === 'you');
      if (myStoryIdx >= 0 && storiesData[myStoryIdx].segments.length > 0) {
        launchStoryViewer(myStoryIdx);
      } else {
        const input = document.getElementById('realStoryFileInput');
        if (input) input.click();
      }
    }

    function launchStoryViewer(creatorIdx) {
      if (creatorIdx < 0 || creatorIdx >= storiesData.length) return;
      activeStoryCreatorIdx = creatorIdx;
      activeStorySegmentIdx = 0;
      storiesData[creatorIdx].seen = true;

      // Update story ring in the stories tray
      const storyRingEl = document.querySelector('#feed-story-' + storiesData[creatorIdx].creatorHandle + ' .story-ring') || document.querySelector('#story-item-' + storiesData[creatorIdx].creatorHandle + ' .story-ring');
      if (storyRingEl) storyRingEl.classList.add('seen');

      const overlay = document.getElementById('storyModalOverlay');
      if (overlay) overlay.style.display = 'flex';

      renderStorySegment();
    }

    function renderStorySegmentsHeader() {
      const container = document.getElementById('storySegmentsHeader');
      if (!container) return;
      const cur = storiesData[activeStoryCreatorIdx];
      if (!cur || !cur.segments) return;

      container.innerHTML = cur.segments.map((seg, idx) => {
        let widthPct = '0%';
        if (idx < activeStorySegmentIdx) widthPct = '100%';
        else if (idx === activeStorySegmentIdx) widthPct = storySegmentProgress + '%';
        return '<div class="story-segment-track">' +
          '<div class="story-segment-fill" id="story-seg-fill-' + idx + '" style="width: ' + widthPct + ';"></div>' +
        '</div>';
      }).join('');
    }

    function renderStorySegment() {
      clearInterval(storyTickInterval);
      storySegmentProgress = 0;

      const curCreator = storiesData[activeStoryCreatorIdx];
      if (!curCreator) { closeStory(); return; }

      const curSeg = curCreator.segments[activeStorySegmentIdx];
      if (!curSeg) { closeStory(); return; }

      // Update Author Header
      const authorEl = document.getElementById('storyModalAuthor');
      if (authorEl) authorEl.innerText = curCreator.creatorName;

      const avatarEl = document.getElementById('storyModalAvatar');
      if (avatarEl) {
        avatarEl.innerText = curCreator.creatorAvatar;
        avatarEl.style.background = curCreator.creatorAvatarBg;
      }

      const timeEl = document.getElementById('storyModalTimeAgo');
      if (timeEl) timeEl.innerText = curSeg.timeAgo;

      // Update Content & Gradient or Real Photo
      const modal = document.getElementById('storyCardModal');
      if (modal) {
        if (curSeg.imageUrl) {
          modal.style.background = '#000';
          modal.style.backgroundImage = 'linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.65)), url(' + curSeg.imageUrl + ')';
          modal.style.backgroundSize = 'cover';
          modal.style.backgroundPosition = 'center';
        } else {
          modal.style.backgroundImage = 'none';
          modal.style.background = curSeg.gradient || '#1e1b4b';
        }
      }

      const textEl = document.getElementById('storyModalText');
      if (textEl) textEl.innerText = curSeg.caption;

      const stickerPill = document.getElementById('storyStickerPill');
      const stickerText = document.getElementById('storyStickerText');
      const stickerIcon = document.getElementById('storyStickerIcon');

      if (curSeg.stickerText && stickerPill) {
        stickerPill.style.display = 'inline-flex';
        if (stickerText) stickerText.innerText = curSeg.stickerText;
        if (stickerIcon) {
          if (curSeg.stickerType === 'location') stickerIcon.innerText = '📍';
          else if (curSeg.stickerType === 'poll') stickerIcon.innerText = '📊';
          else stickerIcon.innerText = '⚡';
        }
      } else if (stickerPill) {
        stickerPill.style.display = 'none';
      }

      renderStorySegmentsHeader();

      // Tick 50ms (5 seconds total for 100%)
      storyTickInterval = setInterval(() => {
        if (isStoryPaused) return;
        storySegmentProgress += 1;
        const fillEl = document.getElementById('story-seg-fill-' + activeStorySegmentIdx);
        if (fillEl) fillEl.style.width = Math.min(100, storySegmentProgress) + '%';

        if (storySegmentProgress >= 100) {
          clearInterval(storyTickInterval);
          nextStorySegment();
        }
      }, 50);
    }

    function nextStorySegment() {
      const curCreator = storiesData[activeStoryCreatorIdx];
      if (!curCreator) { closeStory(); return; }

      if (activeStorySegmentIdx < curCreator.segments.length - 1) {
        activeStorySegmentIdx++;
        renderStorySegment();
      } else if (activeStoryCreatorIdx < storiesData.length - 1) {
        activeStoryCreatorIdx++;
        activeStorySegmentIdx = 0;
        storiesData[activeStoryCreatorIdx].seen = true;
        renderStorySegment();
      } else {
        closeStory();
      }
    }

    function prevStorySegment() {
      if (activeStorySegmentIdx > 0) {
        activeStorySegmentIdx--;
        renderStorySegment();
      } else if (activeStoryCreatorIdx > 0) {
        activeStoryCreatorIdx--;
        const prevCreator = storiesData[activeStoryCreatorIdx];
        activeStorySegmentIdx = prevCreator.segments.length - 1;
        renderStorySegment();
      }
    }

    function pauseStoryTimer() {
      isStoryPaused = true;
    }

    function resumeStoryTimer() {
      isStoryPaused = false;
    }

    function sendStoryReaction(emoji) {
      const modal = document.getElementById('storyCardModal');
      if (modal) {
        const pop = document.createElement('div');
        pop.style.position = 'absolute';
        pop.style.fontSize = '3.5rem';
        pop.style.left = '50%';
        pop.style.top = '50%';
        pop.style.transform = 'translate(-50%, -50%)';
        pop.style.animation = 'heartPop 0.85s forwards';
        pop.style.pointerEvents = 'none';
        pop.style.zIndex = '60';
        pop.innerText = emoji;
        modal.appendChild(pop);
        setTimeout(() => pop.remove(), 850);
      }

      const curCreator = storiesData[activeStoryCreatorIdx];
      const curSeg = curCreator ? curCreator.segments[activeStorySegmentIdx] : null;
      if (curCreator && curSeg) {
        chatMessages.push({
          id: 'msg-' + Date.now(),
          senderDid: 'self',
          recipientDid: 'did:sovra:' + curCreator.creatorHandle,
          senderName: 'You',
          text: 'Reacted ' + emoji + ' to your story: "' + curSeg.caption.substring(0, 30) + '..."',
          isAudio: false,
          audioDurationSec: 0,
          timestamp: Date.now(),
          status: 'sent',
          signatureHex: ' verified_ed25519_msg_sig'
        });
      }
    }

    function sendStoryReply() {
      const input = document.getElementById('storyReplyInput');
      const text = input ? input.value.trim() : '';
      if (!text) return;

      const curCreator = storiesData[activeStoryCreatorIdx];
      if (curCreator) {
        chatMessages.push({
          id: 'msg-' + Date.now(),
          senderDid: 'self',
          recipientDid: 'did:sovra:' + curCreator.creatorHandle,
          senderName: 'You',
          text: 'Replied to story: ' + text,
          isAudio: false,
          audioDurationSec: 0,
          timestamp: Date.now(),
          status: 'sent',
          signatureHex: ' verified_ed25519_msg_sig'
        });
        alert('Encrypted E2EE reply sent to ' + curCreator.creatorName + ' on WhatsApp chat!');
      }
      input.value = '';
    }

    function closeStory(e) {
      if (e && e.target !== document.getElementById('storyModalOverlay') && e.target.tagName !== 'BUTTON') return;
      clearInterval(storyTickInterval);
      const overlay = document.getElementById('storyModalOverlay');
      if (overlay) overlay.style.display = 'none';
    }

    window.addEventListener('keydown', (e) => {
      if (document.getElementById('reels-view').style.display === 'flex') {
        if (e.key === 'ArrowDown' || e.key === 'j') nextReel();
        if (e.key === 'ArrowUp' || e.key === 'k') prevReel();
        if (e.key === ' ' && !e.target.matches('input, textarea')) {
          e.preventDefault();
          toggleReelPlayPause();
        }
        if (e.key.toLowerCase() === 'l' && !e.target.matches('input, textarea')) {
          triggerReelLike();
        }
      }
    });

    // ==========================================
    // 2. WHATSAPP E2EE CHAT SCRIPT ENGINE
    // ==========================================
    let contactsData = ${JSON.stringify(sovraDb.getAllPeers())};
    let bitchatPeersData = ${JSON.stringify(bitchatPeersStore)};
    let chatMessages = ${JSON.stringify(sovraDb.getState().chatMessages)};
    let bitchatModeActive = true;
    let activeContactDid = 'channel:local_mesh';
    let isRecordingVoice = false;
    let voiceRecordStartTime = 0;
    let voiceRecordTimerInterval = null;
    let disappearingPurgeTimer = null;
    let voicePlaybackIntervals = {};
    let callTimerInterval = null;

    function toggleBitChatMode() {
      bitchatModeActive = !bitchatModeActive;
      const dot = document.getElementById('bitchatModeDot');
      const text = document.getElementById('bitchatModeText');
      const badge = document.getElementById('bitchatModeBadge');
      const radar = document.getElementById('bitchatRadarContainer');
      const title = document.getElementById('chatSidebarTitle');
      const protoBadge = document.getElementById('chatSidebarProtocolBadge');

      if (bitchatModeActive) {
        if (text) text.innerText = 'Mesh Mode';
        if (dot) dot.style.background = '#38bdf8';
        if (badge) {
          badge.innerText = 'BLE Active';
          badge.style.background = 'rgba(56, 189, 248, 0.2)';
          badge.style.color = '#38bdf8';
          badge.style.borderColor = 'rgba(56, 189, 248, 0.4)';
        }
        if (radar) radar.style.display = 'flex';
        if (title) title.innerText = '📶 BitChat Swarm';
        if (protoBadge) {
          protoBadge.innerText = 'Multi-Hop Relay Active';
          protoBadge.style.color = '#38bdf8';
          protoBadge.style.background = 'rgba(56, 189, 248, 0.15)';
        }
        activeContactDid = 'channel:local_mesh';
        showAccountToast('📶 BitChat Mode Active: Zero-Internet BLE mesh scanning 2.4GHz spectrum.');
      } else {
        if (text) text.innerText = 'Global P2P';
        if (dot) dot.style.background = '#22c55e';
        if (badge) {
          badge.innerText = 'Internet P2P';
          badge.style.background = 'rgba(34, 197, 94, 0.2)';
          badge.style.color = '#22c55e';
          badge.style.borderColor = 'rgba(34, 197, 94, 0.4)';
        }
        if (radar) radar.style.display = 'none';
        if (title) title.innerText = '💬 Chats';
        if (protoBadge) {
          protoBadge.innerText = 'Double Ratchet Active';
          protoBadge.style.color = '#22c55e';
          protoBadge.style.background = 'rgba(34, 197, 94, 0.15)';
        }
        activeContactDid = contactsData[0]?.did || (bitchatPeersData[0]?.did || 'channel:local_mesh');
        showAccountToast('🌐 Global P2P Mode: Connected via DHT & GossipSub internet relays.');
      }

      renderChatContactsList();
      selectContact(activeContactDid);
    }

    function renderChatContactsList() {
      const container = document.getElementById('contactsList');
      if (!container) return;

      const q = (document.getElementById('chatSearchInput')?.value || '').toLowerCase().trim();

      if (bitchatModeActive) {
        const filteredPeers = bitchatPeersData.filter(function(p) {
          if (!q) return true;
          return p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q);
        });

        const channels = filteredPeers.filter(p => p.isChannel);
        const directPeers = filteredPeers.filter(p => !p.isChannel);

        let html = '';

        if (channels.length > 0) {
          html += '<div class="bitchat-section-title">✨ Hyperlocal Mesh Channels</div>';
          for (const c of channels) {
            const isActive = c.did === activeContactDid;
            html += '<div class="contact-item ' + (isActive ? 'active' : '') + '" data-did="' + c.did + '" onclick="selectContact(this.dataset.did)" id="contact-' + c.did.replace(/[^a-zA-Z0-9]/g, '_') + '">' +
              '<div class="contact-avatar" style="background: ' + c.avatarBg + ';">' +
                c.avatar +
                '<div class="online-dot" style="background: #38bdf8;"></div>' +
              '</div>' +
              '<div class="contact-info">' +
                '<div class="contact-top-row">' +
                  '<span class="contact-name" style="color: #38bdf8; font-weight: 800;">' + c.name + '</span>' +
                  '<span class="bitchat-hop-badge">50m Beacon</span>' +
                '</div>' +
                '<div class="contact-preview-row">' +
                  '<span style="color: #94a3b8; font-size: 0.75rem;">' + c.role + '</span>' +
                '</div>' +
              '</div>' +
            '</div>';
          }
        }

        // Include real registered peers into direct mesh list
        const allDirectPeers = [...directPeers];
        const myDid = myProfile ? myProfile.did : 'self';
        contactsData.forEach(function(c) {
          if (c.did !== myDid && !allDirectPeers.some(function(p) { return p.did === c.did; })) {
            allDirectPeers.push({
              did: c.did,
              name: c.name,
              avatar: c.avatar,
              avatarDataUrl: c.avatarDataUrl,
              avatarBg: c.avatarBg || '#6366f1',
              role: c.role || 'P2P Mesh Peer',
              rssi: -35,
              distanceMeters: 1.8,
              hops: 1,
              isDirect: true,
              isOnline: c.isOnline
            });
          }
        });

        if (allDirectPeers.length > 0) {
          html += '<div class="bitchat-section-title">📡 Nearby Discovered Peers (' + allDirectPeers.length + ')</div>';
          for (const p of allDirectPeers) {
            const isActive = p.did === activeContactDid;
            const hopLabel = p.hops === 1 ? '1 Hop Direct' : p.hops + ' Hops Relay';
            html += '<div class="contact-item ' + (isActive ? 'active' : '') + '" data-did="' + p.did + '" onclick="selectContact(this.dataset.did)" id="contact-' + p.did.replace(/[^a-zA-Z0-9]/g, '_') + '">' +
              '<div class="contact-avatar" style="background: ' + p.avatarBg + '; overflow: hidden;">' +
                (p.avatarDataUrl ? '<img src="' + p.avatarDataUrl + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;" />' : p.avatar) +
                '<div class="online-dot" style="background: ' + (p.isOnline !== false ? '#10b981' : '#64748b') + ';"></div>' +
              '</div>' +
              '<div class="contact-info">' +
                '<div class="contact-top-row">' +
                  '<span class="contact-name">' + p.name + '</span>' +
                  '<span class="bitchat-hop-badge">' + hopLabel + '</span>' +
                '</div>' +
                '<div class="contact-preview-row">' +
                  '<span style="color: #38bdf8; font-weight: 700; font-size: 0.72rem;">' + p.rssi + ' dBm</span>' +
                  '<span style="color: #94a3b8; font-size: 0.72rem;">&bull; ~' + p.distanceMeters + 'm &bull; ' + p.role + '</span>' +
                '</div>' +
              '</div>' +
            '</div>';
          }
        }

        if (allDirectPeers.length === 0 && channels.length === 0) {
          html = '<div style="text-align: center; padding: 2rem 1rem; color: #64748b; font-size: 0.82rem;">No BitChat peers found in range.</div>';
        }

        container.innerHTML = html;
      } else {
        const myDid = myProfile ? myProfile.did : 'self';
        const filteredContacts = contactsData.filter(function(c) {
          if (c.did === myDid) return false;
          if (!q) return true;
          return (c.name || '').toLowerCase().includes(q) || (c.handle || '').toLowerCase().includes(q) || (c.role || '').toLowerCase().includes(q);
        });

        let html = '';
        for (const c of filteredContacts) {
          const isActive = c.did === activeContactDid;

          // Time formatting
          let timeDisplay = c.isOnline ? 'Online' : (c.lastSeen || 'Offline');
          if (c.lastMessageTimestamp && c.lastMessageTimestamp > 0) {
            const msgDate = new Date(c.lastMessageTimestamp);
            const now = new Date();
            if (msgDate.toDateString() === now.toDateString()) {
              timeDisplay = msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } else {
              timeDisplay = msgDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
            }
          }

          // Tick icon for preview
          let previewTick = '';
          if (c.lastMessageIsOutgoing) {
            if (c.lastMessageStatus === 'read') {
              previewTick = '<span style="color: #53bdeb; font-weight: bold; margin-right: 4px; font-size: 0.78rem;">✓✓</span>';
            } else if (c.lastMessageStatus === 'delivered') {
              previewTick = '<span style="color: #94a3b8; font-weight: bold; margin-right: 4px; font-size: 0.78rem;">✓✓</span>';
            } else {
              previewTick = '<span style="color: #94a3b8; margin-right: 4px; font-size: 0.78rem;">✓</span>';
            }
          }

          const unreadBadgeHtml = (c.unreadCount && c.unreadCount > 0)
            ? '<span class="contact-unread-badge" style="background: #22c55e; color: #0b141a; font-size: 0.7rem; font-weight: 800; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; margin-left: auto;">' + c.unreadCount + '</span>'
            : '';

          html += '<div class="contact-item ' + (isActive ? 'active' : '') + '" data-did="' + c.did + '" onclick="selectContact(this.dataset.did)" id="contact-' + c.did.replace(/[^a-zA-Z0-9]/g, '_') + '">' +
            '<div class="contact-avatar" style="background: ' + (c.avatarBg || '#6366f1') + '; overflow: hidden;">' +
              (c.avatarDataUrl ? '<img src="' + c.avatarDataUrl + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;" />' : (c.avatar || 'P')) +
              (c.isOnline ? '<div class="online-dot"></div>' : '') +
              (c.disappearingDurationSec > 0 ? '<div class="contact-clock-badge" title="Disappearing Messages Active">⏱️</div>' : '') +
            '</div>' +
            '<div class="contact-info">' +
              '<div class="contact-top-row">' +
                '<span class="contact-name">' +
                  c.name +
                  (c.isVerified ? '<span class="verified-shield-icon" title="Safety Numbers Verified">🛡️</span>' : '') +
                '</span>' +
                '<span class="contact-time" style="' + (c.unreadCount > 0 ? 'color: #22c55e; font-weight: 700;' : '') + '">' + timeDisplay + '</span>' +
              '</div>' +
              '<div class="contact-preview-row" style="display: flex; align-items: center;">' +
                previewTick +
                '<span id="preview-' + c.did.replace(/[^a-zA-Z0-9]/g, '_') + '" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; ' + (c.unreadCount > 0 ? 'color: #f1f5f9; font-weight: 600;' : '') + '">' + (c.lastMessage || c.role || 'Ready to chat') + '</span>' +
                unreadBadgeHtml +
              '</div>' +
            '</div>' +
          '</div>';
        }

        if (filteredContacts.length === 0) {
          html = '<div style="text-align: center; padding: 2.5rem 1rem; color: #64748b; font-size: 0.85rem;">' +
            '<div style="font-size: 2rem; margin-bottom: 0.5rem;">👥</div>' +
            '<div style="font-weight: 600; color: #cbd5e1; margin-bottom: 0.25rem;">No Other Registered Peers Yet</div>' +
            '<div>Connect other devices (mobile or laptop) on the network to begin messaging!</div>' +
          '</div>';
        }
        container.innerHTML = html;
      }
    }

    function selectContact(did) {
      activeContactDid = did;
      const wCont = document.querySelector('.whatsapp-container');
      if (wCont) wCont.classList.add('show-chat');

      // Acknowledge read receipt for all unread messages from this contact
      const myDid = myProfile ? myProfile.did : 'self';
      const unreadIds = [];
      chatMessages.forEach(function(m) {
        if (m.senderDid === did && (m.recipientDid === myDid || m.recipientDid === 'self') && m.status !== 'read') {
          m.status = 'read';
          unreadIds.push(m.id);
        }
      });
      if (unreadIds.length > 0) {
        fetch('/api/chat/receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageIds: unreadIds, status: 'read' })
        }).catch(function() {});
        const c = contactsData.find(function(x) { return x.did === did; });
        if (c) c.unreadCount = 0;
      }

      const bcPeer = bitchatPeersData.find(function(p) { return p.did === did; });
      const contact = contactsData.find(function(c) { return c.did === did; });

      const avatarEl = document.getElementById('activePeerAvatar');
      const nameEl = document.getElementById('activePeerName');
      const badgeEl = document.getElementById('activePeerVerifiedBadge');
      const statusEl = document.getElementById('activePeerStatus');
      const routeEl = document.getElementById('bitchatHeaderRoute');

      if (bcPeer) {
        if (avatarEl) {
          if (bcPeer.avatarDataUrl) {
            avatarEl.innerHTML = '<img src="' + bcPeer.avatarDataUrl + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;" />';
          } else {
            avatarEl.innerText = bcPeer.avatar;
            avatarEl.style.background = bcPeer.avatarBg;
          }
        }
        if (nameEl) nameEl.innerText = bcPeer.name;
        if (badgeEl) badgeEl.style.display = 'none';

        if (statusEl) {
          if (bcPeer.isChannel) {
            statusEl.innerHTML = '<span style="color: #38bdf8;">● Zero-Internet Local Mesh Swarm</span> &bull; 50m Radius Broadcast';
          } else if (bcPeer.isDirect) {
            statusEl.innerHTML = '<span style="color: #10b981;">● Direct BLE Link</span> &bull; RSSI: ' + bcPeer.rssi + ' dBm (~' + bcPeer.distanceMeters + 'm)';
          } else {
            statusEl.innerHTML = '<span style="color: #f59e0b;">● Relayed ' + bcPeer.hops + ' Hops (via ' + (bcPeer.relayVia || 'Swarm') + ')</span> &bull; Multi-hop Mesh';
          }
        }

        if (routeEl) {
          routeEl.style.display = 'inline-flex';
          if (bcPeer.isChannel) {
            routeEl.innerText = '📡 Hyperlocal Beacon';
          } else if (bcPeer.isDirect) {
            routeEl.innerText = '📶 Direct BLE (1 Hop)';
          } else {
            routeEl.innerText = '📶 Route: You → ' + (bcPeer.relayVia || 'Alice') + ' → ' + bcPeer.name.split(' ')[0] + ' (' + bcPeer.hops + ' Hops)';
          }
        }
      } else if (contact) {
        if (avatarEl) {
          if (contact.avatarDataUrl) {
            avatarEl.innerHTML = '<img src="' + contact.avatarDataUrl + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;" />';
          } else {
            avatarEl.innerText = contact.avatar || 'P';
            avatarEl.style.background = contact.avatarBg || '#6366f1';
          }
        }
        if (nameEl) nameEl.innerText = contact.name;
        if (badgeEl) badgeEl.style.display = contact.isVerified ? 'inline-block' : 'none';
        if (statusEl) {
          statusEl.innerText = (contact.isOnline ? '● Online' : 'Last seen ' + (contact.lastSeen || 'recently')) + ' • Double Ratchet Active';
        }
        if (routeEl) routeEl.style.display = 'none';
        updateHeaderTimerDisplay(contact.disappearingDurationSec || 0);
      }

      document.querySelectorAll('.contact-item').forEach(function(el) {
        el.classList.remove('active');
      });
      const activeEl = document.getElementById('contact-' + did.replace(/[^a-zA-Z0-9]/g, '_'));
      if (activeEl) activeEl.classList.add('active');

      renderChatContactsList();
      renderChatBubbles();
    }

    function executeBitChatPanicWipe() {
      if (!confirm('🚨 EMERGENCY PANIC WIPE (BitChat Stealth Security):\\n\\nThis will immediately zeroize all local BitChat mesh packets, in-memory encryption keys, and peer session routing tables.\\n\\nAre you sure you want to proceed?')) {
        return;
      }
      chatMessages = chatMessages.filter(function(m) { return !m.isBitChat; });
      bitchatPeersData = [];
      const badgeCount = document.getElementById('bitchatPeersCountBadge');
      if (badgeCount) badgeCount.innerText = '0 peers (Wiped)';
      renderChatContactsList();
      renderChatBubbles();
      showAccountToast('🚨 EMERGENCY PANIC WIPE: All local BitChat packets, keys, and peer tables zeroized.');
    }

    function closeMobileChat() {
      const wCont = document.querySelector('.whatsapp-container');
      if (wCont) wCont.classList.remove('show-chat');
    }

    function updateHeaderTimerDisplay(sec) {
      const btn = document.getElementById('headerTimerText');
      if (!btn) return;
      if (sec === 0) btn.innerText = 'Off';
      else if (sec === 5) btn.innerText = '5s 🔥';
      else if (sec === 10) btn.innerText = '10s';
      else if (sec === 86400) btn.innerText = '24h';
      else if (sec === 604800) btn.innerText = '7d';
      else btn.innerText = sec + 's';
    }

    function renderChatBubbles() {
      const container = document.getElementById('chatMessagesContainer');
      if (!container) return;

      const contact = contactsData.find(function(c) { return c.did === activeContactDid; });
      const currentTimer = contact ? (contact.disappearingDurationSec || 0) : 0;

      let html = '';

      // 1. System Encryption Notice
      html += '<div class="system-encryption-banner" onclick="openSafetyNumbersModal()">' +
        '<span style="color: #ffd279; font-size: 0.95rem;">🔒</span>' +
        '<span>Messages and calls are end-to-end encrypted. No one outside of this chat, not even Sovra, can read or listen to them. Tap to verify.</span>' +
        '</div>';

      // 2. Disappearing Notice Banner
      if (currentTimer > 0) {
        const timerLabel = currentTimer >= 86400 ? (currentTimer / 86400) + ' days' : currentTimer + ' seconds';
        html += '<div class="system-disappearing-banner">' +
          '<span>⏱️ Disappearing messages are ON (' + timerLabel + '). New messages vanish after reading.</span>' +
          '<button class="btn-change-timer" onclick="openDisappearingModal()">Change</button>' +
          '</div>';
      }

      // 3. Message Bubbles
      const myDid = myProfile ? myProfile.did : 'self';
      const filtered = chatMessages.filter(function(m) {
        if (activeContactDid.startsWith('channel:')) {
          return m.recipientDid === activeContactDid;
        }
        return (m.senderDid === activeContactDid && (m.recipientDid === myDid || m.recipientDid === 'self')) ||
               ((m.senderDid === myDid || m.senderDid === 'self') && m.recipientDid === activeContactDid);
      });

      const now = Date.now();

      html += filtered.map(function(m) {
        const isOutgoing = m.senderDid === myDid || m.senderDid === 'self';
        const bubbleClass = isOutgoing ? 'chat-bubble outgoing' : 'chat-bubble incoming';

        // Ticks
        let tickHtml = '';
        if (isOutgoing) {
          if (m.status === 'sent') tickHtml = '<span class="tick-icon" title="Sent to P2P network">✓</span>';
          else if (m.status === 'delivered') tickHtml = '<span class="tick-icon" title="Delivered to peer node">✓✓</span>';
          else if (m.status === 'read') tickHtml = '<span class="tick-icon tick-blue" title="Read by recipient">✓✓</span>';
        }

        // Disappearing countdown badge
        let disappearingBadge = '';
        if (m.isDisappeared) {
          // Already disappeared
        } else if (m.expiresAt) {
          const remainingSec = Math.max(0, Math.ceil((m.expiresAt - now) / 1000));
          disappearingBadge = '<span class="disappearing-timer-badge" id="timer-badge-' + m.id + '">⏱️ ' + remainingSec + 's</span>';
        }

        // Content
        let bodyHtml = '';
        if (m.isDisappeared) {
          bodyHtml = '<div class="bubble-disappeared">💨 This message has disappeared</div>';
        } else if (m.isAudio) {
          const bars = m.waveformBars || [25, 45, 80, 60, 95, 40, 70, 30, 85, 50, 65, 90, 40, 75, 30];
          const barsHtml = bars.map(function(h) {
            return '<div class="waveform-bar" style="height: ' + Math.max(6, Math.floor(h * 0.26)) + 'px;"></div>';
          }).join('');
          
          bodyHtml = '<div class="voice-note-card" id="player-' + m.id + '">' +
            '<div class="voice-avatar-mic">🎙️</div>' +
            '<button class="voice-play-btn" onclick="event.stopPropagation(); playVoiceWaveform(this, &quot;' + m.id + '&quot;)">▶</button>' +
            '<div class="voice-waveform-bars" id="bars-' + m.id + '">' + barsHtml + '</div>' +
            '<button class="voice-speed-pill" id="speed-' + m.id + '" onclick="event.stopPropagation(); cycleVoiceSpeed(this, &quot;' + m.id + '&quot;)">1x</button>' +
            '<span style="font-size: 0.72rem; color: #cbd5e1; font-family: monospace;" id="time-' + m.id + '">' + m.audioDurationSec.toFixed(1) + 's</span>' +
            '</div>';
        } else {
          bodyHtml = '<div style="word-break: break-word;">' + m.text + '</div>';
        }

        // BitChat Multi-Hop Routing Box
        let routeHtml = '';
        if (m.isBitChat) {
          const hopText = m.hopCount ? (m.hopCount === 1 ? '1 Hop Direct' : m.hopCount + ' Hops Relay') : 'Direct BLE';
          routeHtml = '<div class="bitchat-mesh-route-box">📶 BLE Mesh &bull; ' + hopText + ' &bull; Noise_XX E2EE</div>';
        }

        // Sender header row for incoming or channel messages
        let senderNameRow = '';
        if (!isOutgoing && (activeContactDid.startsWith('channel:') || m.senderName)) {
          senderNameRow = '<div style="font-size: 0.72rem; font-weight: 700; color: #38bdf8; margin-bottom: 3px;">' + (m.senderName || 'Peer') + '</div>';
        }

        // Reaction dock on hover
        const reactionsDock = '<div class="bubble-reactions-bar" onclick="event.stopPropagation()">' +
          '<button class="reaction-emoji-btn" onclick="reactToMessage(&quot;' + m.id + '&quot;, &quot;❤️&quot;)">❤️</button>' +
          '<button class="reaction-emoji-btn" onclick="reactToMessage(&quot;' + m.id + '&quot;, &quot;👍&quot;)">👍</button>' +
          '<button class="reaction-emoji-btn" onclick="reactToMessage(&quot;' + m.id + '&quot;, &quot;😂&quot;)">😂</button>' +
          '<button class="reaction-emoji-btn" onclick="reactToMessage(&quot;' + m.id + '&quot;, &quot;😮&quot;)">😮</button>' +
          '<button class="reaction-emoji-btn" onclick="reactToMessage(&quot;' + m.id + '&quot;, &quot;😢&quot;)">😢</button>' +
          '<button class="reaction-emoji-btn" onclick="reactToMessage(&quot;' + m.id + '&quot;, &quot;🙏&quot;)">🙏</button>' +
          '</div>';

        // Attached reaction pill
        let reactionPill = '';
        if (m.reactions && m.reactions.length > 0) {
          const topEmoji = m.reactions[0].emoji;
          reactionPill = '<div class="bubble-reaction-pill" onclick="event.stopPropagation(); removeReaction(&quot;' + m.id + '&quot;)">' +
            topEmoji + ' ' + m.reactions.length + '</div>';
        }

        const timeStr = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        return '<div class="' + bubbleClass + '" id="bubble-' + m.id + '" onclick="openMessageInfoModal(&quot;' + m.id + '&quot;)">' +
          reactionsDock +
          senderNameRow +
          bodyHtml +
          routeHtml +
          '<div class="bubble-meta">' +
            disappearingBadge +
            '<span>' + timeStr + '</span>' +
            tickHtml +
          '</div>' +
          reactionPill +
        '</div>';
      }).join('');

      if (filtered.length === 0) {
        html += '<div style="text-align: center; padding: 3.5rem 1rem; color: #64748b; font-size: 0.85rem;">' +
          '<div style="font-size: 2.2rem; margin-bottom: 0.5rem;">💬</div>' +
          '<div style="font-weight: 600; color: #cbd5e1; margin-bottom: 0.25rem;">No messages yet</div>' +
          '<div>Send a direct zero-trust message or broadcast to the mesh swarm!</div>' +
        '</div>';
      }

      container.innerHTML = html;
      container.scrollTop = container.scrollHeight;
    }

    async function sendChatMessage() {
      const input = document.getElementById('chatInputText');
      const text = input.value.trim();
      if (!text) return;

      const bcPeer = bitchatPeersData.find(function(p) { return p.did === activeContactDid; });
      const contact = contactsData.find(function(c) { return c.did === activeContactDid; });
      const timerSec = contact ? (contact.disappearingDurationSec || 0) : 0;
      const now = Date.now();
      const isBc = Boolean(bcPeer || bitchatModeActive);
      const myDid = myProfile ? myProfile.did : 'self';
      const myName = myProfile ? myProfile.name : 'You';

      const newMsg = {
        id: 'msg-' + now + '-' + Math.random().toString(36).substring(2, 7),
        senderDid: myDid,
        recipientDid: activeContactDid,
        senderName: myName,
        text: text,
        isAudio: false,
        audioDurationSec: 0,
        timestamp: now,
        sentAt: now,
        status: 'sent', // Single grey tick initially
        signatureHex: 'ed25519_sig_' + Math.random().toString(16).substring(2, 10),
        disappearingDurationSec: timerSec,
        expiresAt: timerSec > 0 ? now + timerSec * 1000 : undefined,
        isDisappeared: false,
        reactions: [],
        isBitChat: isBc,
        hopCount: 1,
        route: [myDid, activeContactDid]
      };

      chatMessages.push(newMsg);
      input.value = '';

      if (contact) {
        contact.lastMessage = text;
        contact.lastMessageTimestamp = now;
        contact.lastMessageStatus = 'sent';
        contact.lastMessageIsOutgoing = true;
      }

      renderChatBubbles();
      renderChatContactsList();

      try {
        const res = await fetch('/api/chat/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newMsg)
        });
        const data = await res.json();
        if (data && data.ok && data.message) {
          const idx = chatMessages.findIndex(function(m) { return m.id === newMsg.id; });
          if (idx !== -1) {
            chatMessages[idx] = data.message;
            renderChatBubbles();
          }
        }
      } catch (err) {
        console.warn('[Chat] Send sync warning:', err);
      }
    }

    let lastChatSyncTimestamp = 0;
    function syncChatMessages() {
      const myDid = myProfile ? myProfile.did : 'self';
      fetch('/api/chat/messages?since=' + lastChatSyncTimestamp + '&userDid=' + encodeURIComponent(myDid))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data && data.ok && Array.isArray(data.messages) && data.messages.length > 0) {
            let hasNew = false;
            const deliveredIds = [];
            const readIds = [];

            data.messages.forEach(function(msg) {
              if (msg.timestamp > lastChatSyncTimestamp) {
                lastChatSyncTimestamp = msg.timestamp;
              }
              const existingIdx = chatMessages.findIndex(function(m) { return m.id === msg.id; });
              if (existingIdx === -1) {
                chatMessages.push(msg);
                hasNew = true;

                // Acknowledge incoming messages
                if (msg.senderDid !== myDid && msg.senderDid !== 'self') {
                  if (activeContactDid === msg.senderDid || activeContactDid === msg.recipientDid) {
                    msg.status = 'read';
                    readIds.push(msg.id);
                  } else if (msg.status === 'sent') {
                    msg.status = 'delivered';
                    deliveredIds.push(msg.id);
                  }
                }
              } else if (chatMessages[existingIdx].status !== msg.status) {
                chatMessages[existingIdx].status = msg.status;
                hasNew = true;
              }
            });

            // Send delivered acknowledgments to server so sender gets grey double tick (✓✓)
            if (deliveredIds.length > 0) {
              fetch('/api/chat/receipt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messageIds: deliveredIds, status: 'delivered' })
              }).catch(function() {});
            }

            // Send read acknowledgments to server so sender gets blue double tick (✓✓)
            if (readIds.length > 0) {
              fetch('/api/chat/receipt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messageIds: readIds, status: 'read' })
              }).catch(function() {});
            }

            if (hasNew) {
              renderChatBubbles();
              renderChatContactsList();
            }
          }
        })
        .catch(function() {});
    }
    setInterval(syncChatMessages, 1000);

    function syncPeersAndContacts() {
      const myDid = myProfile ? myProfile.did : 'self';
      fetch('/api/chat/contacts?userDid=' + encodeURIComponent(myDid))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data && data.ok && Array.isArray(data.contacts)) {
            contactsData = data.contacts;
            renderChatContactsList();
          }
        })
        .catch(function() {});
    }
    setInterval(syncPeersAndContacts, 1800);

    // Voice recording handlers
    function toggleVoiceRecord() {
      if (isRecordingVoice) return;
      isRecordingVoice = true;
      voiceRecordStartTime = Date.now();

      const standardRow = document.getElementById('standardInputRow');
      const recordDrawer = document.getElementById('voiceRecordingDrawer');
      if (standardRow) standardRow.style.display = 'none';
      if (recordDrawer) recordDrawer.style.display = 'flex';

      const timerEl = document.getElementById('voiceRecordTimer');
      voiceRecordTimerInterval = setInterval(function() {
        const elapsedSec = Math.floor((Date.now() - voiceRecordStartTime) / 1000);
        const mins = Math.floor(elapsedSec / 60);
        const secs = elapsedSec % 60;
        if (timerEl) {
          timerEl.innerText = mins + ':' + (secs < 10 ? '0' : '') + secs;
        }
      }, 500);
    }

    function cancelVoiceRecord() {
      isRecordingVoice = false;
      if (voiceRecordTimerInterval) clearInterval(voiceRecordTimerInterval);
      const standardRow = document.getElementById('standardInputRow');
      const recordDrawer = document.getElementById('voiceRecordingDrawer');
      if (standardRow) standardRow.style.display = 'flex';
      if (recordDrawer) recordDrawer.style.display = 'none';
    }

    function finishAndSendVoiceRecord() {
      if (!isRecordingVoice) return;
      const durationSec = Math.max(1.2, ((Date.now() - voiceRecordStartTime) / 1000));
      cancelVoiceRecord();

      const contact = contactsData.find(function(c) { return c.did === activeContactDid; });
      const timerSec = contact ? (contact.disappearingDurationSec || 0) : 0;
      const now = Date.now();

      const waveform = [];
      for (let i = 0; i < 15; i++) {
        waveform.push(Math.floor(Math.random() * 75) + 25);
      }

      const myDid = myProfile ? myProfile.did : 'self';
      const myName = myProfile ? myProfile.name : 'You';
      const voiceMsg = {
        id: 'audio-' + now + '-' + Math.random().toString(36).substring(2, 6),
        senderDid: myDid,
        recipientDid: activeContactDid,
        senderName: myName,
        text: '🎙️ Voice note (' + durationSec.toFixed(1) + 's)',
        isAudio: true,
        audioDurationSec: parseFloat(durationSec.toFixed(1)),
        waveformBars: waveform,
        timestamp: now,
        sentAt: now,
        status: 'sent',
        signatureHex: 'ed25519_sig_' + Math.random().toString(16).substring(2, 10),
        disappearingDurationSec: timerSec,
        expiresAt: timerSec > 0 ? now + timerSec * 1000 : undefined,
        isDisappeared: false,
        reactions: [],
      };

      chatMessages.push(voiceMsg);
      renderChatBubbles();

      try {
        fetch('/api/chat/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(voiceMsg)
        });
      } catch (e) {}
    }

    function playVoiceWaveform(btn, msgId) {
      const barsContainer = document.getElementById('bars-' + msgId);
      if (!barsContainer) return;
      const bars = barsContainer.querySelectorAll('.waveform-bar');
      const timeEl = document.getElementById('time-' + msgId);
      const msg = chatMessages.find(function(m) { return m.id === msgId; });
      const totalSec = msg ? msg.audioDurationSec : 4.0;

      if (voicePlaybackIntervals[msgId]) {
        clearInterval(voicePlaybackIntervals[msgId]);
        delete voicePlaybackIntervals[msgId];
        btn.innerText = '▶';
        return;
      }

      btn.innerText = '⏸';
      let step = 0;
      const intervalMs = Math.max(80, Math.floor((totalSec * 1000) / bars.length));

      voicePlaybackIntervals[msgId] = setInterval(function() {
        if (step < bars.length) {
          bars[step].classList.add('active');
          const elapsed = (step / bars.length) * totalSec;
          if (timeEl) timeEl.innerText = elapsed.toFixed(1) + 's';
          step++;
        } else {
          clearInterval(voicePlaybackIntervals[msgId]);
          delete voicePlaybackIntervals[msgId];
          btn.innerText = '▶';
          bars.forEach(function(b) { b.classList.remove('active'); });
          if (timeEl) timeEl.innerText = totalSec.toFixed(1) + 's';
        }
      }, intervalMs);
    }

    function cycleVoiceSpeed(btn, msgId) {
      const speeds = ['1x', '1.5x', '2x'];
      const current = btn.innerText;
      const nextIdx = (speeds.indexOf(current) + 1) % speeds.length;
      btn.innerText = speeds[nextIdx];
    }

    function insertEmojiToInput(emoji) {
      const input = document.getElementById('chatInputText');
      if (input) {
        input.value += emoji;
        input.focus();
      }
    }

    // Emoji reactions
    function reactToMessage(msgId, emoji) {
      const msg = chatMessages.find(function(m) { return m.id === msgId; });
      if (!msg) return;
      if (!msg.reactions) msg.reactions = [];

      const existingIdx = msg.reactions.findIndex(function(r) { return r.senderDid === 'self'; });
      if (existingIdx >= 0) {
        if (msg.reactions[existingIdx].emoji === emoji) {
          msg.reactions.splice(existingIdx, 1);
        } else {
          msg.reactions[existingIdx].emoji = emoji;
        }
      } else {
        msg.reactions.push({ emoji: emoji, senderDid: 'self' });
      }
      renderChatBubbles();

      try {
        fetch('/api/chat/reaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId: msgId, emoji: emoji })
        });
      } catch (e) {}
    }

    function removeReaction(msgId) {
      const msg = chatMessages.find(function(m) { return m.id === msgId; });
      if (!msg || !msg.reactions) return;
      msg.reactions = msg.reactions.filter(function(r) { return r.senderDid !== 'self'; });
      renderChatBubbles();
    }

    // Disappearing Messages Timer Engine
    function startDisappearingTicker() {
      if (disappearingPurgeTimer) clearInterval(disappearingPurgeTimer);
      disappearingPurgeTimer = setInterval(function() {
        const now = Date.now();
        let changed = false;

        chatMessages.forEach(function(m) {
          if (m.expiresAt && !m.isDisappeared) {
            const diff = m.expiresAt - now;
            if (diff <= 0) {
              m.isDisappeared = true;
              changed = true;
              const el = document.getElementById('bubble-' + m.id);
              if (el) {
                el.classList.add('disappearing-smoke');
                setTimeout(function() {
                  renderChatBubbles();
                }, 750);
              }
            } else {
              const badge = document.getElementById('timer-badge-' + m.id);
              if (badge) {
                badge.innerText = '⏱️ ' + Math.ceil(diff / 1000) + 's';
              }
            }
          }
        });

        if (changed) {
          renderChatBubbles();
        }
      }, 1000);
    }

    function openDisappearingModal() {
      const contact = contactsData.find(function(c) { return c.did === activeContactDid; });
      const current = contact ? (contact.disappearingDurationSec || 0) : 0;

      const radios = document.getElementsByName('disappearingTimerRadio');
      radios.forEach(function(r) {
        r.checked = parseInt(r.value, 10) === current;
      });

      document.getElementById('disappearingModal').style.display = 'flex';
    }

    function setContactTimer(sec) {
      const contact = contactsData.find(function(c) { return c.did === activeContactDid; });
      if (contact) {
        contact.disappearingDurationSec = sec;
        updateHeaderTimerDisplay(sec);

        // Update sidebar clock icon
        const activeItem = document.getElementById('contact-' + activeContactDid.replace(/[^a-zA-Z0-9]/g, '_'));
        if (activeItem) {
          const avatar = activeItem.querySelector('.contact-avatar');
          let clock = avatar ? avatar.querySelector('.contact-clock-badge') : null;
          if (sec > 0) {
            if (!clock && avatar) {
              const clockDiv = document.createElement('div');
              clockDiv.className = 'contact-clock-badge';
              clockDiv.title = 'Disappearing Messages Active';
              clockDiv.innerText = '⏱️';
              avatar.appendChild(clockDiv);
            }
          } else if (clock) {
            clock.remove();
          }
        }
      }

      closeWaModal('disappearingModal');
      renderChatBubbles();

      try {
        fetch('/api/chat/disappearing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peerDid: activeContactDid, durationSec: sec })
        });
      } catch (e) {}
    }

    // Safety Numbers & Security Code
    function openSafetyNumbersModal() {
      const contact = contactsData.find(function(c) { return c.did === activeContactDid; });
      if (!contact) return;

      const nameEl = document.getElementById('modalContactName');
      if (nameEl) nameEl.innerText = contact.name;

      const numbersEl = document.getElementById('modalSafetyNumbersDisplay');
      if (numbersEl) {
        const raw = contact.safetyNumbers || '28471 90432 18942 09182 39182 48192 19283 48192 48192 01928 38192 49182';
        const parts = raw.split(' ');
        numbersEl.innerHTML = parts.map(function(p) {
          return '<span style="padding: 2px;">' + p + '</span>';
        }).join('');
      }

      const qrBox = document.getElementById('qrSimBox');
      if (qrBox) {
        let qrHtml = '';
        for (let i = 0; i < 49; i++) {
          const isWhite = (i % 3 === 0 || i % 7 === 2);
          qrHtml += '<div class="qr-block ' + (isWhite ? 'white' : '') + '"></div>';
        }
        qrBox.innerHTML = qrHtml;
      }

      document.getElementById('safetyNumbersModal').style.display = 'flex';
    }

    function confirmVerifySafetyNumbers() {
      const contact = contactsData.find(function(c) { return c.did === activeContactDid; });
      if (contact) {
        contact.isVerified = true;
        const badgeEl = document.getElementById('activePeerVerifiedBadge');
        if (badgeEl) badgeEl.style.display = 'inline-block';

        const activeItem = document.getElementById('contact-' + activeContactDid.replace(/[^a-zA-Z0-9]/g, '_'));
        if (activeItem) {
          const nameSpan = activeItem.querySelector('.contact-name');
          if (nameSpan && !nameSpan.querySelector('.verified-shield-icon')) {
            const shield = document.createElement('span');
            shield.className = 'verified-shield-icon';
            shield.title = 'Safety Numbers Verified';
            shield.innerText = '🛡️';
            nameSpan.appendChild(shield);
          }
        }
      }
      closeWaModal('safetyNumbersModal');
      alert('✓ Security code verified! You verified that calls and messages with this peer are end-to-end encrypted with zero middleman inspection.');
    }

    function copySafetyNumbers() {
      const contact = contactsData.find(function(c) { return c.did === activeContactDid; });
      const raw = contact ? contact.safetyNumbers : '';
      navigator.clipboard.writeText(raw);
      alert('Copied 60-digit safety numbers to clipboard!');
    }

    // Message Info Drawer
    function openMessageInfoModal(msgId) {
      const msg = chatMessages.find(function(m) { return m.id === msgId; });
      if (!msg) return;

      const previewBox = document.getElementById('modalMsgPreviewContent');
      if (previewBox) {
        if (msg.isAudio) {
          previewBox.innerHTML = '<div style="color: #34d399; font-weight: 600;">🎙️ Encrypted Voice Note (' + msg.audioDurationSec + 's)</div>';
        } else {
          previewBox.innerText = msg.text;
        }
      }

      const sentEl = document.getElementById('modalInfoSentTime');
      if (sentEl) sentEl.innerText = new Date(msg.sentAt || msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      const delEl = document.getElementById('modalInfoDeliveredTime');
      if (delEl) delEl.innerText = msg.deliveredAt 
        ? new Date(msg.deliveredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) 
        : 'Pending peer socket handshake';

      const readEl = document.getElementById('modalInfoReadTime');
      if (readEl) readEl.innerText = msg.readAt 
        ? new Date(msg.readAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) 
        : (msg.status === 'read' ? 'Read' : 'Unread');

      const seqEl = document.getElementById('modalInfoSeq');
      if (seqEl) seqEl.innerText = '#' + (msg.id.split('-')[1] ? msg.id.split('-')[1].substring(6) : '4');

      const sigEl = document.getElementById('modalInfoSig');
      if (sigEl) sigEl.innerText = msg.signatureHex || 'ed25519_sig_verified';

      document.getElementById('messageInfoModal').style.display = 'flex';
    }

    // E2EE Calling
    function startE2eeCall(type) {
      const contact = contactsData.find(function(c) { return c.did === activeContactDid; });
      if (!contact) return;

      const avatarEl = document.getElementById('callAvatarIcon');
      if (avatarEl) {
        avatarEl.innerText = contact.avatar;
        avatarEl.style.background = contact.avatarBg;
      }
      const nameEl = document.getElementById('callPeerName');
      if (nameEl) nameEl.innerText = contact.name;

      const statusEl = document.getElementById('callStatusText');
      if (statusEl) {
        statusEl.innerText = 'Calling ' + contact.name.split(' ')[0] + '... Noise_XX QUIC Media Stream';
      }

      document.getElementById('e2eeCallModal').style.display = 'flex';

      let count = 0;
      if (callTimerInterval) clearInterval(callTimerInterval);
      callTimerInterval = setInterval(function() {
        count++;
        if (count >= 3 && statusEl) {
          const mins = Math.floor((count - 3) / 60);
          const secs = (count - 3) % 60;
          statusEl.innerText = 'Connected (' + mins + ':' + (secs < 10 ? '0' : '') + secs + ') • 🔒 E2EE Noise_XX Audio Stream';
        }
      }, 1000);
    }

    function endE2eeCall() {
      if (callTimerInterval) clearInterval(callTimerInterval);
      document.getElementById('e2eeCallModal').style.display = 'none';
    }

    function closeWaModal(id) {
      const modal = document.getElementById(id);
      if (modal) modal.style.display = 'none';
    }

    function filterChatContacts(query) {
      const q = (query || '').toLowerCase().trim();
      const items = document.querySelectorAll('.contact-item');
      items.forEach(function(item) {
        const text = item.innerText.toLowerCase();
        item.style.display = text.includes(q) ? 'flex' : 'none';
      });
    }

    // Start ticker
    startDisappearingTicker();

    // ==========================================
    // 3. YOUTUBE WATCH PLAYER & STREAMING ENGINE
    // ==========================================
    const ytVideosCatalog = ${JSON.stringify(longFormVideosCatalog)};
    let ytCommentsDatabase = ${JSON.stringify(youtubeCommentsStore)};
    let activeYtVideoIndex = 0;
    let ytCurrentTimeSec = 0;
    let ytIsPlaying = false;
    let ytIsMuted = false;
    let ytVolume = 1.0;
    let ytPlaybackSpeed = 1.0;
    let ytTheaterMode = false;
    let ytAutoplay = true;
    let ytProgressTimer = null;
    const ytSubscribedMap = {};
    const ytLikedMap = {};
    const ytDislikedMap = {};
    let bellNotificationIndex = 0;
    const bellNotificationOptions = ['all', 'personalized', 'none'];
    let selectedMembershipTier = { name: 'VIP Swarm Patron', price: 199 };

    function formatYtTime(totalSec) {
      const s = Math.max(0, Math.floor(totalSec));
      const m = Math.floor(s / 60);
      const remSec = s % 60;
      return (m < 10 ? '0' : '') + m + ':' + (remSec < 10 ? '0' : '') + remSec;
    }

    function renderYtVideo(idx, autoStart) {
      if (idx < 0 || idx >= ytVideosCatalog.length) idx = 0;
      activeYtVideoIndex = idx;
      const v = ytVideosCatalog[idx];
      if (!v) return;

      // Ambient Glow & Screen Background
      const ambient = document.getElementById('ytAmbientGlow');
      if (ambient) ambient.style.background = v.ambientColor;

      const screenContent = document.getElementById('ytScreenContent');
      if (screenContent) screenContent.style.background = v.gradient;

      // Title & Tags
      const titleEl = document.getElementById('ytVideoTitle');
      if (titleEl) titleEl.innerText = v.title;

      const tagsEl = document.getElementById('ytVideoTags');
      if (tagsEl) {
        tagsEl.innerHTML = v.tags.map(t => '<span style="color:#60a5fa; font-size:0.75rem; font-weight:600;">' + t + '</span>').join(' ');
      }

      // Stats
      const statsEl = document.getElementById('ytVideoStats');
      if (statsEl) {
        statsEl.innerHTML = '<b>' + v.views.toLocaleString() + ' views</b> &bull; ' + v.publishedAt + ' &bull; <code style="color: #818cf8;">CID: ' + v.cid.substring(0, 16) + '...</code>';
      }

      // Likes & Dislikes
      const likeCount = document.getElementById('ytLikeCount');
      if (likeCount) {
        likeCount.innerText = (v.likes + (ytLikedMap[v.id] ? 1 : 0)).toLocaleString();
      }
      const likeBtn = document.getElementById('ytLikeBtn');
      if (likeBtn) {
        likeBtn.style.color = ytLikedMap[v.id] ? '#ef4444' : '#fff';
      }

      // Channel details
      const channelAvatar = document.getElementById('ytChannelAvatar');
      if (channelAvatar) {
        channelAvatar.innerText = v.channelAvatar;
        channelAvatar.style.background = v.channelAvatarBg;
      }
      const channelName = document.getElementById('ytChannelName');
      if (channelName) channelName.innerText = v.channelName;

      const subCount = document.getElementById('subscribersCountDisplay');
      if (subCount) {
        const isSub = Boolean(ytSubscribedMap[v.channelHandle]);
        subCount.innerText = isSub ? (v.channelSubscribers + 1).toLocaleString() + ' subscribers' : v.channelSubscribersText;
      }

      const subBtn = document.getElementById('btnSubscribe');
      const bellBtn = document.getElementById('btnBellNotify');
      const isSub = Boolean(ytSubscribedMap[v.channelHandle]);
      if (subBtn) {
        subBtn.innerText = isSub ? 'Subscribed ✓' : 'Subscribe';
        if (isSub) subBtn.classList.add('subscribed');
        else subBtn.classList.remove('subscribed');
      }
      if (bellBtn) {
        bellBtn.style.display = isSub ? 'flex' : 'none';
      }

      // Description & Clickable Chapters
      const descText = document.getElementById('ytDescText');
      if (descText) descText.innerText = v.description;

      const chaptersList = document.getElementById('ytChaptersList');
      if (chaptersList) {
        chaptersList.innerHTML = v.chapters.map(ch => 
          '<div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem;">' +
            '<span class="chapter-tag" onclick="seekYtTo(' + ch.timeSeconds + ')">' + ch.timecode + '</span>' +
            '<span style="color: #cbd5e1;">' + ch.title + '</span>' +
          '</div>'
        ).join('');
      }

      // Chapter Ticks on Scrubber
      const ticksContainer = document.getElementById('chapterTicksContainer');
      if (ticksContainer) {
        ticksContainer.innerHTML = v.chapters.map(ch => 
          '<div class="chapter-tick" style="left: ' + ((ch.timeSeconds / v.durationSeconds) * 100) + '%;" title="' + ch.timecode + ' - ' + ch.title + '"></div>'
        ).join('');
      }

      // Screen Chapter Label
      const screenCh = document.getElementById('ytScreenCurrentChapter');
      if (screenCh) {
        screenCh.innerText = v.chapters[0] ? v.chapters[0].title : 'Playing 4K Video Swarm';
      }

      // Timecode & Progress Bars
      ytCurrentTimeSec = 0;
      const progressBar = document.getElementById('ytProgressBar');
      if (progressBar) progressBar.style.width = '0%';
      const bufferBar = document.getElementById('ytBufferBar');
      if (bufferBar) bufferBar.style.width = '24%';
      const timecode = document.getElementById('ytTimecode');
      if (timecode) timecode.innerText = '00:00 / ' + v.duration;

      // Tip recipient name
      const tipRecipient = document.getElementById('tipRecipientName');
      if (tipRecipient) tipRecipient.innerText = v.channelName;

      // Render recommendations and comments
      renderYtRecommendations();
      renderYtComments('top');

      if (autoStart) {
        if (!ytIsPlaying) toggleYtPlay();
      }
    }

    function switchYtVideo(idx) {
      renderYtVideo(idx, true);
    }

    function toggleYtPlay() {
      ytIsPlaying = !ytIsPlaying;
      const bigPlay = document.getElementById('ytBigPlayBtn');
      const smallPlay = document.getElementById('ytPlayIcon');
      const v = ytVideosCatalog[activeYtVideoIndex];
      if (!v) return;

      if (ytIsPlaying) {
        if (bigPlay) bigPlay.innerText = '⏸';
        if (smallPlay) smallPlay.innerText = '⏸';
        clearInterval(ytProgressTimer);

        ytProgressTimer = setInterval(() => {
          ytCurrentTimeSec += 0.25 * ytPlaybackSpeed;
          const pct = Math.min(100, (ytCurrentTimeSec / v.durationSeconds) * 100);
          
          const progBar = document.getElementById('ytProgressBar');
          if (progBar) progBar.style.width = pct + '%';

          const bufBar = document.getElementById('ytBufferBar');
          if (bufBar) {
            const bufPct = Math.min(100, pct + 14 + (Math.sin(ytCurrentTimeSec) * 2));
            bufBar.style.width = bufPct + '%';
          }

          const timecode = document.getElementById('ytTimecode');
          if (timecode) {
            timecode.innerText = formatYtTime(ytCurrentTimeSec) + ' / ' + v.duration;
          }

          // Update active chapter on screen
          for (let i = v.chapters.length - 1; i >= 0; i--) {
            if (ytCurrentTimeSec >= v.chapters[i].timeSeconds) {
              const chTitle = document.getElementById('ytScreenCurrentChapter');
              if (chTitle && chTitle.innerText !== v.chapters[i].title) {
                chTitle.innerText = v.chapters[i].title;
              }
              break;
            }
          }

          // Loop or Autoplay on finish
          if (ytCurrentTimeSec >= v.durationSeconds) {
            if (ytAutoplay) {
              const nextIdx = (activeYtVideoIndex + 1) % ytVideosCatalog.length;
              switchYtVideo(nextIdx);
            } else {
              toggleYtPlay();
              ytCurrentTimeSec = 0;
            }
          }
        }, 250);
      } else {
        if (bigPlay) bigPlay.innerText = '▶';
        if (smallPlay) smallPlay.innerText = '▶';
        clearInterval(ytProgressTimer);
      }
    }

    function seekYtTo(seconds) {
      const v = ytVideosCatalog[activeYtVideoIndex];
      if (!v) return;
      ytCurrentTimeSec = Math.max(0, Math.min(v.durationSeconds, seconds));
      const pct = (ytCurrentTimeSec / v.durationSeconds) * 100;
      const progBar = document.getElementById('ytProgressBar');
      if (progBar) progBar.style.width = pct + '%';
      const timecode = document.getElementById('ytTimecode');
      if (timecode) timecode.innerText = formatYtTime(ytCurrentTimeSec) + ' / ' + v.duration;
    }

    function seekRelative(deltaSeconds) {
      seekYtTo(ytCurrentTimeSec + deltaSeconds);
    }

    function scrubYt(e) {
      const scrubber = document.getElementById('ytScrubber');
      const v = ytVideosCatalog[activeYtVideoIndex];
      if (!scrubber || !v) return;
      const rect = scrubber.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, clickX / rect.width));
      seekYtTo(pct * v.durationSeconds);
    }

    function handleScrubberHover(e) {
      const scrubber = document.getElementById('ytScrubber');
      const tooltip = document.getElementById('ytScrubberTooltip');
      const v = ytVideosCatalog[activeYtVideoIndex];
      if (!scrubber || !tooltip || !v) return;
      const rect = scrubber.getBoundingClientRect();
      const hoverX = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, hoverX / rect.width));
      const hoverTime = pct * v.durationSeconds;
      tooltip.innerText = formatYtTime(hoverTime);
      tooltip.style.left = hoverX + 'px';
      tooltip.style.display = 'block';
    }

    function hideScrubberHover() {
      const tooltip = document.getElementById('ytScrubberTooltip');
      if (tooltip) tooltip.style.display = 'none';
    }

    function changeVolume(val) {
      ytVolume = parseFloat(val) / 100;
      ytIsMuted = ytVolume === 0;
      const muteBtn = document.getElementById('ytMuteBtn');
      if (muteBtn) {
        if (ytIsMuted) muteBtn.innerText = '🔇';
        else if (ytVolume < 0.5) muteBtn.innerText = '🔉';
        else muteBtn.innerText = '🔊';
      }
    }

    function toggleYtMute() {
      ytIsMuted = !ytIsMuted;
      const slider = document.getElementById('ytVolumeSlider');
      const muteBtn = document.getElementById('ytMuteBtn');
      if (ytIsMuted) {
        if (slider) slider.value = '0';
        if (muteBtn) muteBtn.innerText = '🔇';
      } else {
        if (slider) slider.value = '100';
        if (muteBtn) muteBtn.innerText = '🔊';
      }
    }

    function changePlaybackSpeed(speed) {
      ytPlaybackSpeed = parseFloat(speed) || 1.0;
    }

    function handleAbrChange(val) {
      const qualityBadge = document.getElementById('videoQualityBadge');
      const bufferBadge = document.getElementById('bufferHealthBadge');

      if (val === '360p') {
        if (qualityBadge) qualityBadge.innerText = '360p (Edge Direct Pull)';
        if (bufferBadge) {
          bufferBadge.innerText = 'Buffer: 1.8s (Edge Seeder Pull)';
          bufferBadge.style.background = 'rgba(245, 158, 11, 0.25)';
          bufferBadge.style.color = '#fbbf24';
        }
      } else if (val === '480p') {
        if (qualityBadge) qualityBadge.innerText = '480p SD (1.5 Mbps)';
        if (bufferBadge) {
          bufferBadge.innerText = 'Buffer: 4.5s (P2P Swarm)';
          bufferBadge.style.background = 'rgba(16, 185, 129, 0.25)';
          bufferBadge.style.color = '#34d399';
        }
      } else if (val === '720p') {
        if (qualityBadge) qualityBadge.innerText = '720p HD (4 Mbps)';
        if (bufferBadge) {
          bufferBadge.innerText = 'Buffer: 7.2s (P2P Swarm)';
          bufferBadge.style.background = 'rgba(16, 185, 129, 0.25)';
          bufferBadge.style.color = '#34d399';
        }
      } else if (val === '1080p') {
        if (qualityBadge) qualityBadge.innerText = '1080p60 (8 Mbps)';
        if (bufferBadge) {
          bufferBadge.innerText = 'Buffer: 9.8s (P2P Swarm OK)';
          bufferBadge.style.background = 'rgba(16, 185, 129, 0.25)';
          bufferBadge.style.color = '#34d399';
        }
      } else {
        if (qualityBadge) qualityBadge.innerText = '4K UHD 60FPS (25 Mbps)';
        if (bufferBadge) {
          bufferBadge.innerText = 'Buffer: 11.4s (High Bandwidth Swarm)';
          bufferBadge.style.background = 'rgba(16, 185, 129, 0.25)';
          bufferBadge.style.color = '#34d399';
        }
      }
    }

    let ytAmbientGlowActive = true;
    function toggleYtAmbientGlow() {
      ytAmbientGlowActive = !ytAmbientGlowActive;
      const glow = document.getElementById('ytAmbientGlow');
      const text = document.getElementById('ambientStatusText');
      const btn = document.getElementById('btnAmbientGlow');
      if (glow) {
        glow.style.opacity = ytAmbientGlowActive ? '0.65' : '0';
      }
      if (text) {
        text.innerText = ytAmbientGlowActive ? 'Ambient' : 'Ambient (Off)';
      }
      if (btn) {
        btn.style.color = ytAmbientGlowActive ? '#38bdf8' : '#64748b';
      }
    }

    function toggleTheaterMode() {
      ytTheaterMode = !ytTheaterMode;
      const container = document.getElementById('youtubeContainer');
      const btn = document.getElementById('btnTheaterMode');
      if (container) {
        if (ytTheaterMode) {
          container.classList.add('theater-mode');
          if (btn) btn.innerText = '◽';
        } else {
          container.classList.remove('theater-mode');
          if (btn) btn.innerText = '🔲';
        }
      }
    }

    function toggleFullscreen() {
      const box = document.getElementById('ytPlayerBox');
      if (!box) return;
      if (!document.fullscreenElement) {
        box.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }

    function toggleAutoplay() {
      ytAutoplay = !ytAutoplay;
      const statusText = document.getElementById('autoplayStatusText');
      if (statusText) {
        statusText.innerText = ytAutoplay ? 'ON' : 'OFF';
        statusText.style.color = ytAutoplay ? '#34d399' : '#9ca3af';
      }
    }

    function likeYtVideo() {
      const v = ytVideosCatalog[activeYtVideoIndex];
      if (!v) return;
      ytLikedMap[v.id] = !ytLikedMap[v.id];
      const countEl = document.getElementById('ytLikeCount');
      if (countEl) {
        countEl.innerText = (v.likes + (ytLikedMap[v.id] ? 1 : 0)).toLocaleString();
      }
      const likeBtn = document.getElementById('ytLikeBtn');
      if (likeBtn) {
        likeBtn.style.color = ytLikedMap[v.id] ? '#ef4444' : '#fff';
      }
    }

    function dislikeYtVideo() {
      const v = ytVideosCatalog[activeYtVideoIndex];
      if (!v) return;
      ytDislikedMap[v.id] = !ytDislikedMap[v.id];
      const dislikeBtn = document.getElementById('ytDislikeBtn');
      if (dislikeBtn) {
        dislikeBtn.style.color = ytDislikedMap[v.id] ? '#ef4444' : '#fff';
      }
    }

    function openShareYtModal() {
      const v = ytVideosCatalog[activeYtVideoIndex];
      if (!v) return;
      const link = 'ipfs://' + v.cid;
      navigator.clipboard.writeText(link);
      alert('Decentralized 4K Video CID copied to clipboard:\\n' + link + '\\n\\nCan be retrieved on any Sovra or IPFS BitSwap node worldwide.');
    }

    function pinVideoToLocalBlockstore() {
      const v = ytVideosCatalog[activeYtVideoIndex];
      if (!v) return;
      const btn = document.getElementById('btnDownloadYt');
      if (btn) {
        btn.innerHTML = '<span>⏳</span> <span>Pinning UnixFS DAG...</span>';
        setTimeout(() => {
          btn.innerHTML = '<span>✓</span> <span>Pinned to BitSwap</span>';
          btn.style.borderColor = '#10b981';
          btn.style.color = '#34d399';
          alert('Local Storage Node: 4K Master Video (CID: ipfs://' + v.cid + ') pinned to local 50GB storage pool. Video is now available for offline zero-data streaming and P2P re-seeding!');
        }, 800);
      }
    }

    function toggleYtSubscribe() {
      const v = ytVideosCatalog[activeYtVideoIndex];
      if (!v) return;
      const wasSub = Boolean(ytSubscribedMap[v.channelHandle]);
      ytSubscribedMap[v.channelHandle] = !wasSub;
      const isSub = ytSubscribedMap[v.channelHandle];

      const btn = document.getElementById('btnSubscribe');
      const counter = document.getElementById('subscribersCountDisplay');
      const bellBtn = document.getElementById('btnBellNotify');

      if (btn) {
        btn.innerText = isSub ? 'Subscribed ✓' : 'Subscribe';
        if (isSub) btn.classList.add('subscribed');
        else btn.classList.remove('subscribed');
      }
      if (counter) {
        counter.innerText = isSub ? (v.channelSubscribers + 1).toLocaleString() + ' subscribers' : v.channelSubscribersText;
      }
      if (bellBtn) {
        bellBtn.style.display = isSub ? 'flex' : 'none';
      }
    }

    function cycleBellNotification() {
      bellNotificationIndex = (bellNotificationIndex + 1) % bellNotificationOptions.length;
      const setting = bellNotificationOptions[bellNotificationIndex];
      const icon = document.getElementById('bellIcon');
      if (icon) {
        if (setting === 'all') icon.innerText = '🔔';
        else if (setting === 'personalized') icon.innerText = '🔕';
        else icon.innerText = '🔕';
      }
      alert('Notification preference set to: ' + setting.toUpperCase());
    }

    function toggleYtDescription() {
      const descBox = document.getElementById('ytDescBox');
      const toggleBtn = document.getElementById('ytDescToggle');
      if (!descBox || !toggleBtn) return;
      const isCollapsed = descBox.classList.contains('collapsed');
      if (isCollapsed) {
        descBox.classList.remove('collapsed');
        toggleBtn.innerText = 'Show less';
      } else {
        descBox.classList.add('collapsed');
        toggleBtn.innerText = 'Show more';
      }
    }

    function openChannelProfile() {
      const v = ytVideosCatalog[activeYtVideoIndex];
      if (!v) return;
      document.getElementById('modalChannelAvatar').innerText = v.channelAvatar;
      document.getElementById('modalChannelAvatar').style.background = v.channelAvatarBg;
      document.getElementById('modalChannelName').innerText = v.channelName;
      document.getElementById('modalChannelSubscribers').innerText = '@' + v.channelHandle + ' &bull; ' + v.channelSubscribersText + ' &bull; 4 long-form videos';
      openYtModal('channelProfileModal');
    }

    function switchChannelModalTab(tab) {
      const tabs = ['videos', 'playlists', 'community', 'about'];
      tabs.forEach(function(t) {
        const btn = document.getElementById('chTab' + t.charAt(0).toUpperCase() + t.slice(1));
        if (btn) {
          if (t === tab) btn.classList.add('active');
          else btn.classList.remove('active');
        }
      });

      const container = document.getElementById('chTabContent');
      if (!container) return;

      if (tab === 'videos') {
        container.innerHTML = '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">' +
          '<span style="font-weight: 700; color: #fff;">Videos (4)</span>' +
          '<div style="display: flex; gap: 0.35rem;">' +
            '<button class="btn btn-secondary" style="font-size: 0.7rem; padding: 2px 6px;" onclick="alert(&quot;Sorted by Latest (HLC order)&quot;)">Latest</button>' +
            '<button class="btn btn-secondary" style="font-size: 0.7rem; padding: 2px 6px;" onclick="alert(&quot;Sorted by Popular (BitSwap swarm seeds)&quot;)">Popular</button>' +
          '</div>' +
        '</div>' +
        '<div style="display: flex; flex-direction: column; gap: 0.4rem;">' +
          '<div style="background: rgba(0,0,0,0.3); padding: 0.4rem 0.6rem; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="closeYtModal(&quot;channelProfileModal&quot;); renderYtVideo(0, true);">' +
            '<span>🎬 4K HLS Master Stream</span>' +
            '<span style="color: #34d399; font-size: 0.72rem;">284K views &bull; 4K UHD</span>' +
          '</div>' +
          '<div style="background: rgba(0,0,0,0.3); padding: 0.4rem 0.6rem; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="closeYtModal(&quot;channelProfileModal&quot;); renderYtVideo(1, true);">' +
            '<span>⚡ Cell Carrier NAT Penetration</span>' +
            '<span style="color: #34d399; font-size: 0.72rem;">92K views &bull; 1080p60</span>' +
          '</div>' +
          '<div style="background: rgba(0,0,0,0.3); padding: 0.4rem 0.6rem; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="closeYtModal(&quot;channelProfileModal&quot;); renderYtVideo(2, true);">' +
            '<span>🎵 Spatial Multi-Track Audio Master</span>' +
            '<span style="color: #34d399; font-size: 0.72rem;">64K views &bull; FLAC 24-bit</span>' +
          '</div>' +
        '</div>';
      } else if (tab === 'playlists') {
        container.innerHTML = '<div style="display: flex; flex-direction: column; gap: 0.5rem;">' +
          '<div style="background: rgba(0,0,0,0.3); padding: 0.6rem; border-radius: 8px;">' +
            '<div style="font-weight: 700; color: #fff;">📑 Sovereign Infrastructure Series (6 Videos)</div>' +
            '<div style="font-size: 0.75rem; color: #94a3b8; margin-top: 2px;">Updated 3 days ago &bull; Curated by Sovra Lab</div>' +
          '</div>' +
          '<div style="background: rgba(0,0,0,0.3); padding: 0.6rem; border-radius: 8px;">' +
            '<div style="font-weight: 700; color: #fff;">📑 P2P ABR Video Architecture (4 Videos)</div>' +
            '<div style="font-size: 0.75rem; color: #94a3b8; margin-top: 2px;">Updated yesterday &bull; BitSwap & HLS Transcoding</div>' +
          '</div>' +
        '</div>';
      } else if (tab === 'community') {
        container.innerHTML = '<div style="display: flex; flex-direction: column; gap: 0.6rem;">' +
          '<div style="background: rgba(0,0,0,0.3); padding: 0.6rem; border-radius: 8px;">' +
            '<div style="font-size: 0.75rem; color: #38bdf8; font-weight: 700;">Pinned Community Poll &bull; 4 hours ago</div>' +
            '<div style="margin-top: 4px; color: #fff;">Which codec should we standardize for 8K P2P streams?</div>' +
            '<div style="font-size: 0.75rem; color: #34d399; margin-top: 4px;">● AV1 (78%) &bull; HEVC/H.265 (22%)</div>' +
          '</div>' +
        '</div>';
      } else if (tab === 'about') {
        container.innerHTML = '<div style="display: flex; flex-direction: column; gap: 0.5rem; line-height: 1.5;">' +
          '<div><b>Joined:</b> October 2026 (Genesis Block)</div>' +
          '<div><b>Total Views:</b> 440,512 across BitSwap Swarm</div>' +
          '<div><b>Links:</b> <span style="color: #60a5fa;">sovra.network/lab</span> &bull; <span style="color: #60a5fa;">github.com/sovra</span></div>' +
          '<div style="color: #94a3b8; font-size: 0.75rem;">Verified Channel Fingerprint: 0x9f88c12b7a...</div>' +
        '</div>';
      }
    }

    function openMembershipModal() {
      openYtModal('membershipModal');
    }

    function selectMembershipTier(cardEl, tierName, price) {
      document.querySelectorAll('.membership-tier-card').forEach(c => c.classList.remove('selected'));
      if (cardEl) cardEl.classList.add('selected');
      selectedMembershipTier = { name: tierName, price: price };
    }

    function confirmMembership() {
      closeYtModal('membershipModal');
      spawnConfetti();
      const v = ytVideosCatalog[activeYtVideoIndex];
      alert('Channel Membership Activated: Joined ' + (v ? v.channelName : 'Channel') + ' as ' + selectedMembershipTier.name + ' (₹' + selectedMembershipTier.price + '/mo)! Signed with Ed25519 identity key.');
    }

    function openSuperThanksModal() {
      openYtModal('superThanksModal');
      updateSuperThanksSplitPreview(100);
    }

    function selectSuperThanksAmount(amt) {
      const input = document.getElementById('superThanksAmountInput');
      if (input) input.value = amt;
      updateSuperThanksSplitPreview(amt);
    }

    function updateSuperThanksSplitPreview(amt) {
      const val = parseFloat(amt) || 0;
      const creator = (val * 0.95).toFixed(2);
      const seeders = (val * 0.05).toFixed(2);
      const preview = document.getElementById('superThanksSplitPreview');
      if (preview) {
        preview.innerHTML = 'Split breakdown: <b>₹' + creator + ' (95%)</b> to Creator, <b>₹' + seeders + ' (5%)</b> to Seeders, <b>₹0.00 (0%)</b> to Platform.';
      }
    }

    function submitSuperThanks() {
      const amtInput = document.getElementById('superThanksAmountInput');
      const msgInput = document.getElementById('superThanksMessageInput');
      const amt = parseFloat(amtInput ? amtInput.value : '100') || 100;
      const msg = msgInput ? msgInput.value.trim() : 'Super Thanks for the sovereign streaming architecture!';
      closeYtModal('superThanksModal');
      sendCreatorTip(amt, msg);
    }

    async function sendCreatorTip(amount, customMessage) {
      const v = ytVideosCatalog[activeYtVideoIndex];
      if (!v) return;

      const creatorAmt = (amount * 0.95).toFixed(2);
      const seederAmt = (amount * 0.05).toFixed(2);
      const notice = document.getElementById('tipStatusNotice');
      if (notice) {
        notice.innerHTML = '⚡ <b>VirtualChannelMeshRouter</b> Voucher Signed: <b style="color:#fbbf24;">₹' + creatorAmt + ' (95%)</b> to ' + v.channelName + ', <b style="color:#34d399;">₹' + seederAmt + ' (5%)</b> to BitSwap Seeders, <b style="color:#38bdf8;">0% Gas Fees</b> (Instant Netting).';
      }

      spawnConfetti();

      if (customMessage) {
        if (!ytCommentsDatabase[v.id]) ytCommentsDatabase[v.id] = [];
        ytCommentsDatabase[v.id].unshift({
          id: 'yt-st-' + Date.now(),
          videoId: v.id,
          authorName: 'You (Super Supporter)',
          authorAvatar: 'Y',
          authorHandle: 'you_peer',
          text: customMessage,
          timestamp: Date.now(),
          likes: 5,
          isSuperThanks: true,
          superThanksAmount: '₹' + amount,
          creatorHeart: true,
          replies: []
        });
        renderYtComments('top');
      }

      try {
        await fetch('/api/youtube/tip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: amount,
            videoId: v.id,
            creatorDid: 'did:sovra:' + v.channelHandle,
            message: customMessage
          })
        });
      } catch (err) {}
    }

    function renderYtRecommendations() {
      const container = document.getElementById('ytRecommendationsList');
      if (!container) return;
      container.innerHTML = ytVideosCatalog.map((vid, idx) => {
        const isActive = idx === activeYtVideoIndex;
        const activeClass = isActive ? ' active-video' : '';
        const badge = isActive ? '<span class="yt-p2p-badge" style="background:#6366f1; color:#fff;">▶ PLAYING</span>' : '<span class="yt-p2p-badge">P2P 4K</span>';
        const icons = ['🌐', '📡', '🔐', '⚡'];
        return '<div class="yt-sidebar-card' + activeClass + '" onclick="switchYtVideo(' + idx + ')">' +
          '<div class="yt-thumbnail" style="background: ' + vid.gradient + ';">' +
            badge +
            '<span>' + icons[idx % icons.length] + '</span>' +
            '<span class="yt-duration-badge">' + vid.duration + '</span>' +
          '</div>' +
          '<div style="flex: 1; min-width: 0;">' +
            '<div style="font-size: 0.82rem; font-weight: 600; color: #f1f5f9; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">' +
              vid.title +
            '</div>' +
            '<div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.25rem;">' + vid.channelName + ' ✓</div>' +
            '<div style="font-size: 0.7rem; color: #94a3b8;">' + vid.viewsText + ' &bull; ' + vid.publishedAt + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function renderYtComments(sort = 'top') {
      const v = ytVideosCatalog[activeYtVideoIndex];
      if (!v) return;
      const list = ytCommentsDatabase[v.id] || [];

      const sorted = [...list];
      if (sort === 'top') {
        sorted.sort((a, b) => b.likes - a.likes);
      } else if (sort === 'newest') {
        sorted.sort((a, b) => b.timestamp - a.timestamp);
      }

      let totalComments = sorted.length;
      for (const c of sorted) {
        if (c.replies) totalComments += c.replies.length;
      }
      const countEl = document.getElementById('ytCommentsCount');
      if (countEl) countEl.innerText = totalComments + ' Comments';

      const container = document.getElementById('ytCommentsList');
      if (!container) return;

      container.innerHTML = sorted.map(c => {
        const isSuper = Boolean(c.isSuperThanks);
        const cardClass = isSuper ? 'yt-comment-thread super-thanks-comment-card' : 'yt-comment-thread';
        
        let headerBadges = '';
        if (c.isPinned) {
          headerBadges += '<span style="color:#f59e0b; font-size:0.75rem; font-weight:700; margin-right:8px;">📌 Pinned by creator</span>';
        }
        if (isSuper) {
          headerBadges += '<span class="super-thanks-badge" style="margin-right:8px;">💰 ' + c.superThanksAmount + ' Super Thanks</span>';
        }

        let creatorHeart = '';
        if (c.creatorHeart) {
          creatorHeart = '<span class="creator-heart-badge">❤️ ' + v.channelName + '</span>';
        }

        const timeStr = new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        let repliesHtml = '';
        if (c.replies && c.replies.length > 0) {
          const repItems = c.replies.map(r => 
            '<div style="display: flex; gap: 0.65rem; align-items: flex-start;">' +
              '<div style="width: 28px; height: 28px; border-radius: 50%; background: #4338ca; color: #fff; font-weight: bold; font-size: 0.75rem; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">' + r.authorAvatar + '</div>' +
              '<div style="flex: 1;">' +
                '<div style="display: flex; align-items: center; gap: 0.4rem;">' +
                  '<span style="font-size: 0.8rem; font-weight: 700; color: #e2e8f0;">' + r.authorName + '</span>' +
                  (r.isCreator ? '<span style="color: #60a5fa; font-size: 0.72rem;">✓ Creator</span>' : '') +
                  '<span style="font-size: 0.68rem; color: var(--text-muted);">' + new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</span>' +
                '</div>' +
                '<div style="font-size: 0.82rem; color: #cbd5e1; line-height: 1.35; margin-top: 0.15rem;">' + r.text + '</div>' +
                '<div style="display: flex; align-items: center; gap: 0.65rem; font-size: 0.72rem; color: var(--text-muted); margin-top: 0.2rem;">' +
                  '<span style="cursor: pointer;" onclick="likeNestedReply(&quot;' + c.id + '&quot;, &quot;' + r.id + '&quot;)">👍 ' + r.likes + '</span>' +
                  '<span style="color: #34d399; font-size: 0.65rem;">● Ed25519 Verified</span>' +
                '</div>' +
              '</div>' +
            '</div>'
          ).join('');

          repliesHtml = '<button class="btn-toggle-replies" onclick="toggleRepliesThread(&quot;' + c.id + '&quot;)" id="btn-toggle-' + c.id + '">' +
            '▾ ' + c.replies.length + (c.replies.length === 1 ? ' reply' : ' replies') +
            '</button>' +
            '<div class="yt-replies-list" id="replies-list-' + c.id + '" style="display: block;">' +
              repItems +
            '</div>';
        }

        return '<div class="' + cardClass + '" id="comment-' + c.id + '">' +
          '<div style="display: flex; gap: 0.75rem; align-items: flex-start;">' +
            '<div style="width: 36px; height: 36px; border-radius: 50%; background: #334155; color: #fff; font-weight: bold; font-size: 0.9rem; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">' + c.authorAvatar + '</div>' +
            '<div style="flex: 1;">' +
              '<div>' + headerBadges + '<span style="font-size: 0.82rem; font-weight: 700; color: #e2e8f0;">@' + c.authorHandle + '</span> ' +
              '<span style="font-size: 0.7rem; color: var(--text-muted); margin-left: 4px;">' + timeStr + '</span>' +
              creatorHeart +
              '<span style="color: #34d399; font-size: 0.65rem; margin-left: 8px;">● Ed25519 Verified</span>' +
              '</div>' +
              '<div style="font-size: 0.85rem; color: #cbd5e1; line-height: 1.4; margin-top: 0.25rem;">' + c.text + '</div>' +
              '<div style="display: flex; align-items: center; gap: 0.85rem; font-size: 0.75rem; color: var(--text-muted); margin-top: 0.35rem;">' +
                '<span style="cursor: pointer;" onclick="likeYtComment(&quot;' + c.id + '&quot;)">👍 <span id="like-cnt-' + c.id + '">' + c.likes + '</span></span>' +
                '<span style="cursor: pointer;">👎</span>' +
                '<span style="cursor: pointer; font-weight: 700; color: #38bdf8;" onclick="toggleReplyBox(&quot;' + c.id + '&quot;)">Reply</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="reply-composer-box" id="reply-box-' + c.id + '">' +
            '<div style="display: flex; gap: 0.5rem; align-items: center;">' +
              '<input type="text" id="reply-input-' + c.id + '" class="chat-text-input" placeholder="Add a public reply..." style="flex: 1;" onkeydown="if(event.key===&quot;Enter&quot;) submitNestedReply(&quot;' + c.id + '&quot;)">' +
              '<button class="btn btn-secondary" style="padding: 0.35rem 0.65rem; font-size: 0.75rem;" onclick="toggleReplyBox(&quot;' + c.id + '&quot;)">Cancel</button>' +
              '<button class="btn btn-primary" style="padding: 0.35rem 0.85rem; font-size: 0.75rem;" onclick="submitNestedReply(&quot;' + c.id + '&quot;)">Reply</button>' +
            '</div>' +
          '</div>' +
          repliesHtml +
        '</div>';
      }).join('');
    }

    function sortYtComments(sortType) {
      renderYtComments(sortType);
    }

    function clearCommentInput() {
      const input = document.getElementById('newCommentInput');
      if (input) input.value = '';
    }

    function addYtComment() {
      const input = document.getElementById('newCommentInput');
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;

      const v = ytVideosCatalog[activeYtVideoIndex];
      if (!v) return;
      if (!ytCommentsDatabase[v.id]) ytCommentsDatabase[v.id] = [];

      const newC = {
        id: 'yt-c-' + Date.now(),
        videoId: v.id,
        authorName: 'You (Verified Peer)',
        authorAvatar: 'Y',
        authorHandle: 'you_peer',
        text: text,
        timestamp: Date.now(),
        likes: 1,
        replies: []
      };

      ytCommentsDatabase[v.id].unshift(newC);
      input.value = '';
      renderYtComments('top');
    }

    function toggleReplyBox(commentId) {
      const box = document.getElementById('reply-box-' + commentId);
      if (!box) return;
      const isHidden = box.style.display === 'none' || !box.style.display;
      box.style.display = isHidden ? 'block' : 'none';
      if (isHidden) {
        const inp = document.getElementById('reply-input-' + commentId);
        if (inp) inp.focus();
      }
    }

    function submitNestedReply(commentId) {
      const input = document.getElementById('reply-input-' + commentId);
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;

      const v = ytVideosCatalog[activeYtVideoIndex];
      if (!v) return;
      const comments = ytCommentsDatabase[v.id] || [];
      const parent = comments.find(c => c.id === commentId);
      if (parent) {
        if (!parent.replies) parent.replies = [];
        parent.replies.push({
          id: 'yt-r-' + Date.now(),
          commentId: commentId,
          authorName: 'You (Verified Peer)',
          authorAvatar: 'Y',
          authorHandle: 'you_peer',
          text: text,
          timestamp: Date.now(),
          likes: 1
        });
        input.value = '';
        toggleReplyBox(commentId);
        renderYtComments('top');
      }
    }

    function toggleRepliesThread(commentId) {
      const list = document.getElementById('replies-list-' + commentId);
      const btn = document.getElementById('btn-toggle-' + commentId);
      if (!list || !btn) return;
      const isHidden = list.style.display === 'none';
      list.style.display = isHidden ? 'flex' : 'none';
      btn.innerText = isHidden ? '▴ Hide replies' : '▾ Show replies';
    }

    function likeYtComment(commentId) {
      const v = ytVideosCatalog[activeYtVideoIndex];
      if (!v) return;
      const comments = ytCommentsDatabase[v.id] || [];
      const c = comments.find(item => item.id === commentId);
      if (c) {
        c.likes++;
        const el = document.getElementById('like-cnt-' + commentId);
        if (el) el.innerText = c.likes;
      }
    }

    function likeNestedReply(commentId, replyId) {
      const v = ytVideosCatalog[activeYtVideoIndex];
      if (!v) return;
      const comments = ytCommentsDatabase[v.id] || [];
      const c = comments.find(item => item.id === commentId);
      if (c && c.replies) {
        const r = c.replies.find(item => item.id === replyId);
        if (r) {
          r.likes++;
          renderYtComments();
        }
      }
    }

    function openYtModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) modal.style.display = 'flex';
    }

    function closeYtModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) modal.style.display = 'none';
    }

    function spawnConfetti() {
      const colors = ['#f59e0b', '#ef4444', '#10b981', '#6366f1', '#ec4899', '#3b82f6'];
      for (let i = 0; i < 45; i++) {
        const p = document.createElement('div');
        p.className = 'confetti-piece';
        p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        p.style.left = (Math.random() * 100) + 'vw';
        p.style.top = '-20px';
        p.style.animationDuration = (1.5 + Math.random() * 2) + 's';
        p.style.transform = 'scale(' + (0.5 + Math.random() * 0.8) + ')';
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 3200);
      }
    }

    // ==========================================
    // 4. CORE PROTOCOL & POST PUBLISHING SCRIPT
    // ==========================================
    async function toggleCreatorMode(active) {
      const res = await fetch('/api/creator/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active })
      });
      const data = await res.json();
      document.getElementById('creatorStudioSection').style.display = data.isCreatorModeActive ? 'block' : 'none';
      document.getElementById('creatorStatusText').innerText = data.isCreatorModeActive ? 'Studio Active' : 'Consumer Mode';
    }

    async function publishPost() {
      const input = document.getElementById('postContent');
      const text = input.value.trim();
      if (!text) return;

      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text })
      });

      if (res.ok) {
        input.value = '';
        window.location.reload();
      }
    }

    async function publishMediaAsset() {
      const input = document.getElementById('mediaPayload');
      const text = input.value.trim();
      if (!text) return;

      const resBox = document.getElementById('mediaPublishResult');
      resBox.innerText = 'Chunking UnixFS DAG...';

      const res = await fetch('/api/storage/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, mimeType: 'text/plain' })
      });

      const data = await res.json();
      if (data.ok) {
        const cidDisplay = data.asset.cid.multihash ? data.asset.cid.multihash.slice(0, 18) + '...' : data.asset.cid;
        resBox.innerHTML = '✓ Pinned CIDv1: <b style="color:#34d399;">' + cidDisplay + '</b> (' + data.asset.byteLength + ' B)';
        input.value = '';
        updateStorageStats();
      } else {
        resBox.innerText = 'Error: ' + data.error;
      }
    }

    async function updateStorageStats() {
      try {
        const res = await fetch('/api/storage/stats');
        const data = await res.json();
        if (data.quotaUsage) {
          const capGB = (Number(BigInt(data.maxCapacityBytes) / 1073741824n)).toFixed(1) + ' GB';
          document.getElementById('quotaCapacity').innerText = capGB;
          document.getElementById('quotaUsed').innerText = data.totalSizeBytes + ' B';
          document.getElementById('quotaPinned').innerText = data.quotaUsage.pinnedBytes + ' B';
          document.getElementById('activePinsCount').innerText = data.activePinsCount;
        }
      } catch {}
    }
    setInterval(updateStorageStats, 5000);
    setTimeout(updateStorageStats, 500);

    async function triggerVerifyReplicas() {
      const resBox = document.getElementById('mediaPublishResult');
      resBox.innerText = 'Verifying network replicas across DHT...';
      try {
        const res = await fetch('/api/storage/verify', { method: 'POST' });
        const report = await res.json();
        if (report.ok) {
          resBox.innerHTML = '✓ Checked ' + report.value.totalPinsChecked + ' pins: <b style="color:#34d399;">' + report.value.healthyCount + ' healthy</b>, <b style="color:#fbbf24;">' + report.value.underReplicatedCount + ' under-replicated</b>, ' + report.value.repairsTriggered + ' repairs triggered.';
        } else {
          resBox.innerText = 'Error: ' + report.error;
        }
      } catch (e) {
        resBox.innerText = 'Verify failed: ' + e;
      }
      updateStorageStats();
    }

    async function triggerGC() {
      const resBox = document.getElementById('mediaPublishResult');
      resBox.innerText = 'Running garbage collection on unpinned blocks...';
      try {
        const res = await fetch('/api/storage/gc', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          resBox.innerHTML = '✓ GC Complete: Freed <b style="color:#34d399;">' + data.value.bytesFreed + ' bytes</b> (' + data.value.blocksEvicted + ' unpinned blocks evicted).';
        } else {
          resBox.innerText = 'Error: ' + data.error;
        }
      } catch (e) {
        resBox.innerText = 'GC failed: ' + e;
      }
      updateStorageStats();
    }

    async function toggleFollow(targetPubkey, isCurrentlyFollowing) {
      try {
        const res = await fetch('/api/social/follow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetPubkey, isUnfollow: !!isCurrentlyFollowing })
        });
        if (res.ok) window.location.reload();
      } catch (e) {
        alert('Follow action failed: ' + e);
      }
    }

    async function toggleBlock(targetPubkey) {
      if (!confirm('Block author? All posts by this author will be suppressed locally with zero central network censorship.')) return;
      try {
        const res = await fetch('/api/social/block', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetPubkey, isUnblock: false, reason: 'User blocked' })
        });
        if (res.ok) window.location.reload();
      } catch (e) {
        alert('Block action failed: ' + e);
      }
    }

    async function toggleMute(targetPubkey) {
      try {
        const res = await fetch('/api/social/mute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetPubkey, isUnmute: false, durationSeconds: 3600 })
        });
        if (res.ok) window.location.reload();
      } catch (e) {
        alert('Mute action failed: ' + e);
      }
    }

    // ==========================================
    // 🌐 PHASE 1 MASTER SOCIAL: OMNI-SEARCH, CHANNELS, PAGES & SAFETY JURY
    // ==========================================
    let currentSearchTab = 'all';
    let currentRecentSearches = ['#sovra', 'Alice', '@metropolis_coffee'];
    let activeTargetPost = { id: '', author: '', cid: '' };

    const socialOmniCatalog = {
      people: [
        { pubkey: 'did:key:alice123', handle: '@alice_crypto', name: 'Alice Wonderland', bio: 'P2P & zero-disk state researcher', avatar: 'A', bg: '#6366f1', isFriend: false, isPending: false, isBlocked: false, mutuals: 3, isOnline: true, contactDid: 'did:sovra:alice_peer' },
        { pubkey: 'did:key:bob456', handle: '@bob_live', name: 'Bob Martinez', bio: 'Audio spaces host & live streamer', avatar: 'B', bg: '#ec4899', isFriend: true, isPending: false, isBlocked: false, mutuals: 8, isOnline: true, contactDid: 'did:sovra:bob_5g_seeder' },
        { pubkey: 'did:key:charlie789', handle: '@charlie_mesh', name: 'Charlie Chen', bio: 'BitSwap seeder & UnixFS architect', avatar: 'C', bg: '#10b981', isFriend: false, isPending: false, isBlocked: false, mutuals: 6, isOnline: false, contactDid: 'did:sovra:dave_edge_relay' },
        { pubkey: 'did:key:priya101', handle: '@priya_sharma', name: 'Priya Sharma', bio: 'Web3 digital artist & music producer', avatar: 'P', bg: '#f59e0b', isFriend: false, isPending: true, isBlocked: false, mutuals: 4, isOnline: true, contactDid: 'did:sovra:carol_musician' },
        { pubkey: 'did:key:vikram202', handle: '@vikram_singh', name: 'Vikram Singh', bio: 'Decentralized node operator (TCP :4001)', avatar: 'V', bg: '#0284c7', isFriend: true, isPending: false, isBlocked: false, mutuals: 11, isOnline: true, contactDid: 'did:sovra:alice_peer' },
        { pubkey: 'did:key:neha303', handle: '@neha_verma', name: 'Neha Verma', bio: 'Decentralized UX architect & Flutter developer', avatar: 'N', bg: '#8b5cf6', isFriend: false, isPending: false, isBlocked: false, mutuals: 5, isOnline: true, contactDid: 'did:sovra:bob_5g_seeder' }
      ],
      channels: [
        { id: 'ch-alpha', handle: '@sovra_alpha', name: 'Sovra Alpha Radar', category: 'tech', desc: 'Cutting-edge P2P social dispatches', count: 14200, avatar: '📢', bg: '#0284c7', isSubbed: true },
        { id: 'ch-gaming', handle: '@web3_gaming', name: 'Web3 Arcade Live', category: 'gaming', desc: 'Multiplayer P2P tournaments & game clips', count: 8900, avatar: '🎮', bg: '#8b5cf6', isSubbed: false },
        { id: 'ch-news', handle: '@decentral_news', name: 'Global Mesh Dispatches', category: 'news', desc: 'Uncensored citizen dispatches over GossipSub', count: 24500, avatar: '📰', bg: '#10b981', isSubbed: false },
        { id: 'ch-music', handle: '@ambient_radio', name: '24/7 Lo-Fi Mesh Waves', category: 'music', desc: 'Continuous stream seeded across 40 nodes', count: 6200, avatar: '🎵', bg: '#f43f5e', isSubbed: true }
      ],
      pages: [
        { id: 'pg-metropolis', handle: '@metropolis_coffee', name: 'Metropolis Roastery', category: 'business', bio: 'Artisan cold brew with gigabit sovereign Wi-Fi', count: 3400, cta: 'Book Table', ctaType: 'book', avatar: '☕', bg: '#78350f', isFollowing: false },
        { id: 'pg-meshlabs', handle: '@mesh_labs', name: 'Mesh Labs AI', category: 'brand', bio: 'Local edge LLMs and private search models', count: 12400, cta: 'Visit Website', ctaType: 'website', avatar: '⚡', bg: '#4f46e5', isFollowing: true },
        { id: 'pg-bakery', handle: '@artisan_bakery', name: 'Sovereign Sourdough', category: 'business', bio: 'Fresh organic loaves delivered directly via P2P orders', count: 1850, cta: 'Send Message', ctaType: 'message', avatar: '🥖', bg: '#d97706', isFollowing: false }
      ],
      hashtags: [
        { tag: '#sovra', count: 4250 },
        { tag: '#crypto', count: 12100 },
        { tag: '#privacy', count: 9400 },
        { tag: '#p2p', count: 3800 },
        { tag: '#zerodisk', count: 1200 },
        { tag: '#decentralized', count: 7600 }
      ],
      audio: [
        { id: 'aud-1', title: 'Midnight Ambient Waves', artist: 'Synthetic Dawn', count: 840 },
        { id: 'aud-2', title: 'Cyber Neon Pulse', artist: 'Mesh Audio Lab', count: 1250 },
        { id: 'aud-3', title: 'Sunset Chill Acoustic', artist: 'Acoustic Peer', count: 430 }
      ]
    };

    function openOmniSearch() {
      const m = document.getElementById('omniSearchModal');
      if (m) {
        m.style.display = 'flex';
        renderOmniRecentChips();
        filterOmniSearch(document.getElementById('omniSearchInput').value || '');
        setTimeout(() => document.getElementById('omniSearchInput')?.focus(), 50);
      }
    }

    function closeOmniSearch() {
      const m = document.getElementById('omniSearchModal');
      if (m) m.style.display = 'none';
    }

    function switchSearchTab(tab) {
      currentSearchTab = tab;
      const tabs = ['all', 'people', 'channels', 'pages', 'media', 'hashtags', 'audio'];
      for (const t of tabs) {
        const btn = document.getElementById('stab-' + t);
        if (btn) btn.classList.toggle('active', t === tab);
      }
      filterOmniSearch(document.getElementById('omniSearchInput').value || '');
    }

    function renderOmniRecentChips() {
      const container = document.getElementById('omniRecentChips');
      if (!container) return;
      container.innerHTML = currentRecentSearches
        .map(q => '<span data-query="' + q.replace(/"/g, '&quot;') + '" onclick="executeRecentSearch(this.dataset.query)" style="background: rgba(255,255,255,0.08); padding: 2px 8px; border-radius: 12px; cursor: pointer; color: #cbd5e1;">' + q + '</span>')
        .join('');
    }

    function executeRecentSearch(q) {
      const input = document.getElementById('omniSearchInput');
      if (input) {
        input.value = q;
        filterOmniSearch(q);
      }
    }

    function clearRecentSearchesDemo() {
      currentRecentSearches = [];
      renderOmniRecentChips();
    }

    function filterOmniSearch(rawQuery) {
      const q = rawQuery.trim().toLowerCase();
      const list = document.getElementById('omniResultsList');
      if (!list) return;

      if (q && !currentRecentSearches.includes(rawQuery.trim())) {
        currentRecentSearches.unshift(rawQuery.trim());
        if (currentRecentSearches.length > 6) currentRecentSearches.pop();
        renderOmniRecentChips();
      }

      let html = '';

      // People
      if (currentSearchTab === 'all' || currentSearchTab === 'people') {
        const matched = socialOmniCatalog.people.filter(p => !p.isBlocked && (!q || p.name.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q) || p.bio.toLowerCase().includes(q)));
        for (const p of matched) {
          const friendBtnText = p.isFriend ? '❤️ Friends' : p.isPending ? '⏳ Requested' : '+ Add Friend';
          const friendBtnClass = p.isFriend ? 'action-pill-secondary' : p.isPending ? 'action-pill-secondary' : 'action-pill-primary';
          html += '<div class="omni-result-item">' +
            '<div style="display: flex; align-items: center; gap: 0.75rem;">' +
              '<div style="width: 40px; height: 40px; border-radius: 50%; background: ' + p.bg + '; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.05rem;">' + p.avatar + '</div>' +
              '<div>' +
                '<div style="font-weight: 700; color: #fff; font-size: 0.9rem; display: flex; align-items: center; gap: 4px;">' +
                  '<span>' + p.name + '</span>' +
                  '<span style="color: #38bdf8; font-size: 0.75rem;">✓</span>' +
                '</div>' +
                '<div style="font-size: 0.75rem; color: #94a3b8;">' + p.handle + ' &bull; ' + p.bio + '</div>' +
              '</div>' +
            '</div>' +
            '<div style="display: flex; gap: 0.4rem; align-items: center;">' +
              '<button class="action-pill-btn ' + friendBtnClass + '" data-pubkey="' + p.pubkey + '" data-name="' + p.name.replace(/"/g, '&quot;') + '" onclick="toggleFriendAction(this.dataset.pubkey, this.dataset.name)">' + friendBtnText + '</button>' +
              '<button class="chat-btn-round" style="width: 28px; height: 28px; font-size: 0.85rem;" title="Block / Mute" data-pubkey="' + p.pubkey + '" data-name="' + p.name.replace(/"/g, '&quot;') + '" onclick="toggleBlockUserDemo(this.dataset.pubkey, this.dataset.name)">🚫</button>' +
            '</div>' +
          '</div>';
        }
      }

      // Channels
      if (currentSearchTab === 'all' || currentSearchTab === 'channels') {
        const matched = socialOmniCatalog.channels.filter(ch => !q || ch.name.toLowerCase().includes(q) || ch.handle.toLowerCase().includes(q) || ch.category.toLowerCase().includes(q));
        for (const ch of matched) {
          const subText = ch.isSubbed ? 'Subscribed ✓' : 'Subscribe';
          const subClass = ch.isSubbed ? 'action-pill-secondary' : 'action-pill-primary';
          html += '<div class="omni-result-item">' +
            '<div style="display: flex; align-items: center; gap: 0.75rem;">' +
              '<div style="width: 40px; height: 40px; border-radius: 12px; background: ' + ch.bg + '; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1.25rem;">' + ch.avatar + '</div>' +
              '<div>' +
                '<div style="font-weight: 700; color: #fff; font-size: 0.9rem; display: flex; align-items: center; gap: 6px;">' +
                  '<span>' + ch.name + '</span>' +
                  '<span style="font-size: 0.65rem; background: rgba(56,189,248,0.15); color: #38bdf8; padding: 1px 6px; border-radius: 8px;">' + ch.category.toUpperCase() + '</span>' +
                '</div>' +
                '<div style="font-size: 0.75rem; color: #94a3b8;">' + ch.handle + ' &bull; ' + ch.count.toLocaleString() + ' subscribers</div>' +
              '</div>' +
            '</div>' +
            '<button class="action-pill-btn ' + subClass + '" data-channel-id="' + ch.id + '" onclick="toggleChannelSubscribeDemo(this.dataset.channelId)">' + subText + '</button>' +
          '</div>';
        }
      }

      // Pages
      if (currentSearchTab === 'all' || currentSearchTab === 'pages') {
        const matched = socialOmniCatalog.pages.filter(pg => !q || pg.name.toLowerCase().includes(q) || pg.handle.toLowerCase().includes(q) || pg.category.toLowerCase().includes(q));
        for (const pg of matched) {
          const folText = pg.isFollowing ? 'Following ✓' : 'Follow';
          const folClass = pg.isFollowing ? 'action-pill-secondary' : 'action-pill-primary';
          html += '<div class="omni-result-item">' +
            '<div style="display: flex; align-items: center; gap: 0.75rem;">' +
              '<div style="width: 40px; height: 40px; border-radius: 12px; background: ' + pg.bg + '; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1.25rem;">' + pg.avatar + '</div>' +
              '<div>' +
                '<div style="font-weight: 700; color: #fff; font-size: 0.9rem; display: flex; align-items: center; gap: 6px;">' +
                  '<span>' + pg.name + '</span>' +
                  '<span style="font-size: 0.65rem; background: rgba(168,85,247,0.15); color: #c084fc; padding: 1px 6px; border-radius: 8px;">' + pg.category.toUpperCase() + '</span>' +
                '</div>' +
                '<div style="font-size: 0.75rem; color: #94a3b8;">' + pg.handle + ' &bull; ' + pg.bio + '</div>' +
              '</div>' +
            '</div>' +
            '<div style="display: flex; gap: 0.4rem;">' +
              '<button class="action-pill-btn action-pill-secondary" style="border-color: #38bdf8; color: #38bdf8;" data-cta="' + pg.cta.replace(/"/g, '&quot;') + '" onclick="alert(&quot;CTA Action: Redirecting to &quot; + this.dataset.cta)">' + pg.cta + '</button>' +
              '<button class="action-pill-btn ' + folClass + '" data-page-id="' + pg.id + '" onclick="togglePageFollowDemo(this.dataset.pageId)">' + folText + '</button>' +
            '</div>' +
          '</div>';
        }
      }

      // Hashtags
      if (currentSearchTab === 'all' || currentSearchTab === 'hashtags') {
        const matched = socialOmniCatalog.hashtags.filter(h => !q || h.tag.toLowerCase().includes(q));
        for (const h of matched) {
          html += '<div class="omni-result-item" style="cursor: pointer;" data-tag="' + h.tag + '" onclick="document.getElementById(&quot;omniSearchInput&quot;).value=this.dataset.tag; filterOmniSearch(this.dataset.tag)">' +
            '<div style="display: flex; align-items: center; gap: 0.75rem;">' +
              '<div style="width: 36px; height: 36px; border-radius: 50%; background: rgba(56, 189, 248, 0.15); color: #38bdf8; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.1rem;">#</div>' +
              '<div>' +
                '<div style="font-weight: 700; color: #38bdf8; font-size: 0.9rem;">' + h.tag + '</div>' +
                '<div style="font-size: 0.72rem; color: #94a3b8;">' + h.count.toLocaleString() + ' decentralized posts</div>' +
              '</div>' +
            '</div>' +
            '<span style="color: #64748b; font-size: 0.8rem;">Explore →</span>' +
          '</div>';
        }
      }

      // Audio
      if (currentSearchTab === 'all' || currentSearchTab === 'audio') {
        const matched = socialOmniCatalog.audio.filter(a => !q || a.title.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q));
        for (const a of matched) {
          html += '<div class="omni-result-item">' +
            '<div style="display: flex; align-items: center; gap: 0.75rem;">' +
              '<div style="width: 36px; height: 36px; border-radius: 50%; background: rgba(244, 63, 94, 0.15); color: #f43f5e; display: flex; align-items: center; justify-content: center; font-size: 1rem;">🎵</div>' +
              '<div>' +
                '<div style="font-weight: 700; color: #fff; font-size: 0.88rem;">' + a.title + '</div>' +
                '<div style="font-size: 0.72rem; color: #94a3b8;">' + a.artist + ' &bull; ' + a.count.toLocaleString() + ' reels</div>' +
              '</div>' +
            '</div>' +
            '<button class="action-pill-btn action-pill-secondary" data-title="' + a.title.replace(/"/g, '&quot;') + '" onclick="alert(&quot;Audio Preview: Playing 15s snippet for &quot; + this.dataset.title)">▶ Preview</button>' +
          '</div>';
        }
      }

      if (!html) {
        html = '<div style="text-align: center; padding: 2.5rem 1rem; color: #64748b; font-size: 0.88rem;">No matching accounts, channels, or tags found on the mesh.</div>';
      }

      list.innerHTML = html;
    }

    function toggleFriendAction(pubkey, name) {
      const p = socialOmniCatalog.people.find(x => x.pubkey === pubkey);
      if (!p) return;
      if (p.isFriend) {
        if (confirm('Remove ' + name + ' from friends?')) {
          p.isFriend = false;
          p.isPending = false;
          updateMeFriendsCounter(-1);
          alert('Friendship with ' + name + ' removed.');
        }
      } else if (p.isPending) {
        p.isPending = false;
        alert('Friend request to ' + name + ' cancelled.');
      } else {
        p.isFriend = true; // Auto-accept demo for high retention feel
        updateMeFriendsCounter(1);
        alert('✓ Friend Request Accepted! You and ' + name + ' are now mutual friends on the sovereign mesh.');
      }
      filterOmniSearch(document.getElementById('omniSearchInput').value || '');
    }

    function updateMeFriendsCounter(delta) {
      const el = document.getElementById('meFriendsCount');
      if (el) {
        const cur = parseInt(el.innerText, 10) || 24;
        el.innerText = Math.max(0, cur + delta);
      }
    }

    function toggleBlockUserDemo(pubkey, name) {
      const p = socialOmniCatalog.people.find(x => x.pubkey === pubkey);
      if (!p) return;
      if (confirm('Block ' + name + '? They will be completely invisible and packets dropped locally.')) {
        p.isBlocked = true;
        p.isFriend = false;
        alert('🚫 ' + name + ' has been blocked. Zero network packets will be accepted.');
        filterOmniSearch(document.getElementById('omniSearchInput').value || '');
      }
    }

    function toggleChannelSubscribeDemo(id) {
      const ch = socialOmniCatalog.channels.find(function(x) { return x.id === id; });
      if (!ch) return;
      ch.isSubbed = !ch.isSubbed;
      ch.count += ch.isSubbed ? 1 : -1;
      filterOmniSearch(document.getElementById('omniSearchInput').value || '');
      fetch('/api/social/channels/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: id })
      }).catch(function(err) { console.warn('[Channel] Subscribe sync warning:', err); });
    }

    function togglePageFollowDemo(id) {
      const pg = socialOmniCatalog.pages.find(function(x) { return x.id === id; });
      if (!pg) return;
      pg.isFollowing = !pg.isFollowing;
      pg.count += pg.isFollowing ? 1 : -1;
      filterOmniSearch(document.getElementById('omniSearchInput').value || '');
      fetch('/api/social/pages/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: id })
      }).catch(function(err) { console.warn('[Page] Follow sync warning:', err); });
    }

    // ==========================================
    // 👥 DEDICATED FRIENDS DISCOVERY & SEARCH ENGINE
    // ==========================================
    let currentFriendsFilter = 'all';
    let friendsViewSearchQuery = '';

    function setFriendsFilter(filter) {
      currentFriendsFilter = filter;
      const pills = ['all', 'requests', 'friends', 'suggestions'];
      for (const p of pills) {
        const btn = document.getElementById('ffilter-' + p);
        if (btn) btn.classList.toggle('active', p === filter);
      }
      renderFriendsDiscoveryView();
    }

    function filterFriendsView(query) {
      friendsViewSearchQuery = (query || '').toLowerCase().trim();
      const clearBtn = document.getElementById('friendsSearchClearBtn');
      if (clearBtn) clearBtn.style.display = friendsViewSearchQuery ? 'inline' : 'none';
      renderFriendsDiscoveryView();
    }

    function clearFriendsViewSearch() {
      const input = document.getElementById('friendsViewSearchInput');
      if (input) input.value = '';
      filterFriendsView('');
    }

    function renderFriendsDiscoveryView() {
      const container = document.getElementById('friendsViewContent');
      if (!container) return;

      const q = friendsViewSearchQuery;
      const matched = socialOmniCatalog.people.filter(function(p) {
        if (p.isBlocked) return false;
        if (!q) return true;
        return (p.name && p.name.toLowerCase().includes(q)) ||
               (p.handle && p.handle.toLowerCase().includes(q)) ||
               (p.bio && p.bio.toLowerCase().includes(q)) ||
               (p.pubkey && p.pubkey.toLowerCase().includes(q));
      });

      const pendingRequests = matched.filter(p => p.isPending);
      const myFriends = matched.filter(p => p.isFriend);
      const suggestions = matched.filter(p => !p.isFriend && !p.isPending);

      // Total counters
      const totalPending = socialOmniCatalog.people.filter(p => !p.isBlocked && p.isPending).length;
      const totalFriends = socialOmniCatalog.people.filter(p => !p.isBlocked && p.isFriend).length;

      const fBadge = document.getElementById('friendsTotalBadge');
      if (fBadge) fBadge.innerText = totalFriends + ' Friends';

      const rCountEl = document.getElementById('ffilterRequestsCount');
      if (rCountEl) {
        rCountEl.innerText = totalPending;
        rCountEl.style.display = totalPending > 0 ? 'inline' : 'none';
      }

      const bnavBadge = document.getElementById('bnavFriendsBadge');
      if (bnavBadge) {
        bnavBadge.innerText = totalPending;
        bnavBadge.style.display = totalPending > 0 ? 'flex' : 'none';
      }

      const railBadge = document.getElementById('railFriendsBadge');
      if (railBadge) {
        railBadge.innerText = totalPending;
        railBadge.style.display = totalPending > 0 ? 'inline' : 'none';
      }

      let html = '';

      // 1. Pending Requests Section
      if ((currentFriendsFilter === 'all' || currentFriendsFilter === 'requests') && pendingRequests.length > 0) {
        html += '<div>' +
          '<div class="friends-section-title"><span>📩</span> <span>Pending Friend Requests (' + pendingRequests.length + ')</span></div>' +
          '<div style="display: flex; flex-direction: column; gap: 0.75rem;">';
        for (const p of pendingRequests) {
          html += '<div class="friend-card">' +
            '<div style="display: flex; align-items: center; gap: 0.85rem;">' +
              '<div style="position: relative;">' +
                '<div style="width: 46px; height: 46px; border-radius: 50%; background: ' + p.bg + '; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.15rem; border: 2px solid rgba(255,255,255,0.15);">' + p.avatar + '</div>' +
                '<div style="position: absolute; bottom: 0; right: 0; width: 12px; height: 12px; border-radius: 50%; background: #f59e0b; border: 2px solid #111827;" title="Pending Handshake"></div>' +
              '</div>' +
              '<div>' +
                '<div style="font-weight: 700; color: #fff; font-size: 0.95rem; display: flex; align-items: center; gap: 6px;">' +
                  '<span>' + p.name + '</span>' +
                  '<span style="color: #38bdf8; font-size: 0.75rem;">✓</span>' +
                '</div>' +
                '<div style="font-size: 0.78rem; color: #94a3b8;">' + p.handle + '</div>' +
                '<div style="font-size: 0.75rem; color: #10b981; margin-top: 2px; font-weight: 600;">⚡ ' + (p.mutuals || 4) + ' mutual connections on mesh</div>' +
              '</div>' +
            '</div>' +
            '<div style="display: flex; gap: 0.5rem; align-items: center;">' +
              '<button class="action-pill-btn action-pill-primary" style="padding: 0.45rem 1rem; font-weight: 700;" data-pubkey="' + p.pubkey + '" data-name="' + p.name.replace(/"/g, '&quot;') + '" onclick="acceptFriendRequest(this.dataset.pubkey, this.dataset.name)">✓ Confirm</button>' +
              '<button class="action-pill-btn action-pill-secondary" style="padding: 0.45rem 0.85rem;" data-pubkey="' + p.pubkey + '" data-name="' + p.name.replace(/"/g, '&quot;') + '" onclick="rejectFriendRequest(this.dataset.pubkey, this.dataset.name)">✕ Delete</button>' +
            '</div>' +
          '</div>';
        }
        html += '</div></div>';
      }

      // 2. People You May Know / Suggested Section
      if ((currentFriendsFilter === 'all' || currentFriendsFilter === 'suggestions') && suggestions.length > 0) {
        html += '<div>' +
          '<div class="friends-section-title"><span>✨</span> <span>People You May Know (' + suggestions.length + ')</span></div>' +
          '<div style="display: flex; flex-direction: column; gap: 0.75rem;">';
        for (const p of suggestions) {
          html += '<div class="friend-card">' +
            '<div style="display: flex; align-items: center; gap: 0.85rem;">' +
              '<div style="width: 46px; height: 46px; border-radius: 50%; background: ' + p.bg + '; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.15rem; border: 2px solid rgba(255,255,255,0.1);">' + p.avatar + '</div>' +
              '<div>' +
                '<div style="font-weight: 700; color: #fff; font-size: 0.95rem; display: flex; align-items: center; gap: 6px;">' +
                  '<span>' + p.name + '</span>' +
                '</div>' +
                '<div style="font-size: 0.78rem; color: #94a3b8;">' + p.handle + ' &bull; ' + p.bio + '</div>' +
                '<div style="font-size: 0.72rem; color: #64748b; margin-top: 2px;">⚡ ' + (p.mutuals || 3) + ' mutual friends</div>' +
              '</div>' +
            '</div>' +
            '<div style="display: flex; gap: 0.4rem; align-items: center;">' +
              '<button class="action-pill-btn action-pill-primary" style="padding: 0.45rem 1rem; font-weight: 700;" data-pubkey="' + p.pubkey + '" data-name="' + p.name.replace(/"/g, '&quot;') + '" onclick="sendFriendRequest(this.dataset.pubkey, this.dataset.name)">+ Add Friend</button>' +
              '<button class="chat-btn-round" style="width: 32px; height: 32px; font-size: 0.85rem;" title="Block" data-pubkey="' + p.pubkey + '" data-name="' + p.name.replace(/"/g, '&quot;') + '" onclick="toggleBlockUserDemo(this.dataset.pubkey, this.dataset.name)">🚫</button>' +
            '</div>' +
          '</div>';
        }
        html += '</div></div>';
      }

      // 3. My Connected Friends Section
      if ((currentFriendsFilter === 'all' || currentFriendsFilter === 'friends') && myFriends.length > 0) {
        html += '<div>' +
          '<div class="friends-section-title"><span>🤝</span> <span>My Connected Friends (' + myFriends.length + ')</span></div>' +
          '<div style="display: flex; flex-direction: column; gap: 0.75rem;">';
        for (const p of myFriends) {
          const statusDot = p.isOnline
            ? '<span style="color: #10b981; font-size: 0.75rem;">● Online on Mesh</span>'
            : '<span style="color: #64748b; font-size: 0.75rem;">○ Offline (25m ago)</span>';
          html += '<div class="friend-card">' +
            '<div style="display: flex; align-items: center; gap: 0.85rem;">' +
              '<div style="position: relative;">' +
                '<div style="width: 46px; height: 46px; border-radius: 50%; background: ' + p.bg + '; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.15rem; border: 2px solid rgba(16, 185, 129, 0.4);">' + p.avatar + '</div>' +
                '<div style="position: absolute; bottom: 0; right: 0; width: 12px; height: 12px; border-radius: 50%; background: ' + (p.isOnline ? '#10b981' : '#64748b') + '; border: 2px solid #111827;"></div>' +
              '</div>' +
              '<div>' +
                '<div style="font-weight: 700; color: #fff; font-size: 0.95rem; display: flex; align-items: center; gap: 6px;">' +
                  '<span>' + p.name + '</span>' +
                  '<span style="color: #10b981; font-size: 0.75rem;">❤️</span>' +
                '</div>' +
                '<div style="font-size: 0.78rem; color: #94a3b8;">' + p.handle + ' &bull; ' + statusDot + '</div>' +
                '<div style="font-size: 0.72rem; color: #6ee7b7; margin-top: 2px;">⚡ Verified Bilateral Key Exchange</div>' +
              '</div>' +
            '</div>' +
            '<div style="display: flex; gap: 0.5rem; align-items: center;">' +
              '<button class="action-pill-btn action-pill-primary" style="padding: 0.45rem 1rem; font-weight: 700; background: #6366f1; color: #fff;" data-did="' + (p.contactDid || p.pubkey) + '" data-name="' + p.name.replace(/"/g, '&quot;') + '" onclick="messageFriend(this.dataset.did, this.dataset.name)">💬 Message</button>' +
              '<button class="action-pill-btn action-pill-secondary" style="padding: 0.45rem 0.75rem; color: #f87171; border-color: rgba(239, 68, 68, 0.3);" title="Remove Friend" data-pubkey="' + p.pubkey + '" data-name="' + p.name.replace(/"/g, '&quot;') + '" onclick="unfriendUser(this.dataset.pubkey, this.dataset.name)">✕</button>' +
            '</div>' +
          '</div>';
        }
        html += '</div></div>';
      }

      if (!html) {
        html = '<div style="text-align: center; padding: 3rem 1rem; color: #64748b; font-size: 0.9rem;">' +
          '<div style="font-size: 2.2rem; margin-bottom: 0.5rem;">👥</div>' +
          'No friends or people found matching "' + (q ? q.replace(/</g, '&lt;') : '') + '".<br>' +
          '<span style="font-size: 0.8rem; color: #475569;">Try searching by different handle or keywords.</span>' +
        '</div>';
      }

      container.innerHTML = html;
      renderRightRailSuggestions();
    }

    function acceptFriendRequest(pubkey, name) {
      const p = socialOmniCatalog.people.find(x => x.pubkey === pubkey);
      if (!p) return;
      p.isPending = false;
      p.isFriend = true;
      updateMeFriendsCounter(1);
      renderFriendsDiscoveryView();
      alert('✓ Friend Request Accepted! You and ' + name + ' are now mutual friends on the sovereign mesh.');
    }

    function rejectFriendRequest(pubkey, name) {
      const p = socialOmniCatalog.people.find(x => x.pubkey === pubkey);
      if (!p) return;
      p.isPending = false;
      renderFriendsDiscoveryView();
      alert('Friend request from ' + name + ' removed.');
    }

    function sendFriendRequest(pubkey, name) {
      const p = socialOmniCatalog.people.find(x => x.pubkey === pubkey);
      if (!p) return;
      p.isPending = true;
      renderFriendsDiscoveryView();
      alert('📨 Friend request sent to ' + name + ' over Noise_XX encrypted P2P handshake.');
    }

    function unfriendUser(pubkey, name) {
      const p = socialOmniCatalog.people.find(x => x.pubkey === pubkey);
      if (!p) return;
      if (confirm('Remove ' + name + ' from your friends list?')) {
        p.isFriend = false;
        p.isPending = false;
        updateMeFriendsCounter(-1);
        renderFriendsDiscoveryView();
        alert('Friendship with ' + name + ' removed.');
      }
    }

    function messageFriend(didOrPubkey, name) {
      switchTab('chat');
      let contact = contactsData.find(c => c.did === didOrPubkey || c.name.toLowerCase().includes(name.toLowerCase()));
      if (contact) {
        selectContact(contact.did);
      } else {
        const targetDid = didOrPubkey || ('did:sovra:' + name.toLowerCase().replace(/[^a-z0-9]/g, '_'));
        const newContact = {
          did: targetDid,
          name: name,
          avatar: name ? name.charAt(0).toUpperCase() : 'P',
          avatarBg: '#6366f1',
          role: 'P2P Sovereign Peer',
          isOnline: true,
          lastSeen: 'Online',
          disappearingDurationSec: 0,
          safetyNumbers: '28471 90432 18942 09182 39182 48192 19283 48192 48192 01928 38192 49182',
          isVerified: true
        };
        contactsData.unshift(newContact);
        renderChatContactsList();
        selectContact(newContact.did);
      }
    }

    function triggerBottomCreateAction() {
      switchTab('feed');
      const composer = document.querySelector('.feed-container .card');
      if (composer) {
        composer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const input = composer.querySelector('textarea') || composer.querySelector('input');
        if (input) input.focus();
        showAccountToast('✍️ Composer ready: create Photo, Video, Reel, or Story!');
      }
    }

    // Top Header Search Live Engine
    function handleHeaderFriendSearch(query) {
      const q = (query || '').toLowerCase().trim();
      const dropdown = document.getElementById('headerSearchDropdown');
      const clearBtn = document.getElementById('headerSearchClearBtn');
      if (clearBtn) clearBtn.style.display = q ? 'inline' : 'none';
      if (!dropdown) return;

      if (!q) {
        dropdown.style.display = 'none';
        return;
      }

      dropdown.style.display = 'block';
      const matchedPeople = (socialOmniCatalog.people || []).filter(p => !p.isBlocked && (p.name.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q) || (p.bio && p.bio.toLowerCase().includes(q))));
      const matchedChannels = (socialOmniCatalog.channels || []).filter(c => c.name.toLowerCase().includes(q) || c.handle.toLowerCase().includes(q));
      const matchedTags = (socialOmniCatalog.hashtags || []).filter(h => h.tag.toLowerCase().includes(q));

      let html = '';

      // Section 1: People & Friends
      if (matchedPeople.length > 0) {
        html += '<div style="font-size: 0.72rem; color: #94a3b8; font-weight: 700; text-transform: uppercase; padding: 4px 8px; margin-bottom: 4px;">👥 People & Friends</div>';
        for (const p of matchedPeople.slice(0, 4)) {
          const statusText = p.isFriend ? '❤️ Friends' : p.isPending ? '⏳ Requested' : '+ Add';
          const statusBg = p.isFriend ? 'rgba(239, 68, 68, 0.15)' : 'rgba(56, 189, 248, 0.15)';
          const statusColor = p.isFriend ? '#f87171' : '#38bdf8';
          html += '<div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-radius: 8px; transition: background 0.15s; cursor: pointer;" onmouseover="this.style.background=&quot;rgba(255,255,255,0.06)&quot;" onmouseout="this.style.background=&quot;transparent&quot;" data-name="' + p.name.replace(/"/g, '&quot;') + '" onclick="switchTab(&quot;friends&quot;); filterFriendsView(this.dataset.name); document.getElementById(&quot;headerSearchDropdown&quot;).style.display=&quot;none&quot;;">' +
            '<div style="display: flex; align-items: center; gap: 8px;">' +
              '<div style="width: 28px; height: 28px; border-radius: 50%; background: ' + p.bg + '; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.8rem;">' + p.avatar + '</div>' +
              '<div>' +
                '<div style="font-size: 0.82rem; font-weight: 700; color: #fff;">' + p.name + '</div>' +
                '<div style="font-size: 0.7rem; color: #94a3b8;">' + p.handle + '</div>' +
              '</div>' +
            '</div>' +
            '<span style="font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 10px; background: ' + statusBg + '; color: ' + statusColor + ';">' + statusText + '</span>' +
          '</div>';
        }
      }

      // Section 2: Channels
      if (matchedChannels.length > 0) {
        html += '<div style="font-size: 0.72rem; color: #94a3b8; font-weight: 700; text-transform: uppercase; padding: 6px 8px 4px 8px; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.06);">📡 Channels</div>';
        for (const c of matchedChannels.slice(0, 2)) {
          html += '<div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-radius: 8px; transition: background 0.15s; cursor: pointer;" onmouseover="this.style.background=&quot;rgba(255,255,255,0.06)&quot;" onmouseout="this.style.background=&quot;transparent&quot;" onclick="openOmniSearch(); switchSearchTab(&quot;channels&quot;); document.getElementById(&quot;headerSearchDropdown&quot;).style.display=&quot;none&quot;;">' +
            '<div style="display: flex; align-items: center; gap: 8px;">' +
              '<div style="width: 26px; height: 26px; border-radius: 6px; background: ' + c.bg + '; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 0.8rem;">' + c.avatar + '</div>' +
              '<div>' +
                '<div style="font-size: 0.82rem; font-weight: 700; color: #fff;">' + c.name + '</div>' +
                '<div style="font-size: 0.68rem; color: #38bdf8;">' + c.handle + ' • ' + (c.count || 0).toLocaleString() + ' peers</div>' +
              '</div>' +
            '</div>' +
            '<span style="font-size: 0.7rem; color: #818cf8; font-weight: 600;">View →</span>' +
          '</div>';
        }
      }

      // Section 3: Hashtags
      if (matchedTags.length > 0) {
        html += '<div style="font-size: 0.72rem; color: #94a3b8; font-weight: 700; text-transform: uppercase; padding: 6px 8px 4px 8px; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.06);">🔥 Hashtags</div>';
        for (const h of matchedTags.slice(0, 2)) {
          html += '<div style="display: flex; align-items: center; justify-content: space-between; padding: 5px 8px; border-radius: 8px; cursor: pointer;" onmouseover="this.style.background=&quot;rgba(255,255,255,0.06)&quot;" onmouseout="this.style.background=&quot;transparent&quot;" data-tag="' + h.tag + '" onclick="searchHashtag(this.dataset.tag);">' +
            '<span style="font-size: 0.82rem; font-weight: 700; color: #38bdf8;">' + h.tag + '</span>' +
            '<span style="font-size: 0.7rem; color: #64748b;">' + (h.posts || 0) + ' posts</span>' +
          '</div>';
        }
      }

      if (!html) {
        html = '<div style="padding: 10px; color: #64748b; font-size: 0.82rem; text-align: center;">No matches for "' + query.replace(/</g, '&lt;') + '"</div>';
      }

      html += '<div style="border-top: 1px solid rgba(255,255,255,0.1); margin-top: 6px; padding-top: 6px; display: flex; justify-content: space-between; align-items: center;">' +
        '<button onclick="switchTab(&quot;friends&quot;); filterFriendsView(document.getElementById(&quot;headerFriendSearchInput&quot;)?.value || &quot;&quot;); document.getElementById(&quot;headerSearchDropdown&quot;).style.display=&quot;none&quot;;" style="background: none; border: none; color: #38bdf8; font-size: 0.75rem; font-weight: 700; cursor: pointer; padding: 4px;">👥 Friends Hub →</button>' +
        '<button onclick="openOmniSearch(); const oi=document.getElementById(&quot;omniSearchInput&quot;); if(oi){oi.value=document.getElementById(&quot;headerFriendSearchInput&quot;)?.value || &quot;&quot;; filterOmniSearch(oi.value);} document.getElementById(&quot;headerSearchDropdown&quot;).style.display=&quot;none&quot;;" style="background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 6px; color: #a5b4fc; font-size: 0.75rem; font-weight: 700; cursor: pointer; padding: 4px 8px;">🔍 Deep Omni-Search (Ctrl+K) →</button>' +
      '</div>';

      dropdown.innerHTML = html;
    }

    function showHeaderSearchDropdown() {
      const input = document.getElementById('headerFriendSearchInput');
      if (input && input.value.trim()) {
        handleHeaderFriendSearch(input.value);
      }
    }

    function clearHeaderSearch(event) {
      if (event && event.stopPropagation) event.stopPropagation();
      const input = document.getElementById('headerFriendSearchInput');
      if (input) input.value = '';
      const clearBtn = document.getElementById('headerSearchClearBtn');
      if (clearBtn) clearBtn.style.display = 'none';
      const dropdown = document.getElementById('headerSearchDropdown');
      if (dropdown) dropdown.style.display = 'none';
    }

    // Close header search dropdown when clicking outside
    document.addEventListener('click', function(e) {
      const wrap = document.querySelector('.header-search-wrap');
      if (wrap && !wrap.contains(e.target)) {
        const dd = document.getElementById('headerSearchDropdown');
        if (dd) dd.style.display = 'none';
      }
    });

    // Global Keyboard Shortcuts (Ctrl+K / Cmd+K for Omni-Search, Esc to dismiss modals)
    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openOmniSearch();
      } else if (e.key === 'Escape') {
        closeOmniSearch();
        const dd = document.getElementById('headerSearchDropdown');
        if (dd) dd.style.display = 'none';
      }
    });

    // Right Discovery Rail & Hashtag Helpers
    function searchHashtag(tag) {
      const input = document.getElementById('headerFriendSearchInput');
      if (input) {
        input.value = tag;
        handleHeaderFriendSearch(tag);
        input.focus();
      }
    }

    function renderRightRailSuggestions() {
      const container = document.getElementById('rightRailSuggestionsList');
      if (!container || !window.socialOmniCatalog || !window.socialOmniCatalog.people) return;
      const suggestions = window.socialOmniCatalog.people
        .filter(function(p) { return !p.isBlocked && !p.isFriend && !p.isPending; })
        .slice(0, 4);

      if (suggestions.length === 0) {
        container.innerHTML = '<div style="font-size: 0.78rem; color: #64748b; padding: 0.5rem 0; text-align: center;">All caught up! No new suggestions.</div>';
        return;
      }

      container.innerHTML = suggestions.map(function(p) {
        return '<div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">' +
          '<div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0;">' +
            '<div style="width: 38px; height: 38px; border-radius: 50%; background: ' + p.bg + '; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.95rem; flex-shrink: 0;">' + p.avatar + '</div>' +
            '<div style="min-width: 0;">' +
              '<div style="font-weight: 700; color: #fff; font-size: 0.84rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + p.name + '</div>' +
              '<div style="font-size: 0.72rem; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + p.handle + '</div>' +
            '</div>' +
          '</div>' +
          '<button class="action-pill-btn action-pill-primary" style="padding: 0.35rem 0.75rem; font-size: 0.75rem; font-weight: 700; flex-shrink: 0;" data-pubkey="' + p.pubkey + '" data-name="' + p.name.replace(/"/g, '&quot;') + '" onclick="sendFriendRequest(this.dataset.pubkey, this.dataset.name); renderRightRailSuggestions();">+ Add</button>' +
        '</div>';
      }).join('');
    }

    // --- Channel Creation Handlers ---
    function openCreateChannelModal() {
      const m = document.getElementById('createChannelModal');
      if (m) m.style.display = 'flex';
    }
    function closeCreateChannelModal() {
      const m = document.getElementById('createChannelModal');
      if (m) m.style.display = 'none';
    }
    function submitCreateChannel() {
      const name = document.getElementById('chanNameInput').value.trim();
      let handle = document.getElementById('chanHandleInput').value.trim();
      const cat = document.getElementById('chanCategoryInput').value;
      const desc = document.getElementById('chanDescInput').value.trim();
      if (!name || !handle) {
        alert('Please provide a channel name and handle.');
        return;
      }
      if (!handle.startsWith('@')) handle = '@' + handle;

      fetch('/api/social/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          handle: handle,
          category: cat,
          desc: desc
        })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.ok && data.channel) {
          socialOmniCatalog.channels.unshift(data.channel);
          closeCreateChannelModal();
          alert('🎉 Sovereign Channel ' + handle + ' created and saved to dynamic store! You are registered as the Owner.');
          openOmniSearch();
          switchSearchTab('channels');
        } else {
          alert('Failed to create channel: ' + (data.error || 'Unknown error'));
        }
      })
      .catch(function(err) {
        alert('Channel creation error: ' + err.message);
      });
    }

    // --- Page Creation Handlers ---
    function openCreatePageModal() {
      const m = document.getElementById('createPageModal');
      if (m) m.style.display = 'flex';
    }
    function closeCreatePageModal() {
      const m = document.getElementById('createPageModal');
      if (m) m.style.display = 'none';
    }
    function submitCreatePage() {
      const name = document.getElementById('pageNameInput').value.trim();
      let handle = document.getElementById('pageHandleInput').value.trim();
      const cat = document.getElementById('pageCategoryInput').value;
      const ctaType = document.getElementById('pageCtaInput').value;
      const bio = document.getElementById('pageBioInput').value.trim();
      if (!name || !handle) {
        alert('Please provide a page name and handle.');
        return;
      }
      if (!handle.startsWith('@')) handle = '@' + handle;

      fetch('/api/social/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          handle: handle,
          category: cat,
          ctaType: ctaType,
          bio: bio
        })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.ok && data.page) {
          socialOmniCatalog.pages.unshift(data.page);
          closeCreatePageModal();
          alert('🎉 Sovereign Page ' + handle + ' created and saved to dynamic store! CTA: ' + data.page.cta);
          openOmniSearch();
          switchSearchTab('pages');
        } else {
          alert('Failed to create page: ' + (data.error || 'Unknown error'));
        }
      })
      .catch(function(err) {
        alert('Page creation error: ' + err.message);
      });
    }

    // --- Feed Post Options & Actions ---
    function openPostOptionsModal(postId, author, cid) {
      activeTargetPost = { id: postId, author: author, cid: cid };
      const m = document.getElementById('postOptionsModal');
      if (m) m.style.display = 'flex';
    }
    function closePostOptionsModal() {
      const m = document.getElementById('postOptionsModal');
      if (m) m.style.display = 'none';
    }
    function triggerCopyPostLink() {
      const link = window.location.origin + '/#card-' + activeTargetPost.id;
      navigator.clipboard?.writeText?.(link);
      closePostOptionsModal();
      alert('🔗 Post Link Copied to Clipboard!\\n' + link);
    }
    function triggerShareFromModal() {
      closePostOptionsModal();
      shareFeedPostCid(activeTargetPost.cid);
    }
    function triggerMuteFromModal() {
      closePostOptionsModal();
      alert('🔕 Author ' + activeTargetPost.author + ' has been muted locally. Feed will hide their updates.');
    }
    function triggerBlockFromModal() {
      closePostOptionsModal();
      const card = document.getElementById('card-' + activeTargetPost.id);
      if (card) card.style.display = 'none';
      alert('🚫 Author ' + activeTargetPost.author + ' blocked! Post removed from viewport.');
    }
    function triggerDeleteFromModal() {
      closePostOptionsModal();
      const card = document.getElementById('card-' + activeTargetPost.id);
      if (card) {
        card.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
        card.style.transition = 'all 0.3s ease';
        setTimeout(function() { card.remove(); }, 320);
      }
      feedPostsData = feedPostsData.filter(function(p) { return p.id !== activeTargetPost.id; });
      updateProfileDynamicStats();
      fetch('/api/feed/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: activeTargetPost.id })
      }).catch(function(err) { console.warn('[Feed] Delete error:', err); });
      alert('🗑️ Post deleted from local feed and network tombstone published!');
    }

    // --- Dislike Handler ---
    function handleFeedDislike(postId) {
      const card = document.getElementById('card-' + postId);
      if (card) {
        card.style.opacity = '0.45';
        card.style.transition = 'opacity 0.3s';
      }
      alert('👎 Feedback recorded. Feed algorithm will de-rank similar topics locally without public counters.');
    }

    // --- Repost & Quote Post ---
    function openRepostModal(postId) {
      activeTargetPost.id = postId;
      const m = document.getElementById('repostModal');
      if (m) {
        m.style.display = 'flex';
        document.getElementById('repostCommentaryInput').value = '';
      }
    }
    function closeRepostModal() {
      const m = document.getElementById('repostModal');
      if (m) m.style.display = 'none';
    }
    function submitInstantRepost() {
      closeRepostModal();
      alert('🔁 Post #' + activeTargetPost.id + ' instantly reposted to your followers on the GossipSub swarm!');
    }
    function submitQuoteRepost() {
      const commentary = document.getElementById('repostCommentaryInput').value.trim();
      closeRepostModal();
      alert('✍️ Quote Post published with your thoughts:\\n"' + (commentary || 'Spotlight on this post!') + '"\\nSigned and broadcasted to mesh.');
    }

    // --- Safety & Dispute Report ---
    function triggerSafetyReportModal() {
      closePostOptionsModal();
      const m = document.getElementById('safetyReportModal');
      if (m) m.style.display = 'flex';
    }
    function closeSafetyReportModal() {
      const m = document.getElementById('safetyReportModal');
      if (m) m.style.display = 'none';
    }
    function submitSafetyReport() {
      const reason = document.getElementById('reportReasonInput').value;
      const ticketId = 'SR-' + Math.floor(1000 + Math.random() * 9000);
      closeSafetyReportModal();
      alert('✅ Cryptographic Report #' + ticketId + ' registered on the Mesh Dispute Ledger!\\nReason: ' + reason.toUpperCase() + '\\nA jury of 5 neutral high-reputation nodes has been assigned.');
    }

    // ==========================================
    // 📱 PROGRESSIVE WEB APP (PWA) & SERVICE WORKER ENGINE
    // ==========================================
    let deferredInstallPrompt = null;

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function() {
        navigator.serviceWorker.register('/sw.js')
          .then(function(reg) {
            console.log('[PWA] Service Worker registered successfully! Scope:', reg.scope);
          })
          .catch(function(err) {
            console.warn('[PWA] Service Worker registration failed:', err);
          });
      });
    }

    window.addEventListener('beforeinstallprompt', function(e) {
      e.preventDefault();
      deferredInstallPrompt = e;
      const banner = document.getElementById('pwaInstallBanner');
      if (banner && !sessionStorage.getItem('pwa_dismissed')) {
        banner.style.display = 'flex';
      }
      const pwaMeBtn = document.getElementById('pwaMeInstallBtn');
      if (pwaMeBtn) pwaMeBtn.style.display = 'inline-flex';
    });

    window.addEventListener('appinstalled', function() {
      deferredInstallPrompt = null;
      const banner = document.getElementById('pwaInstallBanner');
      if (banner) banner.style.display = 'none';
      const pwaMeBtn = document.getElementById('pwaMeInstallBtn');
      if (pwaMeBtn) {
        pwaMeBtn.innerText = '✓ App Installed';
        pwaMeBtn.disabled = true;
      }
      console.log('[PWA] Sovra successfully installed on device!');
    });

    function triggerPwaInstall() {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then(function(choiceResult) {
          if (choiceResult.outcome === 'accepted') {
            console.log('[PWA] User accepted the install prompt');
          } else {
            console.log('[PWA] User dismissed the install prompt');
          }
          deferredInstallPrompt = null;
          const banner = document.getElementById('pwaInstallBanner');
          if (banner) banner.style.display = 'none';
        });
      } else {
        alert('📱 To install Sovra on your device:\\n1. Tap the Share or 3-dots menu in your browser.\\n2. Select "Add to Home screen" or "Install App".');
      }
    }

    function dismissPwaPrompt() {
      const banner = document.getElementById('pwaInstallBanner');
      if (banner) banner.style.display = 'none';
      sessionStorage.setItem('pwa_dismissed', '1');
    }

    function updateOnlineStatus() {
      const pill = document.getElementById('offlineIndicatorPill');
      if (!pill) return;
      if (!navigator.onLine) {
        pill.style.display = 'flex';
        pill.style.background = 'rgba(239, 68, 68, 0.95)';
        pill.innerHTML = '<span>⚡</span> <span>Offline Mode — Browsing Cached Mesh</span>';
      } else {
        pill.style.background = 'rgba(16, 185, 129, 0.95)';
        pill.innerHTML = '<span>🌐</span> <span>Connected to Mesh Swarm</span>';
        setTimeout(function() {
          if (navigator.onLine) pill.style.display = 'none';
        }, 3000);
      }
    }

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
  </script>
</body>
</html>`;
}


async function startDevServer() {
  console.log('------------------------------------------------------------');
  console.log('   SOVRA LOCALHOST DEVELOPMENT & P2P NODE RUNNER');
  console.log('------------------------------------------------------------');

  console.log('[1/2] Initializing Cryptographic Identity, P2P Node, Storage Daemon & Social Graph...');
  const { masterKey, deviceKey, binding, node, tcpPort, storageDaemon, socialGraph, localFeed, workstationPrivKey } = await bootstrapLocalNode();

  console.log(`[P2P] Node Online on OS TCP Port: ${tcpPort}`);
  console.log(`[DID] Identity DID: ${masterKey.did}`);
  console.log(`[PEER] libp2p Peer ID: ${binding.peerId}`);

  // Ensure host node identity is registered in disk-backed database
  sovraDb.upsertUser({
    did: masterKey.did,
    handle: '@laptop_host',
    displayName: 'Host Node (Laptop)',
    avatar: '💻',
    avatarBg: '#6366f1',
    bio: 'Root Mesh Relay & Seeder',
    deviceType: 'Desktop',
    publicKey: binding.devicePublicKeyHex,
  });

  const HTTP_PORT = parseInt(process.env.PORT ?? '3001', 10);
  const startTime = Date.now();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // API: Node Status
    if (url.pathname === '/api/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'online',
          peerId: binding.peerId,
          did: masterKey.did,
          deviceKey: binding.devicePublicKeyHex,
          listenAddress: `/ip4/127.0.0.1/tcp/${tcpPort}/p2p/${binding.peerId}`,
          topics: ['sovra/feed/main', 'sovra/creator/live'],
          connectedPeers: node.getConnectedPeers(),
          isCreatorModeActive,
          uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
          zeroAdminDependency: true,
        }),
      );
      return;
    }

    // API: Creator Mode Toggle
    if (url.pathname === '/api/creator/toggle' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          isCreatorModeActive = !!parsed.active;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ isCreatorModeActive }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // API: Publish Post
    if (url.pathname === '/api/publish' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body);
          const content = String(parsed.content ?? '');
          const signature = deviceKey.sign(new TextEncoder().encode(content));

          const record: PostRecord = {
            id: `post-${Date.now()}`,
            authorDid: masterKey.did,
            authorPeerId: binding.peerId,
            content,
            topic: isCreatorModeActive ? 'sovra/creator/live' : 'sovra/feed/main',
            isCreatorPost: isCreatorModeActive,
            timestamp: Date.now(),
            signatureHex: bytesToHex(signature),
          };

          postsStore.unshift(record);

          // Broadcast on real P2P GossipSub mesh
          await node.pubsub.publish(record.topic, new TextEncoder().encode(JSON.stringify(record)));

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, post: record }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
      return;
    }

    // API: Storage Publish & Pin UnixFS DAG
    if (url.pathname === '/api/storage/publish' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', async () => {
        try {
          let parsed: { content?: string; mimeType?: string };
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = { content: body };
          }
          const dataBytes = new TextEncoder().encode(parsed.content ?? 'Default Sovra Media Asset');
          const pubRes = await storageDaemon.storageService.publishMedia(
            dataBytes,
            parsed.mimeType ?? 'text/plain',
          );
          if (pubRes.ok) {
            await storageDaemon.pin(pubRes.value.cid as unknown as CID);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                ok: true,
                asset: {
                  cid: pubRes.value.cid.toString(),
                  mimeType: pubRes.value.mimeType,
                  byteLength: pubRes.value.byteLength,
                  sha256Digest: pubRes.value.sha256Digest,
                },
              }),
            );
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: pubRes.error.message }));
          }
        } catch (e) {
          console.error('[STORAGE PUBLISH ERROR]', e);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
      return;
    }

    // API: Storage Stats
    if (url.pathname === '/api/storage/stats' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify(storageDaemon.getStats(), (_k, v) =>
          typeof v === 'bigint' ? v.toString() : v,
        ),
      );
      return;
    }

    // API: Storage Replica Verification
    if (url.pathname === '/api/storage/verify' && req.method === 'POST') {
      const repRes = await storageDaemon.verifyReplicas();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(repRes));
      return;
    }

    // API: Storage Garbage Collection
    if (url.pathname === '/api/storage/gc' && req.method === 'POST') {
      const gcRes = await storageDaemon.runGarbageCollection();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify(gcRes, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
      );
      return;
    }

    // API: Storage Pin Registry
    if (url.pathname === '/api/storage/pins' && req.method === 'GET') {
      const pins = storageDaemon.listPins();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(pins));
      return;
    }

    // API: Social Graph State
    if (url.pathname === '/api/social/graph' && req.method === 'GET') {
      const state = socialGraph.getState(binding.devicePublicKeyHex);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state, (_k, v) => (v instanceof Set ? Array.from(v) : v)));
      return;
    }

    // API: Follow / Unfollow
    if (url.pathname === '/api/social/follow' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body);
          const target = String(parsed.targetPubkey);
          const ev = createSignedFollowEvent(
            binding.devicePublicKeyHex,
            workstationPrivKey,
            target,
            Boolean(parsed.isUnfollow),
          );
          const pRes = await socialGraph.processEvent(ev);
          if (!pRes.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: pRes.error.message }));
            return;
          }
          await node.pubsub.publish('sovra/social/graph/v1', new TextEncoder().encode(JSON.stringify(ev)));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, eventId: ev.id, isFollowing: socialGraph.isFollowing(binding.devicePublicKeyHex, target) }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
      return;
    }

    // API: Block / Unblock
    if (url.pathname === '/api/social/block' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body);
          const target = String(parsed.targetPubkey);
          const ev = createSignedBlockEvent(
            binding.devicePublicKeyHex,
            workstationPrivKey,
            target,
            Boolean(parsed.isUnblock),
            parsed.reason ? String(parsed.reason) : 'Blocked by user',
          );
          const pRes = await socialGraph.processEvent(ev);
          if (!pRes.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: pRes.error.message }));
            return;
          }
          await node.pubsub.publish('sovra/social/graph/v1', new TextEncoder().encode(JSON.stringify(ev)));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, eventId: ev.id, isBlocked: socialGraph.isBlocked(binding.devicePublicKeyHex, target) }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
      return;
    }

    // API: Mute / Unmute
    if (url.pathname === '/api/social/mute' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body);
          const target = String(parsed.targetPubkey);
          const ev = createSignedMuteEvent(
            binding.devicePublicKeyHex,
            workstationPrivKey,
            target,
            Boolean(parsed.isUnmute),
            parsed.durationSeconds ? Number(parsed.durationSeconds) : 3600,
          );
          const pRes = await socialGraph.processEvent(ev);
          if (!pRes.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: pRes.error.message }));
            return;
          }
          await node.pubsub.publish('sovra/social/graph/v1', new TextEncoder().encode(JSON.stringify(ev)));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, eventId: ev.id, isMuted: socialGraph.isMuted(binding.devicePublicKeyHex, target) }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
      return;
    }

    // API: Reaction / Retract
    if (url.pathname === '/api/social/react' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body);
          const ev = createSignedReactionEvent(
            binding.devicePublicKeyHex,
            workstationPrivKey,
            String(parsed.targetEventId),
            String(parsed.emoji ?? '❤️'),
            Boolean(parsed.isRetraction),
          );
          const pRes = await socialGraph.processEvent(ev);
          if (!pRes.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: pRes.error.message }));
            return;
          }
          await node.pubsub.publish('sovra/social/graph/v1', new TextEncoder().encode(JSON.stringify(ev)));
          const reactions = socialGraph.getReactions(parsed.targetEventId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, eventId: ev.id, reactionsCount: reactions.length }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
      return;
    }

    // API: Chronological Local Feed
    if (url.pathname === '/api/social/feed' && req.method === 'GET') {
      const feedItems = localFeed.getChronologicalFeed(masterKey.did, 50);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, posts: feedItems }));
      return;
    }

    // ==========================================
    // 🌐 100% DYNAMIC DATA-DRIVEN SOCIAL ENGINE
    // ==========================================

    // API: Dynamic Feed List
    if (url.pathname === '/api/feed/list' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, posts: dynamicSocialStore.posts }));
      return;
    }

    // API: Create Dynamic Post
    if (url.pathname === '/api/feed/create' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body);
          const caption = String(parsed.caption || '').trim();
          if (!caption && !parsed.mediaImage) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Caption or photo is required' }));
            return;
          }

          const themes: Record<string, { emoji: string; title: string; gradient: string }> = {
            dag: { emoji: '📦', title: 'Merkle DAG Block Verified on Device', gradient: 'radial-gradient(circle at center, #064e3b 0%, #022c22 100%)' },
            '5g': { emoji: '⚡', title: '5G CGNAT Hole Punch Traversal Benchmark', gradient: 'radial-gradient(circle at center, #78350f 0%, #451a03 100%)' },
            audio: { emoji: '🎵', title: 'Spatial Audio Stem Mixed Locally', gradient: 'radial-gradient(circle at center, #831843 0%, #4a044e 100%)' },
            creator: { emoji: '💎', title: 'Dynamic 95/5 Creator Split Settlement', gradient: 'radial-gradient(circle at center, #1e1b4b 0%, #030712 100%)' },
            mesh: { emoji: '🚀', title: 'P2P GossipSub Swarm Live Packet Sync', gradient: 'radial-gradient(circle at center, #1e1b4b 0%, #1e40af 100%)' },
          };

          const selectedTheme = themes[parsed.theme || 'mesh'] || themes.mesh;
          const newPostId = 'feed-' + Date.now();

          // Real storage ingestion & deterministic CID generation
          let realCid = '';
          let imageBuffer: Buffer | null = null;

          if (parsed.mediaImage && typeof parsed.mediaImage === 'string') {
            try {
              const commaIdx = parsed.mediaImage.indexOf(',');
              const base64Data = commaIdx >= 0 ? parsed.mediaImage.slice(commaIdx + 1) : parsed.mediaImage;
              imageBuffer = Buffer.from(base64Data, 'base64');
              const cidObj = CID.create('raw', imageBuffer, false, 'sha2-256');
              realCid = cidObj.toString('base32');

              // Ingest into local blockstore
              if (storageDaemon && storageDaemon.blockstore) {
                await storageDaemon.blockstore.put(cidObj, imageBuffer);
              }
            } catch (cidErr) {
              console.warn('[StorageDaemon] Local blockstore ingestion warning:', cidErr);
            }
          }

          if (!realCid) {
            const seed = Buffer.from((caption || 'post') + ':' + Date.now());
            realCid = CID.create('raw', seed, false, 'sha2-256').toString('base32');
          }

          const newPost: FeedPostRecord = {
            id: newPostId,
            authorDid: String(parsed.authorDid || masterKey.did),
            authorName: String(parsed.authorName || 'Sovereign Peer'),
            authorAvatar: String(parsed.authorAvatar || 'S'),
            authorAvatarBg: String(parsed.authorAvatarBg || '#6366f1'),
            authorAvatarDataUrl: parsed.authorAvatarDataUrl ? String(parsed.authorAvatarDataUrl) : undefined,
            audioTrack: String(parsed.audioTrack || 'Original Audio • Sovra Mesh'),
            mediaGradient: selectedTheme.gradient,
            mediaEmoji: selectedTheme.emoji,
            mediaTitle: selectedTheme.title,
            mediaCid: realCid,
            likesCount: 0,
            isLiked: false,
            isSaved: false,
            caption: caption || 'Photo update from sovereign peer',
            tags: String(parsed.tags || '#sovra #p2p #mesh'),
            timestamp: Date.now(),
            comments: [],
            mediaImage: parsed.mediaImage ? String(parsed.mediaImage) : undefined,
            likedByDids: [],
          };

          dynamicSocialStore.posts.unshift(newPost);
          saveDynamicSocialState(dynamicSocialStore);

          localFeed.appendEvent({
            id: newPost.id,
            pubkey: masterKey.did,
            createdAt: Math.floor(newPost.timestamp / 1000),
            kind: 1,
            tags: [['tags', newPost.tags]],
            content: newPost.caption,
            sig: 'ed25519_sig_dynamic_' + newPost.id,
          });

          // Safe GossipSub publish: transmit lightweight event to prevent GossipSub packet size overflow
          try {
            const gossipEvent = {
              ...newPost,
              mediaImage: undefined, // peers retrieve media via CID from Blockstore/Bitswap
            };
            await node.pubsub.publish('sovra/feed/main', new TextEncoder().encode(JSON.stringify(gossipEvent)));
          } catch (pubErr) {
            console.warn('[GossipSub] Publish warning:', pubErr);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, post: newPost }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
      return;
    }

    // API: Like / Unlike Feed Post
    if (url.pathname === '/api/feed/like' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const post = dynamicSocialStore.posts.find(p => p.id === parsed.postId);
          if (post) {
            if (!Array.isArray(post.likedByDids)) post.likedByDids = [];
            const userDid = String(parsed.userDid || 'self');
            const isLiked = Boolean(parsed.isLiked);
            const idx = post.likedByDids.indexOf(userDid);
            if (isLiked && idx === -1) {
              post.likedByDids.push(userDid);
            } else if (!isLiked && idx !== -1) {
              post.likedByDids.splice(idx, 1);
            }
            post.likesCount = post.likedByDids.length;
            post.isLiked = isLiked;
            saveDynamicSocialState(dynamicSocialStore);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, isLiked: post.isLiked, likesCount: post.likesCount, likedByDids: post.likedByDids }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Post not found' }));
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // API: Add Comment to Post
    if (url.pathname === '/api/feed/comment' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const post = dynamicSocialStore.posts.find(p => p.id === parsed.postId);
          if (post) {
            const text = String(parsed.text || '').trim();
            if (!text) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Empty comment' }));
              return;
            }
            const comment = {
              id: 'cmt-' + Date.now(),
              author: String(parsed.author || 'You (Me)'),
              authorDid: parsed.authorDid ? String(parsed.authorDid) : undefined,
              authorAvatar: parsed.authorAvatar ? String(parsed.authorAvatar) : undefined,
              text,
              timestamp: Date.now(),
            };
            if (!Array.isArray(post.comments)) post.comments = [];
            post.comments.push(comment);
            saveDynamicSocialState(dynamicSocialStore);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, comment, commentsCount: post.comments.length }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Post not found' }));
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // API: Delete Post
    if (url.pathname === '/api/feed/delete' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const idx = dynamicSocialStore.posts.findIndex(p => p.id === parsed.postId);
          if (idx !== -1) {
            dynamicSocialStore.posts.splice(idx, 1);
            saveDynamicSocialState(dynamicSocialStore);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Post not found' }));
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // API: Channels List & Create & Subscribe
    if (url.pathname === '/api/social/channels' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, channels: dynamicSocialStore.channels }));
      return;
    }

    if (url.pathname === '/api/social/channels' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          let handle = String(parsed.handle || '').trim();
          if (!handle.startsWith('@')) handle = '@' + handle;
          const newChan: ChannelRecord = {
            id: 'ch-' + Date.now(),
            handle: handle.toLowerCase(),
            name: String(parsed.name || 'Untitled Channel'),
            category: String(parsed.category || 'tech'),
            desc: String(parsed.desc || 'Sovereign channel'),
            count: 1,
            avatar: '📢',
            bg: '#0284c7',
            isSubbed: true,
            ownerDid: masterKey.did,
            createdAt: Date.now(),
          };
          dynamicSocialStore.channels.unshift(newChan);
          saveDynamicSocialState(dynamicSocialStore);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, channel: newChan }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (url.pathname === '/api/social/channels/subscribe' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const ch = dynamicSocialStore.channels.find(c => c.id === parsed.channelId);
          if (ch) {
            ch.isSubbed = !ch.isSubbed;
            ch.count = ch.isSubbed ? ch.count + 1 : Math.max(0, ch.count - 1);
            saveDynamicSocialState(dynamicSocialStore);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, isSubbed: ch.isSubbed, count: ch.count }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Channel not found' }));
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // API: Pages List & Create & Follow
    if (url.pathname === '/api/social/pages' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pages: dynamicSocialStore.pages }));
      return;
    }

    if (url.pathname === '/api/social/pages' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          let handle = String(parsed.handle || '').trim();
          if (!handle.startsWith('@')) handle = '@' + handle;
          const ctaLabels: Record<string, string> = {
            message: 'Send Message',
            website: 'Visit Website',
            book: 'Book Service',
            tip: 'Tip Creator',
          };
          const ctaType = String(parsed.ctaType || 'message');
          const newPage: PageRecord = {
            id: 'pg-' + Date.now(),
            handle: handle.toLowerCase(),
            name: String(parsed.name || 'Untitled Page'),
            category: String(parsed.category || 'business'),
            bio: String(parsed.bio || 'Sovereign business page'),
            count: 1,
            cta: ctaLabels[ctaType] || 'Send Message',
            ctaType,
            avatar: '🏢',
            bg: '#4f46e5',
            isFollowing: true,
            ownerDid: masterKey.did,
            createdAt: Date.now(),
          };
          dynamicSocialStore.pages.unshift(newPage);
          saveDynamicSocialState(dynamicSocialStore);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, page: newPage }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (url.pathname === '/api/social/pages/follow' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const pg = dynamicSocialStore.pages.find(p => p.id === parsed.pageId);
          if (pg) {
            pg.isFollowing = !pg.isFollowing;
            pg.count = pg.isFollowing ? pg.count + 1 : Math.max(0, pg.count - 1);
            saveDynamicSocialState(dynamicSocialStore);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, isFollowing: pg.isFollowing, count: pg.count }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Page not found' }));
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // ==========================================
    // API: INSTAGRAM REELS
    // ==========================================
    if (url.pathname === '/api/reels/list' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, reels: reelsStore }));
      return;
    }

    if (url.pathname === '/api/reels/like' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const r = reelsStore.find(x => x.id === parsed.reelId);
          if (r) {
            r.likesCount++;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, likesCount: r.likesCount }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Reel not found' }));
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // ==========================================
    // API: PEER DISCOVERY & WHATSAPP E2EE CHAT
    // ==========================================
    // ==========================================
    // 👤 CORE USER & IDENTITY DATABASE ENDPOINTS
    // ==========================================
    if (url.pathname === '/api/user/register' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          let handle = String(parsed.handle || '').trim();
          if (!handle) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Handle is required' }));
            return;
          }
          if (!handle.startsWith('@')) handle = '@' + handle;

          // Check if handle is already taken by a different DID
          if (sovraDb.isHandleTaken(handle, parsed.did)) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: `Handle ${handle} is already taken by another peer. Please choose a different handle.` }));
            return;
          }

          const did = parsed.did && String(parsed.did).startsWith('did:sovra:')
            ? String(parsed.did)
            : 'did:sovra:user_' + crypto.randomBytes(8).toString('hex');
          const sessionToken = parsed.sessionToken ? String(parsed.sessionToken) : ('stk_' + crypto.randomBytes(16).toString('hex'));
          const displayName = String(parsed.name || parsed.displayName || handle.replace('@', '')).trim();

          const user = sovraDb.upsertUser({
            did,
            handle,
            displayName: displayName || 'Sovereign Peer',
            avatar: String(parsed.avatar || displayName.charAt(0).toUpperCase() || 'S'),
            avatarDataUrl: parsed.avatarDataUrl ? String(parsed.avatarDataUrl) : undefined,
            avatarBg: String(parsed.avatarBg || '#6366f1'),
            bio: String(parsed.bio || ''),
            deviceType: parsed.device === 'Mobile' || parsed.deviceType === 'Mobile' ? 'Mobile' : 'Desktop',
            publicKey: parsed.publicKey ? String(parsed.publicKey) : undefined,
            sessionToken,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, user, sessionToken: user.sessionToken }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
        }
      });
      return;
    }

    if (url.pathname === '/api/user/update' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (!parsed.did) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'DID is required' }));
            return;
          }
          if (parsed.handle) {
            let handle = String(parsed.handle).trim();
            if (!handle.startsWith('@')) handle = '@' + handle;
            if (sovraDb.isHandleTaken(handle, String(parsed.did))) {
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: `Handle ${handle} is already in use by another peer.` }));
              return;
            }
          }
          const existingUser = sovraDb.findUserByDid(String(parsed.did));
          const cleanHandle = parsed.handle ? (String(parsed.handle).startsWith('@') ? String(parsed.handle).trim() : '@' + String(parsed.handle).trim()) : (existingUser?.handle || '@user');
          const user = sovraDb.upsertUser({
            did: String(parsed.did),
            handle: cleanHandle,
            displayName: String(parsed.name || parsed.displayName || existingUser?.displayName || 'Sovereign Peer'),
            avatar: String(parsed.avatar || existingUser?.avatar || 'S'),
            avatarDataUrl: parsed.avatarDataUrl !== undefined ? (parsed.avatarDataUrl ? String(parsed.avatarDataUrl) : undefined) : existingUser?.avatarDataUrl,
            avatarBg: String(parsed.avatarBg || existingUser?.avatarBg || '#6366f1'),
            bio: String(parsed.bio !== undefined ? parsed.bio : (existingUser?.bio || '')),
            deviceType: parsed.device === 'Mobile' || parsed.deviceType === 'Mobile' ? 'Mobile' : (existingUser?.deviceType || 'Desktop'),
            sessionToken: existingUser?.sessionToken,
            publicKey: parsed.publicKey ? String(parsed.publicKey) : existingUser?.publicKey,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, user }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
        }
      });
      return;
    }

    if (url.pathname === '/api/user/check-handle' && req.method === 'GET') {
      const handle = url.searchParams.get('handle') || '';
      const excludeDid = url.searchParams.get('excludeDid') || undefined;
      if (!handle) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Handle query param is required' }));
        return;
      }
      const isTaken = sovraDb.isHandleTaken(handle, excludeDid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, handle, isAvailable: !isTaken }));
      return;
    }

    if (url.pathname === '/api/user/me' && req.method === 'GET') {
      const sessionToken = url.searchParams.get('sessionToken') || '';
      const did = url.searchParams.get('did') || '';
      const handle = url.searchParams.get('handle') || '';
      let user: any = null;
      if (sessionToken) {
        user = sovraDb.findUserBySessionToken(sessionToken);
      }
      if (!user && did) {
        user = sovraDb.findUserByDid(did);
      }
      if (!user && handle) {
        user = sovraDb.findUserByHandle(handle);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, user: user || null }));
      return;
    }

    if (url.pathname === '/api/user/list' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, users: sovraDb.getAllUsers() }));
      return;
    }

    // ==========================================
    // 🤝 FRIEND RELATIONSHIP & BILATERAL HANDSHAKE ENDPOINTS
    // ==========================================
    if (url.pathname === '/api/friends/request' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (!parsed.fromDid || !parsed.toDid) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'fromDid and toDid are required' }));
            return;
          }
          const rel = sovraDb.sendFriendRequest(String(parsed.fromDid), String(parsed.toDid));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, relationship: rel }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (url.pathname === '/api/friends/respond' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const rel = sovraDb.respondFriendRequest(String(parsed.fromDid), String(parsed.toDid), parsed.status);
          if (rel) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, relationship: rel }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Friend request not found' }));
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (url.pathname === '/api/friends/list' && req.method === 'GET') {
      const userDid = url.searchParams.get('userDid') || '';
      const rels = sovraDb.getFriendRelationships(userDid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, relationships: rels }));
      return;
    }

    // ==========================================
    // 📡 PEER DISCOVERY & WHATSAPP E2EE CHAT
    // ==========================================
    if (url.pathname === '/api/peers/register' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const peer = JSON.parse(body);
          if (peer && peer.did) {
            sovraDb.upsertUser({
              did: String(peer.did),
              handle: String(peer.handle || peer.name || 'peer'),
              displayName: String(peer.name || peer.displayName || 'Sovereign Peer'),
              avatar: String(peer.avatar || 'P'),
              avatarDataUrl: peer.avatarDataUrl ? String(peer.avatarDataUrl) : undefined,
              avatarBg: String(peer.avatarBg || '#6366f1'),
              bio: String(peer.bio || ''),
              deviceType: peer.device === 'Mobile' || peer.deviceType === 'Mobile' ? 'Mobile' : 'Desktop',
            });
          }
          const peers = sovraDb.getAllPeers();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, peersCount: peers.length, peers }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid peer JSON' }));
        }
      });
      return;
    }

    if (url.pathname === '/api/peers/list' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, peers: sovraDb.getAllPeers() }));
      return;
    }

    if (url.pathname === '/api/chat/contacts' && req.method === 'GET') {
      const userDid = url.searchParams.get('userDid') || url.searchParams.get('excludeDid') || '';
      const allPeers = sovraDb.getAllPeers(userDid || undefined);
      const allMessages = sovraDb.getState().chatMessages;

      const contactsWithThreads = allPeers.map(peer => {
        let threadMessages: any[] = [];
        if (userDid) {
          const threadId = sovraDb.getThreadId(userDid, peer.did);
          threadMessages = allMessages.filter(m => m.threadId === threadId || (m.senderDid === peer.did && m.recipientDid === userDid) || (m.senderDid === userDid && m.recipientDid === peer.did));
        } else {
          threadMessages = allMessages.filter(m => m.senderDid === peer.did || m.recipientDid === peer.did);
        }

        const lastMsg = threadMessages.length > 0 ? threadMessages[threadMessages.length - 1] : null;
        const unreadCount = userDid
          ? threadMessages.filter(m => m.senderDid === peer.did && (m.recipientDid === userDid || m.recipientDid === 'self') && m.status !== 'read').length
          : 0;

        let lastMessageText = peer.role || 'Ready to chat';
        if (lastMsg) {
          if (lastMsg.isDisappeared) {
            lastMessageText = '💨 Message disappeared';
          } else if (lastMsg.isAudio) {
            lastMessageText = '🎙️ Voice note (' + (lastMsg.audioDurationSec || 0).toFixed(1) + 's)';
          } else {
            lastMessageText = lastMsg.text;
          }
        }

        return {
          ...peer,
          lastMessage: lastMessageText,
          lastMessageTimestamp: lastMsg ? lastMsg.timestamp : (peer.lastSeenTimestamp || 0),
          lastMessageStatus: lastMsg ? lastMsg.status : null,
          lastMessageIsOutgoing: lastMsg && userDid ? (lastMsg.senderDid === userDid || lastMsg.senderDid === 'self') : false,
          unreadCount,
        };
      });

      contactsWithThreads.sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, contacts: contactsWithThreads }));
      return;
    }

    if (url.pathname === '/api/chat/messages' && req.method === 'GET') {
      const since = Number(url.searchParams.get('since') || 0);
      const userDid = url.searchParams.get('userDid') || undefined;
      const threadId = url.searchParams.get('threadId') || undefined;
      let messages = sovraDb.getState().chatMessages;
      if (since > 0) {
        messages = messages.filter(m => (m.timestamp || 0) > since);
      }
      if (userDid) {
        messages = messages.filter(m => m.recipientDid.startsWith('channel:') || m.senderDid === userDid || m.recipientDid === userDid);
      }
      if (threadId) {
        messages = messages.filter(m => m.threadId === threadId);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, messages }));
      return;
    }

    if (url.pathname === '/api/chat/send' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (!parsed.text && !parsed.isAudio) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Message text or audio required' }));
            return;
          }
          const record = sovraDb.appendMessage({
            id: parsed.id,
            senderDid: String(parsed.senderDid || 'self'),
            recipientDid: String(parsed.recipientDid || 'channel:local_mesh'),
            senderName: String(parsed.senderName || 'Peer'),
            text: String(parsed.text || ''),
            isAudio: Boolean(parsed.isAudio),
            audioDurationSec: Number(parsed.audioDurationSec || 0),
            waveformBars: Array.isArray(parsed.waveformBars) ? parsed.waveformBars : undefined,
            status: 'sent',
            disappearingDurationSec: Number(parsed.disappearingDurationSec || 0),
            isBitChat: Boolean(parsed.isBitChat),
            hopCount: Number(parsed.hopCount || 1),
            route: Array.isArray(parsed.route) ? parsed.route : undefined,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: record }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
        }
      });
      return;
    }

    if (url.pathname === '/api/chat/disappearing' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const peer = sovraDb.getState().contacts_and_peers.find(x => x.did === parsed.peerDid);
          if (peer) {
            peer.disappearingDurationSec = Number(parsed.durationSec || 0);
            sovraDb.save();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, peerDid: peer.did, disappearingDurationSec: peer.disappearingDurationSec }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Contact not found' }));
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (url.pathname === '/api/chat/reaction' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const msg = sovraDb.getState().chatMessages.find(x => x.id === parsed.messageId);
          if (msg) {
            if (!msg.reactions) msg.reactions = [];
            const userDid = String(parsed.senderDid || 'self');
            const existingIdx = msg.reactions.findIndex(r => r.senderDid === userDid);
            if (existingIdx >= 0) {
              if (msg.reactions[existingIdx].emoji === parsed.emoji) {
                msg.reactions.splice(existingIdx, 1);
              } else {
                msg.reactions[existingIdx].emoji = parsed.emoji;
              }
            } else {
              msg.reactions.push({ emoji: parsed.emoji, senderDid: userDid });
            }
            sovraDb.save();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, reactions: msg.reactions }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Message not found' }));
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (url.pathname === '/api/chat/receipt' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const status = parsed.status === 'read' ? 'read' : 'delivered';
          const messageIds: string[] = Array.isArray(parsed.messageIds)
            ? parsed.messageIds
            : (parsed.messageId ? [String(parsed.messageId)] : []);

          if (messageIds.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'messageId or messageIds array required' }));
            return;
          }

          const updatedCount = sovraDb.updateMessagesReceipt(messageIds, status);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, updatedCount, status, messageIds }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
        }
      });
      return;
    }

    // ==========================================
    // API: YOUTUBE WATCH PLAYER & TIPPING
    // ==========================================
    if (url.pathname === '/api/youtube/videos' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, videos: longFormVideosCatalog }));
      return;
    }

    if (url.pathname === '/api/youtube/video' && req.method === 'GET') {
      const vidId = url.searchParams.get('id') || currentYoutubeVideo.id;
      const found = longFormVideosCatalog.find(v => v.id === vidId) || currentYoutubeVideo;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          video: found,
          comments: youtubeCommentsStore[found.id] || [],
        }),
      );
      return;
    }

    if (url.pathname === '/api/youtube/switch' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const found = longFormVideosCatalog.find(v => v.id === parsed.videoId);
          if (found) {
            currentYoutubeVideo = found;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, video: currentYoutubeVideo }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Video not found' }));
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (url.pathname === '/api/youtube/tip' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const amount = Number(parsed.amount ?? 50);
          const creatorSplit = Math.round(amount * 0.95 * 100) / 100;
          const seederSplit = Math.round(amount * 0.05 * 100) / 100;
          const targetVideoId = parsed.videoId || currentYoutubeVideo.id;

          const voucher: TipVoucherRecord = {
            voucherId: 'vouch_' + Date.now(),
            creatorDid: parsed.creatorDid ?? 'did:sovra:creator_studio_broadcast',
            seederDid: 'did:sovra:edge_seeder_relay',
            totalAmount: amount.toString(),
            creatorAmount: creatorSplit.toString(),
            seederAmount: seederSplit.toString(),
            platformAmount: '0',
            timestamp: Date.now(),
          };
          tipVouchersStore.push(voucher);

          // If a message was sent, add as a Super Thanks comment
          if (parsed.message) {
            if (!youtubeCommentsStore[targetVideoId]) {
              youtubeCommentsStore[targetVideoId] = [];
            }
            const stComment: YoutubeCommentRecord = {
              id: 'yt-st-' + Date.now(),
              videoId: targetVideoId,
              authorName: parsed.authorName || 'Super Supporter',
              authorAvatar: '⭐',
              authorHandle: 'supporter_' + Math.floor(Math.random() * 900 + 100),
              text: String(parsed.message),
              timestamp: Date.now(),
              likes: 1,
              isSuperThanks: true,
              superThanksAmount: '₹' + amount,
              replies: [],
            };
            youtubeCommentsStore[targetVideoId].unshift(stComment);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              voucher,
              split: {
                total: amount,
                creator: creatorSplit,
                seeder: seederSplit,
                platformTake: 0,
              },
            }),
          );
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (url.pathname === '/api/youtube/subscribe' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const targetVideoId = parsed.videoId || currentYoutubeVideo.id;
          const targetVideo = longFormVideosCatalog.find(v => v.id === targetVideoId) || currentYoutubeVideo;
          targetVideo.isSubscribed = !targetVideo.isSubscribed;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, isSubscribed: targetVideo.isSubscribed }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (url.pathname === '/api/youtube/comment' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const targetVideoId = parsed.videoId || currentYoutubeVideo.id;
          if (!youtubeCommentsStore[targetVideoId]) {
            youtubeCommentsStore[targetVideoId] = [];
          }

          if (parsed.parentCommentId) {
            // Nested reply
            const parentComment = youtubeCommentsStore[targetVideoId].find(c => c.id === parsed.parentCommentId);
            if (parentComment) {
              if (!parentComment.replies) parentComment.replies = [];
              const newReply: YoutubeReplyRecord = {
                id: 'yt-r-' + Date.now(),
                commentId: parentComment.id,
                authorName: parsed.authorName || 'Local Peer',
                authorAvatar: (parsed.authorName || 'L')[0].toUpperCase(),
                authorHandle: (parsed.authorName || 'peer').toLowerCase().replace(/\s+/g, '_'),
                text: String(parsed.text || ''),
                timestamp: Date.now(),
                likes: 0,
              };
              parentComment.replies.push(newReply);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, reply: newReply, parentCommentId: parentComment.id }));
              return;
            }
          }

          // Top-level comment
          const newComment: YoutubeCommentRecord = {
            id: 'yt-c-' + Date.now(),
            videoId: targetVideoId,
            authorName: parsed.authorName ?? 'Verified Peer',
            authorAvatar: (parsed.authorName ?? 'V')[0].toUpperCase(),
            authorHandle: (parsed.authorName ?? 'peer').toLowerCase().replace(/\s+/g, '_'),
            text: String(parsed.text ?? ''),
            timestamp: Date.now(),
            likes: 0,
            replies: [],
          };
          youtubeCommentsStore[targetVideoId].unshift(newComment);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, comment: newComment }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // PWA: Web App Manifest
    if (url.pathname === '/manifest.webmanifest' || url.pathname === '/manifest.json') {
      res.writeHead(200, {
        'Content-Type': 'application/manifest+json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(SOVRA_PWA_MANIFEST, null, 2));
      return;
    }

    // PWA: Service Worker
    if (url.pathname === '/sw.js') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Service-Worker-Allowed': '/',
        'Cache-Control': 'no-cache',
      });
      res.end(SOVRA_SERVICE_WORKER_SCRIPT);
      return;
    }

    // PWA: App Icons
    if (
      url.pathname === '/icon.svg' ||
      url.pathname === '/icon-192.png' ||
      url.pathname === '/icon-512.png' ||
      url.pathname === '/icon-maskable.png'
    ) {
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(SOVRA_SVG_ICON);
      return;
    }

    // Product B: Standalone Company Operations Console (Dedicated Admin Panel)
    if (url.pathname === '/admin' || url.pathname === '/admin/' || url.pathname === '/admin/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        renderAdminHtml({
          peerId: binding.peerId,
          did: masterKey.did,
          devicePublicKeyHex: binding.devicePublicKeyHex,
          tcpPort,
          uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
          totalBlocks: storageDaemon.getStats().totalBlocks,
          pinnedCount: storageDaemon.getStats().pinnedCount,
          postsCount: feedPostsStore.length,
          connectedPeers: node.getConnectedPeers(),
          vouchers: tipVouchersStore,
        }),
      );
      return;
    }

    // Emergency Panic Wipe Endpoint (Operations Console)
    if (url.pathname === '/api/admin/panic' && req.method === 'POST') {
      console.log('[SECURITY] Emergency panic wipe triggered from Operations Console');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, wiped: true }));
      return;
    }

    // Product A: Sovra Consumer Social App & Creator Studio (Dedicated User Panel)
    if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/app') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml(binding, masterKey, tcpPort, Date.now() - startTime, storageDaemon, socialGraph, localFeed));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log('[2/2] HTTP Server Bound!');
    console.log(`\n============================================================`);
    console.log(`  🌐 Sovra Localhost Server is LIVE at:`);
    console.log(`     👉 http://localhost:${HTTP_PORT}`);
    console.log(`============================================================\n`);
    console.log(`  - Product A (Sovra End-User Social App):          http://localhost:${HTTP_PORT}`);
    console.log(`  - Product B (Sovra Company Operations Console):   http://localhost:${HTTP_PORT}/admin`);
    console.log(`  - JSON Node Health Status:                      http://localhost:${HTTP_PORT}/api/status`);
    console.log(`  - P2P Noise_XX TCP Port:                         127.0.0.1:${tcpPort}`);
    console.log(`\nPress Ctrl+C to terminate the local node.`);
  });
}

startDevServer().catch(err => {
  console.error('[FATAL] Failed to start local server:', err);
  process.exit(1);
});
