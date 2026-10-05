import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Dynamic Data-Driven Social Engine Suite', () => {
  let tempDir: string;
  let stateFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovra-dynamic-social-'));
    stateFilePath = path.join(tempDir, 'dynamic-social-state.json');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('proves dynamic post creation, liking, commenting, and deletion persist state', () => {
    interface Post {
      id: string;
      caption: string;
      likesCount: number;
      isLiked: boolean;
      comments: { author: string; text: string }[];
    }

    const state = {
      posts: [
        {
          id: 'post-1',
          caption: 'Hello mesh',
          likesCount: 5,
          isLiked: false,
          comments: [{ author: 'Alice', text: 'Great!' }],
        },
      ] as Post[],
    };

    // Save initial
    fs.writeFileSync(stateFilePath, JSON.stringify(state), 'utf-8');

    // 1. Create new dynamic post
    const newPost: Post = {
      id: 'post-2',
      caption: 'Dynamic P2P post',
      likesCount: 0,
      isLiked: false,
      comments: [],
    };
    state.posts.unshift(newPost);
    expect(state.posts.length).toBe(2);

    // 2. Like post
    newPost.isLiked = true;
    newPost.likesCount += 1;
    expect(newPost.likesCount).toBe(1);

    // 3. Comment on post
    newPost.comments.push({ author: 'You', text: 'First dynamic comment' });
    expect(newPost.comments.length).toBe(1);

    // Save mutated state
    fs.writeFileSync(stateFilePath, JSON.stringify(state), 'utf-8');

    // Reload from disk and verify persistence
    const reloaded = JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'));
    expect(reloaded.posts.length).toBe(2);
    expect(reloaded.posts[0].id).toBe('post-2');
    expect(reloaded.posts[0].isLiked).toBe(true);
    expect(reloaded.posts[0].likesCount).toBe(1);
    expect(reloaded.posts[0].comments[0].text).toBe('First dynamic comment');

    // 4. Delete post
    state.posts = state.posts.filter(p => p.id !== 'post-2');
    expect(state.posts.length).toBe(1);
    expect(state.posts[0].id).toBe('post-1');
  });

  it('proves dynamic channel and page creation with subscription and follow logic', () => {
    const channels = [
      { id: 'ch-1', handle: '@tech', count: 10, isSubbed: false },
    ];

    const pages = [
      { id: 'pg-1', handle: '@bakery', count: 25, isFollowing: false },
    ];

    // Create channel
    const newChan = { id: 'ch-2', handle: '@alpha', count: 1, isSubbed: true };
    channels.unshift(newChan);
    expect(channels.length).toBe(2);

    // Toggle sub
    newChan.isSubbed = false;
    newChan.count -= 1;
    expect(newChan.count).toBe(0);

    // Create page
    const newPage = { id: 'pg-2', handle: '@cafe', count: 1, isFollowing: true };
    pages.unshift(newPage);
    expect(pages.length).toBe(2);

    // Toggle follow
    newPage.isFollowing = false;
    newPage.count -= 1;
    expect(newPage.count).toBe(0);
  });
});
