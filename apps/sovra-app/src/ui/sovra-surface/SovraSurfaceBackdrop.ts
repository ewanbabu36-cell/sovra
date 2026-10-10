/**
 * SOVRA Spatial Surface Backdrop
 * File: apps/sovra-app/src/ui/sovra-surface/SovraSurfaceBackdrop.ts
 */

export class SovraSurfaceBackdrop {
  private element: HTMLElement | null = null;
  private onDismissCallback: (() => void) | null = null;

  public mount(container: HTMLElement, onDismiss: () => void): HTMLElement {
    this.onDismissCallback = onDismiss;
    if (!this.element) {
      this.element = document.createElement('div');
      this.element.className = 'sovra-surface-backdrop';
      this.element.onclick = () => {
        if (this.onDismissCallback) this.onDismissCallback();
      };
      container.appendChild(this.element);
    }
    const activate = () => {
      this.element?.classList.add('is-active');
    };
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(activate);
    } else {
      setTimeout(activate, 0);
    }
    return this.element;
  }

  public hide(): void {
    if (this.element) {
      this.element.classList.remove('is-active');
    }
  }

  public destroy(): void {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
      this.element = null;
    }
  }
}
