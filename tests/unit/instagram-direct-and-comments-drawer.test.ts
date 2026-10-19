import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Iteration #1 Verification: Instagram-Grade Direct Share & Comments Drawer', () => {
  const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
  const dbEnginePath = path.resolve(__dirname, '../../scripts/database-engine.ts');
  const chatRoutesPath = path.resolve(__dirname, '../../scripts/routes/chat.routes.ts');

  it('verifies database-engine ChatMessageRecord and appendMessage support sharedPost metadata', () => {
    const dbSource = fs.readFileSync(dbEnginePath, 'utf-8');
    expect(dbSource).toContain('sharedPost?: {');
    expect(dbSource).toContain('authorName?: string;');
    expect(dbSource).toContain('caption?: string;');
    expect(dbSource).toContain('mediaImage?: string;');
    expect(dbSource).toContain('mediaVideo?: string;');
    expect(dbSource).toContain('sharedPost: msg.sharedPost');
  });

  it('verifies chat.routes.ts accepts and parses sharedPost on POST /api/chat/send', () => {
    const routeSource = fs.readFileSync(chatRoutesPath, 'utf-8');
    expect(routeSource).toContain('sharedPost: parsed.sharedPost');
    expect(routeSource).toContain('parsed.sharedPost.id');
  });

  it('verifies dev-server.ts mounts feedShareModal and instaCommentsDrawer defaulting to hidden', () => {
    const devSource = fs.readFileSync(devServerPath, 'utf-8');
    expect(devSource).toMatch(/<div id="feedShareModal"[^>]*style="[^"]*display:\s*none;[^"]*"/);
    expect(devSource).toMatch(/<div id="instaCommentsDrawer"[^>]*style="[^"]*display:\s*none;[^"]*"/);
  });

  it('verifies feedShareModal contains story reshare, search, contacts list, and direct send', () => {
    const devSource = fs.readFileSync(devServerPath, 'utf-8');
    expect(devSource).toContain('id="shareModalContactsList"');
    expect(devSource).toContain('id="shareModalSearchInput"');
    expect(devSource).toContain('onclick="sharePostToMyStory()"');
    expect(devSource).toContain('onclick="copyFeedPostShareLink()"');
    expect(devSource).toContain('onclick="shareFeedPostViaSystem()"');
  });

  it('verifies instaCommentsDrawer contains comment stream, quick emoji picker, reply indicator, and composer', () => {
    const devSource = fs.readFileSync(devServerPath, 'utf-8');
    expect(devSource).toContain('id="drawerCommentsStream"');
    expect(devSource).toContain('id="drawerCommentCountBadge"');
    expect(devSource).toContain('id="drawerReplyIndicator"');
    expect(devSource).toContain('id="drawerCommentInput"');
    expect(devSource).toContain('insertDrawerEmoji(\'❤️\')');
    expect(devSource).toContain('submitDrawerComment()');
  });

  it('verifies client functions are bound to window in dev-server.ts', () => {
    const devSource = fs.readFileSync(devServerPath, 'utf-8');
    expect(devSource).toContain('window.openFeedShareModal = openFeedShareModal;');
    expect(devSource).toContain('window.closeFeedShareModal = closeFeedShareModal;');
    expect(devSource).toContain('window.sendPostToPeerChat = sendPostToPeerChat;');
    expect(devSource).toContain('window.sharePostToMyStory = sharePostToMyStory;');
    expect(devSource).toContain('window.jumpToSharedPost = jumpToSharedPost;');
    expect(devSource).toContain('window.openCommentsDrawer = openCommentsDrawer;');
    expect(devSource).toContain('window.closeCommentsDrawer = closeCommentsDrawer;');
    expect(devSource).toContain('window.submitDrawerComment = submitDrawerComment;');
    expect(devSource).toContain('window.toggleDrawerCommentLike = toggleDrawerCommentLike;');
  });

  it('verifies renderChatBubbles renders rich shared post card with jumpToSharedPost trigger', () => {
    const devSource = fs.readFileSync(devServerPath, 'utf-8');
    expect(devSource).toContain('chat-shared-post-card');
    expect(devSource).toContain('jumpToSharedPost(');
    expect(devSource).toContain('sharedPostHtml + attachmentHtml + textHtml');
  });
});
