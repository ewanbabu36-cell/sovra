/**
 * @file tests/e2e/creator-studio-flagship.test.ts
 * Creator Studio Pro: Full YouTube Studio Parity (Playlists, Community, Shelves & Bulk Actions)
 *
 * Verifies:
 * 1. Milestone 1: Clean Shadowed Legacy Stubs in scripts.view.ts
 * 2. Milestone 2: Dedicated Playlists Management Hub (#studioSectionPlaylists, #studioNavPlaylists, #studioCreatePlaylistModal)
 * 3. Milestone 3: Community Posts & Polls Hub (#studioSectionCommunity, #studioNavCommunity, feed & composer)
 * 4. Milestone 4: Channel Customization Homepage Shelves (#customShelvesSection, shelves list & API persistence)
 * 5. Milestone 5: Content Table Multi-Select Checkboxes & Sticky Bulk Actions Bar (#studioBulkActionsBar, #studioSelectAllVideos)
 * 6. Milestone 6: Video Details Modal Tags, Visibility & Sovereign License Fields (#editVideoTags, #editVideoVisibility, #editVideoLicense)
 * 7. Milestone 7: Live Stream OBS Broadcast Health & Status Card (#studioLiveStreamHealthSection)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sovraDb } from '../../scripts/database-engine.ts';
import { handleStudioTranscoderRoutes } from '../../scripts/routes/studio.routes.ts';

describe('Creator Studio Flagship: Full YouTube Studio Parity Test Suite', () => {
  const scriptsViewPath = path.resolve(__dirname, '../../scripts/views/scripts.view.ts');
  const layoutViewPath = path.resolve(__dirname, '../../scripts/views/layout.view.ts');
  const studioRoutesPath = path.resolve(__dirname, '../../scripts/routes/studio.routes.ts');
  const databaseEnginePath = path.resolve(__dirname, '../../scripts/database-engine.ts');

  const scriptsViewContent = fs.readFileSync(scriptsViewPath, 'utf8');
  const layoutViewContent = fs.readFileSync(layoutViewPath, 'utf8');
  const studioRoutesContent = fs.readFileSync(studioRoutesPath, 'utf8');
  const databaseEngineContent = fs.readFileSync(databaseEnginePath, 'utf8');

  const testCreatorDid = 'did:sovra:creator_flagship_' + Date.now();
  const testChannelId = 'ch_flagship_' + Date.now();
  let testVideoId1 = 'vid-flagship-1-' + Date.now();
  let testVideoId2 = 'vid-flagship-2-' + Date.now();

  beforeAll(() => {
    sovraDb.load();
    if (!(sovraDb as any).db.videos) (sovraDb as any).db.videos = [];
    if (!(sovraDb as any).db.playlists) (sovraDb as any).db.playlists = [];
    if (!(sovraDb as any).db.posts) (sovraDb as any).db.posts = [];

    // Seed test channel videos
    (sovraDb as any).db.videos.push({
      id: testVideoId1,
      channelId: testChannelId,
      ownerDid: testCreatorDid,
      title: 'Decentralized P2P Mesh Architecture (4K HLS)',
      description: 'BitSwap mesh protocol overview.',
      tags: ['sovra', 'mesh', 'p2p'],
      visibility: 'public',
      license: 'sovra_standard',
      monetizationGating: 'free',
      status: 'PUBLISHED',
      createdAt: Date.now()
    });

    (sovraDb as any).db.videos.push({
      id: testVideoId2,
      channelId: testChannelId,
      ownerDid: testCreatorDid,
      title: 'Cellular CGNAT Traversal Deep Dive',
      description: 'WebRTC data channels and STUN/TURN traversal.',
      tags: ['networking', 'cgnat'],
      visibility: 'unlisted',
      license: 'creative_commons',
      monetizationGating: 'supporter_gated',
      status: 'PUBLISHED',
      createdAt: Date.now()
    });

    sovraDb.save();
  });

  // =========================================================================
  // MILESTONE 1: Clean Shadowed Legacy Stubs
  // =========================================================================
  describe('Milestone 1: Clean Shadowed Legacy Stubs in scripts.view.ts', () => {
    it('should have eliminated legacy shadowed stubs from the top of SovraCreatorStudioEngine', () => {
      // The old shadowed stubs had hardcoded "submitUpload: function(publishImmediately, scheduledPublishAt)"
      // and duplicate "saveCustomization: function()" with "Customization published" toast
      const duplicateSaveCount = (scriptsViewContent.match(/saveCustomization:\s*function/g) || []).length;
      expect(duplicateSaveCount).toBe(1);

      const duplicateSubmitUploadCount = (scriptsViewContent.match(/submitWorkspaceUpload:\s*function/g) || []).length;
      expect(duplicateSubmitUploadCount).toBe(1);
    });
  });

  // =========================================================================
  // MILESTONE 2: Dedicated Playlists Management Hub
  // =========================================================================
  describe('Milestone 2: Dedicated Playlists Management Hub', () => {
    it('should declare #studioNavPlaylists and #studioSectionPlaylists in layout.view.ts', () => {
      expect(layoutViewContent).toContain('id="studioNavPlaylists"');
      expect(layoutViewContent).toContain('id="studioSectionPlaylists"');
      expect(layoutViewContent).toContain('id="studioPlaylistsTable"');
      expect(layoutViewContent).toContain('id="studioPlaylistsTableBody"');
      expect(layoutViewContent).toContain('id="studioCreatePlaylistModal"');
      expect(layoutViewContent).toContain('id="newPlaylistTitle"');
      expect(layoutViewContent).toContain('id="newPlaylistPrivacy"');
    });

    it('should implement playlist methods in SovraCreatorStudioEngine', () => {
      expect(scriptsViewContent).toContain('loadStudioPlaylists:');
      expect(scriptsViewContent).toContain('renderStudioPlaylists:');
      expect(scriptsViewContent).toContain('filterPlaylists:');
      expect(scriptsViewContent).toContain('openCreatePlaylistModal:');
      expect(scriptsViewContent).toContain('submitCreatePlaylist:');
      expect(scriptsViewContent).toContain('deletePlaylist:');
    });

    it('should create and retrieve playlists via /api/studio/playlists endpoints', async () => {
      // Create playlist
      let responseData: any = null;
      let statusCode = 0;
      const mockRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        end: (data: string) => { responseData = JSON.parse(data); }
      };

      const createReq: any = { method: 'POST', headers: {} };
      const createCtx: any = {
        url: new URL('http://localhost:3000/api/studio/playlists/create'),
        req: createReq,
        res: mockRes,
        readBoundedBody: async () => ({
          body: JSON.stringify({
            channelId: testChannelId,
            title: 'Sovereign P2P Masterclass',
            description: 'Curated collection of decentralized mesh dispatches.',
            privacy: 'public'
          }),
          ok: true
        }),
        resolvePrincipal: () => ({ did: testCreatorDid }),
        enforceAuth: () => ({ did: testCreatorDid })
      };

      const handledCreate = await handleStudioTranscoderRoutes(createCtx);
      expect(handledCreate).toBe(true);
      expect(statusCode).toBe(200);
      expect(responseData.ok).toBe(true);
      expect(responseData.playlist).toBeDefined();
      expect(responseData.playlist.title).toBe('Sovereign P2P Masterclass');

      const createdPlaylistId = responseData.playlist.id;

      // Fetch playlists for channel
      let listResponse: any = null;
      const mockListRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        end: (data: string) => { listResponse = JSON.parse(data); }
      };

      const listReq: any = { method: 'GET', headers: {} };
      const listCtx: any = {
        url: new URL(`http://localhost:3000/api/studio/playlists?channelId=${testChannelId}`),
        req: listReq,
        res: mockListRes,
        readBoundedBody: async () => ({ body: '', ok: true }),
        resolvePrincipal: () => ({ did: testCreatorDid }),
        enforceAuth: () => ({ did: testCreatorDid })
      };

      const handledList = await handleStudioTranscoderRoutes(listCtx);
      expect(handledList).toBe(true);
      expect(listResponse.ok).toBe(true);
      expect(listResponse.playlists.length).toBeGreaterThanOrEqual(1);

      const found = listResponse.playlists.find((p: any) => p.id === createdPlaylistId);
      expect(found).toBeDefined();
      expect(found.title).toBe('Sovereign P2P Masterclass');
    });
  });

  // =========================================================================
  // MILESTONE 3: Community Posts Hub
  // =========================================================================
  describe('Milestone 3: Community Posts Hub', () => {
    it('should declare #studioNavCommunity and #studioSectionCommunity in layout.view.ts', () => {
      expect(layoutViewContent).toContain('id="studioNavCommunity"');
      expect(layoutViewContent).toContain('id="studioSectionCommunity"');
      expect(layoutViewContent).toContain('id="studioCommunityPostContent"');
      expect(layoutViewContent).toContain('id="studioCommunityPollOpt1"');
      expect(layoutViewContent).toContain('id="studioCommunityPollOpt2"');
      expect(layoutViewContent).toContain('id="btnPublishCommunityPost"');
      expect(layoutViewContent).toContain('id="studioCommunityFeedList"');
    });

    it('should implement community methods in SovraCreatorStudioEngine', () => {
      expect(scriptsViewContent).toContain('loadCommunityPosts:');
      expect(scriptsViewContent).toContain('renderCommunityPosts:');
      expect(scriptsViewContent).toContain('submitCommunityPost:');
    });

    it('should publish community post with poll via /api/channel/community/post and fetch it via /api/channel/community', async () => {
      let responseData: any = null;
      let statusCode = 0;
      const mockRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        end: (data: string) => { responseData = JSON.parse(data); }
      };

      const postReq: any = { method: 'POST', headers: {} };
      const postCtx: any = {
        url: new URL('http://localhost:3000/api/channel/community/post'),
        req: postReq,
        res: mockRes,
        readBoundedBody: async () => ({
          body: JSON.stringify({
            channelId: testChannelId,
            content: 'Which video should we stream next Friday?',
            poll: {
              question: 'Which video should we stream next Friday?',
              options: [
                { id: '1', text: '4K HLS BitSwap Deep Dive', votes: 0 },
                { id: '2', text: 'Cellular CGNAT Punching', votes: 0 }
              ]
            }
          }),
          ok: true
        }),
        resolvePrincipal: () => ({ did: testCreatorDid }),
        enforceAuth: () => ({ did: testCreatorDid })
      };

      const handledPost = await handleStudioTranscoderRoutes(postCtx);
      expect(handledPost).toBe(true);
      expect(statusCode).toBe(200);
      expect(responseData.ok).toBe(true);
      expect(responseData.post).toBeDefined();
      expect(responseData.post.content).toBe('Which video should we stream next Friday?');
      expect(responseData.post.poll.options.length).toBe(2);

      // Fetch community posts
      let listResponse: any = null;
      const mockListRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        end: (data: string) => { listResponse = JSON.parse(data); }
      };

      const listReq: any = { method: 'GET', headers: {} };
      const listCtx: any = {
        url: new URL(`http://localhost:3000/api/channel/community?channelId=${testChannelId}`),
        req: listReq,
        res: mockListRes,
        readBoundedBody: async () => ({ body: '', ok: true }),
        resolvePrincipal: () => ({ did: testCreatorDid }),
        enforceAuth: () => ({ did: testCreatorDid })
      };

      const handledList = await handleStudioTranscoderRoutes(listCtx);
      expect(handledList).toBe(true);
      expect(listResponse.ok).toBe(true);
      expect(listResponse.posts.length).toBeGreaterThanOrEqual(1);
      const foundPost = listResponse.posts.find((p: any) => p.content.includes('Which video should we stream'));
      expect(foundPost).toBeDefined();
    });
  });

  // =========================================================================
  // MILESTONE 4: Channel Customization Homepage Shelves
  // =========================================================================
  describe('Milestone 4: Channel Customization Homepage Shelves', () => {
    it('should declare #customShelvesSection, #customShelvesList and #customAddShelfSelect in layout.view.ts', () => {
      expect(layoutViewContent).toContain('id="customShelvesSection"');
      expect(layoutViewContent).toContain('id="customShelvesList"');
      expect(layoutViewContent).toContain('id="customAddShelfSelect"');
      expect(layoutViewContent).toContain('id="btnAddCustomShelf"');
    });

    it('should implement shelf management methods in SovraCreatorStudioEngine', () => {
      expect(scriptsViewContent).toContain('renderCustomShelves:');
      expect(scriptsViewContent).toContain('addSelectedShelf:');
      expect(scriptsViewContent).toContain('toggleShelfEnabled:');
      expect(scriptsViewContent).toContain('removeCustomShelf:');
    });

    it('should persist and load homepage shelves via /api/studio/customization/shelves', async () => {
      const testShelves = [
        { id: 'uploads_1', title: 'Recent Videos', type: 'uploads', enabled: true },
        { id: 'popular_1', title: 'Popular Uploads', type: 'popular', enabled: true },
        { id: 'shorts_1', title: 'Sovra Reels & Shorts', type: 'shorts', enabled: false }
      ];

      let saveResponse: any = null;
      let statusCode = 0;
      const mockRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        end: (data: string) => { saveResponse = JSON.parse(data); }
      };

      const saveReq: any = { method: 'POST', headers: {} };
      const saveCtx: any = {
        url: new URL('http://localhost:3000/api/studio/customization/shelves'),
        req: saveReq,
        res: mockRes,
        readBoundedBody: async () => ({
          body: JSON.stringify({ shelves: testShelves }),
          ok: true
        }),
        resolvePrincipal: () => ({ did: testCreatorDid }),
        enforceAuth: () => ({ did: testCreatorDid })
      };

      const handledSave = await handleStudioTranscoderRoutes(saveCtx);
      expect(handledSave).toBe(true);
      expect(statusCode).toBe(200);
      expect(saveResponse.ok).toBe(true);

      // Verify retrieval
      let getResponse: any = null;
      const mockGetRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        end: (data: string) => { getResponse = JSON.parse(data); }
      };

      const getReq: any = { method: 'GET', headers: {} };
      const getCtx: any = {
        url: new URL('http://localhost:3000/api/studio/customization/shelves'),
        req: getReq,
        res: mockGetRes,
        readBoundedBody: async () => ({ body: '', ok: true }),
        resolvePrincipal: () => ({ did: testCreatorDid }),
        enforceAuth: () => ({ did: testCreatorDid })
      };

      const handledGet = await handleStudioTranscoderRoutes(getCtx);
      expect(handledGet).toBe(true);
      expect(getResponse.ok).toBe(true);
      expect(getResponse.shelves.length).toBe(3);
      expect(getResponse.shelves[2].type).toBe('shorts');
      expect(getResponse.shelves[2].enabled).toBe(false);
    });
  });

  // =========================================================================
  // MILESTONE 5: Content Table Multi-Select & Bulk Actions Bar
  // =========================================================================
  describe('Milestone 5: Content Table Multi-Select Checkboxes & Sticky Bulk Actions Bar', () => {
    it('should declare #studioBulkActionsBar and #studioSelectAllVideos in layout.view.ts', () => {
      expect(layoutViewContent).toContain('id="studioBulkActionsBar"');
      expect(layoutViewContent).toContain('id="studioSelectAllVideos"');
      expect(layoutViewContent).toContain('id="studioBulkSelectedCount"');
      expect(layoutViewContent).toContain('id="btnBulkUnpublishAction"');
    });

    it('should implement bulk selection methods in SovraCreatorStudioEngine', () => {
      expect(scriptsViewContent).toContain('toggleSelectAllVideos:');
      expect(scriptsViewContent).toContain('handleRowCheckboxChange:');
      expect(scriptsViewContent).toContain('updateBulkActionBar:');
      expect(scriptsViewContent).toContain('clearVideoSelection:');
      expect(scriptsViewContent).toContain('bulkSetVisibility:');
      expect(scriptsViewContent).toContain('bulkUnpublishVideos:');
      expect(scriptsViewContent).toContain('class="studio-video-select-cb"');
    });
  });

  // =========================================================================
  // MILESTONE 6: Video Details Modal Tags, Visibility & Sovereign License Fields
  // =========================================================================
  describe('Milestone 6: Video Details Modal Tags, Visibility & Sovereign License Fields', () => {
    it('should declare #editVideoTags, #editVideoVisibility, and #editVideoLicense in layout.view.ts', () => {
      expect(layoutViewContent).toContain('id="editVideoTags"');
      expect(layoutViewContent).toContain('id="editVideoVisibility"');
      expect(layoutViewContent).toContain('id="editVideoLicense"');
    });

    it('should bind tags, visibility and license in openVideoDetailsModal and saveVideoDetails in scripts.view.ts', () => {
      expect(scriptsViewContent).toContain("document.getElementById('editVideoTags')");
      expect(scriptsViewContent).toContain("document.getElementById('editVideoVisibility')");
      expect(scriptsViewContent).toContain("document.getElementById('editVideoLicense')");
      expect(scriptsViewContent).toContain('tags: tags');
      expect(scriptsViewContent).toContain('visibility: visibility');
      expect(scriptsViewContent).toContain('license: license');
    });

    it('should persist tags, visibility, and license via /api/studio/video/update into database', async () => {
      let updateResponse: any = null;
      let statusCode = 0;
      const mockRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        end: (data: string) => { updateResponse = JSON.parse(data); }
      };

      const updateReq: any = { method: 'POST', headers: {} };
      const updateCtx: any = {
        url: new URL('http://localhost:3000/api/studio/video/update'),
        req: updateReq,
        res: mockRes,
        readBoundedBody: async () => ({
          body: JSON.stringify({
            id: testVideoId1,
            title: 'Updated Decentralized Mesh Dispatch',
            tags: ['p2p', 'webrtc', '4k', 'flagship'],
            visibility: 'unlisted',
            license: 'creative_commons'
          }),
          ok: true
        }),
        resolvePrincipal: () => ({ did: testCreatorDid }),
        enforceAuth: () => ({ did: testCreatorDid })
      };

      const handledUpdate = await handleStudioTranscoderRoutes(updateCtx);
      expect(handledUpdate).toBe(true);
      expect(statusCode).toBe(200);
      expect(updateResponse.ok).toBe(true);

      // Verify directly from sovraDb
      const updatedVid = (sovraDb as any).db.videos.find((v: any) => v.id === testVideoId1);
      expect(updatedVid).toBeDefined();
      expect(updatedVid.title).toBe('Updated Decentralized Mesh Dispatch');
      expect(updatedVid.visibility).toBe('unlisted');
      expect(updatedVid.license).toBe('creative_commons');
      expect(updatedVid.tags).toEqual(['p2p', 'webrtc', '4k', 'flagship']);
    });
  });

  // =========================================================================
  // MILESTONE 7: Live Stream OBS Broadcast Health & Status Card
  // =========================================================================
  describe('Milestone 7: Live Stream OBS Broadcast Health & Status Card', () => {
    it('should declare #studioLiveStreamHealthSection and telemetry fields in layout.view.ts', () => {
      expect(layoutViewContent).toContain('id="studioLiveStreamHealthSection"');
      expect(layoutViewContent).toContain('id="studioLiveStreamStatusBadge"');
      expect(layoutViewContent).toContain('id="studioLiveBitrateVal"');
      expect(layoutViewContent).toContain('id="studioLiveResVal"');
      expect(layoutViewContent).toContain('id="studioLiveHealthVal"');
    });
  });
});
