export interface PointerInput { type: 'down' | 'move' | 'up' | 'cancel'; x: number; y: number; force: number; simulated?: boolean }

/** One captured pointer owns a gesture; no frame-based synthetic presses. */
export class PointerController {
  private id: number | null = null;
  private visibility = (): void => { if (document.hidden) this.release(); };
  private blockNative = (e: Event): void => e.preventDefault();
  constructor(private canvas: HTMLCanvasElement, private receive: (input: PointerInput) => boolean | void) {
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.cancel);
    canvas.addEventListener('lostpointercapture', this.cancel);
    canvas.addEventListener('contextmenu', this.blockNative);
    canvas.addEventListener('selectstart', this.blockNative);
    canvas.addEventListener('dragstart', this.blockNative);
    window.addEventListener('blur', this.release);
    document.addEventListener('visibilitychange', this.visibility);
  }
  private input(e: PointerEvent, type: PointerInput['type']): PointerInput {
    const rect = this.canvas.getBoundingClientRect();
    const measured = e.pressure > 0 && (e.pointerType === 'pen' || (e.pointerType === 'touch' && e.pressure !== .5));
    return { simulated: !measured, type, x: e.clientX - rect.left, y: e.clientY - rect.top,
      force: measured ? Math.min(1, e.pressure) : .18 };
  }
  private down = (e: PointerEvent): void => {
    if (this.id !== null || e.button !== 0 || !e.isPrimary) return;
    if (this.receive(this.input(e, 'down')) === false) return;
    e.preventDefault(); this.id = e.pointerId;
    if (e.pointerType === 'touch') this.canvas.blur();
    else this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(e.pointerId);
  };
  private move = (e: PointerEvent): void => {
    if (this.id !== e.pointerId) return;
    e.preventDefault(); this.receive(this.input(e, 'move'));
  };
  private up = (e: PointerEvent): void => {
    if (this.id !== e.pointerId) return;
    this.receive(this.input(e, 'up')); this.releaseCapture();
  };
  private cancel = (e: PointerEvent): void => { if (this.id === e.pointerId) this.release(); };
  private releaseCapture(): void {
    const id = this.id; this.id = null;
    if (id !== null && this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
  }
  release = (): void => {
    if (this.id !== null) this.receive({ type: 'cancel', x: 0, y: 0, force: 0 });
    this.releaseCapture();
  };
  dispose(): void {
    this.release();
    this.canvas.removeEventListener('pointerdown', this.down);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('pointercancel', this.cancel);
    this.canvas.removeEventListener('lostpointercapture', this.cancel);
    this.canvas.removeEventListener('contextmenu', this.blockNative);
    this.canvas.removeEventListener('selectstart', this.blockNative);
    this.canvas.removeEventListener('dragstart', this.blockNative);
    window.removeEventListener('blur', this.release);
    document.removeEventListener('visibilitychange', this.visibility);
  }
}
