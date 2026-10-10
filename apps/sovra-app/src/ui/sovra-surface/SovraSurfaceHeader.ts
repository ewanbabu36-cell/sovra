/**
 * SOVRA Spatial Surface Header & Breadcrumb Trail
 * File: apps/sovra-app/src/ui/sovra-surface/SovraSurfaceHeader.ts
 */

import { SurfaceOptions, SurfaceRecord } from './types.js';

export class SovraSurfaceHeader {
  public static create(
    options: SurfaceOptions,
    depth: number,
    onBack: () => void,
    onClose: () => void
  ): {
    headerEl: HTMLElement;
    breadcrumbsEl: HTMLElement;
    backBtn: HTMLButtonElement;
  } {
    const headerEl = document.createElement('div');
    headerEl.className = 'sovra-surface-header';

    // Mobile pull handle
    const handleEl = document.createElement('div');
    handleEl.className = 'sovra-surface-drag-handle';
    headerEl.appendChild(handleEl);

    const navLeft = document.createElement('div');
    navLeft.className = 'sovra-surface-nav-left';

    // Back button
    const backBtn = document.createElement('button');
    backBtn.className = 'sovra-surface-back-btn';
    backBtn.setAttribute('aria-label', 'Go back to previous surface');
    backBtn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>';
    backBtn.style.display = depth > 0 ? 'inline-flex' : 'none';
    backBtn.onclick = (e) => {
      e.stopPropagation();
      onBack();
    };
    navLeft.appendChild(backBtn);

    // Title & Breadcrumbs container
    const titleGroup = document.createElement('div');
    titleGroup.className = 'sovra-surface-title-group';

    const breadcrumbsEl = document.createElement('nav');
    breadcrumbsEl.className = 'sovra-surface-breadcrumbs';
    breadcrumbsEl.setAttribute('aria-label', 'Breadcrumb trail');
    titleGroup.appendChild(breadcrumbsEl);

    const titleEl = document.createElement('h2');
    titleEl.className = 'sovra-surface-title';
    titleEl.innerText = options.title;
    titleGroup.appendChild(titleEl);

    if (options.subtitle) {
      const subEl = document.createElement('div');
      subEl.className = 'sovra-surface-subtitle';
      subEl.innerText = options.subtitle;
      titleGroup.appendChild(subEl);
    }

    navLeft.appendChild(titleGroup);
    headerEl.appendChild(navLeft);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'sovra-surface-close-btn';
    closeBtn.setAttribute('aria-label', 'Close surface');
    closeBtn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      onClose();
    };
    headerEl.appendChild(closeBtn);

    return { headerEl, breadcrumbsEl, backBtn };
  }

  public static updateBreadcrumbs(stack: SurfaceRecord[], onNavigate: (id: string) => void): void {
    stack.forEach((item) => {
      if (!item.breadcrumbsEl) return;
      let html = '';
      for (let i = 0; i < stack.length; i++) {
        const s = stack[i];
        if (!s) continue;
        if (i === stack.length - 1) {
          html += `<span class="sovra-surface-crumb sovra-surface-crumb-active">${s.title}</span>`;
        } else {
          html += `<button class="sovra-surface-crumb" data-surface-id="${s.id}">${s.title}</button>`;
          html += '<span class="sovra-surface-crumb-sep">/</span>';
        }
      }
      item.breadcrumbsEl.innerHTML = html;
      item.breadcrumbsEl.querySelectorAll('button.sovra-surface-crumb').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetId = (e.currentTarget as HTMLElement).dataset.surfaceId;
          if (targetId) onNavigate(targetId);
        });
      });
    });
  }
}
