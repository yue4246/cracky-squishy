/** Local material history. Time advances relaxation, never shell damage. */
export const GRID = 24;
export const RADIUS = 0.24;
export const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
export const influence = (distance: number, radius = RADIUS) => distance >= radius ? 0 : (1 - (distance / radius) ** 2) ** 2;
export interface Point { x: number; y: number }
export interface Hit extends Point { pan: number }
export interface Crack { a: Point; b: Point; width: number }
export type EventType = 'press' | 'micro_crack' | 'shell_break' | 'fragment' | 'soft_squish' | 'scrape' | 'release';
export interface MaterialEvent extends Hit {
  id: number; generation: number; pressId: number; type: EventType;
  intensity: number; soft: boolean; force?: number; dragDistance?: number; segments?: Crack[]; cells?: number[];
}
export interface Contact extends Hit { force: number; peakForce: number; simulated: boolean; soft: boolean; dragX: number; dragY: number }

export class SquishyStateMachine {
  readonly damage = new Float32Array(GRID * GRID);
  readonly opened = new Uint8Array(GRID * GRID);
  readonly lastPress = new Int32Array(GRID * GRID).fill(-1);
  readonly residualX = new Float32Array((GRID + 1) ** 2);
  readonly residualY = new Float32Array((GRID + 1) ** 2);
  readonly residualH = new Float32Array((GRID + 1) ** 2);
  contact: Contact | null = null;
  compliance = 1;
  pressCount = 0;
  generation = 0;
  revision = 0;
  onEvent: (event: MaterialEvent) => void = () => {};
  isSolid: (x: number, y: number) => boolean = () => true;
  isExposed: ((x: number, y: number) => boolean) | null = null;
  private softAt(x: number, y: number): boolean { return this.isExposed?.(x,y) ?? !!this.opened[this.cellAt(x,y)]; }
  private serial = 0;
  private seed = 48271;
  private tips: Point[] = [];
  private travel = 0;
  private lastHit: Hit | null = null;
  private residualCommitted = new Set<number>();
  private loadCycle = 0;
  private pressBaseX = new Float32Array((GRID + 1) ** 2);
  private pressBaseY = new Float32Array((GRID + 1) ** 2);
  private holdTime = 0;
  private holdFractured = false;

  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  cellAt(x: number, y: number): number {
    return Math.min(GRID - 1, Math.floor(clamp(y) * GRID)) * GRID + Math.min(GRID - 1, Math.floor(clamp(x) * GRID));
  }
  cellPoint(i: number): Point { return { x: (i % GRID + 0.5) / GRID, y: (Math.floor(i / GRID) + 0.5) / GRID }; }
  valid(hit: Hit): boolean {
    return [hit.x, hit.y, hit.pan].every(Number.isFinite) && hit.x >= 0 && hit.x <= 1 && hit.y >= 0 && hit.y <= 1 && this.isSolid(hit.x, hit.y);
  }
  private emit(type: EventType, hit: Hit, intensity: number, extra: Partial<MaterialEvent> = {}): void {
    this.onEvent({ ...hit, id: ++this.serial, generation: this.generation, pressId: this.pressCount,
      type, intensity: clamp(intensity), soft: this.contact?.soft ?? false,
      force: this.contact?.force, dragDistance: this.contact ? Math.hypot(this.contact.dragX,this.contact.dragY) : 0, ...extra });
  }
  begin(hit: Hit, force = 0.5, simulated = false): boolean {
    if (this.contact || !this.valid(hit) || !Number.isFinite(force)) return false;
    this.pressCount++;
    this.loadCycle++;
    this.holdTime = 0;
    this.holdFractured = false;
    this.travel = 0;
    this.residualCommitted.clear();
    this.pressBaseX.set(this.residualX);
    this.pressBaseY.set(this.residualY);
    this.contact = { ...hit, force: clamp(force), peakForce: clamp(force), simulated, soft: this.softAt(hit.x, hit.y), dragX: 0, dragY: 0 };
    this.lastHit = hit;
    this.emit('press', hit, clamp(force));
    this.load(hit);
    if (this.contact.soft) { this.plasticize(hit, .14); this.emit('soft_squish', hit, 0.55); }
    this.constrainResidual();
    return true;
  }
  /** Crack on contact, then open once during the same sustained press. */
  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (!this.contact) return;
    const plasticDt = Math.min(dt, 0.05);
    this.contact.soft=this.softAt(this.contact.x,this.contact.y);
    this.holdTime += Math.min(dt, 1);
    if (this.contact.simulated) this.contact.force = .18 + .72 * clamp(this.holdTime / .65);
    this.contact.peakForce = Math.max(this.contact.peakForce, this.contact.force);
    if (!this.holdFractured) {
      if (this.holdTime >= 0.62) {
        this.holdFractured = true;
        this.loadCycle++;
        this.residualCommitted.clear();
        this.load(this.contact);
        this.contact.soft = this.softAt(this.contact.x, this.contact.y);
        if (this.contact.soft) this.emit('soft_squish', this.contact, 0.7);
      }
    }
    if (this.contact.soft) this.plasticize(this.contact, plasticDt);
    this.constrainResidual();
  }

  private plasticize(hit: Hit, dt: number): void {
    const cx=.5-hit.x, cy=.48-hit.y, side=Math.hypot(cx,cy);
    const pushX=side>.08?cx/side:0, pushY=side>.08?cy/side:.75;
    for (let i = 0; i < this.residualH.length; i++) {
      const x = i % (GRID + 1) / GRID, y = Math.floor(i / (GRID + 1)) / GRID;
      const dx = x - hit.x, dy = y - hit.y, distance = Math.hypot(dx, dy);
      // Extend the deformation through transparent vertices too: alpha is a visual mask,
      // not a fixed boundary in the material. A bounded smooth target cannot accumulate spikes.
      const w = influence(distance, RADIUS * 1.8);
      const alpha = 1 - Math.exp(-dt / .5);
      if (!w) continue;
      // A finite fingertip dent with a broad displaced-material shoulder.
      // Keep old dents: a neighboring press must not erase the user's history.
      const pit=influence(distance,RADIUS*.88);
      const shoulder=influence(Math.abs(distance-RADIUS*.95),RADIUS*.65);
      // The shell confines the core: extrusion concentrates at exposed openings.
      const exposed=this.opened[this.cellAt(x,y)];
      const direction=distance>.001?(dx*this.contact!.dragX+dy*this.contact!.dragY)/distance:0;
      const extrusion=exposed?(.024+Math.max(0,direction)*.2):.006;
      const target=-.13*this.compliance*(.55+.9*this.contact!.force)*pit+extrusion*shoulder;
      if(target<this.residualH[i] || (target>0 && this.residualH[i]>=0))
        this.residualH[i]+=(target-this.residualH[i])*alpha;

      this.residualX[i] += (this.pressBaseX[i]+pushX*.10*this.compliance+this.contact!.dragX*.7-this.residualX[i])*alpha*w;
      this.residualY[i] += (this.pressBaseY[i]+pushY*.10*this.compliance+this.contact!.dragY*.7-this.residualY[i])*alpha*w;
    }
  }
  // ponytail: bounded 2D displacement field; this is a visual soft-body approximation.
  private constrainResidual(): void {
    const stride=GRID+1, limit=.18/GRID;
    for(let pass=0;pass<12;pass++) for(let i=0;i<this.residualX.length;i++) {
      for(const j of [i%stride<GRID?i+1:-1,i+stride<this.residualX.length?i+stride:-1]) {
        if(j<0) continue;
        const dx=this.residualX[j]-this.residualX[i], dy=this.residualY[j]-this.residualY[i];
        const length=Math.hypot(dx,dy);
        if(length<=limit) continue;
        const correction=(length-limit)/length*.5;
        this.residualX[i]+=dx*correction; this.residualX[j]-=dx*correction;
        this.residualY[i]+=dy*correction; this.residualY[j]-=dy*correction;
      }
    }
  }
  move(hit: Hit, force = 0.5): void {
    if (!this.contact || !this.valid(hit) || !Number.isFinite(force)) return;
    const previous = this.lastHit ?? hit;
    const distance = Math.hypot(hit.x - previous.x, hit.y - previous.y);
    // No damage bridge across a jump or transparent gap; each sample checks the silhouette.
    const steps = Math.min(32, Math.max(1, Math.ceil(distance / (RADIUS / 3))));
    if (!this.contact.simulated) this.contact.force = clamp(force);
    this.contact.peakForce = Math.max(this.contact.peakForce, this.contact.force);
    this.contact.dragX = clamp(this.contact.dragX + hit.x - previous.x, -RADIUS * 0.25, RADIUS * 0.25);
    this.contact.dragY = clamp(this.contact.dragY + hit.y - previous.y, -RADIUS * 0.25, RADIUS * 0.25);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sample = { x: previous.x + (hit.x - previous.x) * t, y: previous.y + (hit.y - previous.y) * t, pan: hit.pan };
      if (this.valid(sample)) this.load(sample);
    }
    Object.assign(this.contact, hit);
    this.contact.soft = this.softAt(hit.x, hit.y);
    this.travel += distance;
    if (this.travel >= 0.07) {
      this.travel = 0;
      this.emit(this.contact.soft ? 'soft_squish' : 'scrape', hit, clamp(0.3 + distance * 3));
    }
    this.lastHit = hit;
  }
  leaveSurface(): void { this.lastHit = null; }
  drag(x: number, y: number, force = .5): void {
    if (!this.contact || ![x,y,force].every(Number.isFinite)) return;
    const distance = Math.hypot(x,y);
    const scale = distance > 0 ? .15 * Math.tanh(distance/.15) / distance : 1;
    this.contact.dragX = x*scale; this.contact.dragY = y*scale;
    if (!this.contact.simulated) this.contact.force = clamp(force);
    this.contact.peakForce = Math.max(this.contact.peakForce, this.contact.force);
    this.travel += Math.hypot(x-(this.lastHit?.x ?? 0), y-(this.lastHit?.y ?? 0));
    this.lastHit = { x, y, pan: this.contact.pan };
    if (this.travel > .045) {
      this.travel = 0;
      this.emit(this.contact.soft ? 'soft_squish' : 'scrape', this.contact, .5);
    }
  }
  end(cancelled = false): void {
    if (!this.contact) return;
    if (!cancelled) this.emit('release', this.contact, this.contact.peakForce);
    this.contact = null;
    this.lastHit = null;
  }
  private load(hit: Hit): void {
    if (!this.contact) return;
    const start = this.cellAt(hit.x, hit.y);
    if (this.contact.soft && this.softAt(hit.x,hit.y)) return;
    const queue = [start];
    const visited = new Set<number>(queue);
    const affected: { i: number; w: number }[] = [];
    let peak = 0;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], p = this.cellPoint(i);
      const w = influence(Math.hypot(p.x - hit.x, p.y - hit.y), RADIUS * (.65 + .7 * this.contact.force));
      if (!w || !this.isSolid(p.x, p.y)) continue;
      affected.push({ i, w }); peak = Math.max(peak, w);
      const neighbors = [i - GRID, i + GRID];
      if (i % GRID > 0) neighbors.push(i - 1);
      if (i % GRID < GRID - 1) neighbors.push(i + 1);
      for (const n of neighbors) {
        if (n < 0 || n >= GRID * GRID || visited.has(n)) continue;
        const next = this.cellPoint(n);
        if (this.isSolid((p.x + next.x) / 2, (p.y + next.y) / 2)) {
          visited.add(n); queue.push(n);
        }
      }
    }
    const broken: number[] = [];
    let crackGrowth = false;
    for (const { i, w } of affected) {
      if (this.lastPress[i] === this.loadCycle) continue;
      this.lastPress[i] = this.loadCycle;
      if (this.opened[i]) continue;
      const before = this.damage[i];
      const gain = this.holdFractured ? 0.52 : 0.34;
      this.damage[i] = clamp(before + gain * (0.55 + .9 * this.contact.force) * w / peak);
      if (Math.floor(this.damage[i] / 0.3) > Math.floor(before / 0.3)) crackGrowth = true;
      if (this.damage[i] >= 0.62) { this.opened[i] = 1; broken.push(i); }
    }
    if (crackGrowth || (!this.holdFractured && !this.contact.soft)) {
      const segments = this.growCracks(hit);
      if (segments.length) this.emit('micro_crack', hit, .15 + this.contact.force * .5, { segments });
    }
    if (broken.length) this.emit('shell_break', hit, clamp(0.5 + broken.length * 0.02), { cells: broken });
    if (crackGrowth || broken.length) this.revision++;
    // Residual deformation is bounded and committed once per vertex per gesture.
    for (let i = 0; i < this.residualH.length; i++) {
      const x = i % (GRID + 1) / GRID, y = Math.floor(i / (GRID + 1)) / GRID;
      const w = influence(Math.hypot(x - hit.x, y - hit.y));
      if (!w || this.residualCommitted.has(i)) continue;
      this.residualCommitted.add(i);
      this.residualH[i] = Math.max(Math.min(-0.085, this.residualH[i]), this.residualH[i] - w * (this.contact.soft ? 0.012 : 0.009));
      const cx=.5-hit.x, cy=.48-hit.y, side=Math.hypot(cx,cy);
      this.residualX[i] += ((side>.08?cx/side:0) * w * .026)*(.5+this.contact.force);
      this.residualY[i] += ((side>.08?cy/side:.75) * w * .026)*(.5+this.contact.force);
    }
  }
  private growCracks(hit: Hit): Crack[] {
    const segments: Crack[] = [];
    if (this.tips.some(p => Math.hypot(p.x-hit.x,p.y-hit.y)<.055)) return segments;
    const trunkAngle = .9 + this.random() * 1.1;
    const joints: Point[] = [{x:hit.x,y:hit.y}];
    for (let ray = 0; ray < 4; ray++) {
      let a: Point = ray === 0 ? {x:hit.x,y:hit.y} : joints[Math.min(ray, joints.length-1)];
      let angle = trunkAngle + (ray === 0 ? 0 : ray === 1 ? 1.12 : ray === 2 ? -1.2 : 2.7);
      for (let step = 0; step < 4; step++) {
        angle += (this.random() - 0.5) * 0.92;
        const direction = angle;
        const length = (0.045 + this.random() * 0.018) * (.6 + .8 * this.contact!.force);
        const b = { x: a.x + Math.cos(direction) * length, y: a.y + Math.sin(direction) * length };
        if (Math.hypot(b.x - hit.x, b.y - hit.y) > RADIUS) break;
        let allowed = true;
        for (let t = 0.2; t <= 1; t += 0.2) {
          const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
          if (!this.isSolid(x, y)) allowed = false;
        }
        if (!allowed) break;
        segments.push({ a: { ...a }, b, width: (ray===0 ? .007 : .0045) * (1-step*.18) });
        if (ray===0) joints.push(b);
        a = b;
      }
    }
    this.tips.push({x:hit.x,y:hit.y});
    // Old segments stay baked in the renderer; only active growth tips are bounded.
    this.tips = this.tips.slice(-64);
    return segments;
  }
  fragment(hit: Hit, intensity = 0.25): void { this.emit('fragment', hit, intensity); }
  reset(): void {
    this.end(true); this.generation++; this.pressCount = 0; this.revision++;
    this.damage.fill(0); this.opened.fill(0); this.lastPress.fill(-1);
    this.residualX.fill(0); this.residualY.fill(0); this.residualH.fill(0);
    this.tips = []; this.seed = 48271; this.residualCommitted.clear();
    this.loadCycle = 0; this.holdTime = 0; this.holdFractured = false;
  }
}
