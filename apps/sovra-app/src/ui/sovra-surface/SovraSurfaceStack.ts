/**
 * SOVRA Spatial Surface Stack Manager
 * File: apps/sovra-app/src/ui/sovra-surface/SovraSurfaceStack.ts
 */

import { SurfaceId, SurfaceOptions, SurfaceRecord, SurfaceRenderContext } from './types.js';
import { SovraSurface } from './SovraSurface.js';
import { SovraSurfaceHeader } from './SovraSurfaceHeader.js';
import { SovraSurfaceBackdrop } from './SovraSurfaceBackdrop.js';

export class SovraSurfaceStack {
  private stack: SurfaceRecord[] = [];
  private container: HTMLElement | null = null;
  private backdrop = new SovraSurfaceBackdrop();
  private initialTriggerEl: HTMLElement | null = null;
  private syncingHistory = false;

  constructor() {
    this.bindGlobalKeyboardAndHistory();
  }

  public initContainer(): HTMLElement {
    if (!this.container) {
      let el = document.getElementById('sovraSpatialSurfaceContainer');
      if (!el) {
        el = document.createElement('div');
        el.id = 'sovraSpatialSurfaceContainer';
        el.className = 'sovra-surface-container';
        el.setAttribute('aria-live', 'polite');
        document.body.appendChild(el);
      }
      this.container = el;
    }
    return this.container;
  }

  public push(options: SurfaceOptions): SurfaceRecord {
    const container = this.initContainer();

    if (this.stack.length === 0) {
      this.initialTriggerEl = (options.origin instanceof HTMLElement ? options.origin : null) || (document.activeElement as HTMLElement | null);
      document.body.classList.add('spatial-surface-open');
    }

    if (options.modal !== false) {
      this.backdrop.mount(container, () => this.pop());
    }

    // Set parent linkage if not specified
    if (!options.parent && this.stack.length > 0) {
      const parentRecord = this.stack[this.stack.length - 1];
      if (parentRecord) {
        options.parent = parentRecord.id;
      }
    }

    // Recede existing top card into 3D spatial depth
    if (this.stack.length > 0) {
      const top = this.stack[this.stack.length - 1];
      if (top) {
        top.animationState = 'receded';
        top.el.classList.add('is-receded');
        top.el.classList.remove('is-active');
        top.el.setAttribute('aria-hidden', 'true');
      }
    }

    const renderCtx = this.createRenderContext(options.id || '');
    const record = SovraSurface.create(
      options,
      this.stack.length,
      renderCtx,
      () => this.pop(),
      () => this.closeAll()
    );

    container.appendChild(record.el);
    this.stack.push(record);
    SovraSurfaceHeader.updateBreadcrumbs(this.stack, (id) => this.popTo(id));

    // Mobile history synchronization
    if (typeof window !== 'undefined' && window.history && typeof window.history.pushState === 'function') {
      try {
        window.history.pushState({ sovraSurfaceId: record.id, depth: this.stack.length }, '', window.location.href);
      } catch (_) {}
    }

    return record;
  }

  public pop(opts?: { fromHistory?: boolean }): SurfaceRecord | null {
    if (this.stack.length === 0) return null;
    if (this.stack.length === 1) {
      this.closeAll();
      return null;
    }

    const popped = this.stack.pop();
    if (popped) {
      popped.animationState = 'closing';
      popped.el.classList.remove('is-active');
      popped.el.classList.add('is-closing');
      if (typeof popped.onBack === 'function') {
        try { popped.onBack(); } catch (err) { console.warn(err); }
      }

      setTimeout(() => {
        if (popped.el && popped.el.parentNode) {
          popped.el.parentNode.removeChild(popped.el);
        }
      }, 200);
    }

    // Sync mobile browser history state if pop was triggered via UI/ESC
    if (!opts?.fromHistory && typeof window !== 'undefined' && window.history) {
      try {
        this.syncingHistory = true;
        window.history.back();
      } catch (_) {}
    }

    if (this.stack.length > 0) {
      const active = this.stack[this.stack.length - 1];
      if (active) {
        active.animationState = 'active';
        active.el.classList.remove('is-receded');
        active.el.classList.add('is-active');
        active.el.removeAttribute('aria-hidden');

        SovraSurfaceHeader.updateBreadcrumbs(this.stack, (id) => this.popTo(id));

        // Restore focus to original trigger or active surface
        if (popped?.origin instanceof HTMLElement) {
          popped.origin.focus();
        } else {
          const focusable = active.el.querySelector<HTMLElement>('button, input, select, textarea, [tabindex="0"]');
          if (focusable) focusable.focus();
        }
        return active;
      }
    }

    return null;
  }

