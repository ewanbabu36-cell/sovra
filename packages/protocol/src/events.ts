/**
 * Sovra Protocol Canonical Event Definitions & Classification
 *
 * DATA AUTHORITY MATRIX:
 * 1. AUTHORITATIVE (Source of Truth):
 *    - Signed cryptographic events (`SovraEvent`)
 *    - Cryptographic key signatures
 *    - Content identifiers (CIDs) produced from immutable content
 *
 * 2. DERIVED (Computed deterministically from authoritative events):
 *    - Follower / following relationship states
 *    - Aggregated reaction / like counts
 *    - Verified author badges and profile views
 *
 * 3. CACHED (Ephemeral performance acceleration):
 *    - Unpacked media frames and thumbnails
 *    - Search index query postings
 *    - Peer connection tables
 *
 * 4. LOCALLY RECONSTRUCTED (Built on client device, never centrally dictated):
 *    - Chronological timeline feed
 *    - Local mute and block enforcement filters
 *    - Screen-time usage budgets
 */

export enum EventKind {
  Metadata = 0, // User profile, bio, display name, avatar CID
  ShortPost = 1, // Text post, microblog, photo attachment
  Follow = 2, // Follow / Unfollow relationship assertion
  Reaction = 3, // Like, emoji reaction to an event
  Comment = 4, // Threaded reply
  VideoPublication = 10, // Multi-resolution HLS video publication
  CommunityManifest = 20, // Community creation / governance rule update
  ModerationAssertion = 30, // Signed node or moderator quarantine flag
  CreatorSubscription = 40, // Creator tier subscription assertion
}

export interface ContentReference {
  readonly cid: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly sha256Hash: string;
  readonly variants?: readonly string[]; // e.g. ["360p", "720p", "1080p"]
}

export type EventTag = readonly [string, ...string[]];

export interface SovraEvent<T = string> {
  /**
   * SHA-256 hash of the RFC 8785 canonical serialized event payload
   */
  readonly id: string;

  /**
   * Hex-encoded Ed25519 public key of the author or author's delegated device
   */
  readonly pubkey: string;

  /**
   * Creation timestamp in unix seconds
   */
  readonly createdAt: number;

  /**
   * Event kind enumeration
   */
  readonly kind: EventKind | number;

  /**
   * Array of tags (e.g., ["e", "target_event_id"], ["p", "target_pubkey"])
   */
  readonly tags: readonly EventTag[];

  /**
   * Content payload or CID reference string
   */
  readonly content: T;

  /**
   * Optional content-addressed media attachments
   */
  readonly media?: readonly ContentReference[];

  /**
   * Hex-encoded Ed25519 digital signature covering the event ID
   */
  readonly sig: string;
}

export interface UnsignedSovraEvent<T = string> {
  readonly pubkey: string;
  readonly createdAt: number;
  readonly kind: EventKind | number;
  readonly tags: readonly EventTag[];
  readonly content: T;
  readonly media?: readonly ContentReference[];
}
