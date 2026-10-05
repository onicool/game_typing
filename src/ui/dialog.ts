/** Focus and background isolation for the two actual modal dialogs. */
export class DialogFocus {
  private dialog: HTMLElement | null = null;
  private origin: HTMLElement | null = null;
  private background: { element: HTMLElement; inert: boolean }[] = [];

  constructor(private readonly stage: HTMLElement) {
    document.addEventListener('focusin', () => {
      if (this.dialog && !this.dialog.contains(document.activeElement)) this.focusFirst();
    });
  }

  get active(): boolean { return this.dialog !== null; }

  contains(target: EventTarget | null): boolean {
    return target instanceof Node && !!this.dialog?.contains(target);
  }

  /** Call after visibility changes, passing the focus captured before hiding. */
  show(dialog: HTMLElement | null, origin: Element | null): void {
    if (dialog === this.dialog) return;
    this.close();
    if (!dialog) return;
    this.dialog = dialog;
    this.origin = origin instanceof HTMLElement ? origin : document.body;
    for (const child of this.stage.children) {
      if (!(child instanceof HTMLElement) || child === dialog) continue;
      this.background.push({ element: child, inert: child.inert });
      child.inert = true;
    }
    this.focusFirst();
  }

  cycle(e: KeyboardEvent): void {
    if (!this.dialog || e.key !== 'Tab') return;
    e.preventDefault();
    const controls = this.controls();
    if (!controls.length) { this.dialog.focus({ preventScroll: true }); return; }
    const index = controls.indexOf(document.activeElement as HTMLElement);
    const next = index < 0 ? (e.shiftKey ? controls.length - 1 : 0)
      : (index + (e.shiftKey ? -1 : 1) + controls.length) % controls.length;
    controls[next].focus({ preventScroll: true });
  }

  private controls(): HTMLElement[] {
    if (!this.dialog) return [];
    return [...this.dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')]
      .filter(element => element.tabIndex >= 0 && !element.matches(':disabled')
        && !element.closest('[inert]') && element.getClientRects().length > 0
        && getComputedStyle(element).visibility !== 'hidden');
  }

  private focusFirst(): void {
    (this.controls()[0] ?? this.dialog)?.focus({ preventScroll: true });
  }

  private close(): void {
    if (!this.dialog) return;
    this.dialog = null;
    for (const { element, inert } of this.background) element.inert = inert;
    this.background = [];
    const target = this.origin?.isConnected && !this.origin.closest('[inert]')
      && this.origin.getClientRects().length > 0 && getComputedStyle(this.origin).visibility !== 'hidden'
      ? this.origin : document.body;
    this.origin = null;
    // Body is the typing surface's default origin and needs a temporary focus target.
    const previous = target.getAttribute('tabindex');
    if (target === document.body) target.tabIndex = -1;
    target.focus({ preventScroll: true });
    if (target === document.body) {
      if (previous === null) target.removeAttribute('tabindex');
      else target.setAttribute('tabindex', previous);
    }
  }
}