  public popTo(targetSurfaceId: SurfaceId): void {
    while (this.stack.length > 1) {
      const last = this.stack[this.stack.length - 1];
      if (!last || last.id === targetSurfaceId) break;
      const popped = this.stack.pop();
      if (popped && popped.el && popped.el.parentNode) {
        popped.el.parentNode.removeChild(popped.el);
      }
    }
    if (this.stack.length > 0) {
      const active = this.stack[this.stack.length - 1];
      if (active) {
        active.animationState = 'active';
        active.el.classList.remove('is-receded');
        active.el.classList.add('is-active');
        active.el.removeAttribute('aria-hidden');
        SovraSurfaceHeader.updateBreadcrumbs(this.stack, (id) => this.popTo(id));
      }
    }
  }

  public replace(options: SurfaceOptions): SurfaceRecord {
    if (this.stack.length > 0) {
      const current = this.stack.pop();
      if (current && current.el && current.el.parentNode) {
        current.el.parentNode.removeChild(current.el);
      }
    }
    return this.push(options);
  }

  public close(surfaceId?: SurfaceId): void {
    const currentTop = this.stack.length > 0 ? this.stack[this.stack.length - 1] : undefined;
    if (!surfaceId || (currentTop && currentTop.id === surfaceId)) {
      this.pop();
      return;
    }
    const idx = this.stack.findIndex((s) => s.id === surfaceId);
    if (idx !== -1) {
      const [removed] = this.stack.splice(idx, 1);
      if (removed && removed.el && removed.el.parentNode) {
        removed.el.parentNode.removeChild(removed.el);
      }
      SovraSurfaceHeader.updateBreadcrumbs(this.stack, (id) => this.popTo(id));
    }
  }

  public closeAll(): void {
    while (this.stack.length > 0) {
      const s = this.stack.pop();
      if (s) {
        if (typeof s.onClose === 'function') {
          try { s.onClose(); } catch (err) { console.warn(err); }
        }
        if (s.el && s.el.parentNode) {
          s.el.parentNode.removeChild(s.el);
        }
      }
    }
    this.backdrop.hide();
    document.body.classList.remove('spatial-surface-open');

    if (this.initialTriggerEl && typeof this.initialTriggerEl.focus === 'function') {
      try { this.initialTriggerEl.focus(); } catch (_) {}
    }
    this.initialTriggerEl = null;
  }

  public getCurrent(): SurfaceRecord | null {
    if (this.stack.length === 0) return null;
    return this.stack[this.stack.length - 1] ?? null;
  }

  public getStack(): SurfaceRecord[] {
    return [...this.stack];
  }

  public getDepth(): number {
    return this.stack.length;
  }

  private createRenderContext(surfaceId: string): SurfaceRenderContext {
    return {
      surfaceId,
      pushSurface: (opts) => this.push(opts),
      popSurface: () => this.pop(),
      replaceSurface: (opts) => this.replace(opts),
      closeSurface: (id) => this.close(id),
      closeAllSurfaces: () => this.closeAll(),
      params: {},
      context: {},
    };
  }

  private bindGlobalKeyboardAndHistory(): void {
    if (typeof window === 'undefined') return;

    // ESC key closes topmost surface
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.stack.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        this.pop();
      }
    });

    // Mobile hardware / gesture back navigation
    window.addEventListener('popstate', () => {
      if (this.syncingHistory) {
        this.syncingHistory = false;
        return;
      }
      if (this.stack.length > 0) {
        this.pop({ fromHistory: true });
      }
    });
  }
}
