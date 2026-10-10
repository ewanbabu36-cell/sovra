/**
 * SOVRA Spatial Surface Component
 * File: apps/sovra-app/src/ui/sovra-surface/SovraSurface.ts
 */

import { SurfaceOptions, SurfaceRecord, SurfaceRenderContext } from './types.js';
import { SovraSurfaceHeader } from './SovraSurfaceHeader.js';
import { SovraSurfaceTransition } from './SovraSurfaceTransition.js';

export class SovraSurface {
  public static create(
    options: SurfaceOptions,
    depth: number,
    renderCtx: SurfaceRenderContext,
    onBack: () => void,
    onClose: () => void
  ): SurfaceRecord {
    const surfaceId = options.id || `surf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const cardEl = document.createElement('div');
    cardEl.className = 'sovra-surface-card is-active';
    cardEl.id = `surface-card-${surfaceId}`;
    cardEl.setAttribute('role', 'dialog');
    cardEl.setAttribute('aria-modal', 'true');
    cardEl.setAttribute('aria-label', options.title);

    // Apply origin coordinates for organic emergence
    const coords = SovraSurfaceTransition.getOriginCoordinates(options.origin);
    SovraSurfaceTransition.applyOriginToCard(cardEl, coords);
    SovraSurfaceTransition.triggerEnergyPulse(coords);

    // Header & Breadcrumbs
    const { headerEl, breadcrumbsEl } = SovraSurfaceHeader.create(options, depth, onBack, onClose);
    cardEl.appendChild(headerEl);

    // Scrollable content body
    const bodyEl = document.createElement('div');
    bodyEl.className = 'sovra-surface-body';
    bodyEl.id = `surface-body-${surfaceId}`;
    cardEl.appendChild(bodyEl);

    // Optional footer
    if (typeof options.renderFooter === 'function') {
      const footerEl = document.createElement('div');
      footerEl.className = 'sovra-surface-footer';
      options.renderFooter(footerEl, renderCtx);
      cardEl.appendChild(footerEl);
    }

    const record: SurfaceRecord = {
      id: surfaceId,
      type: options.type || 'generic',
      title: options.title,
      subtitle: options.subtitle,
      context: options.context || {},
      origin: options.origin,
      params: options.params || {},
      parent: options.parent,
      dismissible: options.dismissible !== false,
      modal: options.modal !== false,
      el: cardEl,
      bodyEl,
      breadcrumbsEl,
      animationState: 'active',
      onBack: options.onBack,
      onClose: options.onClose,
    };

    // Execute render callback
    if (typeof options.render === 'function') {
      options.render(bodyEl, renderCtx);
    }

    // Accessible focus management
    setTimeout(() => {
      const focusable = cardEl.querySelector<HTMLElement>('button, input, select, textarea, [tabindex="0"]');
      if (focusable) focusable.focus();
    }, 60);

    return record;
  }
}
