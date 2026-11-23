# SOVRA — HARDCODED & MOCKED FEATURES AUDIT REGISTRY

**Workspace:** `D:\Sovra`  
**Classification:** Forensic Mock Data & Simulation Audit  
**Auditor:** Principal Cryptographic Security Auditor & Code Forensics Lead  
**Date:** November 24, 2026  

---

## 1. COMPREHENSIVE INVENTORY OF IDENTIFIED MOCKS & HARDCODED VALUES

| Ref # | Location | Type | Original Hardcoded / Simulated Content | Remediated Production Behavior | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **MCK-01** | `scripts/views/layout.view.ts:4476` | Static HTML | `<span class="yt-buffer-badge" id="bufferHealthBadge">⚡ Buffer 9.4s</span>` | Initializes at `⚡ Buffer 0.0s`, dynamically updated from `video.buffered`. | **REMEDIATED** |
| **MCK-02** | `scripts/views/layout.view.ts:4496` | Static HTML | `<div class="yt-screen-swarm" id="ytScreenP2pStats">● BitSwap Swarm: 14 Connected Seeders &bull; Sub-300ms</div>` | Initializes at `● BitSwap Swarm: Initializing...`, dynamically binds to WebRTC mesh peer count. | **REMEDIATED** |
| **MCK-03** | `scripts/views/layout.view.ts:4531-4534` | Static HTML | Stats for Nerds defaults: `Buffer Health: 14.8s`, `Network Speed: 18.4 MB/s`, `Network Seeders: 14 Connected Seeders`, `Dropped Frames: 0 / 4820` | Starts at `0.0s`, `0.0 MB/s`, `Initializing...`, `0 / 0 (0.0%)`, dynamically updated from browser APIs. | **REMEDIATED** |
| **MCK-04** | `scripts/views/layout.view.ts:4861` | Static HTML | `<span id="ytLiveSwarmBadge">🟢 14 Local Seeders • 4K 60fps</span>` | Dynamically updated to `🟢 <N> Peer Seeders • Active` or `🟢 Direct Stream • Ready`. | **REMEDIATED** |
| **MCK-05** | `scripts/views/layout.view.ts:4867-4870` | Static HTML | Mock chat comments from Alice (Seeder #4), Bob (Relay #12), Charlie, and Elena. | Replaced with dynamic swarm chat list bound to `/api/live/chat`. | **REMEDIATED** |
| **MCK-06** | `scripts/views/scripts.view.ts:47638-47641` | Simulated Math | `(14.2 + Math.sin(ytCurrentTimeSec) * 2.1).toFixed(1) + ' s'`<br>`(18.4 + Math.cos(ytCurrentTimeSec) * 3.2).toFixed(1) + ' MB/s'`<br>`0 / Math.floor(ytCurrentTimeSec * 60)` | Replaced with real `video.buffered` calculation, `getVideoPlaybackQuality()` dropped/total frames, and HLS transfer rates. | **REMEDIATED** |
| **MCK-07** | `scripts/views/scripts.view.ts:48600-48635` | Hardcoded Quality | `bufferBadge.innerText = 'Buffer: 1.8s ...'`<br>`bufferBadge.innerText = 'Buffer: 11.4s ...'` | Removed hardcoded strings; invokes `updateBufferHealthBadge()` to reflect genuine buffer state. | **REMEDIATED** |
| **MCK-08** | `scripts/views/scripts.view.ts:48245` | Hardcoded Initial Buffer | `bufferBar.style.width = '24%'` before playback | Replaced with `bufferBar.style.width = '0%'`, dynamically expanded by `onprogress` and `timeupdate`. | **REMEDIATED** |
| **MCK-09** | `scripts/views/scripts.view.ts:49466-49480` | Local-Only DOM Chat | `sendLiveSwarmChatMessage()` only appended `<div>` to local DOM without server sync. | Wired to `POST /api/live/chat` and implemented `pollLiveSwarmChat()` for multi-peer synchronization. | **REMEDIATED** |
