import { Result, ok, err } from '@sovra/shared';
import { PageMetadata, PageRoleAssignment, PageReview } from './types.js';

export interface CreatePageInput {
  readonly ownerPubkey: string;
  readonly handle: string;
  readonly name: string;
  readonly category: 'business' | 'creator' | 'brand' | 'ngo' | 'community';
  readonly bio: string;
  readonly ctaType?: 'message' | 'website' | 'call' | 'book' | 'tip' | undefined;
  readonly ctaLink?: string | undefined;
  readonly websiteUrl?: string | undefined;
  readonly avatarUrl?: string | undefined;
  readonly bannerUrl?: string | undefined;
}

export interface UpdatePageInput {
  readonly name?: string | undefined;
  readonly bio?: string | undefined;
  readonly category?: 'business' | 'creator' | 'brand' | 'ngo' | 'community' | undefined;
  readonly ctaType?: 'message' | 'website' | 'call' | 'book' | 'tip' | undefined;
  readonly ctaLink?: string | undefined;
  readonly websiteUrl?: string | undefined;
  readonly avatarUrl?: string | undefined;
  readonly bannerUrl?: string | undefined;
}

/**
 * Sovereign Page Manager.
 * Governs business, creator, and brand community pages with multi-admin delegation,
 * dynamic Call-To-Action (CTA) routing, and decentralized customer reviews.
 */
export class PageManager {
  private readonly pagesById = new Map<string, PageMetadata>();
  private readonly pageIdByHandle = new Map<string, string>();
  private readonly followersByPage = new Map<string, Set<string>>();

  /**
   * Creates a new sovereign page.
   */
  public createPage(input: CreatePageInput): Result<PageMetadata> {
    const cleanHandle = input.handle.startsWith('@') ? input.handle.toLowerCase() : `@${input.handle.toLowerCase()}`;

    if (this.pageIdByHandle.has(cleanHandle)) {
      return err(new Error(`Page handle ${cleanHandle} is already registered`));
    }

    const pageId = `did:key:${input.ownerPubkey}#page-${Date.now().toString(36)}`;
    const roles: PageRoleAssignment[] = [
      {
        pubkey: input.ownerPubkey,
        role: 'owner',
      },
    ];

    const metadata: PageMetadata = {
      id: pageId,
      ownerPubkey: input.ownerPubkey,
      handle: cleanHandle,
      name: input.name,
      category: input.category,
      bio: input.bio,
      ctaType: input.ctaType ?? 'message',
      ctaLink: input.ctaLink,
      websiteUrl: input.websiteUrl,
      avatarUrl: input.avatarUrl,
      bannerUrl: input.bannerUrl,
      roles,
      reviews: [],
      followerCount: 0,
      createdAt: Math.floor(Date.now() / 1000),
    };

    this.pagesById.set(pageId, metadata);
    this.pageIdByHandle.set(cleanHandle, pageId);
    this.followersByPage.set(pageId, new Set());

    return ok(metadata);
  }

  /**
   * Updates page details. Caller must possess Owner or Editor role.
   */
  public updatePage(pageId: string, callerPubkey: string, updates: UpdatePageInput): Result<PageMetadata> {
    const page = this.pagesById.get(pageId);
    if (!page) {
      return err(new Error(`Page ${pageId} not found`));
    }

    if (!this.hasPermission(page, callerPubkey, 'editor')) {
      return err(new Error(`Caller ${callerPubkey} unauthorized to update page`));
    }

    const updated: PageMetadata = {
      ...page,
      name: updates.name ?? page.name,
      bio: updates.bio ?? page.bio,
      category: updates.category ?? page.category,
      ctaType: updates.ctaType ?? page.ctaType,
      ctaLink: updates.ctaLink ?? page.ctaLink,
      websiteUrl: updates.websiteUrl ?? page.websiteUrl,
      avatarUrl: updates.avatarUrl ?? page.avatarUrl,
      bannerUrl: updates.bannerUrl ?? page.bannerUrl,
    };

    this.pagesById.set(pageId, updated);
    return ok(updated);
  }

