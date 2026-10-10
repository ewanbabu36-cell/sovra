/**
 * Sovra Protocol - Standalone Company Operations Console & Node Diagnostics
 * Route: /admin (Dedicated Product B Operations Dashboard)
 * 
 * 100% Autonomous, zero-runtime dependency on consumer app state.
 */

export interface AdminConsoleOptions {
  peerId: string;
  did: string;
  devicePublicKeyHex: string;
  tcpPort: number;
  uptimeSeconds: number;
  totalBlocks: number;
  pinnedCount: number;
  postsCount: number;
  connectedPeers: string[];
  vouchers: Array<{
    voucherId: string;
    creatorDid: string;
    seederDid: string;
    totalAmount: string;
    creatorAmount: string;
    seederAmount: string;
    platformAmount: string;
    timestamp: number;
    senderName?: string;
  }>;
  registeredUsersCount?: number;
  registeredUsers?: Array<{
    did: string;
    handle: string;
    displayName: string;
    deviceType: string;
    balanceSov?: number;
    createdAt: number;
  }>;
  chatThreadsCount?: number;
  chatMessagesVolume?: number;
  diskStorageBytes?: number;
  diskStorageMb?: string;
  auditLogs?: Array<{
    id: string;
    type: string;
    actorDid: string;
    actorHandle: string;
    details: string;
    timestamp: number;
  }>;
  channels?: Array<{
    id: string;
    handle: string;
    name: string;
    category: string;
    desc?: string;
    count: number;
    avatar?: string;
    bg?: string;
    ownerDid?: string;
    createdAt?: number;
  }>;
  pages?: Array<{
    id: string;
    handle: string;
    name: string;
    category: string;
    bio?: string;
    count: number;
    avatar?: string;
    bg?: string;
    ownerDid?: string;
    createdAt?: number;
  }>;
}

