/**
 * @file scripts/views/view-helpers.ts
 * HTML and JSON Sanitization & Formatting Helpers for Sovra Views
 */

export function safeJsonForScript(data: any): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function escapeHtml(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatFeedTimestamp(ts?: number | string): { timeAgo: string; fullDate: string } {
  if (!ts) return { timeAgo: 'Just now', fullDate: 'Just now' };
  const numTs = typeof ts === 'string' ? (isNaN(Number(ts)) ? Date.parse(ts) : Number(ts)) : ts;
  if (isNaN(numTs) || numTs <= 0) return { timeAgo: 'Just now', fullDate: 'Just now' };
  const d = new Date(numTs);
  const fullDate = d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const diffSec = Math.floor((Date.now() - numTs) / 1000);
  if (diffSec < 45) return { timeAgo: 'Just now', fullDate };
  if (diffSec < 3600) return { timeAgo: `${Math.floor(diffSec / 60)}m ago`, fullDate };
  if (diffSec < 86400) return { timeAgo: `${Math.floor(diffSec / 3600)}h ago`, fullDate };
  if (diffSec < 604800) return { timeAgo: `${Math.floor(diffSec / 86400)}d ago`, fullDate };
  return { timeAgo: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), fullDate };
}

export function formatMetricCount(num?: number): string {
  if (!num || isNaN(num) || num <= 0) return '0';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(num);
}