  /**
   * Assigns administrative roles to page members. Caller must be Owner.
   */
  public assignRole(
    pageId: string,
    callerPubkey: string,
    targetPubkey: string,
    role: 'owner' | 'editor' | 'moderator',
  ): Result<PageMetadata> {
    const page = this.pagesById.get(pageId);
    if (!page) {
      return err(new Error(`Page ${pageId} not found`));
    }

    if (page.ownerPubkey !== callerPubkey) {
      return err(new Error(`Only page owner can assign administrative roles`));
    }

    const existingRoles = page.roles.filter(r => r.pubkey !== targetPubkey);
    const newRoles: PageRoleAssignment[] = [...existingRoles, { pubkey: targetPubkey, role }];

    const updated: PageMetadata = {
      ...page,
      roles: newRoles,
    };

    this.pagesById.set(pageId, updated);
    return ok(updated);
  }

  /**
   * Adds an authentic customer review to the page.
   */
  public addReview(
    pageId: string,
    reviewerPubkey: string,
    rating: number,
    comment: string,
  ): Result<PageMetadata> {
    const page = this.pagesById.get(pageId);
    if (!page) {
      return err(new Error(`Page ${pageId} not found`));
    }

    const clampedRating = Math.max(1, Math.min(5, Math.round(rating)));
    const review: PageReview = {
      reviewerPubkey,
      rating: clampedRating,
      comment,
      createdAt: Math.floor(Date.now() / 1000),
    };

    // Replace if user already reviewed
    const otherReviews = page.reviews.filter(r => r.reviewerPubkey !== reviewerPubkey);
    const updatedReviews = [...otherReviews, review];

    const updated: PageMetadata = {
      ...page,
      reviews: updatedReviews,
    };

    this.pagesById.set(pageId, updated);
    return ok(updated);
  }

  /**
   * Follows a page.
   */
  public followPage(pageId: string, followerPubkey: string): Result<number> {
    const page = this.pagesById.get(pageId);
    if (!page) {
      return err(new Error(`Page ${pageId} not found`));
    }

    let followers = this.followersByPage.get(pageId);
    if (!followers) {
      followers = new Set();
      this.followersByPage.set(pageId, followers);
    }

    followers.add(followerPubkey);
    const count = followers.size;

    this.pagesById.set(pageId, {
      ...page,
      followerCount: count,
    });

    return ok(count);
  }

  /**
   * Unfollows a page.
   */
  public unfollowPage(pageId: string, followerPubkey: string): Result<number> {
    const page = this.pagesById.get(pageId);
    if (!page) {
      return err(new Error(`Page ${pageId} not found`));
    }

    const followers = this.followersByPage.get(pageId);
    if (followers) {
      followers.delete(followerPubkey);
      const count = followers.size;
      this.pagesById.set(pageId, {
        ...page,
        followerCount: count,
      });
      return ok(count);
    }

    return ok(page.followerCount);
  }

  public isFollowing(pageId: string, followerPubkey: string): boolean {
    return this.followersByPage.get(pageId)?.has(followerPubkey) ?? false;
  }

  public getPage(pageId: string): PageMetadata | undefined {
    return this.pagesById.get(pageId);
  }

  public getPageByHandle(handle: string): PageMetadata | undefined {
    const cleanHandle = handle.startsWith('@') ? handle.toLowerCase() : `@${handle.toLowerCase()}`;
    const id = this.pageIdByHandle.get(cleanHandle);
    return id ? this.pagesById.get(id) : undefined;
  }

  public getPagesByOwner(ownerPubkey: string): readonly PageMetadata[] {
    const list: PageMetadata[] = [];
    for (const p of this.pagesById.values()) {
      if (p.ownerPubkey === ownerPubkey) list.push(p);
    }
    return list;
  }

  public getAllPages(): readonly PageMetadata[] {
    return Array.from(this.pagesById.values());
  }

  public getAverageRating(pageId: string): number {
    const page = this.pagesById.get(pageId);
    if (!page || page.reviews.length === 0) return 0;
    const total = page.reviews.reduce((acc, r) => acc + r.rating, 0);
    return Math.round((total / page.reviews.length) * 10) / 10;
  }

  private hasPermission(
    page: PageMetadata,
    pubkey: string,
    minRole: 'owner' | 'editor' | 'moderator',
  ): boolean {
    if (page.ownerPubkey === pubkey) return true;
    const assignment = page.roles.find(r => r.pubkey === pubkey);
    if (!assignment) return false;

    if (minRole === 'moderator') return true;
    if (minRole === 'editor') return assignment.role === 'owner' || assignment.role === 'editor';
    if (minRole === 'owner') return assignment.role === 'owner';
    return false;
  }
}