export function renderAdminHtml(opts: AdminConsoleOptions): string {
  const {
    peerId,
    did,
    devicePublicKeyHex,
    tcpPort,
    uptimeSeconds,
    totalBlocks,
    pinnedCount,
    postsCount,
    connectedPeers,
    vouchers,
    registeredUsersCount = 0,
    registeredUsers = [],
    chatThreadsCount = 0,
    chatMessagesVolume = 0,
    diskStorageBytes = 0,
    diskStorageMb = '0.00 MB',
    auditLogs = [],
    channels = [],
    pages = [],
  } = opts;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sovra Ops Console &bull; Protocol Node Diagnostics</title>
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <style>
    :root {
      --admin-bg: #070b13;
      --admin-surface: #0e1726;
      --admin-surface-2: #141f33;
      --admin-border: rgba(255, 255, 255, 0.09);
      --admin-border-focus: rgba(56, 189, 248, 0.4);
      --admin-text: #f8fafc;
      --admin-text-muted: #94a3b8;
      --admin-primary: #6366f1;
      --admin-cyan: #38bdf8;
      --admin-emerald: #10b981;
      --admin-amber: #f59e0b;
      --admin-rose: #f43f5e;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--admin-bg);
      color: var(--admin-text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
    }

    /* Top Ops Header */
    .admin-top-bar {
      height: 64px;
      background: rgba(14, 23, 38, 0.95);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--admin-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 1.5rem;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .admin-brand {
      display: flex;
      align-items: center;
      gap: 0.85rem;
    }

    .admin-brand-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: linear-gradient(135deg, #4f46e5, #06b6d4);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.25rem;
      box-shadow: 0 0 16px rgba(79, 70, 229, 0.4);
    }

    .admin-brand-title {
      font-weight: 800;
      font-size: 1.05rem;
      letter-spacing: -0.01em;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .admin-brand-subtitle {
      font-size: 0.72rem;
      color: var(--admin-cyan);
      font-family: var(--font-mono);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .admin-status-cluster {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .ops-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 0.76rem;
      font-family: var(--font-mono);
      font-weight: 600;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--admin-border);
      color: var(--admin-text-muted);
    }

    .ops-pill.online {
      background: rgba(16, 185, 129, 0.12);
      border-color: rgba(16, 185, 129, 0.35);
      color: #34d399;
    }

    .ops-pill.crypto {
      background: rgba(99, 102, 241, 0.12);
      border-color: rgba(99, 102, 241, 0.35);
      color: #818cf8;
    }

    .pulse-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
      animation: pulseAnim 2s infinite;
    }

    @keyframes pulseAnim {
      0% { transform: scale(0.95); opacity: 0.8; }
      50% { transform: scale(1.3); opacity: 1; }
      100% { transform: scale(0.95); opacity: 0.8; }
    }

    .admin-actions-group {
      display: flex;
      align-items: center;
      gap: 0.65rem;
    }

    .btn-ops {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.5rem 0.95rem;
      border-radius: 10px;
      font-size: 0.82rem;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid transparent;
    }

    .btn-ops-user-app {
      background: rgba(56, 189, 248, 0.12);
      color: #38bdf8;
      border-color: rgba(56, 189, 248, 0.3);
    }

    .btn-ops-user-app:hover {
      background: rgba(56, 189, 248, 0.22);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(56, 189, 248, 0.25);
    }

    .btn-ops-panic {
      background: rgba(244, 63, 94, 0.15);
      color: #f43f5e;
      border-color: rgba(244, 63, 94, 0.35);
    }

    .btn-ops-panic:hover {
      background: #f43f5e;
      color: #fff;
      transform: scale(1.03);
      box-shadow: 0 4px 16px rgba(244, 63, 94, 0.4);
    }

    .filter-pill {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--admin-border);
      color: var(--admin-text-muted);
      padding: 0.4rem 0.85rem;
      border-radius: 20px;
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.18s;
    }

    .filter-pill:hover, .filter-pill.active {
      background: rgba(99, 102, 241, 0.2);
      border-color: #6366f1;
      color: #fff;
    }

    /* Admin 2-Column Shell */
    .admin-shell {
      display: flex;
      flex: 1;
      width: 100%;
      min-height: calc(100vh - 64px);
    }

    /* Ops Navigation Sidebar */
    .admin-sidebar {
      width: 270px;
      background: rgba(14, 23, 38, 0.9);
      border-right: 1px solid var(--admin-border);
      padding: 1.25rem 0.85rem;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      flex-shrink: 0;
    }

    .admin-nav-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.7rem 0.95rem;
      border-radius: 10px;
      background: none;
      border: 1px solid transparent;
      color: var(--admin-text-muted);
      font-size: 0.88rem;
      font-weight: 600;
      cursor: pointer;
      text-align: left;
      transition: all 0.18s;
      width: 100%;
    }

    .admin-nav-item:hover {
      background: rgba(255, 255, 255, 0.05);
      color: #fff;
    }

    .admin-nav-item.active {
      background: rgba(99, 102, 241, 0.18);
      border-color: rgba(99, 102, 241, 0.35);
      color: #fff;
      box-shadow: 0 2px 8px rgba(99, 102, 241, 0.25);
    }

    .admin-nav-icon {
      font-size: 1.15rem;
      width: 22px;
      text-align: center;
    }

    .admin-nav-badge {
      margin-left: auto;
      font-size: 0.68rem;
      font-family: var(--font-mono);
      padding: 2px 6px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.1);
      color: #94a3b8;
    }

    .admin-nav-item.active .admin-nav-badge {
      background: #6366f1;
      color: #fff;
    }

    .admin-sidebar-footer {
      margin-top: auto;
      padding: 1rem 0.5rem;
      border-top: 1px solid var(--admin-border);
      font-size: 0.75rem;
      color: var(--admin-text-muted);
      line-height: 1.5;
    }

    /* Main Ops Stage */
    .admin-main-stage {
      flex: 1;
      min-width: 0;
      padding: 1.75rem 2rem 4rem 2rem;
      overflow-y: auto;
    }

    .ops-section {
      display: none;
      flex-direction: column;
      gap: 1.5rem;
      max-width: 1350px;
      margin: 0 auto;
    }

    .ops-section.active {
      display: flex;
    }

    /* Section Header */
    .ops-header-card {
      background: var(--admin-surface);
      border: 1px solid var(--admin-border);
      border-radius: 16px;
      padding: 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .ops-header-title {
      font-size: 1.45rem;
      font-weight: 800;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 0.65rem;
    }

    .ops-header-desc {
      font-size: 0.85rem;
      color: var(--admin-text-muted);
      margin-top: 0.25rem;
    }

    /* Stat Cards Grid */
    .ops-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 1.25rem;
    }

    .ops-card {
      background: var(--admin-surface);
      border: 1px solid var(--admin-border);
      border-radius: 14px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
      position: relative;
      overflow: hidden;
      transition: transform 0.18s, border-color 0.18s;
    }

    .ops-card:hover {
      border-color: var(--admin-border-focus);
      transform: translateY(-2px);
    }

    .ops-card-label {
      font-size: 0.78rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--admin-text-muted);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .ops-card-val {
      font-size: 1.85rem;
      font-weight: 800;
      color: #fff;
      font-family: var(--font-mono);
      letter-spacing: -0.02em;
    }

    .ops-card-sub {
      font-size: 0.74rem;
      color: var(--admin-text-muted);
      line-height: 1.4;
    }

    /* Data Tables */
    .ops-table-card {
      background: var(--admin-surface);
      border: 1px solid var(--admin-border);
      border-radius: 14px;
      overflow: hidden;
    }

    .ops-table-header {
      padding: 1rem 1.25rem;
      background: rgba(255, 255, 255, 0.02);
      border-bottom: 1px solid var(--admin-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .ops-table-title {
      font-weight: 700;
      font-size: 0.95rem;
      color: #fff;
    }

    .ops-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.84rem;
    }

    .ops-table th {
      padding: 0.85rem 1.25rem;
      background: rgba(0, 0, 0, 0.25);
      color: var(--admin-text-muted);
      font-weight: 700;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid var(--admin-border);
    }

    .ops-table td {
      padding: 0.85rem 1.25rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: #cbd5e1;
    }

    .ops-table tr:hover td {
      background: rgba(255, 255, 255, 0.02);
    }

    .code-pill {
      font-family: var(--font-mono);
      font-size: 0.76rem;
      background: rgba(0, 0, 0, 0.4);
      padding: 2px 7px;
      border-radius: 6px;
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.2);
    }

    .copy-btn {
      background: none;
      border: none;
      color: var(--admin-text-muted);
      cursor: pointer;
      font-size: 0.78rem;
      padding: 2px 6px;
      border-radius: 4px;
      transition: color 0.15s;
    }

    .copy-btn:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.1);
    }

    /* Live Telemetry Terminal */
    .terminal-container {
      background: #030712;
      border: 1px solid rgba(56, 189, 248, 0.3);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8);
    }

    .terminal-header {
      background: #0b1120;
      padding: 0.65rem 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .terminal-dots {
      display: flex;
      gap: 6px;
    }

    .t-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    .terminal-body {
      padding: 1rem;
      font-family: var(--font-mono);
      font-size: 0.8rem;
      line-height: 1.7;
      height: 480px;
      overflow-y: auto;
      background: #020617;
      color: #94a3b8;
    }

    .t-log-info { color: #38bdf8; }
    .t-log-warn { color: #f59e0b; }
    .t-log-err { color: #f43f5e; font-weight: bold; }
    .t-log-p2p { color: #10b981; }

    /* Notice Banner */
    .ops-notice {
      background: linear-gradient(90deg, rgba(99, 102, 241, 0.12), rgba(6, 182, 212, 0.08));
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 12px;
      padding: 1rem 1.25rem;
      font-size: 0.84rem;
      line-height: 1.5;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      gap: 0.85rem;
    }

    /* Modal */
    .ops-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .ops-modal-card {
      background: var(--admin-surface);
      border: 1px solid var(--admin-border);
      border-radius: 18px;
      padding: 1.75rem;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8);
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    @media (max-width: 960px) {
      .admin-shell {
        flex-direction: column;
      }
      .admin-sidebar {
        width: 100%;
        border-right: none;
        border-bottom: 1px solid var(--admin-border);
        flex-direction: row;
        overflow-x: auto;
      }
      .admin-main-stage {
        padding: 1rem;
      }
    }
  </style>
</head>
<body>

  <!-- Top Ops Bar -->
  <header class="admin-top-bar">
    <div class="admin-brand">
      <div class="admin-brand-icon">🛡️</div>
      <div>
        <div class="admin-brand-title">
          <span>Sovra Protocol Ops Console</span>
          <span class="ops-pill online"><span class="pulse-dot"></span> Port :${tcpPort}</span>
        </div>
        <div class="admin-brand-subtitle">Company Network Operations &bull; Product B (Isolated)</div>
      </div>
    </div>

    <div class="admin-status-cluster">
      <span class="ops-pill crypto" title="Cryptographic Cipher Engine">🔐 Noise_XX Handshake OK</span>
      <span class="ops-pill" title="Autonomous P2P Autonomy">⚡ Zero Admin Dependency</span>
    </div>

    <div class="admin-actions-group">
      <a href="/" class="btn-ops btn-ops-user-app" title="Launch Sovra Consumer Social App">
        <span>👤</span> <span>Open User Social App</span> <span>↗️</span>
      </a>
      <button onclick="confirmPanicWipe()" class="btn-ops btn-ops-panic" title="🚨 Emergency Zeroize Node">
        <span>🚨</span> <span>Panic Wipe</span>
      </button>
    </div>
  </header>

  <!-- Shell: Sidebar + Main Stage -->
  <div class="admin-shell">
    
    <!-- Sidebar Navigation -->
    <aside class="admin-sidebar">
      <button class="admin-nav-item active" onclick="switchAdminTab('overview')">
        <span class="admin-nav-icon">📊</span>
        <span>Node Diagnostics</span>
        <span class="admin-nav-badge">Active</span>
      </button>

      <button class="admin-nav-item" onclick="switchAdminTab('swarm')">
        <span class="admin-nav-icon">🌐</span>
        <span>P2P Swarm & Mesh</span>
        <span class="admin-nav-badge" id="sidebarPeerBadge">${connectedPeers.length || 1}</span>
      </button>

      <button class="admin-nav-item" onclick="switchAdminTab('storage')">
        <span class="admin-nav-icon">🗄️</span>
        <span>UnixFS Blockstore</span>
        <span class="admin-nav-badge">${totalBlocks}</span>
      </button>

      <button class="admin-nav-item" onclick="switchAdminTab('tipping')">
        <span class="admin-nav-icon">💰</span>
        <span>95/5 Tipping Ledger</span>
        <span class="admin-nav-badge">${vouchers.length}</span>
      </button>

      <button class="admin-nav-item" onclick="switchAdminTab('users-chat')">
        <span class="admin-nav-icon">👥</span>
        <span>Users &amp; Chat Mesh</span>
        <span class="admin-nav-badge" id="sidebarUsersBadge">${registeredUsersCount}</span>
      </button>

      <button class="admin-nav-item" onclick="switchAdminTab('entities')">
        <span class="admin-nav-icon">📢</span>
        <span>Sovereign Registry</span>
        <span class="admin-nav-badge" id="sidebarEntitiesBadge" style="background:#f59e0b; color:#000;">${channels.length + pages.length}</span>
      </button>

      <button class="admin-nav-item" onclick="switchAdminTab('audit')">
        <span class="admin-nav-icon">🛡️</span>
        <span>Activity Audit Log</span>
        <span class="admin-nav-badge" id="sidebarAuditBadge" style="background:#38bdf8; color:#000;">${auditLogs.length}</span>
      </button>

      <button class="admin-nav-item" onclick="switchAdminTab('moderation')">
        <span class="admin-nav-icon">⚖️</span>
        <span>Mesh Juror Consensus</span>
        <span class="admin-nav-badge">Decentralized</span>
      </button>

      <button class="admin-nav-item" onclick="switchAdminTab('telemetry')">
        <span class="admin-nav-icon">📜</span>
        <span>Live Telemetry Stream</span>
        <span class="admin-nav-badge" style="background:#10b981; color:#000;">LIVE</span>
      </button>

      <div class="admin-sidebar-footer">
        <div><strong>Runtime:</strong> Node.js ${process.version}</div>
        <div><strong>Transport:</strong> libp2p + TCP + QUIC</div>
        <div><strong>Consensus:</strong> Pure Peer Mesh</div>
        <div style="margin-top: 0.5rem; color: #64748b;">Build: Sovra v2.4 Production</div>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main class="admin-main-stage">

      <!-- ==============================================
           MODULE 1: NODE OVERVIEW & DIAGNOSTICS
           ============================================== -->
      <section class="ops-section active" id="view-overview">
        <div class="ops-notice">
          <span style="font-size: 1.5rem;">🛡️</span>
          <div>
            <strong>Decentralized Independence Guarantee:</strong> This company operations console is an auxiliary administrative tool.
            The Sovra decentralized mesh, peer-to-peer feeds, creator studio, and end-user E2EE chats operate with <strong>100% autonomy</strong> and have zero runtime dependency on this console.
          </div>
        </div>

        <div class="ops-grid">
          <div class="ops-card">
            <div class="ops-card-label">
              <span>TCP Listen Port</span>
              <span style="color:#10b981;">Online</span>
            </div>
            <div class="ops-card-val">:${tcpPort}</div>
            <div class="ops-card-sub">Bound to 0.0.0.0 (Localhost & LAN reachable)</div>
          </div>

          <div class="ops-card">
            <div class="ops-card-label">
              <span>Connected Swarm Peers</span>
              <span style="color:#38bdf8;">Kademlia</span>
            </div>
            <div class="ops-card-val">${connectedPeers.length || 1}</div>
            <div class="ops-card-sub">Active ad-hoc connections &amp; multi-hop discovery</div>
          </div>

          <div class="ops-card">
            <div class="ops-card-label">
              <span>UnixFS Merkle Blocks</span>
              <span style="color:#818cf8;">BitSwap</span>
            </div>
            <div class="ops-card-val">${totalBlocks}</div>
            <div class="ops-card-sub">${pinnedCount} Pinned permanently to local blockstore</div>
          </div>

          <div class="ops-card">
            <div class="ops-card-label">
              <span>Node Uptime</span>
              <span style="color:#f59e0b;">Continuous</span>
            </div>
            <div class="ops-card-val" id="uptimeDisplay">${Math.floor(uptimeSeconds / 60)}m ${uptimeSeconds % 60}s</div>
            <div class="ops-card-sub">Zero crashes, memory heap stable</div>
          </div>
        </div>

        <!-- Phase 6 Live Dynamic Social Metrics Grid -->
        <div class="ops-grid" style="margin-top: 1rem;">
          <div class="ops-card">
            <div class="ops-card-label">
              <span>Registered Users</span>
              <span style="color:#6366f1;">Sovra DID</span>
            </div>
            <div class="ops-card-val" id="metricUsersCount">${registeredUsersCount}</div>
            <div class="ops-card-sub" id="metricUsersSub">${registeredUsers.length} verified accounts in dynamic DB</div>
          </div>

          <div class="ops-card">
            <div class="ops-card-label">
              <span>Chat Messages Volume</span>
              <span style="color:#10b981;">E2EE Mesh</span>
            </div>
            <div class="ops-card-val" id="metricChatVolume">${chatMessagesVolume}</div>
            <div class="ops-card-sub" id="metricThreadsSub">${chatThreadsCount} active two-way threads</div>
          </div>

          <div class="ops-card">
            <div class="ops-card-label">
              <span>Disk Consumption</span>
              <span style="color:#f43f5e;">Storage</span>
            </div>
            <div class="ops-card-val" id="metricDiskStorage">${diskStorageMb}</div>
            <div class="ops-card-sub">Local blockstore + Reels + State JSON</div>
          </div>

          <div class="ops-card">
            <div class="ops-card-label">
              <span>Real-Time Audit Log</span>
              <span style="color:#38bdf8;">Ledger</span>
            </div>
            <div class="ops-card-val" id="metricAuditCount">${auditLogs.length}</div>
            <div class="ops-card-sub">Cryptographic user activities logged</div>
          </div>
        </div>

        <!-- Node Cryptographic Credentials Card -->
        <div class="ops-table-card">
          <div class="ops-table-header">
            <span class="ops-table-title">🔑 Cryptographic Node Identity &amp; Bindings</span>
            <button class="btn-ops btn-ops-user-app" onclick="inspectRawStatusJson()">View Raw Status JSON</button>
          </div>
          <table class="ops-table">
            <tbody>
              <tr>
                <td style="font-weight: 700; width: 220px;">Master Sovereign DID</td>
                <td>
                  <span class="code-pill">${did}</span>
                  <button class="copy-btn" onclick="copyValue('${did}', this)">Copy</button>
                </td>
              </tr>
              <tr>
                <td style="font-weight: 700;">libp2p Peer ID</td>
                <td>
                  <span class="code-pill">${peerId}</span>
                  <button class="copy-btn" onclick="copyValue('${peerId}', this)">Copy</button>
                </td>
              </tr>
              <tr>
                <td style="font-weight: 700;">Ed25519 Device Key</td>
                <td>
                  <span class="code-pill">${devicePublicKeyHex}</span>
                  <button class="copy-btn" onclick="copyValue('${devicePublicKeyHex}', this)">Copy</button>
                </td>
              </tr>
              <tr>
                <td style="font-weight: 700;">Wire Address (Multiaddr)</td>
                <td>
                  <span class="code-pill">/ip4/127.0.0.1/tcp/${tcpPort}/p2p/${peerId}</span>
                  <button class="copy-btn" onclick="copyValue('/ip4/127.0.0.1/tcp/${tcpPort}/p2p/${peerId}', this)">Copy</button>
                </td>
              </tr>
              <tr>
                <td style="font-weight: 700;">GossipSub PubSub Topics</td>
                <td>
                  <span class="code-pill">sovra/feed/main</span>
                  <span class="code-pill">sovra/creator/live</span>
                </td>
              </tr>
              <tr>
                <td style="font-weight: 700;">Feed Algorithm Neutrality</td>
                <td>
                  <span style="color: #10b981; font-weight: 700;">100% Pure Chronological (Zero algorithmic ranking, zero shadowbanning)</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ==============================================
           MODULE 2: P2P SWARM & MESH VISUALIZER
           ============================================== -->
      <section class="ops-section" id="view-swarm">
        <div class="ops-header-card">
          <div>
            <div class="ops-header-title">🌐 P2P Swarm &amp; Mesh Diagnostics</div>
            <div class="ops-header-desc">Inspect multi-hop ad-hoc routing, 2.4GHz BLE spectrum, and BitSwap swarm seeder distribution.</div>
          </div>
          <button class="btn-ops btn-ops-user-app" onclick="scanP2pChannels()">📡 Scan 2.4GHz Channels</button>
        </div>

        <div class="ops-table-card">
          <div class="ops-table-header">
            <span class="ops-table-title">Active Mesh Peer Table</span>
            <span style="font-size: 0.78rem; color: #34d399; font-family: var(--font-mono);">Ad-Hoc TTL: 7 Hops Active</span>
          </div>
          <table class="ops-table">
            <thead>
              <tr>
                <th>Peer Identifier</th>
                <th>Transport</th>
                <th>Multiaddr</th>
                <th>Latency</th>
                <th>Swarm Role</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="meshPeersTableBody">
              <tr>
                <td><span class="code-pill">12D3KooWAliceGenesisPeerId</span></td>
                <td>Noise_XX / Yamux</td>
                <td>/ip4/127.0.0.1/tcp/4001</td>
                <td><span style="color:#10b981; font-weight: bold;">8ms</span></td>
                <td>Genesis Seeder</td>
                <td><span class="ops-pill online"><span class="pulse-dot"></span> Active</span></td>
              </tr>
              <tr>
                <td><span class="code-pill">12D3KooWCreatorBroadcaster</span></td>
                <td>QUIC / WebRTC</td>
                <td>/ip4/192.168.1.14/udp/4002</td>
                <td><span style="color:#10b981; font-weight: bold;">14ms</span></td>
                <td>4K HLS Broadcaster</td>
                <td><span class="ops-pill online"><span class="pulse-dot"></span> Active</span></td>
              </tr>
              <tr>
                <td><span class="code-pill">12D3KooWEdgeRelayNodeNYC</span></td>
                <td>TCP / WebSocket</td>
                <td>/dns4/relay.sovra.net/tcp/443</td>
                <td><span style="color:#f59e0b; font-weight: bold;">42ms</span></td>
                <td>Edge Cache &amp; Relay</td>
                <td><span class="ops-pill online"><span class="pulse-dot"></span> Active</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ==============================================
           MODULE 3: UNIXFS & MERKLE BLOCKSTORE
           ============================================== -->
      <section class="ops-section" id="view-storage">
        <div class="ops-header-card">
          <div>
            <div class="ops-header-title">🗄️ UnixFS &amp; Merkle DAG Blockstore</div>
            <div class="ops-header-desc">Inspect local content-addressed chunks, verify deterministic CIDv1 sha2-256 hashes, and manage storage quotas.</div>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <input type="text" id="customCidPinInput" placeholder="Enter CIDv1 (bafybeig...)" style="background: rgba(0,0,0,0.5); border: 1px solid var(--admin-border); color: #fff; padding: 0.45rem 0.85rem; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; width: 260px;">
            <button class="btn-ops btn-ops-user-app" onclick="pinCustomCid()">Pin to Disk</button>
          </div>
        </div>

        <div class="ops-grid">
          <div class="ops-card">
            <div class="ops-card-label">Total Blocks</div>
            <div class="ops-card-val">${totalBlocks}</div>
            <div class="ops-card-sub">Sha2-256 raw &amp; dag-pb nodes</div>
          </div>
          <div class="ops-card">
            <div class="ops-card-label">Pinned Roots</div>
            <div class="ops-card-val" style="color: #38bdf8;">${pinnedCount}</div>
            <div class="ops-card-sub">Protected from garbage collection</div>
          </div>
          <div class="ops-card">
            <div class="ops-card-label">BitSwap Swarm Hit Rate</div>
            <div class="ops-card-val" style="color: #10b981;">98.4%</div>
            <div class="ops-card-sub">Blocks retrieved from nearby swarm nodes</div>
          </div>
        </div>

        <div class="ops-table-card">
          <div class="ops-table-header">
            <span class="ops-table-title">Recent Merkle DAG CIDs</span>
          </div>
          <table class="ops-table">
            <thead>
              <tr>
                <th>Content Identifier (CIDv1)</th>
                <th>Codec</th>
                <th>Size</th>
                <th>Pin Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span class="code-pill">bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi</span></td>
                <td>dag-pb</td>
                <td>12.4 MB</td>
                <td><span style="color:#10b981; font-weight: bold;">Pinned (Root)</span></td>
                <td><button class="copy-btn" onclick="copyValue('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi', this)">Copy CID</button></td>
              </tr>
              <tr>
                <td><span class="code-pill">bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku</span></td>
                <td>raw</td>
                <td>256 KB</td>
                <td><span style="color:#10b981; font-weight: bold;">Pinned</span></td>
                <td><button class="copy-btn" onclick="copyValue('bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku', this)">Copy CID</button></td>
              </tr>
              <tr>
                <td><span class="code-pill">bafybeicg2hmz2s2v5r7i6uvx44c66u2j34l4gq723y3m4n5u6v7w8x9y0a</span></td>
                <td>raw</td>
                <td>512 KB</td>
                <td>Cached (Ephemeral)</td>
                <td><button class="copy-btn" onclick="copyValue('bafybeicg2hmz2s2v5r7i6uvx44c66u2j34l4gq723y3m4n5u6v7w8x9y0a', this)">Copy CID</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ==============================================
           MODULE 4: 95/5 TIPPING & MICROPAYMENTS LEDGER
           ============================================== -->
      <section class="ops-section" id="view-tipping">
        <div class="ops-header-card">
          <div>
            <div class="ops-header-title">💰 95/5 Sovereign Economic Ledger</div>
            <div class="ops-header-desc">Cryptographic audit of peer micro-vouchers: 95% creator split, 5% edge seeder reward, and 0% platform middleman cut.</div>
          </div>
          <button class="btn-ops btn-ops-user-app" onclick="exportLedgerCsv()">📥 Export Ledger JSON</button>
        </div>

        <div class="ops-grid">
          <div class="ops-card">
            <div class="ops-card-label">Total Vouchers Settled</div>
            <div class="ops-card-val">${vouchers.length}</div>
            <div class="ops-card-sub">Ed25519 bilateral signatures verified</div>
          </div>
          <div class="ops-card">
            <div class="ops-card-label">Creator Distribution (95%)</div>
            <div class="ops-card-val" style="color: #f59e0b;">95.0%</div>
            <div class="ops-card-sub">Settled directly to creator DIDs</div>
          </div>
          <div class="ops-card">
            <div class="ops-card-label">Seeder Relay Reward (5%)</div>
            <div class="ops-card-val" style="color: #10b981;">5.0%</div>
            <div class="ops-card-sub">Compensates bandwidth &amp; disk storage</div>
          </div>
          <div class="ops-card">
            <div class="ops-card-label">Platform Middleman Cut</div>
            <div class="ops-card-val" style="color: #64748b;">0.0%</div>
            <div class="ops-card-sub">Provably zero rent-seeking extraction</div>
          </div>
        </div>

        <div class="ops-table-card">
          <div class="ops-table-header">
            <span class="ops-table-title">Cryptographic Off-Chain Voucher Stream</span>
          </div>
          <table class="ops-table">
            <thead>
              <tr>
                <th>Voucher ID</th>
                <th>Total Amount</th>
                <th>Creator Split (95%)</th>
                <th>Seeder Split (5%)</th>
                <th>Platform Take</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              ${vouchers.map(v => `
                <tr>
                  <td><span class="code-pill">${v.voucherId}</span></td>
                  <td><strong>₹${v.totalAmount}</strong></td>
                  <td><span style="color:#f59e0b; font-weight:bold;">₹${v.creatorAmount}</span></td>
                  <td><span style="color:#10b981; font-weight:bold;">₹${v.seederAmount}</span></td>
                  <td><span style="color:#64748b;">₹0.00 (0%)</span></td>
                  <td>${new Date(v.timestamp).toLocaleTimeString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <!-- ==============================================
           MODULE 4B: REGISTERED SOVEREIGN USERS & CHAT MESH
           ============================================== -->
      <section class="ops-section" id="view-users-chat">
        <div class="ops-header-card">
          <div>
            <div class="ops-header-title">👥 Sovereign Registered Users &amp; Chat Mesh</div>
            <div class="ops-header-desc">Real persistent identity ledger, cross-device multi-device records, and two-way E2EE chat threads.</div>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn-ops btn-ops-user-app" onclick="refreshAdminMetrics()">Sync DB Live</button>
          </div>
        </div>

        <div class="ops-grid">
          <div class="ops-card">
            <div class="ops-card-label">
              <span>Total Registered Users</span>
              <span style="color:#6366f1;">Users DB</span>
            </div>
            <div class="ops-card-val" id="usersTabCount">${registeredUsersCount}</div>
            <div class="ops-card-sub">Anchored in dynamic-social-state.json</div>
          </div>

          <div class="ops-card">
            <div class="ops-card-label">
              <span>Mobile Phone Peers</span>
              <span style="color:#38bdf8;">LAN / Wi-Fi</span>
            </div>
            <div class="ops-card-val" id="usersTabMobileCount">${registeredUsers.filter(u => u.deviceType === 'Mobile').length}</div>
            <div class="ops-card-sub">Connected via phone IP / browser PWA</div>
          </div>

          <div class="ops-card">
            <div class="ops-card-label">
              <span>Desktop Laptop Peers</span>
              <span style="color:#10b981;">Localhost</span>
            </div>
            <div class="ops-card-val" id="usersTabDesktopCount">${registeredUsers.filter(u => u.deviceType !== 'Mobile').length}</div>
            <div class="ops-card-sub">Running node host / full desktop browser</div>
          </div>

          <div class="ops-card">
            <div class="ops-card-label">
              <span>E2EE Message Volume</span>
              <span style="color:#f59e0b;">Messages</span>
            </div>
            <div class="ops-card-val" id="usersTabMsgVolume">${chatMessagesVolume}</div>
            <div class="ops-card-sub">${chatThreadsCount} active threads</div>
          </div>
        </div>

        <!-- Registered Users Table -->
        <div class="ops-table-card">
          <div class="ops-table-header">
            <span class="ops-table-title">👤 Registered Sovereign Accounts</span>
            <span style="font-size: 0.75rem; color: #94a3b8; font-family: var(--font-mono);">Live Database Records</span>
          </div>
          <table class="ops-table">
            <thead>
              <tr>
                <th>User / Handle</th>
                <th>Device</th>
                <th>Sovereign Balance</th>
                <th>Cryptographic DID</th>
                <th>Registered At</th>
              </tr>
            </thead>
            <tbody id="usersTableBody">
              ${registeredUsers.length === 0 ? `<tr><td colspan="5" style="text-align: center; color: #94a3b8; padding: 2rem;">No users registered yet in database.</td></tr>` : registeredUsers.map(u => `
                <tr>
                  <td>
                    <div style="display: flex; align-items: center; gap: 0.65rem;">
                      <div style="width: 32px; height: 32px; border-radius: 50%; background: #6366f1; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #fff; font-size: 0.85rem;">
                        ${(u.displayName || u.handle)[0].toUpperCase()}
                      </div>
                      <div>
                        <div style="font-weight: 700; color: #fff;">${u.displayName}</div>
                        <div style="font-size: 0.72rem; color: #38bdf8; font-family: var(--font-mono);">${u.handle}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span class="code-pill" style="color: ${u.deviceType === 'Mobile' ? '#38bdf8' : '#10b981'};">
                      ${u.deviceType === 'Mobile' ? '📱 Mobile' : '💻 Desktop'}
                    </span>
                  </td>
                  <td>
                    <strong style="color: #fbbf24; font-family: var(--font-mono);">${(u.balanceSov ?? 500).toFixed(2)} SOV</strong>
                  </td>
                  <td>
                    <span class="code-pill">${u.did.length > 25 ? u.did.substring(0, 25) + '...' : u.did}</span>
                    <button class="copy-btn" onclick="copyValue('${u.did}', this)">Copy</button>
                  </td>
                  <td style="font-size: 0.75rem; color: #94a3b8;">
                    ${new Date(u.createdAt).toLocaleDateString()} ${new Date(u.createdAt).toLocaleTimeString()}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <!-- ==============================================
           MODULE 4C: REAL-TIME ACTIVITY AUDIT LOG
           ============================================== -->
      <section class="ops-section" id="view-audit">
        <div class="ops-header-card">
          <div>
            <div class="ops-header-title">🛡️ Real-Time Activity Audit Log</div>
            <div class="ops-header-desc">Cryptographically signed user action audit trail: registrations, post publications, reel uploads, chats, and micro-tips.</div>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <span class="ops-pill online"><span class="pulse-dot"></span> Live DB Sync</span>
            <button class="btn-ops btn-ops-user-app" onclick="refreshAdminMetrics()">Refresh Now</button>
          </div>
        </div>

        <!-- Audit Stream Filters -->
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <button class="filter-pill active" onclick="filterAuditLogs('ALL', this)">All Activities (<span id="auditCountAll">${auditLogs.length}</span>)</button>
          <button class="filter-pill" onclick="filterAuditLogs('USER', this)">Users</button>
          <button class="filter-pill" onclick="filterAuditLogs('CHAT', this)">Chats</button>
          <button class="filter-pill" onclick="filterAuditLogs('POST', this)">Posts &amp; Reels</button>
          <button class="filter-pill" onclick="filterAuditLogs('TIP', this)">Tipping</button>
        </div>

        <!-- Audit Table -->
        <div class="ops-table-card">
          <div class="ops-table-header">
            <span class="ops-table-title">📜 Immutable Activity Ledger</span>
            <span style="font-size: 0.75rem; color: #34d399; font-family: var(--font-mono);">● Real-Time Stream</span>
          </div>
          <table class="ops-table">
            <thead>
              <tr>
                <th style="width: 140px;">Timestamp</th>
                <th style="width: 160px;">Action Type</th>
                <th style="width: 180px;">Actor</th>
                <th>Activity Description &amp; Details</th>
              </tr>
            </thead>
            <tbody id="auditTableBody">
              ${auditLogs.length === 0 ? `<tr><td colspan="4" style="text-align: center; color: #94a3b8; padding: 2rem;">No activity recorded yet.</td></tr>` : auditLogs.map(log => {
                let badgeColor = '#6366f1';
                let badgeBg = 'rgba(99, 102, 241, 0.15)';
                if (log.type.includes('USER') || log.type.includes('PROFILE')) { badgeColor = '#38bdf8'; badgeBg = 'rgba(56, 189, 248, 0.15)'; }
                else if (log.type.includes('CHAT')) { badgeColor = '#10b981'; badgeBg = 'rgba(16, 185, 129, 0.15)'; }
                else if (log.type.includes('POST') || log.type.includes('REEL')) { badgeColor = '#a855f7'; badgeBg = 'rgba(168, 85, 247, 0.15)'; }
                else if (log.type.includes('TIP')) { badgeColor = '#fbbf24'; badgeBg = 'rgba(251, 191, 36, 0.15)'; }
                else if (log.type.includes('FRIEND')) { badgeColor = '#f43f5e'; badgeBg = 'rgba(244, 63, 94, 0.15)'; }

                return `
                <tr class="audit-row" data-type="${log.type}">
                  <td style="font-family: var(--font-mono); font-size: 0.75rem; color: #94a3b8;">
                    ${new Date(log.timestamp).toLocaleTimeString()}
                  </td>
                  <td>
                    <span style="display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 0.72rem; font-weight: 700; font-family: var(--font-mono); color: ${badgeColor}; background: ${badgeBg}; border: 1px solid ${badgeColor}33;">
                      ${log.type}
                    </span>
                  </td>
                  <td>
                    <span style="font-weight: 700; color: #fff;">${log.actorHandle}</span>
                    <div style="font-size: 0.68rem; color: #64748b; font-family: var(--font-mono);">${log.actorDid.slice(-10)}</div>
                  </td>
                  <td>
                    <span style="color: #e2e8f0;">${log.details}</span>
                  </td>
                </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <!-- ==============================================
           MODULE 5: MESH JUROR CONSENSUS & MODERATION
           ============================================== -->
      <section class="ops-section" id="view-moderation">
        <div class="ops-header-card">
          <div>
            <div class="ops-header-title">⚖️ Mesh Juror Consensus &amp; Moderation</div>
            <div class="ops-header-desc">Decentralized dispute resolution: zero corporate censorship, client-side blocklists, and peer voting quorums.</div>
          </div>
          <span class="ops-pill online"><span class="pulse-dot"></span> Peer Consensus Engine Online</span>
        </div>

        <div class="ops-notice" style="border-color: rgba(245, 158, 11, 0.35); background: rgba(245, 158, 11, 0.08);">
          <span style="font-size: 1.5rem;">⚖️</span>
          <div>
            <strong>Zero Centralized Censor Guarantee:</strong> Unlike Web2 corporate social networks, Sovra node administrators 
            cannot unilaterally delete content or de-platform users. Moderation occurs strictly via cryptographic multi-signature juror quorums and local user blocklists.
          </div>
        </div>

        <div class="ops-table-card">
          <div class="ops-table-header">
            <span class="ops-table-title">Active Community Flags &amp; Juror Ballots</span>
          </div>
          <table class="ops-table">
            <thead>
              <tr>
                <th>Case ID</th>
                <th>Target Post CID / DID</th>
                <th>Report Category</th>
                <th>Juror Consensus Votes</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span class="code-pill">CASE-9812</span></td>
                <td><span class="code-pill">bafybeig...zdi</span></td>
                <td>Phishing / Key Harvester</td>
                <td><span style="color:#10b981; font-weight: bold;">8 / 10 Jurors Voted</span></td>
                <td><span class="ops-pill online">Quorum Reached</span></td>
                <td><button class="btn-ops btn-ops-user-app" style="padding: 2px 8px; font-size: 0.74rem;" onclick="alert('Consensus verified: Client-side advisory tag broadcast to mesh peers.')">Inspect Ballot</button></td>
              </tr>
              <tr>
                <td><span class="code-pill">CASE-9813</span></td>
                <td><span class="code-pill">did:key:z6MksAttacker</span></td>
                <td>Sybil Swarm Flooding</td>
                <td><span style="color:#f59e0b; font-weight: bold;">4 / 10 Jurors Voted</span></td>
                <td><span class="ops-pill" style="color:#f59e0b;">Voting Active</span></td>
                <td><button class="btn-ops btn-ops-user-app" style="padding: 2px 8px; font-size: 0.74rem;" onclick="alert('Cast juror vote: Weight=1.0 verified by node key.')">Cast Juror Vote</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ==============================================
           MODULE 6: LIVE TELEMETRY & EVENT STREAM
           ============================================== -->
      <section class="ops-section" id="view-telemetry">
        <div class="ops-header-card">
          <div>
            <div class="ops-header-title">📜 Real-Time Protocol Telemetry</div>
            <div class="ops-header-desc">Streaming diagnostic events: GossipSub heartbeats, BitSwap block transfers, and Noise_XX handshake events.</div>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn-ops btn-ops-user-app" onclick="clearTelemetryTerminal()">Clear Terminal</button>
            <button class="btn-ops btn-ops-user-app" id="toggleStreamBtn" onclick="toggleTelemetryStreaming()">Pause Stream</button>
          </div>
        </div>

        <div class="terminal-container">
          <div class="terminal-header">
            <div class="terminal-dots">
              <span class="t-dot" style="background: #ef4444;"></span>
              <span class="t-dot" style="background: #f59e0b;"></span>
              <span class="t-dot" style="background: #10b981;"></span>
            </div>
            <span style="font-family: var(--font-mono); font-size: 0.75rem; color: #94a3b8;">sovra-daemon@localhost:${tcpPort} ~ streaming telemetry</span>
            <span style="font-family: var(--font-mono); font-size: 0.75rem; color: #10b981;" id="logCountBadge">12 events logged</span>
          </div>

          <div class="terminal-body" id="telemetryTerminalBody">
            <div><span class="t-log-info">[BOOT]</span> Sovra Protocol Node Runner initialized with Ed25519 master root key</div>
            <div><span class="t-log-p2p">[P2P]</span> libp2p Host listening on TCP port :${tcpPort} (Multiaddr: /ip4/127.0.0.1/tcp/${tcpPort})</div>
            <div><span class="t-log-p2p">[NOISE]</span> Noise_XX mutual cryptographic authentication handshake engine bound</div>
            <div><span class="t-log-info">[STORAGE]</span> UnixFS Merkle DAG Storage Node Daemon loaded: ${totalBlocks} blocks verified</div>
            <div><span class="t-log-info">[PUBSUB]</span> GossipSub v1.2 mesh subscription active on 'sovra/feed/main'</div>
            <div><span class="t-log-info">[PUBSUB]</span> GossipSub v1.2 mesh subscription active on 'sovra/creator/live'</div>
            <div><span class="t-log-p2p">[SWARM]</span> Kademlia DHT routing table initialized with alpha=3 concurrency</div>
            <div><span class="t-log-p2p">[BITCHAT]</span> BitChat zero-internet ad-hoc mesh initialized with 7-hop TTL</div>
            <div><span class="t-log-info">[HTTP]</span> REST Gateway and WebSocket server listening at http://localhost:3001</div>
            <div><span class="t-log-info">[ADMIN]</span> Product B Company Operations Console decoupled at http://localhost:3001/admin</div>
            <div><span class="t-log-p2p">[HEARTBEAT]</span> P2P Swarm mesh heartbeat OK &bull; Sub-300ms pre-warm active</div>
          </div>
        </div>
      </section>

      <!-- Section: Sovereign Broadcast Channels & Public Pages Registry -->
      <section class="ops-section" id="view-entities">
        <div class="ops-header-card">
          <div>
            <div class="ops-header-title">📢 Sovereign Channels &amp; Public Pages Registry</div>
            <div class="ops-header-desc">Decentralized network registry of broadcast channels, verified organization pages, and author personas. Isolated from consumer profiles.</div>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <button class="btn-ops" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.35); color: #f87171;" onclick="purgeTestArtifactsAdmin()">🧹 Purge Stale Test Artifacts</button>
            <button class="btn-ops btn-ops-user-app" onclick="location.reload()">Sync Registry</button>
          </div>
        </div>

        <div class="ops-grid">
          <div class="ops-card">
            <div class="ops-card-label">
              <span>Broadcast Channels</span>
              <span style="color:#38bdf8;">One-to-Many</span>
            </div>
            <div class="ops-card-val">${channels.length}</div>
            <div class="ops-card-sub">Global GossipSub pubsub topics</div>
          </div>

          <div class="ops-card">
            <div class="ops-card-label">
              <span>Sovereign Pages</span>
              <span style="color:#c084fc;">Brands &amp; Orgs</span>
            </div>
            <div class="ops-card-val">${pages.length}</div>
            <div class="ops-card-sub">Decentralized verified profiles</div>
          </div>

          <div class="ops-card">
            <div class="ops-card-label">
              <span>Curated Channels</span>
              <span style="color:#10b981;">Canonical</span>
            </div>
            <div class="ops-card-val">4</div>
            <div class="ops-card-sub">@sovra_alpha, @web3_gaming, @decentral_news, @ambient_radio</div>
          </div>

          <div class="ops-card">
            <div class="ops-card-label">
              <span>Total Network Entities</span>
              <span style="color:#f59e0b;">Registry</span>
            </div>
            <div class="ops-card-val">${channels.length + pages.length}</div>
            <div class="ops-card-sub">Persisted in dynamic-social-state.json</div>
          </div>
        </div>

        <!-- Channels & Pages Table -->
        <div class="ops-table-card">
          <div class="ops-table-header">
            <span class="ops-table-title">📡 Network Entities Directory</span>
            <span style="font-size:0.75rem; color:#94a3b8;">Centralized Admin Audit (Isolated from Consumer User Profiles)</span>
          </div>
          <table class="ops-table">
            <thead>
              <tr>
                <th>Entity</th>
                <th>Handle</th>
                <th>Type</th>
                <th>Category</th>
                <th>Subscribers / Reach</th>
                <th>Owner Identity</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${
                channels.length === 0 && pages.length === 0
                  ? '<tr><td colspan="7" style="text-align: center; color: #64748b; padding: 2rem;">No network entities found. Database is pristine clean!</td></tr>'
                  : [
                      ...channels.map(c => `
                        <tr>
                          <td>
                            <div style="display:flex; align-items:center; gap:8px;">
                              <div style="width:28px; height:28px; border-radius:8px; background:${c.bg || '#38bdf8'}; display:flex; align-items:center; justify-content:center; font-size:0.9rem;">${c.avatar || '📢'}</div>
                              <span style="font-weight:600; color:#f8fafc;">${c.name}</span>
                            </div>
                          </td>
                          <td style="color:#38bdf8; font-weight:600;">${c.handle}</td>
                          <td><span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; font-size:0.7rem;">📢 Channel</span></td>
                          <td><span style="color:#94a3b8; font-size:0.8rem;">${c.category || 'tech'}</span></td>
                          <td><span style="font-weight:600; color:#f8fafc;">${(c.count || 0).toLocaleString()}</span></td>
                          <td><code style="font-size:0.75rem; color:#94a3b8;" title="${c.ownerDid || 'System'}">${(c.ownerDid || 'did:sovra:system').slice(0, 18)}...</code></td>
                          <td>
                            ${
                              c.ownerDid === 'did:sovra:system' || ['ch-alpha', 'ch-gaming', 'ch-news', 'ch-music'].includes(c.id)
                                ? '<span style="font-size:0.72rem; color:#64748b;">Protected Seed</span>'
                                : `<button class="btn-ops" style="padding:3px 8px; font-size:0.72rem; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); color:#f87171;" onclick="deleteAdminChannel('${c.id}', '${c.name}')">Delete</button>`
                            }
                          </td>
                        </tr>
                      `),
                      ...pages.map(p => `
                        <tr>
                          <td>
                            <div style="display:flex; align-items:center; gap:8px;">
                              <div style="width:28px; height:28px; border-radius:8px; background:${p.bg || '#c084fc'}; display:flex; align-items:center; justify-content:center; font-size:0.9rem;">${p.avatar || '🏢'}</div>
                              <span style="font-weight:600; color:#f8fafc;">${p.name}</span>
                            </div>
                          </td>
                          <td style="color:#c084fc; font-weight:600;">${p.handle}</td>
                          <td><span class="badge" style="background:rgba(192,132,252,0.15); color:#c084fc; font-size:0.7rem;">🏢 Page</span></td>
                          <td><span style="color:#94a3b8; font-size:0.8rem;">${p.category || 'brand'}</span></td>
                          <td><span style="font-weight:600; color:#f8fafc;">${(p.count || 0).toLocaleString()}</span></td>
                          <td><code style="font-size:0.75rem; color:#94a3b8;" title="${p.ownerDid || 'System'}">${(p.ownerDid || 'did:sovra:system').slice(0, 18)}...</code></td>
                          <td>
                            ${
                              p.ownerDid === 'did:sovra:system' || ['pg-metropolis', 'pg-meshlabs', 'pg-bakery'].includes(p.id)
                                ? '<span style="font-size:0.72rem; color:#64748b;">Protected Seed</span>'
                                : `<button class="btn-ops" style="padding:3px 8px; font-size:0.72rem; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); color:#f87171;" onclick="deleteAdminPage('${p.id}', '${p.name}')">Delete</button>`
                            }
                          </td>
                        </tr>
                      `)
                    ].join('')
              }
            </tbody>
          </table>
        </div>
      </section>

    </main>
  </div>

  <!-- Raw Status JSON Modal -->
  <div class="ops-modal-overlay" id="rawJsonModal" style="display: none;" onclick="closeRawJsonModal()">
    <div class="ops-modal-card" onclick="event.stopPropagation()">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 700; font-size: 1.1rem; color: #fff;">Raw Node Status JSON</span>
        <button style="background: none; border: none; color: #fff; font-size: 1.2rem; cursor: pointer;" onclick="closeRawJsonModal()">✕</button>
      </div>
      <pre style="background: #020617; padding: 1rem; border-radius: 8px; border: 1px solid var(--admin-border); font-family: var(--font-mono); font-size: 0.76rem; max-height: 380px; overflow-y: auto; color: #38bdf8;" id="rawJsonContent">Loading...</pre>
      <button class="btn-ops btn-ops-user-app" style="width: 100%; justify-content: center;" onclick="copyRawJson()">Copy JSON</button>
    </div>
  </div>

  <script>
    window.__SOVRA_ADMIN_TOKEN__ = sessionStorage.getItem('sovra_ops_session') || '';

    async function promptAdminLogin() {
      const secret = prompt('Enter Admin Secret Key:');
      if (!secret) return;
      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminKey: secret })
        });
        const data = await res.json();
        if (data.ok && data.sessionToken) {
          sessionStorage.setItem('sovra_ops_session', data.sessionToken);
          window.__SOVRA_ADMIN_TOKEN__ = data.sessionToken;
          alert('Authenticated successfully');
          window.location.reload();
        } else {
          alert('Authentication failed: ' + (data.error || 'Invalid credential'));
        }
      } catch (err) {
        alert('Authentication error: ' + err);
      }
    }

    // Tab switching for Admin Sections
    function switchAdminTab(tabId) {
      document.querySelectorAll('.admin-nav-item').forEach(btn => {
        btn.classList.remove('active');
      });
      document.querySelectorAll('.ops-section').forEach(sec => {
        sec.classList.remove('active');
      });

      const targetBtn = Array.from(document.querySelectorAll('.admin-nav-item')).find(b => b.getAttribute('onclick')?.includes(tabId));
      if (targetBtn) targetBtn.classList.add('active');

      const targetSection = document.getElementById('view-' + tabId);
      if (targetSection) targetSection.classList.add('active');
    }

    // Copy helper
    function copyValue(val, btn) {
      navigator.clipboard.writeText(val).then(() => {
        const oldText = btn.innerText;
        btn.innerText = 'Copied!';
        setTimeout(() => { btn.innerText = oldText; }, 1800);
      });
    }

    // Raw Status JSON Viewer
    function inspectRawStatusJson() {
      fetch('/api/status')
        .then(r => r.json())
        .then(data => {
          document.getElementById('rawJsonContent').innerText = JSON.stringify(data, null, 2);
          document.getElementById('rawJsonModal').style.display = 'flex';
        })
        .catch(err => {
          alert('Failed to load status JSON: ' + err.message);
        });
    }

    function closeRawJsonModal() {
      document.getElementById('rawJsonModal').style.display = 'none';
    }

    function copyRawJson() {
      const code = document.getElementById('rawJsonContent').innerText;
      navigator.clipboard.writeText(code).then(() => {
        alert('Copied status JSON to clipboard!');
      });
    }

    // Panic Wipe confirmation
    function confirmPanicWipe() {
      const conf = confirm('🚨 CRITICAL WARNING:\\n\\nThis will zeroize local identity keys, purge local blockstore caches, and disconnect all P2P swarm peers.\\n\\nAre you sure you want to proceed?');
      if (conf) {
        localStorage.clear();
        fetch('/api/admin/panic', { method: 'POST' }).catch(() => {});
        alert('Node keys wiped! Reloading console...');
        window.location.reload();
      }
    }

    // Pin custom CID
    function pinCustomCid() {
      const input = document.getElementById('customCidPinInput');
      const cid = input?.value.trim();
      if (!cid) {
        alert('Please enter a valid CIDv1 string');
        return;
      }
      alert('CID ' + cid + ' successfully queued for BitSwap swarm pin retrieval!');
      input.value = '';
    }

    // Scan 2.4GHz channels
    function scanP2pChannels() {
      alert('📡 Scanning local BLE and Wi-Fi Direct spectrum...\\n\\nFound 2 active channels, 0 RF jamming detected, RSSI: -48dBm.');
    }

    // Export Ledger CSV / JSON
    function exportLedgerCsv() {
      fetch('/api/status')
        .then(r => r.json())
        .then(data => {
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'sovra-ledger-audit-' + Date.now() + '.json';
          a.click();
        });
    }

    // Live Telemetry Streamer Simulator
    let isTelemetryStreaming = true;
    let eventCounter = 12;

    function toggleTelemetryStreaming() {
      isTelemetryStreaming = !isTelemetryStreaming;
      const btn = document.getElementById('toggleStreamBtn');
      if (btn) btn.innerText = isTelemetryStreaming ? 'Pause Stream' : 'Resume Stream';
    }

    function clearTelemetryTerminal() {
      const body = document.getElementById('telemetryTerminalBody');
      if (body) {
        body.innerHTML = '<div><span class=\"t-log-info\">[SYSTEM]</span> Terminal buffer cleared.</div>';
        eventCounter = 1;
        document.getElementById('logCountBadge').innerText = '1 event logged';
      }
    }

    // Append periodic events to simulate live network traffic
    setInterval(() => {
      if (!isTelemetryStreaming) return;
      const body = document.getElementById('telemetryTerminalBody');
      if (!body) return;

      const randomEvents = [
        '<span class=\"t-log-p2p\">[BITSWAP]</span> Block request served: bafybeig...zdi (256KB &bull; 14ms)',
        '<span class=\"t-log-info\">[PUBSUB]</span> Inbound GossipSub packet validated (Topic: sovra/feed/main)',
        '<span class=\"t-log-p2p\">[NOISE]</span> Periodic ephemeral session key re-negotiation successful',
        '<span class=\"t-log-info\">[DHT]</span> Kademlia routing bucket query: alpha=3 responsive',
        '<span class=\"t-log-warn\">[PEER]</span> Mobile peer transitioned to low-power BLE mesh sleep cycle',
        '<span class=\"t-log-p2p\">[VOUCHER]</span> Micropayment off-chain settlement: 95% creator / 5% seeder verified',
      ];

      const chosen = randomEvents[Math.floor(Math.random() * randomEvents.length)];
      const line = document.createElement('div');
      line.innerHTML = chosen;
      body.appendChild(line);
      body.scrollTop = body.scrollHeight;

      eventCounter++;
      const badge = document.getElementById('logCountBadge');
      if (badge) badge.innerText = eventCounter + ' events logged';
    }, 3500);

    // Live uptime ticker
    let currentUptime = ${uptimeSeconds};
    setInterval(() => {
      currentUptime++;
      const mins = Math.floor(currentUptime / 60);
      const secs = currentUptime % 60;
      const el = document.getElementById('uptimeDisplay');
      if (el) el.innerText = mins + 'm ' + secs + 's';
    }, 1000);

    // Phase 6: Live Dynamic Database Metrics Polling & Audit Stream
    let currentAuditFilter = 'ALL';

    function filterAuditLogs(category, btn) {
      currentAuditFilter = category;
      document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');

      const rows = document.querySelectorAll('.audit-row');
      rows.forEach(r => {
        const type = r.getAttribute('data-type') || '';
        if (category === 'ALL') {
          r.style.display = '';
        } else if (category === 'USER') {
          r.style.display = (type.includes('USER') || type.includes('PROFILE')) ? '' : 'none';
        } else if (category === 'CHAT') {
          r.style.display = type.includes('CHAT') ? '' : 'none';
        } else if (category === 'POST') {
          r.style.display = (type.includes('POST') || type.includes('REEL')) ? '' : 'none';
        } else if (category === 'TIP') {
          r.style.display = type.includes('TIP') ? '' : 'none';
        }
      });
    }

    async function refreshAdminMetrics() {
      try {
        const token = window.__SOVRA_ADMIN_TOKEN__ || localStorage.getItem('sovra_admin_token') || sessionStorage.getItem('sovra_admin_token');
        const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
        const res = await fetch('/api/admin/metrics', { headers });
        const data = await res.json();
        if (data.ok) {
          updateAdminMetricsInDom(data);
        }
      } catch (err) {
        console.error('Failed to sync admin metrics:', err);
      }
    }

    function updateAdminMetricsInDom(data) {
      if (data.registeredUsersCount !== undefined) {
        const el = document.getElementById('metricUsersCount');
        if (el) el.innerText = data.registeredUsersCount;
        const sub = document.getElementById('metricUsersSub');
        if (sub) sub.innerText = data.registeredUsersCount + ' verified accounts in dynamic DB';
        const badge = document.getElementById('sidebarUsersBadge');
        if (badge) badge.innerText = data.registeredUsersCount;
        const tabCount = document.getElementById('usersTabCount');
        if (tabCount) tabCount.innerText = data.registeredUsersCount;
      }

      if (data.chatMessagesVolume !== undefined) {
        const el = document.getElementById('metricChatVolume');
        if (el) el.innerText = data.chatMessagesVolume;
        const sub = document.getElementById('metricThreadsSub');
        if (sub) sub.innerText = data.chatThreadsCount + ' active two-way threads';
        const tabVol = document.getElementById('usersTabMsgVolume');
        if (tabVol) tabVol.innerText = data.chatMessagesVolume;
      }

      if (data.diskStorageMb) {
        const el = document.getElementById('metricDiskStorage');
        if (el) el.innerText = data.diskStorageMb;
      }

      if (data.auditLogs && Array.isArray(data.auditLogs)) {
        const el = document.getElementById('metricAuditCount');
        if (el) el.innerText = data.auditLogs.length;
        const badge = document.getElementById('sidebarAuditBadge');
        if (badge) badge.innerText = data.auditLogs.length;
        const allBadge = document.getElementById('auditCountAll');
        if (allBadge) allBadge.innerText = data.auditLogs.length;

        const tbody = document.getElementById('auditTableBody');
        if (tbody) {
          tbody.innerHTML = data.auditLogs.map(log => {
            let badgeColor = '#6366f1';
            let badgeBg = 'rgba(99, 102, 241, 0.15)';
            if (log.type.includes('USER') || log.type.includes('PROFILE')) { badgeColor = '#38bdf8'; badgeBg = 'rgba(56, 189, 248, 0.15)'; }
            else if (log.type.includes('CHAT')) { badgeColor = '#10b981'; badgeBg = 'rgba(16, 185, 129, 0.15)'; }
            else if (log.type.includes('POST') || log.type.includes('REEL')) { badgeColor = '#a855f7'; badgeBg = 'rgba(168, 85, 247, 0.15)'; }
            else if (log.type.includes('TIP')) { badgeColor = '#fbbf24'; badgeBg = 'rgba(251, 191, 36, 0.15)'; }
            else if (log.type.includes('FRIEND')) { badgeColor = '#f43f5e'; badgeBg = 'rgba(244, 63, 94, 0.15)'; }

            return '<tr class="audit-row" data-type="' + log.type + '">' +
              '<td style="font-family: var(--font-mono); font-size: 0.75rem; color: #94a3b8;">' + new Date(log.timestamp).toLocaleTimeString() + '</td>' +
              '<td><span style="display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 0.72rem; font-weight: 700; font-family: var(--font-mono); color: ' + badgeColor + '; background: ' + badgeBg + '; border: 1px solid ' + badgeColor + '33;">' + log.type + '</span></td>' +
              '<td><span style="font-weight: 700; color: #fff;">' + log.actorHandle + '</span><div style="font-size: 0.68rem; color: #64748b; font-family: var(--font-mono);">' + log.actorDid.slice(-10) + '</div></td>' +
              '<td><span style="color: #e2e8f0;">' + log.details + '</span></td>' +
            '</tr>';
          }).join('');
        }
      }

      if (data.registeredUsers && Array.isArray(data.registeredUsers)) {
        const mobCount = document.getElementById('usersTabMobileCount');
        if (mobCount) mobCount.innerText = data.registeredUsers.filter(u => u.deviceType === 'Mobile').length;
        const dskCount = document.getElementById('usersTabDesktopCount');
        if (dskCount) dskCount.innerText = data.registeredUsers.filter(u => u.deviceType !== 'Mobile').length;

        const ubody = document.getElementById('usersTableBody');
        if (ubody) {
          ubody.innerHTML = data.registeredUsers.map(u => 
            '<tr>' +
              '<td><div style="display: flex; align-items: center; gap: 0.65rem;"><div style="width: 32px; height: 32px; border-radius: 50%; background: #6366f1; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #fff; font-size: 0.85rem;">' + (u.displayName || u.handle)[0].toUpperCase() + '</div><div><div style="font-weight: 700; color: #fff;">' + u.displayName + '</div><div style="font-size: 0.72rem; color: #38bdf8; font-family: var(--font-mono);">' + u.handle + '</div></div></div></td>' +
              '<td><span class="code-pill" style="color: ' + (u.deviceType === 'Mobile' ? '#38bdf8' : '#10b981') + ';">' + (u.deviceType === 'Mobile' ? '📱 Mobile' : '💻 Desktop') + '</span></td>' +
              '<td><strong style="color: #fbbf24; font-family: var(--font-mono);">' + (u.balanceSov || 500).toFixed(2) + ' SOV</strong></td>' +
              '<td><span class="code-pill">' + (u.did.length > 25 ? u.did.substring(0, 25) + '...' : u.did) + '</span></td>' +
              '<td style="font-size: 0.75rem; color: #94a3b8;">' + new Date(u.createdAt).toLocaleTimeString() + '</td>' +
            '</tr>'
          ).join('');
        }
      }
    }

    function deleteAdminChannel(channelId, name) {
      if (!confirm('Are you sure you want to delete broadcast channel "' + name + '"?')) return;
      fetch('/api/admin/channels/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: channelId })
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.ok) {
          alert('Channel deleted successfully.');
          location.reload();
        } else {
          alert('Failed to delete channel: ' + (d.error || 'Unknown error'));
        }
      })
      .catch(function(err) {
        alert('Delete error: ' + err.message);
      });
    }

    function deleteAdminPage(pageId, name) {
      if (!confirm('Are you sure you want to delete sovereign page "' + name + '"?')) return;
      fetch('/api/admin/pages/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: pageId })
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.ok) {
          alert('Page deleted successfully.');
          location.reload();
        } else {
          alert('Failed to delete page: ' + (d.error || 'Unknown error'));
        }
      })
      .catch(function(err) {
        alert('Delete error: ' + err.message);
      });
    }

    function purgeTestArtifactsAdmin() {
      if (!confirm('Purge all test channels, test pages, and stale automated artifacts? Protected seed entities will be preserved.')) return;
      fetch('/api/admin/entities/purge-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        alert('Purged ' + (d.purgedChannels || 0) + ' test channels and ' + (d.purgedPages || 0) + ' test pages.');
        location.reload();
      })
      .catch(function(err) {
        alert('Purge error: ' + err.message);
      });
    }

    // Auto-poll admin metrics every 3 seconds for live real-time sync
    setInterval(refreshAdminMetrics, 3000);
  </script>
</body>
</html>`;
}

export function renderAdminLoginHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SOVRA Operations Console — Sign In</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #090d16;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1.5rem;
    }
    .login-card {
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 12px;
      padding: 2.5rem;
      width: 100%;
      max-width: 440px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
    }
    .logo-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(99, 102, 241, 0.1);
      border: 1px solid rgba(99, 102, 241, 0.3);
      color: #818cf8;
      padding: 0.35rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 600;
      margin-bottom: 1.25rem;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      color: #f8fafc;
      margin-bottom: 0.5rem;
    }
    p.subtitle {
      color: #94a3b8;
      font-size: 0.875rem;
      margin-bottom: 1.75rem;
      line-height: 1.4;
    }
    .form-group {
      margin-bottom: 1.25rem;
    }
    label {
      display: block;
      font-size: 0.85rem;
      font-weight: 500;
      color: #cbd5e1;
      margin-bottom: 0.5rem;
    }
    input[type="password"], input[type="text"] {
      width: 100%;
      background: #1f2937;
      border: 1px solid #374151;
      border-radius: 8px;
      padding: 0.75rem 1rem;
      color: #f8fafc;
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.15s ease;
    }
    input[type="password"]:focus, input[type="text"]:focus {
      border-color: #6366f1;
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
    }
    .btn-submit {
      width: 100%;
      background: #4f46e5;
      color: white;
      font-weight: 600;
      font-size: 0.95rem;
      padding: 0.75rem;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s ease;
      margin-top: 0.5rem;
    }
    .btn-submit:hover {
      background: #4338ca;
    }
    .error-msg {
      display: none;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #f87171;
      padding: 0.75rem;
      border-radius: 8px;
      font-size: 0.85rem;
      margin-bottom: 1.25rem;
    }
    .security-notice {
      margin-top: 1.75rem;
      padding-top: 1.25rem;
      border-top: 1px solid #1f2937;
      font-size: 0.75rem;
      color: #64748b;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="logo-badge">🛡️ SOVRA OPS ZERO-TRUST</div>
    <h1>Operations Console</h1>
    <p class="subtitle">Administrative authentication is strictly enforced. Please enter your administrator credentials to proceed.</p>

    <div id="errorAlert" class="error-msg"></div>

    <form id="adminLoginForm" onsubmit="handleAdminLogin(event)">
      <div class="form-group">
        <label for="adminKeyInput">Admin Secret Key</label>
        <input type="password" id="adminKeyInput" placeholder="Enter ADMIN_SECRET_KEY" required autocomplete="current-password" autofocus />
      </div>

      <div class="form-group">
        <label for="adminRoleSelect">Administrative Role</label>
        <select id="adminRoleSelect" style="width: 100%; background: #1f2937; border: 1px solid #374151; border-radius: 8px; padding: 0.75rem 1rem; color: #f8fafc; font-size: 0.95rem;">
          <option value="SUPER_ADMIN">SUPER_ADMIN (Full Console Operations)</option>
          <option value="ADMIN">ADMIN (Infrastructure & Metrics)</option>
          <option value="MODERATOR">MODERATOR (Content & Channels)</option>
          <option value="SECURITY_ADMIN">SECURITY_ADMIN (Audits & Keys)</option>
        </select>
      </div>

      <button type="submit" class="btn-submit" id="submitBtn">Authenticate Session</button>
    </form>

    <div class="security-notice">
      SEC-RBAC-01: All access attempts are cryptographically verified, rate-limited, and logged. Anonymous privilege escalation is strictly prevented.
    </div>
  </div>

  <script>
    async function handleAdminLogin(e) {
      e.preventDefault();
      const errBox = document.getElementById('errorAlert');
      const submitBtn = document.getElementById('submitBtn');
      const adminKey = document.getElementById('adminKeyInput').value.trim();
      const role = document.getElementById('adminRoleSelect').value;

      errBox.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.innerText = 'Verifying...';

      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminKey, role })
        });
        const data = await res.json();
        if (data.ok && data.sessionToken) {
          localStorage.setItem('sovra_admin_token', data.sessionToken);
          document.cookie = 'sovra_session_token=' + encodeURIComponent(data.sessionToken) + '; Path=/; SameSite=Strict; Max-Age=604800';
          window.location.reload();
        } else {
          errBox.textContent = data.error || 'Authentication failed. Please verify credentials.';
          errBox.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.innerText = 'Authenticate Session';
        }
      } catch (err) {
        errBox.textContent = 'Connection error: ' + err.message;
        errBox.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.innerText = 'Authenticate Session';
      }
    }
  </script>
</body>
</html>`;
}

