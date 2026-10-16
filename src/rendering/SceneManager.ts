import { ClayRenderer } from './ClayRenderer';
import { SquishyStateMachine } from '../core/SquishyStateMachine';

const FRAME_MS = 1000 / 60;

export class SceneManager {
  readonly squishy: ClayRenderer;
  private frame: number | null = null;
  private last = 0;
  private visibility = (): void => { if (document.hidden) this.stop(); else this.start(); };
  constructor(canvas: HTMLCanvasElement, private model: SquishyStateMachine) {
    this.squishy = new ClayRenderer(canvas, model);
    document.addEventListener('visibilitychange', this.visibility);
  }
  start(): void {
    if (this.frame !== null || document.hidden) return;
    this.last = performance.now(); this.frame = requestAnimationFrame(this.animate);
  }
  private stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }
  private animate = (time: number): void => {
    this.frame = requestAnimationFrame(this.animate);
    const elapsed = time - this.last;
    if (elapsed < FRAME_MS) return;
    const dt = Math.min(0.2, elapsed / 1000);
    this.model.update(dt);
    this.squishy.update(dt);
    this.last = time - elapsed % FRAME_MS;
  };
  dispose(): void { this.stop(); document.removeEventListener('visibilitychange', this.visibility); this.squishy.dispose(); }
}
