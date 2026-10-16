/**
 * @file scripts/blockchain-explorer.ts
 * Sovra Layer-1 CometBFT Blockchain Web Explorer UI
 * 
 * High-performance, zero-external-dependency web explorer interface
 * for real-time blocks, transactions, supply counters, and P2P validator peering.
 */

export function renderExplorerHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sovra Layer-1 Explorer | CometBFT Testnet-0</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>">
  <style>
    :root {
      --bg-dark: #060b13;
      --bg-card: rgba(15, 23, 42, 0.75);
      --bg-card-hover: rgba(30, 41, 59, 0.85);
      --border-color: rgba(0, 240, 255, 0.2);
      --border-glow: rgba(0, 240, 255, 0.4);
      --cyan: #00f0ff;
      --emerald: #10b981;
      --purple: #a855f7;
      --amber: #f59e0b;
      --red: #ef4444;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --mono: 'JetBrains Mono', 'Fira Code', Consolas, Monaco, monospace;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background: radial-gradient(circle at 50% 0%, #0d1b2a 0%, #060b13 70%, #030712 100%);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      overflow-x: hidden;
      line-height: 1.5;
    }

    /* Top Navigation Bar */
    .explorer-nav {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(6, 11, 19, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border-color);
      padding: 0.75rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .brand-wrap {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      text-decoration: none;
      color: inherit;
    }

    .brand-logo {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: linear-gradient(135deg, #00f0ff 0%, #3b82f6 50%, #8b5cf6 100%);
      box-shadow: 0 0 16px rgba(0, 240, 255, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 900;
      font-size: 1.25rem;
      color: #fff;
    }

    .brand-text h1 {
      font-size: 1.15rem;
      font-weight: 800;
      letter-spacing: 0.05em;
      background: linear-gradient(90deg, #fff 0%, #00f0ff 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      line-height: 1.2;
    }

    .network-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.7rem;
      font-weight: 700;
      color: #34d399;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.35);
      padding: 0.15rem 0.5rem;
      border-radius: 9999px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .pulse-dot {
      width: 7px;
      height: 7px;
      background: #10b981;
      border-radius: 50%;
      box-shadow: 0 0 8px #10b981;
      animation: livePulse 1.8s infinite;
    }

    @keyframes livePulse {
      0% { transform: scale(0.95); opacity: 0.7; }
      50% { transform: scale(1.3); opacity: 1; }
      100% { transform: scale(0.95); opacity: 0.7; }
    }

    /* Global Search */
    .search-container {
      flex: 1;
      max-width: 580px;
      position: relative;
    }

    .search-input {
      width: 100%;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(0, 240, 255, 0.25);
      border-radius: 9999px;
      padding: 0.6rem 1rem 0.6rem 2.5rem;
      color: #fff;
      font-size: 0.85rem;
      font-family: var(--mono);
      outline: none;
      transition: all 0.2s ease;
    }

    .search-input:focus {
      border-color: var(--cyan);
      box-shadow: 0 0 16px rgba(0, 240, 255, 0.35);
      background: rgba(15, 23, 42, 0.95);
    }

    .search-icon {
      position: absolute;
      left: 0.9rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      pointer-events: none;
    }

    /* Top Nav Controls */
    .nav-controls {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .btn-toggle-refresh {
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(0, 240, 255, 0.25);
      color: var(--text-main);
      padding: 0.45rem 0.85rem;
      border-radius: 8px;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.4rem;
      transition: all 0.2s;
    }

    .btn-toggle-refresh:hover {
      background: rgba(0, 240, 255, 0.15);
      border-color: var(--cyan);
    }

    .btn-wallet-link {
      background: linear-gradient(135deg, rgba(0, 240, 255, 0.2) 0%, rgba(59, 130, 246, 0.2) 100%);
      border: 1px solid var(--cyan);
      color: var(--cyan);
      padding: 0.45rem 0.9rem;
      border-radius: 8px;
      font-size: 0.75rem;
      font-weight: 700;
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 0.4rem;
      transition: all 0.2s;
    }

    .btn-wallet-link:hover {
      background: var(--cyan);
      color: #000;
      box-shadow: 0 0 14px rgba(0, 240, 255, 0.5);
    }

    /* Main Container */
    .explorer-main {
      max-width: 1360px;
      margin: 0 auto;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    /* Hero Metric Cards Grid */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1rem;
    }

    .metric-card {
      background: var(--bg-card);
      backdrop-filter: blur(10px);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      padding: 1.25rem;
      position: relative;
      overflow: hidden;
      transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
    }

    .metric-card:hover {
      border-color: var(--border-glow);
      box-shadow: 0 4px 20px rgba(0, 240, 255, 0.12);
      transform: translateY(-2px);
    }

    .metric-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.6rem;
    }

    .metric-title {
      font-size: 0.75rem;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }

    .metric-icon {
      font-size: 1.15rem;
      opacity: 0.85;
    }

    .metric-value {
      font-size: 1.65rem;
      font-weight: 800;
      font-family: var(--mono);
      color: #fff;
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
    }

    .metric-sub {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.35rem;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }

    .badge-ok {
      color: #34d399;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.35);
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 700;
    }

    /* Navigation Tabs */
    .tab-bar {
      display: flex;
      gap: 0.5rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 0.5rem;
      overflow-x: auto;
    }

    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 0.6rem 1rem;
      font-size: 0.85rem;
      font-weight: 700;
      cursor: pointer;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s;
      white-space: nowrap;
    }

    .tab-btn:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.05);
    }

    .tab-btn.active {
      color: var(--cyan);
      background: rgba(0, 240, 255, 0.12);
      border: 1px solid rgba(0, 240, 255, 0.3);
    }

    /* Content Panels */
    .tab-panel {
      display: none;
      flex-direction: column;
      gap: 1.5rem;
    }

    .tab-panel.active {
      display: flex;
    }

    /* Live Feed Split View */
    .feed-split {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.25rem;
    }

    @media (max-width: 960px) {
      .feed-split {
        grid-template-columns: 1fr;
      }
    }

    .section-card {
      background: var(--bg-card);
      backdrop-filter: blur(10px);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 0.75rem;
    }

    .section-title {
      font-size: 0.95rem;
      font-weight: 800;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #fff;
    }

    /* Item Streams */
    .item-list {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }

    .block-item, .tx-item {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      padding: 0.85rem 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .block-item:hover, .tx-item:hover {
      background: var(--bg-card-hover);
      border-color: var(--border-glow);
      transform: translateX(3px);
    }

    .block-left, .tx-left {
      display: flex;
      align-items: center;
      gap: 0.85rem;
    }

    .block-icon-badge {
      width: 42px;
      height: 42px;
      border-radius: 8px;
      background: rgba(0, 240, 255, 0.1);
      border: 1px solid rgba(0, 240, 255, 0.3);
      color: var(--cyan);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 0.95rem;
    }

    .tx-icon-badge {
      width: 42px;
      height: 42px;
      border-radius: 8px;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: var(--emerald);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 0.95rem;
    }

    .tx-icon-badge.burn {
      background: rgba(245, 158, 11, 0.1);
      border-color: rgba(245, 158, 11, 0.3);
      color: var(--amber);
    }

    .tx-icon-badge.wasm {
      background: rgba(168, 85, 247, 0.1);
      border-color: rgba(168, 85, 247, 0.3);
      color: var(--purple);
    }

    .item-meta h4 {
      font-size: 0.88rem;
      font-weight: 700;
      color: #fff;
      font-family: var(--mono);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .item-meta p {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.15rem;
    }

    .item-right {
      text-align: right;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0.2rem;
    }

    .item-right .amount {
      font-size: 0.85rem;
      font-weight: 800;
      font-family: var(--mono);
      color: #34d399;
    }

    .item-right .amount.burn {
      color: #fbbf24;
    }

    .item-right .sub {
      font-size: 0.7rem;
      color: var(--text-muted);
    }

    /* Tables */
    .table-container {
      overflow-x: auto;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .explorer-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.82rem;
    }

    .explorer-table th {
      background: rgba(15, 23, 42, 0.9);
      color: var(--text-muted);
      text-transform: uppercase;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      padding: 0.85rem 1rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .explorer-table td {
      padding: 0.85rem 1rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: var(--text-main);
      vertical-align: middle;
    }

    .explorer-table tr:hover td {
      background: rgba(30, 41, 59, 0.5);
    }

    .mono-chip {
      font-family: var(--mono);
      background: rgba(255, 255, 255, 0.06);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.78rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      border: 1px solid transparent;
      transition: all 0.15s;
    }

    .mono-chip:hover {
      border-color: var(--cyan);
      color: var(--cyan);
      background: rgba(0, 240, 255, 0.1);
    }

    /* Validator Cards */
    .validators-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
      gap: 1.25rem;
    }

    .val-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      position: relative;
    }

    .val-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .val-moniker {
      font-size: 1.05rem;
      font-weight: 800;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 0.45rem;
    }

    .val-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.78rem;
    }

    .val-row .label {
      color: var(--text-muted);
    }

    .val-row .val {
      font-family: var(--mono);
      font-weight: 600;
    }

    .voting-power-bar {
      height: 6px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 9999px;
      overflow: hidden;
      margin-top: 0.35rem;
    }

    .voting-power-fill {
      height: 100%;
      background: linear-gradient(90deg, #00f0ff, #10b981);
      width: 25%;
    }

    /* Modals */
    .modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 200;
      background: rgba(3, 7, 18, 0.85);
      backdrop-filter: blur(8px);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }

    .modal-content {
      background: #0d1626;
      border: 1px solid var(--border-glow);
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8), 0 0 20px rgba(0, 240, 255, 0.25);
      border-radius: 16px;
      max-width: 680px;
      width: 100%;
      max-height: 85vh;
      overflow-y: auto;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      animation: modalPop 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes modalPop {
      0% { transform: scale(0.95); opacity: 0; }
      100% { transform: scale(1); opacity: 1; }
    }

    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 0.75rem;
    }

    .modal-title {
      font-size: 1.1rem;
      font-weight: 800;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .btn-close {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 1.4rem;
      cursor: pointer;
      line-height: 1;
      padding: 0.2rem;
    }

    .btn-close:hover {
      color: #fff;
    }

    .detail-grid {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }

    .detail-row {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      background: rgba(15, 23, 42, 0.5);
      padding: 0.6rem 0.85rem;
      border-radius: 8px;
    }

    .detail-label {
      font-size: 0.7rem;
      color: var(--text-muted);
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.05em;
    }

    .detail-val {
      font-family: var(--mono);
      font-size: 0.85rem;
      color: #fff;
      word-break: break-all;
    }

    /* Toast Notification */
    .copy-toast {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background: #10b981;
      color: #fff;
      font-weight: 700;
      font-size: 0.82rem;
      padding: 0.6rem 1.1rem;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
      display: none;
      z-index: 300;
      animation: fadeInOut 2s ease forwards;
    }

    @keyframes fadeInOut {
      0% { opacity: 0; transform: translateY(10px); }
      15% { opacity: 1; transform: translateY(0); }
      85% { opacity: 1; transform: translateY(0); }
      100% { opacity: 0; transform: translateY(-10px); }
    }
  </style>
</head>
<body>

  <!-- Top Navigation -->
  <header class="explorer-nav">
    <a href="/explorer" class="brand-wrap">
      <div class="brand-logo">⚡</div>
      <div class="brand-text">
        <h1>SOVRA EXPLORER</h1>
        <div class="network-badge">
          <span class="pulse-dot"></span>
          <span id="navChainId">sovra-testnet-0</span>
        </div>
      </div>
    </a>

    <!-- Global Search -->
    <div class="search-container">
      <span class="search-icon">🔍</span>
      <input type="text" id="explorerGlobalSearch" class="search-input" placeholder="Search by Block Height / Tx Hash / Address (sovra1...)">
    </div>

    <!-- Controls -->
    <div class="nav-controls">
      <button class="btn-toggle-refresh" id="toggleRefreshBtn" onclick="toggleAutoRefresh()">
        <span id="refreshIcon">🔄</span>
        <span id="refreshText">LIVE (2s)</span>
      </button>
      <a href="/" class="btn-wallet-link" title="Open Sovra Super App & Web Wallet">
        <span>👛 Web Wallet</span>
        <span>↗</span>
      </a>
    </div>
  </header>

  <!-- Main Content -->
  <main class="explorer-main">

    <!-- Top Metric Cards -->
    <div class="metrics-grid">
      <!-- Card 1: Block Height -->
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-title">Block Height</span>
          <span class="metric-icon">🧱</span>
        </div>
        <div class="metric-value">
          <span id="heroHeight">0</span>
          <span style="font-size: 0.85rem; color: #34d399; font-weight: 700;">#</span>
        </div>
        <div class="metric-sub">
          <span class="pulse-dot"></span>
          <span>Block Time ~3.0s | Instant BFT Finality</span>
        </div>
      </div>

      <!-- Card 2: Total Supply -->
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-title">Circulating Bank Supply</span>
          <span class="metric-icon">🪙</span>
        </div>
        <div class="metric-value">
          <span id="heroTotalSupply">0</span>
          <span style="font-size: 0.85rem; color: var(--cyan); font-weight: 700;">SOV</span>
        </div>
        <div class="metric-sub">
          <span id="heroTotalSupplyUsov">0 uSOV</span>
        </div>
      </div>

      <!-- Card 3: Invariant & Mint/Burn -->
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-title">Supply Invariant</span>
          <span class="metric-icon">⚖️</span>
        </div>
        <div class="metric-value" style="font-size: 1.25rem;">
          <span class="badge-ok" id="heroInvariantBadge">✓ 100% BALANCED</span>
        </div>
        <div class="metric-sub">
          <span>Mint: <strong id="heroLifetimeMint" style="color:#fff;">0</strong> | Burn: <strong id="heroLifetimeBurn" style="color:#fbbf24;">0</strong></span>
        </div>
      </div>

      <!-- Card 4: Active Validators -->
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-title">Consensus Quorum</span>
          <span class="metric-icon">🛰️</span>
        </div>
        <div class="metric-value">
          <span id="heroValidators">4 / 4</span>
          <span style="font-size: 0.85rem; color: #a78bfa; font-weight: 700;">Active</span>
        </div>
        <div class="metric-sub">
          <span id="heroQuorumStatus">CometBFT PBFT Supermajority (100%)</span>
        </div>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="tab-bar">
      <button class="tab-btn active" onclick="switchExplorerTab('overview', this)">
        <span>⚡</span> <span>Live Overview</span>
      </button>
      <button class="tab-btn" onclick="switchExplorerTab('blocks', this)">
        <span>🧱</span> <span>Blocks</span>
      </button>
      <button class="tab-btn" onclick="switchExplorerTab('transactions', this)">
        <span>💸</span> <span>Transactions</span>
      </button>
      <button class="tab-btn" id="tabBtnTokens" onclick="switchExplorerTab('tokens', this)">
        <span>🪙</span> <span>Creator Tokens (CW20)</span> <span id="tokensCountBadge" style="margin-left: 4px; background: rgba(0, 240, 255, 0.15); color: var(--cyan); border: 1px solid rgba(0, 240, 255, 0.3); font-size: 0.65rem; padding: 1px 6px; border-radius: 9999px;">0</span>
      </button>
      <button class="tab-btn" id="tabBtnMempool" onclick="switchExplorerTab('mempool', this)">
        <span>⏳</span> <span>Mempool</span> <span id="mempoolBadgeCount" style="margin-left: 4px; background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); font-size: 0.65rem; padding: 1px 6px; border-radius: 9999px;">0</span>
      </button>
      <button class="tab-btn" onclick="switchExplorerTab('validators', this)">
        <span>🛰️</span> <span>Validators & P2P Peering</span>
      </button>
      <button class="tab-btn" onclick="switchExplorerTab('economics', this)">
        <span>⚖️</span> <span>Economics & Invariant</span>
      </button>
    </div>

    <!-- Tab 1: Live Overview -->
    <section id="panel-overview" class="tab-panel active">
      <div class="feed-split">
        <!-- Latest Blocks Column -->
        <div class="section-card">
          <div class="section-header">
            <h3 class="section-title"><span>🧱</span> Latest Blocks</h3>
            <button class="btn-toggle-refresh" onclick="switchExplorerTab('blocks', document.querySelectorAll('.tab-btn')[1])">View All ↗</button>
          </div>
          <div class="item-list" id="overviewBlocksList">
            <!-- Rendered dynamically -->
          </div>
        </div>

        <!-- Latest Transactions Column -->
        <div class="section-card">
          <div class="section-header">
            <h3 class="section-title"><span>💸</span> Latest Transactions</h3>
            <button class="btn-toggle-refresh" onclick="switchExplorerTab('transactions', document.querySelectorAll('.tab-btn')[2])">View All ↗</button>
          </div>
          <div class="item-list" id="overviewTxsList">
            <!-- Rendered dynamically -->
          </div>
        </div>
      </div>
    </section>

    <!-- Tab 2: Blocks -->
    <section id="panel-blocks" class="tab-panel">
      <div class="section-card">
        <div class="section-header">
          <h3 class="section-title"><span>🧱</span> Block Stream</h3>
          <span style="font-size: 0.75rem; color: var(--text-muted);">Real-time BFT committed blocks (sub-second finality)</span>
        </div>
        <div class="table-container">
          <table class="explorer-table">
            <thead>
              <tr>
                <th>Height</th>
                <th>Age</th>
                <th>Proposer</th>
                <th>Tx Count</th>
                <th>Gas Used</th>
                <th>App Hash</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="blocksTableBody">
              <!-- Rendered dynamically -->
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Tab 3: Transactions -->
    <section id="panel-transactions" class="tab-panel">
      <div class="section-card">
        <div class="section-header">
          <h3 class="section-title"><span>💸</span> On-Chain Transaction Ledger</h3>
          <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
            <button class="btn-toggle-refresh" onclick="filterTxTable('all')">All</button>
            <button class="btn-toggle-refresh" onclick="filterTxTable('send')">Transfers</button>
            <button class="btn-toggle-refresh" onclick="filterTxTable('burn')">Burns</button>
            <button class="btn-toggle-refresh" onclick="filterTxTable('wasm')" style="background: rgba(168, 85, 247, 0.15); border-color: #a855f7; color: #c084fc;">CW20 / Smart Contracts</button>
            <button class="btn-toggle-refresh" onclick="exportTransactionsCsv()" style="background: rgba(16, 185, 129, 0.15); border-color: #10b981; color: #34d399;" title="Export filtered ledger as RFC 4180 CSV">
              <span>⬇️</span> <span>Export CSV</span>
            </button>
          </div>
        </div>
        <div class="table-container">
          <table class="explorer-table">
            <thead>
              <tr>
                <th>Tx Hash</th>
                <th>Type</th>
                <th>From</th>
                <th>To / Contract</th>
                <th>Amount / Action</th>
                <th>Fee</th>
                <th>Block</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="txsTableBody">
              <!-- Rendered dynamically -->
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Tab 4: Creator Tokens (CW20) -->
    <section id="panel-tokens" class="tab-panel">
      <div class="section-card">
        <div class="section-header">
          <h3 class="section-title"><span>🪙</span> CosmWasm CW20 Creator Tokens</h3>
          <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
            <button class="btn-toggle-refresh" onclick="fetchCreatorTokens(true)">🔄 Refresh Tokens</button>
            <span style="font-size: 0.75rem; color: var(--text-muted);">Decentralized Sovereign Creator Coins on Layer-1</span>
          </div>
        </div>
        <div class="table-container">
          <table class="explorer-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Token Name</th>
                <th>Decimals</th>
                <th>Total Supply</th>
                <th>Creator Address</th>
                <th>Contract Address</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="tokensTableBody">
              <!-- Rendered dynamically -->
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Tab: Mempool Visualization -->
    <section id="panel-mempool" class="tab-panel">
      <div class="section-card">
        <div class="section-header">
          <h3 class="section-title"><span>⏳</span> Unconfirmed Mempool Stream</h3>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <button class="btn-toggle-refresh" onclick="fetchMempoolData(true)">🔄 Refresh Pool</button>
            <span style="font-size: 0.75rem; color: var(--text-muted);">Awaiting BFT Block Commitment</span>
          </div>
        </div>
        <div class="metrics-grid" style="margin-bottom: 1.25rem;">
          <div class="metric-card" style="padding: 1rem;">
            <div class="metric-title">Pending Transactions</div>
            <div class="metric-value" style="font-size: 1.5rem;" id="mempoolCount">0</div>
            <div class="metric-sub">In CometBFT memory</div>
          </div>
          <div class="metric-card" style="padding: 1rem;">
            <div class="metric-title">Mempool Payload Size</div>
            <div class="metric-value" style="font-size: 1.5rem;" id="mempoolBytes">0 B</div>
            <div class="metric-sub">Raw tx serialization</div>
          </div>
          <div class="metric-card" style="padding: 1rem;">
            <div class="metric-title">Congestion State</div>
            <div class="metric-value" style="font-size: 1.1rem;"><span class="badge-ok" id="mempoolCongestionBadge">🟢 HEALTHY / ZERO CONGESTION</span></div>
            <div class="metric-sub">Block Inclusion ~3.0s</div>
          </div>
          <div class="metric-card" style="padding: 1rem;">
            <div class="metric-title">Max Capacity</div>
            <div class="metric-value" style="font-size: 1.1rem; color: var(--cyan);" id="mempoolCapacity">5,000 txs (100 MB)</div>
            <div class="metric-sub">FIFO / Priority Queue</div>
          </div>
        </div>
        <div class="table-container">
          <table class="explorer-table">
            <thead>
              <tr>
                <th>Tx Hash</th>
                <th>Age / In Pool</th>
                <th>Sender</th>
                <th>Recipient</th>
                <th>Amount</th>
                <th>Fee</th>
                <th>Priority</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="mempoolTableBody">
              <!-- Rendered dynamically -->
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Tab 4: Validators & P2P Peering -->
    <section id="panel-validators" class="tab-panel">
      <div class="section-card">
        <div class="section-header">
          <h3 class="section-title"><span>🛰️</span> CometBFT Consensus Validator Nodes (4/4 Swarm)</h3>
          <span class="badge-ok" id="valQuorumBadge">100% Supermajority Quorum Active</span>
        </div>
        <div class="validators-grid" id="validatorsGrid">
          <!-- Rendered dynamically -->
        </div>
      </div>

      <!-- P2P Peering Mesh Topology Card -->
      <div class="section-card">
        <div class="section-header">
          <h3 class="section-title"><span>🌐</span> P2P Gossip & Consensus Topology</h3>
          <span style="font-size: 0.75rem; color: var(--text-muted);">Decentralized Full-Mesh P2P (Ports 26656-26686)</span>
        </div>
        <div style="background: rgba(15, 23, 42, 0.6); padding: 1.25rem; border-radius: 10px; font-family: var(--mono); font-size: 0.8rem; line-height: 1.8;">
          <div style="color: var(--cyan); font-weight: 700; margin-bottom: 0.5rem;">[CometBFT Tendermint-Engine Consensus Mesh]</div>
          <div>• Node 0 (Port 26657 / P2P 26656) ⟷ Connected to Nodes 1, 2, 3 [Latency &lt; 2ms]</div>
          <div>• Node 1 (Port 26667 / P2P 26666) ⟷ Connected to Nodes 0, 2, 3 [Latency &lt; 2ms]</div>
          <div>• Node 2 (Port 26677 / P2P 26676) ⟷ Connected to Nodes 0, 1, 3 [Latency &lt; 2ms]</div>
          <div>• Node 3 (Port 26687 / P2P 26686) ⟷ Connected to Nodes 0, 1, 2 [Latency &lt; 2ms]</div>
          <div style="margin-top: 0.75rem; color: #34d399;">✓ Consensus Algorithm: Tendermint Core BFT (Prevote + Precommit rounds $\ge$ 2/3 + 1)</div>
        </div>
      </div>
    </section>

    <!-- Tab 5: Economics & Invariant -->
    <section id="panel-economics" class="tab-panel">
      <div class="section-card">
        <div class="section-header">
          <h3 class="section-title"><span>⚖️</span> Sovereign Economics & Conservation of Supply</h3>
          <span class="badge-ok">ABCI State Machine Verification</span>
        </div>
        
        <div style="display: flex; flex-direction: column; gap: 1rem; background: rgba(15, 23, 42, 0.6); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(0, 240, 255, 0.2);">
          <h4 style="color: #fff; font-size: 1.1rem; font-weight: 800;">Protocol Master Conservation Equation</h4>
          <div style="font-family: var(--mono); font-size: 1.15rem; color: var(--cyan); background: rgba(0,0,0,0.4); padding: 1rem; border-radius: 8px; border-left: 4px solid var(--cyan);" id="econFormulaDisplay">
            Total Bank Supply == Lifetime Minted - Lifetime Burned
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-top: 0.5rem;">
            <div style="background: rgba(255,255,255,0.04); padding: 1rem; border-radius: 8px;">
              <div style="color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase;">Bank Supply</div>
              <div style="font-size: 1.25rem; font-weight: 800; color: #fff; font-family: var(--mono); margin-top: 0.2rem;" id="econBankSupply">0 SOV</div>
            </div>
            <div style="background: rgba(255,255,255,0.04); padding: 1rem; border-radius: 8px;">
              <div style="color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase;">Lifetime Minted</div>
              <div style="font-size: 1.25rem; font-weight: 800; color: #34d399; font-family: var(--mono); margin-top: 0.2rem;" id="econMinted">0 SOV</div>
            </div>
            <div style="background: rgba(255,255,255,0.04); padding: 1rem; border-radius: 8px;">
              <div style="color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase;">Lifetime Burned</div>
              <div style="font-size: 1.25rem; font-weight: 800; color: #fbbf24; font-family: var(--mono); margin-top: 0.2rem;" id="econBurned">0 SOV</div>
            </div>
          </div>
        </div>

        <div style="background: rgba(15, 23, 42, 0.6); padding: 1.25rem; border-radius: 12px;">
          <h4 style="font-size: 0.95rem; font-weight: 800; color: #fff; margin-bottom: 0.75rem;">Tokenomics Specifications</h4>
          <ul style="padding-left: 1.25rem; font-size: 0.85rem; color: var(--text-muted); line-height: 1.8;">
            <li><strong>Base Denomination:</strong> <code style="color:var(--cyan);">usov</code> (Micro-SOV), where <code style="color:#fff;">1 SOV = 1,000,000 usov</code></li>
            <li><strong>Genesis Allocation:</strong> <code style="color:#fff;">30,000,000 SOV</code> evenly staked across initial consensus validators</li>
            <li><strong>Issuance Mechanism:</strong> Epoch-based daily issuance allocation to creator rewards, storage seeders, and relay nodes</li>
            <li><strong>Deflationary Engine:</strong> Protocol coin burning with programmatic reduction of <code style="color:#fff;">bank_supply</code> in the ABCI state store</li>
          </ul>
        </div>
      </div>
    </section>

  </main>

  <!-- Block Detail Modal -->
  <div id="explorerBlockModal" class="modal-overlay" onclick="closeExplorerModal('explorerBlockModal')">
    <div class="modal-content" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3 class="modal-title"><span>🧱</span> Block Details</h3>
        <button class="btn-close" onclick="closeExplorerModal('explorerBlockModal')">&times;</button>
      </div>
      <div class="detail-grid" id="blockModalBody">
        <!-- Rendered dynamically -->
      </div>
    </div>
  </div>

  <!-- Tx Detail Modal -->
  <div id="explorerTxModal" class="modal-overlay" onclick="closeExplorerModal('explorerTxModal')">
    <div class="modal-content" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3 class="modal-title"><span>💸</span> Transaction Details</h3>
        <button class="btn-close" onclick="closeExplorerModal('explorerTxModal')">&times;</button>
      </div>
      <div class="detail-grid" id="txModalBody">
        <!-- Rendered dynamically -->
      </div>
    </div>
  </div>

  <!-- Account Detail Modal -->
  <div id="explorerAccountModal" class="modal-overlay" onclick="closeExplorerModal('explorerAccountModal')">
    <div class="modal-content" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3 class="modal-title"><span>👤</span> Account Inspector</h3>
        <button class="btn-close" onclick="closeExplorerModal('explorerAccountModal')">&times;</button>
      </div>
      <div class="detail-grid" id="accountModalBody">
        <!-- Rendered dynamically -->
      </div>
    </div>
  </div>

  <!-- Contract & Token Detail Modal -->
  <div id="explorerContractModal" class="modal-overlay" onclick="closeExplorerModal('explorerContractModal')">
    <div class="modal-content" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3 class="modal-title"><span>🪙</span> CW20 Token & Smart Contract Inspector</h3>
        <button class="btn-close" onclick="closeExplorerModal('explorerContractModal')">&times;</button>
      </div>
      <div class="detail-grid" id="contractModalBody">
        <!-- Rendered dynamically -->
      </div>
    </div>
  </div>

  <!-- Toast Notification -->
  <div id="copyToast" class="copy-toast">✓ Copied to clipboard!</div>

  <!-- Client-side Interactive Script -->
  <script>
    var isAutoRefresh = true;
    var refreshTimer = null;
    var cachedSummary = null;
    var activeTxFilter = 'all';
    var currentInspectedAddress = '';
    var sseSource = null;
    var isStreaming = false;

    function showToast(msg) {
      var t = document.getElementById('copyToast');
      if (!t) return;
      t.innerText = msg || '✓ Copied to clipboard!';
      t.style.display = 'block';
      setTimeout(function() { t.style.display = 'none'; }, 2000);
    }

    function copyText(txt) {
      if (!txt) return;
      navigator.clipboard.writeText(txt).then(function() {
        showToast('✓ Copied: ' + txt.slice(0, 16) + '...');
      }).catch(function() {
        showToast('✓ Copied!');
      });
    }

    function switchExplorerTab(tabName, btn) {
      document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
      if (btn) btn.classList.add('active');
      var p = document.getElementById('panel-' + tabName);
      if (p) p.classList.add('active');
      if (tabName === 'mempool') {
        fetchMempoolData(false);
      }
      if (tabName === 'tokens') {
        fetchCreatorTokens(false);
      }
    }

    function toggleAutoRefresh() {
      isAutoRefresh = !isAutoRefresh;
      var icon = document.getElementById('refreshIcon');
      var text = document.getElementById('refreshText');
      if (isAutoRefresh) {
        if (icon) icon.innerText = '🔄';
        if (text) text.innerText = 'LIVE (2s)';
        fetchExplorerData();
      } else {
        if (icon) icon.innerText = '⏸';
        if (text) text.innerText = 'PAUSED';
      }
    }

    function formatNumber(n) {
      return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 6 });
    }

    function formatTimeAgo(ms) {
      var sec = Math.floor((Date.now() - Number(ms)) / 1000);
      if (sec < 0) return 'Just now';
      if (sec < 5) return 'Just now';
      if (sec < 60) return sec + 's ago';
      if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
      return Math.floor(sec / 3600) + 'h ago';
    }

    function closeExplorerModal(id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }

    function openBlockModal(height) {
      if (!cachedSummary || !cachedSummary.recentBlocks) return;
      var block = cachedSummary.recentBlocks.find(function(b) { return b.height === height; });
      if (!block) return;

      var html = '' +
        '<div class="detail-row"><span class="detail-label">Block Height</span><span class="detail-val" style="color:var(--cyan); font-weight:800;">#' + block.height + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Block Hash</span><span class="detail-val mono-chip" onclick="copyText(\\'' + block.blockHash + '\\')">' + block.blockHash + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">App Hash (State Root)</span><span class="detail-val mono-chip" onclick="copyText(\\'' + block.appHash + '\\')">' + block.appHash + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Proposer</span><span class="detail-val">' + block.proposer + ' (' + block.proposerAddress + ')</span></div>' +
        '<div class="detail-row"><span class="detail-label">Proposer Public Key</span><span class="detail-val mono-chip" onclick="copyText(\\'' + block.proposerPubKey + '\\')">' + block.proposerPubKey + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Transactions Count</span><span class="detail-val">' + block.txCount + ' transactions</span></div>' +
        '<div class="detail-row"><span class="detail-label">Committed Timestamp</span><span class="detail-val">' + new Date(block.timestamp).toISOString() + ' (' + formatTimeAgo(block.timestamp) + ')</span></div>' +
        '<div class="detail-row"><span class="detail-label">Block Gas & Reward</span><span class="detail-val">' + block.totalGas + ' gas units | ' + block.rewardSov + ' SOV block reward</span></div>';

      document.getElementById('blockModalBody').innerHTML = html;
      document.getElementById('explorerBlockModal').style.display = 'flex';
    }

    function openTxModal(hash) {
      if (!cachedSummary || !cachedSummary.recentTransactions) return;
      var tx = cachedSummary.recentTransactions.find(function(t) { return t.txHash === hash; });
      if (!tx) return;

      var isBurn = tx.type === 'burn';
      var isWasm = tx.type && (tx.type.startsWith('wasm_') || tx.type === 'cw20_transfer');
      var amountText = tx.tokenSymbol
        ? (formatNumber(tx.amountToken || tx.amountSov) + ' ' + tx.tokenSymbol)
        : ((isBurn ? '-' : '') + formatNumber(tx.amountSov) + ' SOV (' + tx.amountUsov + ' usov)');

      var html = '' +
        '<div class="detail-row"><span class="detail-label">Transaction Hash</span><span class="detail-val mono-chip" onclick="copyText(\\'' + tx.txHash + '\\')">' + tx.txHash + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Type</span><span class="detail-val" style="text-transform:uppercase; font-weight:800; color:' + (isBurn ? '#fbbf24' : (isWasm ? '#c084fc' : '#34d399')) + ';">' + tx.type + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">From Address</span><span class="detail-val mono-chip" onclick="inspectAccount(\\'' + tx.sender + '\\')">' + tx.sender + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">To / Contract</span><span class="detail-val mono-chip" onclick="' + (tx.contractAddress ? 'inspectContract(\\'' + tx.contractAddress + '\\')' : 'inspectAccount(\\'' + (tx.recipient || '') + '\\')') + '">' + (tx.recipient || tx.contractAddress || '-') + '</span></div>' +
        (tx.contractAddress ? '<div class="detail-row"><span class="detail-label">CW20 Contract Address</span><span class="detail-val mono-chip" onclick="inspectContract(\\'' + tx.contractAddress + '\\')">' + tx.contractAddress + '</span></div>' : '') +
        (tx.tokenSymbol ? '<div class="detail-row"><span class="detail-label">Token Symbol</span><span class="detail-val" style="color:var(--cyan); font-weight:800;">' + tx.tokenSymbol + '</span></div>' : '') +
        '<div class="detail-row"><span class="detail-label">Amount / Action</span><span class="detail-val" style="font-size:1.1rem; color:' + (isBurn ? '#fbbf24' : (tx.tokenSymbol ? '#f472b6' : '#34d399')) + ';">' + amountText + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Fee</span><span class="detail-val">' + tx.feeUsov + ' usov (' + tx.feeSov + ' SOV)</span></div>' +
        '<div class="detail-row"><span class="detail-label">Block Height</span><span class="detail-val" style="color:var(--cyan);">#' + tx.blockHeight + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Timestamp</span><span class="detail-val">' + new Date(tx.timestamp).toISOString() + ' (' + formatTimeAgo(tx.timestamp) + ')</span></div>' +
        '<div class="detail-row"><span class="detail-label">Memo / Description</span><span class="detail-val">' + (tx.memo || 'None') + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Status</span><span class="detail-val badge-ok">' + tx.status + '</span></div>';

      document.getElementById('txModalBody').innerHTML = html;
      document.getElementById('explorerTxModal').style.display = 'flex';
    }

    function inspectAccount(address) {
      if (!address || address.startsWith('system:') || address.startsWith('module:')) return;
      fetch('/api/explorer/account?address=' + encodeURIComponent(address))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (!data || !data.ok) {
            showToast('Account not found or error querying');
            return;
          }
          currentInspectedAddress = data.address;
          var html = '' +
            '<div class="detail-row"><span class="detail-label">Sovra L1 Address</span><span class="detail-val mono-chip" onclick="copyText(\\'' + data.address + '\\')">' + data.address + '</span></div>' +
            '<div class="detail-row"><span class="detail-label">On-Chain Balance</span><span class="detail-val" style="font-size:1.2rem; color:var(--cyan); font-weight:800;">' + formatNumber(data.balanceSov) + ' SOV</span></div>' +
            '<div class="detail-row"><span class="detail-label">Raw Denomination</span><span class="detail-val">' + data.balanceUsov + ' usov</span></div>' +
            '<div class="detail-row"><span class="detail-label">Account Nonce (Sequence)</span><span class="detail-val">' + data.nonce + '</span></div>' +
            '<div class="detail-row"><span class="detail-label">Transaction Activity</span><span class="detail-val">' + data.transactionsCount + ' ledger transactions</span></div>' +
            '<div style="margin-top:0.75rem; display:flex; justify-content:flex-end;">' +
              '<button type="button" class="btn-toggle-refresh" onclick="exportAccountCsv()" style="background:rgba(16,185,129,0.15); border-color:#10b981; color:#34d399; font-weight:700;">⬇️ Export Account Tax CSV</button>' +
            '</div>';

          document.getElementById('accountModalBody').innerHTML = html;
          document.getElementById('explorerAccountModal').style.display = 'flex';
        })
        .catch(function(err) {
          showToast('Failed to inspect account: ' + err.message);
        });
    }

    function filterTxTable(filter) {
      activeTxFilter = filter;
      renderTransactionsTable();
    }

    function renderSummary(data) {
      if (!data) return;
      cachedSummary = data;

      // Nav and Heroes
      var navChainEl = document.getElementById('navChainId');
      if (navChainEl) navChainEl.innerText = data.chainId;

      var heightEl = document.getElementById('heroHeight');
      if (heightEl) heightEl.innerText = data.height;

      var supplyEl = document.getElementById('heroTotalSupply');
      if (supplyEl) supplyEl.innerText = formatNumber(data.supply.totalSov);

      var supplyUsovEl = document.getElementById('heroTotalSupplyUsov');
      if (supplyUsovEl) supplyUsovEl.innerText = data.supply.totalUsov + ' usov';

      var mintEl = document.getElementById('heroLifetimeMint');
      if (mintEl) mintEl.innerText = formatNumber(data.supply.lifetimeMintSov) + ' SOV';

      var burnEl = document.getElementById('heroLifetimeBurn');
      if (burnEl) burnEl.innerText = formatNumber(data.supply.lifetimeBurnSov) + ' SOV';

      var valEl = document.getElementById('heroValidators');
      if (valEl) valEl.innerText = data.consensus.onlineValidators + ' / ' + data.consensus.totalValidators;

      var quorumEl = document.getElementById('heroQuorumStatus');
      if (quorumEl) quorumEl.innerText = data.consensus.activeQuorumPercent + '% Quorum (' + data.consensus.quorumStatus + ')';

      // Economics tab
      var econFormulaEl = document.getElementById('econFormulaDisplay');
      if (econFormulaEl) econFormulaEl.innerText = data.supply.invariantEquation;

      var econBankEl = document.getElementById('econBankSupply');
      if (econBankEl) econBankEl.innerText = formatNumber(data.supply.totalSov) + ' SOV';

      var econMintEl = document.getElementById('econMinted');
      if (econMintEl) econMintEl.innerText = formatNumber(data.supply.lifetimeMintSov) + ' SOV';

      var econBurnEl = document.getElementById('econBurned');
      if (econBurnEl) econBurnEl.innerText = formatNumber(data.supply.lifetimeBurnSov) + ' SOV';

      // Overview Blocks
      var obEl = document.getElementById('overviewBlocksList');
      if (obEl && data.recentBlocks) {
        var obHtml = '';
        data.recentBlocks.slice(0, 6).forEach(function(b) {
          obHtml += '' +
            '<div class="block-item" onclick="openBlockModal(' + b.height + ')">' +
              '<div class="block-left">' +
                '<div class="block-icon-badge">#' + b.height + '</div>' +
                '<div class="item-meta">' +
                  '<h4>' + b.proposer + ' <span style="font-size:0.7rem; color:var(--text-muted);">(' + formatTimeAgo(b.timestamp) + ')</span></h4>' +
                  '<p>' + b.appHash.slice(0, 18) + '... • ' + b.txCount + ' tx(s)</p>' +
                '</div>' +
              '</div>' +
              '<div class="item-right">' +
                '<span class="amount">+' + b.rewardSov + ' SOV</span>' +
                '<span class="sub">Reward</span>' +
              '</div>' +
            '</div>';
        });
        obEl.innerHTML = obHtml;
      }

      // Overview Txs
      var otEl = document.getElementById('overviewTxsList');
      if (otEl && data.recentTransactions) {
        var otHtml = '';
        data.recentTransactions.slice(0, 6).forEach(function(t) {
          var isBurn = t.type === 'burn';
          var isWasm = t.type && (t.type.startsWith('wasm_') || t.type === 'cw20_transfer');
          var icon = isBurn ? '🔥' : (isWasm ? '🪙' : '💸');
          var iconClass = isBurn ? 'burn' : (isWasm ? 'wasm' : '');
          var displayAmount = t.tokenSymbol
            ? (formatNumber(t.amountToken || t.amountSov) + ' ' + t.tokenSymbol)
            : ((isBurn ? '-' : '+') + formatNumber(t.amountSov) + ' SOV');

          otHtml += '' +
            '<div class="tx-item" onclick="openTxModal(\\'' + t.txHash + '\\')">' +
              '<div class="tx-left">' +
                '<div class="tx-icon-badge ' + iconClass + '">' + icon + '</div>' +
                '<div class="item-meta">' +
                  '<h4>' + t.txHash.slice(0, 16) + '...</h4>' +
                  '<p>' + t.sender.slice(0, 14) + '... → ' + (t.recipient || t.contractAddress || '').slice(0, 14) + '...</p>' +
                '</div>' +
              '</div>' +
              '<div class="item-right">' +
                '<span class="amount ' + (isBurn ? 'burn' : (isWasm ? 'wasm' : '')) + '">' + displayAmount + '</span>' +
                '<span class="sub">Block #' + t.blockHeight + '</span>' +
              '</div>' +
            '</div>';
        });
        otEl.innerHTML = otHtml;
      }

      // Blocks Table Tab
      var btEl = document.getElementById('blocksTableBody');
      if (btEl && data.recentBlocks) {
        var btHtml = '';
        data.recentBlocks.forEach(function(b) {
          btHtml += '' +
            '<tr>' +
              '<td><span class="mono-chip" onclick="openBlockModal(' + b.height + ')" style="color:var(--cyan); font-weight:700;">#' + b.height + '</span></td>' +
              '<td>' + formatTimeAgo(b.timestamp) + '</td>' +
              '<td><strong>' + b.proposer + '</strong></td>' +
              '<td>' + b.txCount + '</td>' +
              '<td>' + b.totalGas + '</td>' +
              '<td><span class="mono-chip" onclick="copyText(\\'' + b.appHash + '\\')">' + b.appHash.slice(0, 14) + '...</span></td>' +
              '<td><button class="btn-toggle-refresh" onclick="openBlockModal(' + b.height + ')">Inspect</button></td>' +
            '</tr>';
        });
        btEl.innerHTML = btHtml;
      }

      // Transactions Table Tab
      renderTransactionsTable();

      // Creator Tokens Tab telemetry
      fetchCreatorTokens(false);

      // Validators Tab
      var vgEl = document.getElementById('validatorsGrid');
      if (vgEl && data.validators) {
        var vgHtml = '';
        data.validators.forEach(function(v) {
          var isOnline = v.status === 'online';
          vgHtml += '' +
            '<div class="val-card">' +
              '<div class="val-header">' +
                '<div class="val-moniker">' +
                  '<span class="pulse-dot" style="background:' + (isOnline ? '#10b981' : '#ef4444') + ';"></span>' +
                  '<span>' + v.moniker + '</span>' +
                '</div>' +
                '<span class="badge-ok" style="' + (isOnline ? '' : 'background:rgba(239,68,68,0.2); color:#ef4444; border-color:#ef4444;') + '">' + (isOnline ? 'ONLINE' : 'OFFLINE') + '</span>' +
              '</div>' +
              '<div class="val-row">' +
                '<span class="label">Address</span>' +
                '<span class="val mono-chip" onclick="inspectAccount(\\'' + v.address + '\\')">' + v.address.slice(0, 14) + '...</span>' +
              '</div>' +
              '<div class="val-row">' +
                '<span class="label">RPC / P2P Ports</span>' +
                '<span class="val">' + v.rpcPort + ' / ' + v.p2pPort + '</span>' +
              '</div>' +
              '<div class="val-row">' +
                '<span class="label">Latency</span>' +
                '<span class="val" style="color:#34d399;">' + (v.latencyMs || 1) + 'ms</span>' +
              '</div>' +
              '<div class="val-row">' +
                '<span class="label">Voting Power</span>' +
                '<span class="val">' + v.votingPower + '.0%</span>' +
              '</div>' +
              '<div class="voting-power-bar">' +
                '<div class="voting-power-fill" style="width:' + v.votingPower + '%;"></div>' +
              '</div>' +
            '</div>';
        });
        vgEl.innerHTML = vgHtml;
      }
    }

    function renderTransactionsTable() {
      if (!cachedSummary || !cachedSummary.recentTransactions) return;
      var ttEl = document.getElementById('txsTableBody');
      if (!ttEl) return;

      var filtered = cachedSummary.recentTransactions.filter(function(t) {
        if (activeTxFilter === 'send') return t.type === 'send' || t.type === 'genesis_alloc';
        if (activeTxFilter === 'burn') return t.type === 'burn';
        if (activeTxFilter === 'wasm') return t.type && (t.type.startsWith('wasm_') || t.type === 'cw20_transfer');
        return true;
      });

      var html = '';
      filtered.forEach(function(t) {
        var isBurn = t.type === 'burn';
        var isWasmStore = t.type === 'wasm_store_code';
        var isWasmInit = t.type === 'wasm_instantiate';
        var isCw20Transfer = t.type === 'wasm_execute' || t.type === 'cw20_transfer';

        var typeBadgeHtml = '';
        if (isWasmStore) {
          typeBadgeHtml = '<span style="font-weight:700; text-transform:uppercase; color:#c084fc; background:rgba(168,85,247,0.15); border:1px solid rgba(168,85,247,0.3); padding:3px 8px; border-radius:6px; font-size:0.75rem;">STORE CODE</span>';
        } else if (isWasmInit) {
          typeBadgeHtml = '<span style="font-weight:700; text-transform:uppercase; color:#60a5fa; background:rgba(59,130,246,0.15); border:1px solid rgba(59,130,246,0.3); padding:3px 8px; border-radius:6px; font-size:0.75rem;">INSTANTIATE</span>';
        } else if (isCw20Transfer) {
          typeBadgeHtml = '<span style="font-weight:700; text-transform:uppercase; color:#f472b6; background:rgba(236,72,153,0.15); border:1px solid rgba(236,72,153,0.3); padding:3px 8px; border-radius:6px; font-size:0.75rem;">CW20 TRANSFER</span>';
        } else if (isBurn) {
          typeBadgeHtml = '<span style="font-weight:700; text-transform:uppercase; color:#fbbf24;">BURN</span>';
        } else {
          typeBadgeHtml = '<span style="font-weight:700; text-transform:uppercase; color:#34d399;">' + (t.type || 'SEND') + '</span>';
        }

        var amountDisplay = '';
        if (isWasmStore) {
          amountDisplay = '<span style="color:var(--text-muted); font-size:0.8rem;">-</span>';
        } else if (t.tokenSymbol) {
          amountDisplay = '<span style="font-family:var(--mono); font-weight:700; color:#f472b6;">' + formatNumber(t.amountToken || t.amountSov) + ' ' + t.tokenSymbol + '</span>';
        } else {
          amountDisplay = '<span style="font-family:var(--mono); font-weight:700; color:' + (isBurn ? '#fbbf24' : '#34d399') + ';">' + (isBurn ? '-' : '') + formatNumber(t.amountSov) + ' SOV</span>';
        }

        var targetDisplay = t.contractAddress
          ? '<span class="mono-chip" onclick="inspectContract(\\'' + t.contractAddress + '\\')" title="' + t.contractAddress + '">' + t.contractAddress.slice(0, 14) + '...</span>'
          : '<span class="mono-chip" onclick="inspectAccount(\\'' + (t.recipient || '') + '\\')">' + (t.recipient || '').slice(0, 14) + '...</span>';

        html += '' +
          '<tr>' +
            '<td><span class="mono-chip" onclick="openTxModal(\\'' + t.txHash + '\\')">' + t.txHash.slice(0, 16) + '...</span></td>' +
            '<td>' + typeBadgeHtml + '</td>' +
            '<td><span class="mono-chip" onclick="inspectAccount(\\'' + t.sender + '\\')">' + t.sender.slice(0, 14) + '...</span></td>' +
            '<td>' + targetDisplay + '</td>' +
            '<td>' + amountDisplay + '</td>' +
            '<td style="font-family:var(--mono);">' + t.feeUsov + ' usov</td>' +
            '<td><span class="mono-chip" onclick="openBlockModal(' + t.blockHeight + ')">#' + t.blockHeight + '</span></td>' +
            '<td><span class="badge-ok">' + t.status + '</span></td>' +
          '</tr>';
      });
      ttEl.innerHTML = html;
    }

    var cachedTokens = [];
    function fetchCreatorTokens(force) {
      var tbEl = document.getElementById('tokensTableBody');
      var badgeEl = document.getElementById('tokensCountBadge');
      if (!tbEl) return;
      if (!force && cachedTokens && cachedTokens.length > 0) {
        renderTokensTable(cachedTokens);
        return;
      }
      fetch('/api/blockchain/wasm/tokens')
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data && data.ok && Array.isArray(data.tokens)) {
            cachedTokens = data.tokens;
            if (badgeEl) badgeEl.innerText = data.tokens.length;
            renderTokensTable(data.tokens);
          } else {
            tbEl.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:2rem;">No creator tokens deployed yet.</td></tr>';
          }
        })
        .catch(function(err) {
          console.warn('[EXPLORER] Error fetching tokens:', err);
          tbEl.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#f87171; padding:2rem;">Failed to load tokens: ' + err.message + '</td></tr>';
        });
    }

    function renderTokensTable(tokens) {
      var tbEl = document.getElementById('tokensTableBody');
      if (!tbEl) return;
      if (!tokens || tokens.length === 0) {
        tbEl.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:2rem;">No creator tokens deployed yet.</td></tr>';
        return;
      }
      var html = '';
      tokens.forEach(function(tok) {
        var supplyDisplay = formatNumber(tok.totalSupply || tok.total_supply || 0);
        html += '' +
          '<tr>' +
            '<td><span style="font-weight:800; font-family:var(--mono); color:var(--cyan); background:rgba(0,240,255,0.08); padding:3px 8px; border-radius:4px; border:1px solid rgba(0,240,255,0.2);">' + (tok.symbol || 'CW20') + '</span></td>' +
            '<td style="font-weight:600; color:#fff;">' + (tok.name || 'Unknown Token') + '</td>' +
            '<td style="font-family:var(--mono);">' + (tok.decimals !== undefined ? tok.decimals : 6) + '</td>' +
            '<td style="font-family:var(--mono); font-weight:700; color:#34d399;">' + supplyDisplay + ' ' + (tok.symbol || '') + '</td>' +
            '<td><span class="mono-chip" onclick="inspectAccount(\\'' + tok.creator + '\\')">' + (tok.creator ? tok.creator.slice(0, 16) + '...' : '-') + '</span></td>' +
            '<td><span class="mono-chip" onclick="inspectContract(\\'' + tok.contractAddress + '\\')">' + (tok.contractAddress ? tok.contractAddress.slice(0, 18) + '...' : '-') + '</span></td>' +
            '<td><button type="button" class="btn-toggle-refresh" style="padding:4px 10px; font-size:0.75rem;" onclick="inspectContract(\\'' + tok.contractAddress + '\\')">Query Contract</button></td>' +
          '</tr>';
      });
      tbEl.innerHTML = html;
    }

    function inspectContract(contractAddress) {
      if (!contractAddress) return;
      var modalBody = document.getElementById('contractModalBody');
      if (!modalBody) return;
      modalBody.innerHTML = '<div style="padding:2rem; text-align:center; color:var(--text-muted);">Querying smart contract state...</div>';
      document.getElementById('explorerContractModal').style.display = 'flex';

      fetch('/api/blockchain/wasm/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress: contractAddress,
          query: { token_info: {} }
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var tokenInfo = data.data || data;
        var html = '' +
          '<div class="detail-row"><span class="detail-label">Contract Address</span><span class="detail-val mono-chip" onclick="copyText(\\'' + contractAddress + '\\')">' + contractAddress + '</span></div>' +
          '<div class="detail-row"><span class="detail-label">Token Name</span><span class="detail-val" style="font-weight:700; color:#fff;">' + (tokenInfo.name || 'CW20 Contract') + '</span></div>' +
          '<div class="detail-row"><span class="detail-label">Symbol</span><span class="detail-val" style="color:var(--cyan); font-weight:800;">' + (tokenInfo.symbol || '-') + '</span></div>' +
          '<div class="detail-row"><span class="detail-label">Decimals</span><span class="detail-val">' + (tokenInfo.decimals !== undefined ? tokenInfo.decimals : 6) + '</span></div>' +
          '<div class="detail-row"><span class="detail-label">Total Supply</span><span class="detail-val" style="font-family:var(--mono); color:#34d399; font-weight:800;">' + formatNumber(tokenInfo.total_supply || tokenInfo.totalSupply || 0) + ' ' + (tokenInfo.symbol || '') + '</span></div>' +
          '<div class="detail-row" style="flex-direction:column; align-items:flex-start; gap:0.5rem; margin-top:0.75rem; width:100%;">' +
            '<span class="detail-label" style="font-weight:700; color:#fff;">Smart Query ABI Executor</span>' +
            '<div style="display:flex; width:100%; gap:0.5rem;">' +
              '<input type="text" id="customContractQueryInput" class="search-input" style="flex:1; font-size:0.8rem; background:rgba(0,0,0,0.4);" value="{&quot;token_info&quot;:{}}" />' +
              '<button type="button" class="btn-toggle-refresh" onclick="executeCustomContractQuery(\\'' + contractAddress + '\\')">Run Query</button>' +
            '</div>' +
            '<pre id="customContractQueryResult" style="background:rgba(0,0,0,0.6); padding:0.75rem; border-radius:6px; font-family:var(--mono); font-size:0.78rem; width:100%; max-height:160px; overflow:auto; color:var(--cyan); margin-top:0.5rem; border:1px solid rgba(255,255,255,0.06);">' + JSON.stringify(data, null, 2) + '</pre>' +
          '</div>';
        modalBody.innerHTML = html;
      })
      .catch(function(err) {
        modalBody.innerHTML = '<div style="padding:1.5rem; color:#f87171;">Failed to inspect contract: ' + err.message + '</div>';
      });
    }

    function executeCustomContractQuery(contractAddress) {
      var input = document.getElementById('customContractQueryInput');
      var resultEl = document.getElementById('customContractQueryResult');
      if (!input || !resultEl) return;
      var queryJson;
      try {
        queryJson = JSON.parse(input.value);
      } catch (e) {
        resultEl.innerText = 'Invalid JSON: ' + e.message;
        resultEl.style.color = '#f87171';
        return;
      }
      resultEl.innerText = 'Querying smart contract...';
      fetch('/api/blockchain/wasm/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress: contractAddress,
          query: queryJson
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        resultEl.innerText = JSON.stringify(res, null, 2);
        resultEl.style.color = res.ok ? 'var(--cyan)' : '#f87171';
      })
      .catch(function(err) {
        resultEl.innerText = 'Error: ' + err.message;
        resultEl.style.color = '#f87171';
      });
    }

    function handleLiveBlockEvent(data) {
      if (!data) return;
      var prevHeight = cachedSummary ? Number(cachedSummary.height || 0) : 0;
      var newHeight = Number(data.height || 0);

      // 1. Dynamically update Latest Height card with pulse animation
      var heightEl = document.getElementById('heroHeight');
      if (heightEl) {
        heightEl.innerText = newHeight;
        heightEl.style.transition = 'transform 0.25s ease, color 0.25s ease';
        heightEl.style.transform = 'scale(1.12)';
        heightEl.style.color = '#00f0ff';
        setTimeout(function() {
          heightEl.style.transform = 'scale(1)';
          heightEl.style.color = '';
        }, 400);
      }

      // Update hero supply and consensus telemetry
      var navChainEl = document.getElementById('navChainId');
      if (navChainEl && data.chainId) navChainEl.innerText = data.chainId;

      var supplyEl = document.getElementById('heroTotalSupply');
      if (supplyEl && data.supply) supplyEl.innerText = formatNumber(data.supply.totalSov);

      var supplyUsovEl = document.getElementById('heroTotalSupplyUsov');
      if (supplyUsovEl && data.supply) supplyUsovEl.innerText = data.supply.totalUsov + ' usov';

      var mintEl = document.getElementById('heroLifetimeMint');
      if (mintEl && data.supply) mintEl.innerText = formatNumber(data.supply.lifetimeMintSov) + ' SOV';

      var burnEl = document.getElementById('heroLifetimeBurn');
      if (burnEl && data.supply) burnEl.innerText = formatNumber(data.supply.lifetimeBurnSov) + ' SOV';

      var valEl = document.getElementById('heroValidators');
      if (valEl && data.consensus) valEl.innerText = data.consensus.onlineValidators + ' / ' + data.consensus.totalValidators;

      var quorumEl = document.getElementById('heroQuorumStatus');
      if (quorumEl && data.consensus) quorumEl.innerText = data.consensus.activeQuorumPercent + '% Quorum (' + data.consensus.quorumStatus + ')';

      // 2. Dynamically prepend new block row to Blocks table without a full page fetch
      var btEl = document.getElementById('blocksTableBody');
      if (btEl && data.recentBlocks && data.recentBlocks.length > 0) {
        var latestBlock = data.recentBlocks[0];
        if (newHeight > prevHeight && prevHeight > 0) {
          var tr = document.createElement('tr');
          tr.style.animation = 'fadeIn 0.4s ease-out';
          tr.innerHTML = '' +
            '<td><span class="mono-chip" onclick="openBlockModal(' + latestBlock.height + ')" style="color:var(--cyan); font-weight:700;">#' + latestBlock.height + '</span></td>' +
            '<td>' + formatTimeAgo(latestBlock.timestamp) + '</td>' +
            '<td><strong>' + latestBlock.proposer + '</strong></td>' +
            '<td>' + latestBlock.txCount + '</td>' +
            '<td>' + latestBlock.totalGas + '</td>' +
            '<td><span class="mono-chip" onclick="copyText(\\'' + latestBlock.appHash + '\\')">' + latestBlock.appHash.slice(0, 14) + '...</span></td>' +
            '<td><button class="btn-toggle-refresh" onclick="openBlockModal(' + latestBlock.height + ')">Inspect</button></td>';
          btEl.insertBefore(tr, btEl.firstChild);

          while (btEl.children.length > 30) {
            btEl.removeChild(btEl.lastChild);
          }

          var obEl = document.getElementById('overviewBlocksList');
          if (obEl) {
            var blockDiv = document.createElement('div');
            blockDiv.className = 'block-item';
            blockDiv.onclick = function() { openBlockModal(latestBlock.height); };
            blockDiv.innerHTML = '' +
              '<div class="block-left">' +
                '<div class="block-icon-badge">#' + latestBlock.height + '</div>' +
                '<div class="item-meta">' +
                  '<h4>' + latestBlock.proposer + ' <span style="font-size:0.7rem; color:var(--text-muted);">(just now)</span></h4>' +
                  '<p>' + latestBlock.appHash.slice(0, 18) + '... • ' + latestBlock.txCount + ' tx(s)</p>' +
                '</div>' +
              '</div>' +
              '<div class="item-right">' +
                '<span class="amount">+' + latestBlock.rewardSov + ' SOV</span>' +
                '<span class="sub">Reward</span>' +
              '</div>';
            obEl.insertBefore(blockDiv, obEl.firstChild);
            while (obEl.children.length > 6) {
              obEl.removeChild(obEl.lastChild);
            }
          }
        } else {
          renderSummary(data);
        }
      } else {
        renderSummary(data);
      }

      cachedSummary = data;
    }

    function initStreaming() {
      if (typeof EventSource !== 'undefined') {
        try {
          if (sseSource) { sseSource.close(); }
          sseSource = new EventSource('/api/explorer/stream');
          sseSource.addEventListener('connected', function() {
            isStreaming = true;
            updateStreamingIndicator(true);
            if (refreshTimer) {
              clearTimeout(refreshTimer);
              refreshTimer = null;
            }
          });
          sseSource.addEventListener('block', function(e) {
            try {
              var data = JSON.parse(e.data);
              handleLiveBlockEvent(data);
              isStreaming = true;
              updateStreamingIndicator(true);
              if (refreshTimer) {
                clearTimeout(refreshTimer);
                refreshTimer = null;
              }
            } catch (_) {}
          });
          sseSource.onerror = function() {
            isStreaming = false;
            updateStreamingIndicator(false);
            if (isAutoRefresh && !refreshTimer) {
              refreshTimer = setTimeout(fetchExplorerData, 2500);
            }
          };
        } catch (_) {
          isStreaming = false;
          updateStreamingIndicator(false);
          if (isAutoRefresh && !refreshTimer) {
            refreshTimer = setTimeout(fetchExplorerData, 2500);
          }
        }
      }
    }

    function updateStreamingIndicator(streaming) {
      var icon = document.getElementById('refreshIcon');
      var text = document.getElementById('refreshText');
      if (streaming) {
        if (icon) icon.innerText = '⚡';
        if (text) text.innerText = 'STREAMING (WS/SSE)';
      } else {
        if (icon) icon.innerText = isAutoRefresh ? '🔄' : '⏸';
        if (text) text.innerText = isAutoRefresh ? 'LIVE (2s)' : 'PAUSED';
      }
    }

    function fetchMempoolData(showToastMsg) {
      fetch('/api/explorer/mempool')
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (!data || !data.ok) return;
          var countEl = document.getElementById('mempoolCount');
          var bytesEl = document.getElementById('mempoolBytes');
          var badgeEl = document.getElementById('mempoolBadgeCount');
          var congEl = document.getElementById('mempoolCongestionBadge');
          var capEl = document.getElementById('mempoolCapacity');
          var tbody = document.getElementById('mempoolTableBody');

          if (countEl) countEl.innerText = data.n_txs || 0;
          if (bytesEl) bytesEl.innerText = formatNumber(data.total_bytes || 0) + ' B';
          if (badgeEl) badgeEl.innerText = data.n_txs || 0;
          if (capEl && data.mempoolCapacity) capEl.innerText = data.mempoolCapacity;
          if (congEl) {
            congEl.innerText = data.congestionStatus === 'HEALTHY_ZERO_CONGESTION' ? '🟢 HEALTHY / ZERO CONGESTION' : data.congestionStatus;
          }

          if (tbody) {
            var txs = data.unconfirmedTxs || [];
            if (txs.length === 0) {
              tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:1.5rem; color:var(--text-muted);">Mempool is currently clear — all submitted transactions have been finalized on block height.</td></tr>';
            } else {
              var rowsHtml = '';
              txs.forEach(function(tx) {
                rowsHtml += '<tr>' +
                  '<td><span class="mono-chip" onclick="openTxModal(\\'' + tx.txHash + '\\')">' + tx.txHash.slice(0, 16) + '...</span></td>' +
                  '<td>' + (tx.timeInMempoolSec || 0.4) + 's in pool</td>' +
                  '<td><span class="mono-chip" onclick="inspectAccount(\\'' + tx.sender + '\\')">' + tx.sender.slice(0, 14) + '...</span></td>' +
                  '<td><span class="mono-chip" onclick="inspectAccount(\\'' + tx.recipient + '\\')">' + tx.recipient.slice(0, 14) + '...</span></td>' +
                  '<td style="font-family:var(--mono); color:#34d399; font-weight:700;">+' + formatNumber(tx.amountSov) + ' SOV</td>' +
                  '<td style="font-family:var(--mono);">' + tx.feeUsov + ' usov</td>' +
                  '<td><span class="badge-ok" style="background:rgba(56,189,248,0.15); color:#38bdf8;">' + (tx.priority || 'HIGH') + '</span></td>' +
                  '<td><span class="badge-ok" style="background:rgba(245,158,11,0.15); color:#fbbf24;">PENDING</span></td>' +
                '</tr>';
              });
              tbody.innerHTML = rowsHtml;
            }
          }
          if (showToastMsg) {
            showToast('✓ Mempool refreshed');
          }
        })
        .catch(function() {});
    }

    function exportTransactionsCsv(filter) {
      var t = filter || activeTxFilter || 'all';
      showToast('⏳ Generating Ledger CSV...');
      var link = document.createElement('a');
      link.href = '/api/explorer/export/csv?type=' + encodeURIComponent(t);
      link.download = 'sovra_chain_ledger_' + Date.now() + '.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    function exportAccountCsv() {
      if (!currentInspectedAddress) return;
      showToast('⏳ Generating Account Tax CSV...');
      var link = document.createElement('a');
      link.href = '/api/explorer/export/csv?address=' + encodeURIComponent(currentInspectedAddress);
      link.download = 'sovra_account_' + currentInspectedAddress.slice(0, 10) + '_' + Date.now() + '.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    function fetchExplorerData() {
      fetch('/api/explorer/summary')
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data && data.ok) {
            renderSummary(data);
          }
        })
        .catch(function(err) {
          console.warn('[EXPLORER] Fetch error:', err);
        })
        .finally(function() {
          if (isAutoRefresh && !isStreaming) {
            clearTimeout(refreshTimer);
            refreshTimer = setTimeout(fetchExplorerData, 2500);
          }
        });
    }

    // Global Search Handling
    var searchInput = document.getElementById('explorerGlobalSearch');
    if (searchInput) {
      searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          var q = (searchInput.value || '').trim();
          if (!q) return;

          // Check if number -> block height
          var num = parseInt(q, 10);
          if (!isNaN(num) && String(num) === q) {
            openBlockModal(num);
            return;
          }

          // Check if address
          if (q.startsWith('sovra1')) {
            inspectAccount(q);
            return;
          }

          // Default assume tx hash
          openTxModal(q);
        }
      });
    }

    // Initial load
    fetchExplorerData();
    initStreaming();
    fetchMempoolData(false);
  </script>
</body>
</html>`;
}
