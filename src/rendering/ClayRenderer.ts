import { KeyboardToy } from './KeyboardToy';
import { validSnapshot, type SquishySnapshot } from '../core/SquishySnapshot';
import { makeWaxPieces, insideWax, stressWaxPieces, type WaxPiece } from './WaxDamage';
export { makeWaxPieces, insideWax } from './WaxDamage';
import { GRID, RADIUS, clamp, influence, SquishyStateMachine, type Point, type Hit, type MaterialEvent, type Crack } from '../core/SquishyStateMachine';

export interface Character {
  name: string; image: string; color: string;
  material: 'bread' | 'mochi' | 'jelly' | 'chocolate' | 'ice' | 'sugar';
  coreMaterial?: Character['material'];
  shellStrength?: number;
  filling?: string;
  crop?: [number, number, number, number];
  removeBackground?: boolean;
  corePatch?: [number, number, number, number];
  coreTexture?: 'smooth' | 'granular';
  authoredDamage?: boolean;
  keyboard?: boolean;
}
interface Vertex extends Point { u: number; v: number; h: number }
interface Shard extends Hit { vx: number; vy: number; size: number; angle: number; spin: number; age: number; landed: boolean; sourceX: number; sourceY: number; polygon?: Point[] }
const SIZE = 512;
const SOFT_SIZE = 96;
function layer(): HTMLCanvasElement { const c = document.createElement('canvas'); c.width = c.height = SIZE; return c; }
function context(c: HTMLCanvasElement): CanvasRenderingContext2D { const ctx = c.getContext('2d'); if (!ctx) throw new Error('浏览器不支持 Canvas 2D'); return ctx; }
// Project a curved strip with a fixed hinge. The bounded slope prevents folded textures.
export function bendWax(y:number, hinge:number, span:number, curl:number):number {
  const distance=clamp((hinge-y)/Math.max(1,span));
  return y+Math.min(.38,Math.max(0,curl))*span*distance*distance;
}
export function barycentric(p: Point, a: Point, b: Point, c: Point): [number, number, number] | null {
  const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(det) < 1e-9) return null;
  const u = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / det;
  const v = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / det;
  return u >= -1e-6 && v >= -1e-6 && u + v <= 1.000001 ? [u, v, 1 - u - v] : null;
}
export function overscanTriangle(points:Point[], amount:number):Point[] {
  const center=points.reduce((sum,p)=>({x:sum.x+p.x/3,y:sum.y+p.y/3}),{x:0,y:0});
  return points.map(p=>{const dx=p.x-center.x,dy=p.y-center.y,length=Math.hypot(dx,dy)||1;return {x:p.x+dx/length*amount,y:p.y+dy/length*amount};});
}

export class ClayRenderer {
  private ctx: CanvasRenderingContext2D;
  private shell = layer();
  private soft = layer();
  private cracks = layer();
  private openings = layer();
  private fractures: { segments: Crack[]; x: number; y: number; age: number; spread: number }[] = [];
  private waxPieces: WaxPiece[] = [];
  private authoredDamage = false;
  private corePixels: ImageData | null = null;
  private coreColor = [239, 205, 177];
  private granular = false;
  private shellStrength = 1;
  private coreGloss = .19;
  private plate = layer();
  private surface = layer();
  private shellLayer = layer();
  private alpha = new Uint8ClampedArray(SIZE * SIZE);
  readonly vertices: Vertex[] = [];
  readonly triangles: number[][] = [];
  private readonly renderTriangles: number[][] = [];
  private pending: { segment: Crack; age: number }[] = [];
  private shards: Shard[] = [];
  private peelLayer = layer();
  private pressForce = -1;
  private peeledArea = 0;
  private impactCooldown = 0;
  private renderedPress = -1;
  private pressurePoint: Point | null = null;
  private drawSize = 400;
  private left = 0;
  private top = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private version = 0;
  private disposed = false;
  private dirty = true;
  ready = false;
  keyboard: KeyboardToy | null = null;
  keyboardPoint: Point | null = null;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private observedRevision = -1;

  constructor(private canvas: HTMLCanvasElement, readonly model: SquishyStateMachine) {
    this.ctx = context(canvas);
    this.model.isExposed=(x,y)=>this.keyboard ? this.keyboard.exposed({x,y}) : this.authoredDamage
      ? this.waxPieces.some(p=>p.state===2 && insideWax({x,y},p.polygon))
      : !!this.model.opened[this.model.cellAt(x,y)];
    for (let y = 0; y <= GRID; y++) for (let x = 0; x <= GRID; x++) this.vertices.push({ u: x / GRID, v: y / GRID, x: x / GRID, y: y / GRID, h: 0 });
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const a = y * (GRID + 1) + x;
      this.triangles.push([a, a + 1, a + GRID + 1], [a + 1, a + GRID + 2, a + GRID + 1]);
    }
    const renderStep = matchMedia('(pointer: coarse)').matches ? 2 : 1;
    for (let y = 0; y < GRID; y += renderStep) for (let x = 0; x < GRID; x += renderStep) {
      const a = y * (GRID + 1) + x, right = a + renderStep, below = a + renderStep * (GRID + 1);
      this.renderTriangles.push([a, right, below], [right, below + renderStep, below]);
    }
    this.resize(); window.addEventListener('resize', this.resize);
  }
  private resize = (): void => {
    const bounds = this.canvas.getBoundingClientRect();
    this.width = bounds.width; this.height = bounds.height;
    this.dpr = Math.min(devicePixelRatio || 1, 1.25);
    this.canvas.width = Math.round(this.width * this.dpr); this.canvas.height = Math.round(this.height * this.dpr);
    const controls = document.querySelector<HTMLElement>('#controls');
    const status = document.querySelector<HTMLElement>('#status');
    const dock = document.querySelector<HTMLElement>('.dessert-dock');
    const upper = controls && !controls.hidden ? controls.getBoundingClientRect().bottom - bounds.top : 0;
    const lower = Math.min(this.height,
      status && !status.hidden ? status.getBoundingClientRect().top - bounds.top : this.height,
      dock && !dock.hidden ? dock.getBoundingClientRect().top - bounds.top : this.height);
    this.drawSize = Math.min(this.width * .86, this.height * .6, 560, Math.max(0, lower - upper - 20) / .84);
    this.left = (this.width - this.drawSize) / 2;
    this.top = (upper + lower - this.drawSize) / 2;
    this.keyboard?.layout(this.width,this.height);
    this.dirty = true;
  };
  async load(character: Character): Promise<void> {
    this.keyboard = character.keyboard ? new KeyboardToy() : null;
    if(this.keyboard){
      this.version++;this.keyboard.layout(this.width,this.height);
      this.model.isSolid=(x,y)=>this.keyboard?.keyAt({x,y})!==-1;
      this.ready=true;return;
    }
    const version = ++this.version;
    this.ready = false;
    const image = new Image();
    image.src = `./characters/${encodeURIComponent(character.image)}`;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('角色图片加载失败'));
      if (image.complete && image.naturalWidth) resolve();
    });
    if (this.disposed || version !== this.version) return;
    this.authoredDamage = !!character.authoredDamage;
    const crop = character.crop ?? [0, 0, 1, 1];
    const raw = layer(), rc = context(raw);
    rc.drawImage(image, crop[0] * image.width, crop[1] * image.height, crop[2] * image.width, crop[3] * image.height, 0, 0, SIZE, SIZE);
    const pixels = rc.getImageData(0, 0, SIZE, SIZE);
    const data = pixels.data;
    if (character.removeBackground) {
      const seen = new Uint8Array(SIZE * SIZE), queue: number[] = [];
      for (let i = 0; i < SIZE; i++) queue.push(i, (SIZE - 1) * SIZE + i, i * SIZE, i * SIZE + SIZE - 1);
      for (let q = 0; q < queue.length; q++) {
        const i = queue[q]; if (seen[i]) continue; seen[i] = 1;
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        if (Math.min(r, g, b) < 190 || Math.max(r, g, b) - Math.min(r, g, b) > 32) continue;
        data[i * 4 + 3] = 0;
        if (i % SIZE) queue.push(i - 1); if (i % SIZE < SIZE - 1) queue.push(i + 1);
        if (i >= SIZE) queue.push(i - SIZE); if (i < SIZE * (SIZE - 1)) queue.push(i + SIZE);
      }
    }
    // Keep the main connected silhouette, excluding detached crumbs/background marks.
    const seen = new Uint8Array(SIZE * SIZE); let largest: number[] = [];
    for (let start = 0; start < seen.length; start++) {
      if (seen[start] || data[start * 4 + 3] < 40) continue;
      const component = [start]; seen[start] = 1;
      for (let q = 0; q < component.length; q++) {
        const i = component[q], neighbors: number[] = [];
        if (i % SIZE) neighbors.push(i - 1); if (i % SIZE < SIZE - 1) neighbors.push(i + 1);
        if (i >= SIZE) neighbors.push(i - SIZE); if (i < SIZE * (SIZE - 1)) neighbors.push(i + SIZE);
        for (const n of neighbors) if (!seen[n] && data[n * 4 + 3] >= 40) { seen[n] = 1; component.push(n); }
      }
      if (component.length > largest.length) largest = component;
    }
    if (largest.length < 100) throw new Error('角色轮廓无法识别');
    const keep = new Uint8Array(SIZE * SIZE);
    let minX = SIZE, minY = SIZE, maxX = 0, maxY = 0;
    for (const i of largest) { keep[i] = 1; minX = Math.min(minX, i % SIZE); maxX = Math.max(maxX, i % SIZE); minY = Math.min(minY, Math.floor(i / SIZE)); maxY = Math.max(maxY, Math.floor(i / SIZE)); }
    for (let i = 0; i < keep.length; i++) if (!keep[i]) data[i * 4 + 3] = 0;
    rc.putImageData(pixels, 0, 0);
    const sw = maxX - minX + 1, sh = maxY - minY + 1;
    const aspect = crop[2] * image.width / (crop[3] * image.height);
    const dw = sw * aspect, dh = sh, scale = SIZE * 0.84 / Math.max(dw, dh);
    const sc = context(this.shell); sc.clearRect(0, 0, SIZE, SIZE);
    sc.drawImage(raw, minX, minY, sw, sh, (SIZE - dw * scale) / 2, (SIZE - dh * scale) / 2, dw * scale, dh * scale);
    const normalized = sc.getImageData(0, 0, SIZE, SIZE).data;
    for (let i = 0; i < this.alpha.length; i++) this.alpha[i] = normalized[i * 4 + 3];
    this.model.isSolid = this.isSolid;
    this.coreColor = character.color.match(/[a-f\d]{2}/gi)!.map(c => parseInt(c,16));
    const core=character.coreMaterial ?? character.material;
    this.granular = character.coreTexture === 'granular' || core === 'bread';
    this.shellStrength=clamp(character.shellStrength ?? 1,.7,1.3);
    this.coreGloss=core==='jelly' || core==='ice' ? .29 : this.granular ? .10 : .19;
    this.model.compliance=core==='jelly' || core==='ice' ? 1.15 : core==='bread' ? .85 : 1;
    this.soft.width = this.soft.height = SOFT_SIZE;
    this.corePixels = context(this.soft).createImageData(SOFT_SIZE,SOFT_SIZE);
    this.clear(); this.ready = true; this.dirty = true;
  }
  get interactionSize(): number { return this.drawSize; }
  relayout(): void { this.resize(); }
  isSolid = (x: number, y: number): boolean => x >= 0 && x < 1 && y >= 0 && y < 1 && this.alpha[Math.floor(y * SIZE) * SIZE + Math.floor(x * SIZE)] > 80;
  hitTest(x: number, y: number): Hit | null {
    if (!this.ready || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    if(this.keyboard){const p=this.keyboard.point(x,y);return this.keyboard.keyAt(p)<0?null:{...p,pan:clamp(p.x*1.6-.8,-.8,.8)};}
    const p = { x: (x - this.left) / this.drawSize, y: (y - this.top) / this.drawSize };
    // ponytail: ~1,152 triangles; add an index only if measured input cost warrants it.
    for (const indices of this.triangles) {
      const [a, b, c] = indices.map(i => this.vertices[i]);
      const weights = barycentric(p, a, b, c); if (!weights) continue;
      const u = a.u * weights[0] + b.u * weights[1] + c.u * weights[2];
      const v = a.v * weights[0] + b.v * weights[1] + c.v * weights[2];
      if (!this.isSolid(u, v)) continue;
      return { x: u, y: v, pan: clamp((p.x - 0.5) / 0.42, -0.8, 0.8) };
    }
    return null;
  }
  toScreen(p: Point): Point {
    if(this.keyboard)return this.keyboard.screen(p);
    const gx = clamp(p.x, 0, 0.9999) * GRID, gy = clamp(p.y, 0, 0.9999) * GRID;
    const i = Math.floor(gy) * (GRID + 1) + Math.floor(gx), fx = gx % 1, fy = gy % 1;
    const ids = fx + fy <= 1 ? [i, i + 1, i + GRID + 1] : [i + 1, i + GRID + 2, i + GRID + 1];
    const verts = ids.map(n => this.vertices[n]);
    const weights = barycentric(p, ...verts.map(v => ({ x: v.u, y: v.v })) as [Point, Point, Point]) ?? [1, 0, 0];
    return { x: this.left + verts.reduce((sum, v, n) => sum + v.x * weights[n], 0) * this.drawSize,
      y: this.top + verts.reduce((sum, v, n) => sum + v.y * weights[n], 0) * this.drawSize };
  }
  handleEvent(event: MaterialEvent): void {
    if(this.keyboard){this.keyboard.event(event);return;}
    if(event.type==='press' && this.authoredDamage) {
      if(!this.waxPieces.length) {
        this.waxPieces=makeWaxPieces();
        for(const piece of this.waxPieces)piece.strength*=this.shellStrength;
        // Measure visible material, excluding transparent margins and holes.
        for(const piece of this.waxPieces) {
          let samples=0;
          for(let y=.5/64;y<1;y+=1/64)for(let x=.5/64;x<1;x+=1/64)
            if(this.isSolid(x,y) && insideWax({x,y},piece.polygon))samples++;
          piece.area=samples/(64*64);
        }
      }
      this.peeledArea=0;
      this.pressForce=-1;this.pressurePoint={x:event.x,y:event.y};
      this.stressWax(event.intensity);
    }
    if(event.type==='release') {
      // Keep 95% of the visible, fold-checked pose, including intact-shell presses.
      if(this.renderedPress===this.model.pressCount) this.vertices.forEach((v,i)=>{
        this.model.residualX[i]+=(v.x-v.u-this.model.residualX[i])*.95;
        this.model.residualY[i]+=(v.y-v.v-this.model.residualY[i])*.95;
        this.model.residualH[i]+=(v.h-this.model.residualH[i])*.95;
      });
      this.stressWax(event.intensity); this.pressurePoint=null;
    }
    if (!this.authoredDamage && event.segments?.length) {
      this.fractures.push({ segments: event.segments, x: event.x, y: event.y, age: 0, spread: 0 });
    }
    if (event.type === 'shell_break' && event.cells?.length) {
      for (const f of this.fractures) if (Math.hypot(f.x - event.x, f.y - event.y) < RADIUS) f.spread = Math.max(f.spread, 0.18);
      if (!this.reducedMotion) {
        const count = Math.min(2, event.cells.length, 18 - this.shards.length);
        for (let n = 0; n < count; n++) {
          const p = this.model.cellPoint(event.cells[n % event.cells.length]);
          const side = n % 2 ? 1 : -1;
          this.shards.push({ ...p, pan: event.pan, vx: side * (.14 + n * .025), vy: -.24 - n * .025,
            size: .025 + n % 3 * .009, angle: n * .7, spin: side * (3.4 + n * .25), age: 0, landed: false, sourceX: p.x, sourceY: p.y });
        }

      }
    }
    this.dirty = true;
  }
  private stressWax(force:number):void {
    if(!this.pressurePoint || force<=this.pressForce)return;
    this.peeledArea=stressWaxPieces(this.waxPieces,this.pressurePoint,force,this.pressForce,this.peeledArea);
    this.pressForce=force;this.dirty=true;
  }
  private advancePeeling(dt:number):void {
    const mask=context(this.peelLayer);
    for(const piece of this.waxPieces) {
      piece.age+=dt;
      if(piece.state!==1 || (!this.reducedMotion && piece.age<piece.delay))continue;
      piece.state=2;
      this.polygonPath(mask,piece.polygon);mask.fillStyle='#fff';mask.fill();
      mask.strokeStyle='#fff';mask.lineWidth=1;mask.lineJoin='miter';mask.stroke();
      if(!this.reducedMotion && this.shards.length<40) {
        const p=this.toScreen(piece.center),polygon=piece.polygon.map(v=>({x:v.x-piece.center.x,y:v.y-piece.center.y}));
        const size=Math.max(...polygon.map(v=>Math.max(Math.abs(v.x),Math.abs(v.y))));
        this.shards.push({x:(p.x-this.left)/this.drawSize,y:(p.y-this.top)/this.drawSize,pan:0,
          vx:(piece.center.x-.5)*.4,vy:-.12,size,polygon,angle:0,spin:piece.center.x<.5?-1.5:1.5,age:0,landed:false,sourceX:piece.center.x,sourceY:piece.center.y});
      }

      this.dirty=true;
    }
  }
  private polygonPath(ctx:CanvasRenderingContext2D, polygon:Point[]):void {
    ctx.beginPath();polygon.forEach((p,i)=>i?ctx.lineTo(p.x*SIZE,p.y*SIZE):ctx.moveTo(p.x*SIZE,p.y*SIZE));ctx.closePath();
  }
  private stroke(ctx: CanvasRenderingContext2D, segment: Crack, t = 1): void {
    const { a, b, width } = segment;
    const end = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const dx = end.x - a.x, dy = end.y - a.y;
    const bend = Math.sin((a.x * 83 + a.y * 47 + b.x * 29) * Math.PI) * 0.12;
    const control = { x: (a.x + end.x) / 2 - dy * bend, y: (a.y + end.y) / 2 + dx * bend };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(a.x * SIZE, a.y * SIZE); ctx.quadraticCurveTo(control.x * SIZE, control.y * SIZE, end.x * SIZE, end.y * SIZE);
    ctx.save(); ctx.shadowColor = 'rgba(20,10,7,.65)'; ctx.shadowBlur = 1.5; ctx.shadowOffsetY = 1;
    ctx.strokeStyle = 'rgba(42,20,13,.88)'; ctx.lineWidth = width * SIZE; ctx.stroke(); ctx.restore();
    ctx.strokeStyle = 'rgba(244,205,164,.38)'; ctx.lineWidth = Math.max(0.45, width * SIZE * 0.24); ctx.stroke();
  }
  private shadeCore(): void {
    if(!this.corePixels) return;
    const pixels=this.corePixels, size=pixels.width, stride=GRID+1;
    const slopes=this.vertices.map((_,i)=>{
      const x=i%stride,y=Math.floor(i/stride);
      const l=this.vertices[y*stride+Math.max(0,x-1)],r=this.vertices[y*stride+Math.min(GRID,x+1)];
      const t=this.vertices[Math.max(0,y-1)*stride+x],b=this.vertices[Math.min(GRID,y+1)*stride+x];
      const ux=r.x-l.x,uy=r.y-l.y,vx=b.x-t.x,vy=b.y-t.y;
      const det=ux*vy-uy*vx,du=r.h-l.h,dv=b.h-t.h;
      return Math.abs(det)>1e-6?[(du*vy-dv*uy)/det,(dv*ux-du*vx)/det]:[0,0];
    });
    // ponytail: a front-surface height field; true overhangs require a volumetric mesh.
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
      const u=x/(size-1),v=y/(size-1),gx=Math.min(GRID-.00001,u*GRID),gy=Math.min(GRID-.00001,v*GRID);
      const ix=Math.floor(gx),iy=Math.floor(gy),fx=gx-ix,fy=gy-iy,i=iy*stride+ix;
      const a=slopes[i],b=slopes[i+1],c=slopes[i+stride],d=slopes[i+stride+1];
      const dx=(a[0]*(1-fx)+b[0]*fx)*(1-fy)+(c[0]*(1-fx)+d[0]*fx)*fy;
      const dy=(a[1]*(1-fx)+b[1]*fx)*(1-fy)+(c[1]*(1-fx)+d[1]*fx)*fy;
      const nx=(u-.5)/.44,ny=(v-.49)/.46,nz=Math.sqrt(Math.max(.12,1-nx*nx-ny*ny));
      const sx=nx-dx*1.6,sy=ny-dy*1.6,length=Math.hypot(sx,sy,nz);
      const lx=sx/length,ly=sy/length,lz=nz/length;
      const diffuse=Math.max(0,-lx*.36-ly*.48+lz*.8);
      const spec=Math.pow(Math.max(0,-lx*.2-ly*.27+lz*.94),this.granular?32:22)*this.coreGloss;
      const noise=(Math.sin(x*127.1+y*311.7)*43758.5453)%1;
      const factor=.76+.24*diffuse+noise*(this.granular?.035:.008);
      const at=(y*size+x)*4;
      for(let c=0;c<3;c++) pixels.data[at+c]=this.coreColor[c]*Math.min(1,factor)*(1-spec)+248*spec;
      pixels.data[at+3]=255;
    }
    context(this.soft).putImageData(pixels,0,0);
  }
  private compose(): void {
    const surface = context(this.surface), shell = context(this.shellLayer);
    this.shadeCore();
    surface.clearRect(0, 0, SIZE, SIZE); surface.drawImage(this.soft, 0, 0, SIZE, SIZE);
    const mask = context(this.openings);
    mask.clearRect(0,0,SIZE,SIZE);
    mask.strokeStyle = '#fff'; mask.fillStyle = '#fff'; mask.lineCap = 'round'; mask.lineJoin = 'round';
    for (const f of this.fractures) {
      for (const [index, s] of f.segments.entries()) {
        const t = clamp((f.age - index * .015) / .07);
        mask.lineWidth = (s.width * (1 + f.spread * 13)) * SIZE;
        mask.beginPath(); mask.moveTo(s.a.x*SIZE,s.a.y*SIZE);
        mask.lineTo((s.a.x+(s.b.x-s.a.x)*t)*SIZE,(s.a.y+(s.b.y-s.a.y)*t)*SIZE); mask.stroke();
      }
      if (f.spread > .1) {
        // One union mask: overlapping presses cannot leave interior rim outlines.
        mask.beginPath();
        for (let n=0;n<15;n++) {
          const a=n/15*Math.PI*2, r=(.035+f.spread*.09)*(1+.24*Math.sin(n*2.7+f.x*17));
          const x=(f.x+Math.cos(a)*r)*SIZE,y=(f.y+Math.sin(a)*r*.85)*SIZE;
          if(!n) mask.moveTo(x,y); else mask.lineTo(x,y);
        }
        mask.closePath(); mask.fill();
      }
    }
    if(this.authoredDamage)for(const piece of this.waxPieces) {
      if(piece.damage<.12 || piece.state===2)continue;
      this.polygonPath(mask,piece.polygon);
      mask.lineJoin='miter';mask.miterLimit=2;
      mask.lineWidth=.4+Math.min(piece.damage,1)*1.8;mask.stroke();
      if(piece.damage>.65)mask.fill();
    }
    mask.drawImage(this.peelLayer,0,0);
    shell.clearRect(0, 0, SIZE, SIZE);
    shell.drawImage(this.shell, 0, 0);
    shell.globalCompositeOperation = 'destination-in'; shell.drawImage(this.shell, 0, 0);
    shell.globalCompositeOperation = 'destination-out'; shell.drawImage(this.openings, 0, 0);
    shell.globalCompositeOperation = 'source-over';
    shell.globalCompositeOperation = 'destination-in'; shell.drawImage(this.shell, 0, 0); shell.globalCompositeOperation = 'source-over';
    // Continuous wax cross-section at every exposed seam, underneath the glossy face.
    const wall=context(this.plate);wall.clearRect(0,0,SIZE,SIZE);wall.drawImage(this.shellLayer,0,0);
    wall.globalCompositeOperation='source-in';wall.fillStyle='#d9ae8c';wall.fillRect(0,0,SIZE,SIZE);wall.globalCompositeOperation='source-over';
    surface.save();surface.shadowColor='rgba(100,61,34,.2)';surface.shadowBlur=2;
    surface.shadowOffsetX=1;surface.shadowOffsetY=2;
    surface.drawImage(this.plate,0,2.4);surface.restore();
    surface.drawImage(this.shellLayer, 0, 0);
    // Hinged wax plate: separate projected upper/lower faces give a visible fracture wall.
    for(const piece of this.waxPieces) {
      if(piece.damage<=.65 || piece.state===2)continue;
      const mark={x:piece.center.x,y:piece.center.y,scale:1,hits:piece.damage*2,age:piece.age};
      const points=piece.polygon.map(p=>[p.x-mark.x,p.y-mark.y]);
      const pc=context(this.plate); pc.clearRect(0,0,SIZE,SIZE);
      pc.save(); this.polygonPath(pc,piece.polygon); pc.clip(); pc.drawImage(this.shell,0,0); pc.restore();
      const angle=(.24+Math.min(mark.hits,3)*.14)*(this.reducedMotion?1:1-Math.exp(-mark.age/.055));
      const hinge=(mark.y+Math.max(...points.map(p=>p[1]))*mark.scale)*SIZE;
      const top=(mark.y+Math.min(...points.map(p=>p[1]))*mark.scale)*SIZE;
      const span=hinge-top,curl=angle*.5,rise=Math.sin(angle)*span*.3,thickness=2.4;
      const project=(y:number)=>bendWax(y,hinge,span,curl);
      const face=piece.polygon.map(p=>({x:p.x*SIZE,y:project(p.y*SIZE)}));
      const path=(vertices:Point[])=>{surface.beginPath();vertices.forEach((p,i)=>i?surface.lineTo(p.x,p.y):surface.moveTo(p.x,p.y));surface.closePath();};
      surface.save();
      // Warm area-light shadow falls away from the upper-left light; bounded opacity.
      surface.shadowColor='rgba(103,62,36,.25)'; surface.shadowBlur=3+rise*.5;
      surface.shadowOffsetX=rise*.45; surface.shadowOffsetY=rise*.75+thickness;
      path(face);surface.fillStyle='#d6a380';surface.fill();surface.restore();
      for(let i=0;i<face.length;i++) {
        const a=face[i],b=face[(i+1)%face.length];
        const brightness=clamp((b.x-a.x)/Math.max(1,Math.hypot(b.x-a.x,b.y-a.y))*.5+.5);
        path([a,b,{x:b.x,y:b.y+thickness},{x:a.x,y:a.y+thickness}]);
        surface.fillStyle=`rgb(${210+brightness*29} ${163+brightness*38} ${130+brightness*41})`;surface.fill();
      }
      surface.save();path(face);surface.clip();
      // Bend the original texture with the face, rather than translating a flat sticker.
      for(let y=Math.max(0,Math.floor(top));y<Math.min(SIZE,hinge);y+=2) {
        const end=Math.min(y+2,hinge),py=project(y),height=project(end)-py;
        surface.drawImage(this.plate,0,y,SIZE,end-y,0,py,SIZE,height+.3);
        const sheen=.09*curl*(hinge-y)/Math.max(1,span);
        surface.fillStyle=`rgba(255,236,211,${sheen})`;surface.fillRect(0,py,SIZE,height+.3);
      }
      surface.restore();
      // Only the lit fracture rim catches light, not an opaque white ring around the plate.
      for(let i=0;i<face.length;i++) {
        const a=face[i],b=face[(i+1)%face.length];
        surface.beginPath();surface.moveTo(a.x,a.y);surface.lineTo(b.x,b.y);
        surface.strokeStyle=b.x>a.x?'rgba(255,228,194,.8)':'rgba(173,117,83,.35)';
        surface.lineWidth=.7;surface.stroke();
      }
    }

    // Height-gradient-inspired shading is local and deforms with the same UV mesh.
    surface.globalCompositeOperation = 'destination-in'; surface.drawImage(this.shell, 0, 0); surface.globalCompositeOperation = 'source-over';
  }
  update(dt: number): void {
    if(this.keyboard){if(this.model.contact)this.keyboard.press(this.model.contact.force);else this.keyboard.stop();this.keyboard.draw(this.ctx,dt,this.dpr);return;}
    if (!this.ready) { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); return; }
    dt = clamp(dt, 0, 0.2);
    const contact = this.model.contact;
    if(contact)this.renderedPress=this.model.pressCount;
    if(contact)this.stressWax(contact.peakForce);
    else this.pressurePoint=null;
    this.advancePeeling(dt);
    if(this.waxPieces.some(p=>p.damage>0 && p.age<.4))this.dirty=true;
    for (const f of this.fractures) {
      f.age += dt;
      if (contact?.soft && Math.hypot(f.x-contact.x,f.y-contact.y)<RADIUS) {
        f.spread = Math.min(1.6, f.spread + dt * .48);
        this.dirty = true;
      }
      if (f.age < .6) this.dirty = true;
    }
    let moving = false;
    const previous = this.vertices.map(v => ({ x: v.x, y: v.y, h: v.h }));
    for (let i = 0; i < this.vertices.length; i++) {
      const v = this.vertices[i];
      let tx = v.u + this.model.residualX[i], ty = v.v + this.model.residualY[i], th = this.model.residualH[i];
      if (contact) {
        const w = influence(Math.hypot(v.u - contact.x, v.v - contact.y), .48);
        const softness = contact.soft ? 1 : this.model.damage[this.model.cellAt(v.u, v.v)] * 0.25;
        const amplitude = (0.018 + softness * 0.024 * this.model.compliance) * (0.5 + contact.force);
        const cx=.5-contact.x, cy=.48-contact.y, side=Math.hypot(cx,cy);
        const pushX=side>.08?cx/side:0, pushY=side>.08?cy/side:.75;
        const dx=pushX*amplitude+contact.dragX, dy=pushY*amplitude+contact.dragY;
        const length=Math.hypot(dx,dy), amount=length ? .095*Math.tanh(length/.095)/length : 1;
        tx += dx*amount*w; ty += dy*amount*w;
        th -= amplitude * influence(Math.hypot(v.u-contact.x,v.v-contact.y),RADIUS*.88);
      }
      const alpha = 1 - Math.exp(-dt / (contact ? 0.035 : 0.3));
      v.x += (tx - v.x) * alpha; v.y += (ty - v.y) * alpha; v.h += (th - v.h) * alpha;
      if (Math.hypot(v.x - previous[i].x, v.y - previous[i].y, v.h - previous[i].h) > 0.000008) moving = true;
    }
    // Reject folds for residual and active displacement alike.
    for (let attempt = 0; attempt < 10; attempt++) {
      const folded = this.triangles.some(([i, j, k]) => {
        const a = this.vertices[i], b = this.vertices[j], c = this.vertices[k];
        return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0.05 / (GRID * GRID);
      });
      if (!folded) break;
      this.vertices.forEach((v, i) => { v.x = (v.x + previous[i].x) / 2; v.y = (v.y + previous[i].y) / 2; });
    }
    const crackContext = context(this.cracks);
    for (const p of this.pending) { p.age += dt; if (p.age >= 0.08) this.stroke(crackContext, p.segment); }
    const hadPending = this.pending.length > 0;
    this.pending = this.pending.filter(p => p.age < 0.08);
    let impact: Shard | null = null;
    for (const shard of this.shards) {
      shard.age += dt;
      if (!shard.landed) {
        shard.vy += dt * 1.5; shard.x += shard.vx * dt; shard.y += shard.vy * dt; shard.angle += shard.spin * dt;
        if (shard.y >= 0.93) { shard.y = 0.93; shard.landed = true; impact = shard; }
      }
    }
    this.impactCooldown=Math.max(0,this.impactCooldown-dt);
    if (impact && this.impactCooldown===0) {this.model.fragment(impact, 0.22);this.impactCooldown=.14;}
    const hadShards = this.shards.length > 0; this.shards = this.shards.filter(s => s.age < 2.4);
    if (moving || hadPending || hadShards || this.dirty || this.observedRevision !== this.model.revision) {
      this.compose(); this.render(); this.dirty = false; this.observedRevision = this.model.revision;
    }
  }
  private render(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, this.width, this.height);
    ctx.save(); ctx.translate(this.left, this.top); ctx.scale(this.drawSize, this.drawSize);
    const visible=this.vertices.filter(v=>this.isSolid(v.u,v.v));
    if(visible.length) {
      const minX=Math.min(...visible.map(v=>v.x)),maxX=Math.max(...visible.map(v=>v.x)),bottom=Math.max(...visible.map(v=>v.y));
      ctx.save();ctx.translate((minX+maxX)/2,bottom-.004);ctx.scale((maxX-minX)*.52,.036);
      const shadow=ctx.createRadialGradient(0,0,.04,0,0,1);
      shadow.addColorStop(0,'rgba(88,53,29,.26)');shadow.addColorStop(.55,'rgba(88,53,29,.13)');shadow.addColorStop(1,'rgba(88,53,29,0)');
      ctx.fillStyle=shadow;ctx.fillRect(-1,-1,2,2);ctx.restore();
    }
    for (const [i, j, k] of this.renderTriangles) {
      const a = this.vertices[i], b = this.vertices[j], c = this.vertices[k];
      const [pa,pb,pc]=overscanTriangle([a,b,c],.75/this.drawSize);
      ctx.save(); ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.lineTo(pc.x, pc.y); ctx.closePath(); ctx.clip();
      const sx1 = (b.u - a.u) * SIZE, sy1 = (b.v - a.v) * SIZE, sx2 = (c.u - a.u) * SIZE, sy2 = (c.v - a.v) * SIZE;
      const det = sx1 * sy2 - sx2 * sy1;
      const m11 = ((b.x - a.x) * sy2 - (c.x - a.x) * sy1) / det;
      const m12 = ((b.y - a.y) * sy2 - (c.y - a.y) * sy1) / det;
      const m21 = ((c.x - a.x) * sx1 - (b.x - a.x) * sx2) / det;
      const m22 = ((c.y - a.y) * sx1 - (b.y - a.y) * sx2) / det;
      ctx.transform(m11, m12, m21, m22, a.x - m11 * a.u * SIZE - m21 * a.v * SIZE, a.y - m12 * a.u * SIZE - m22 * a.v * SIZE);
      ctx.drawImage(this.surface, 0, 0); ctx.restore();
    }
    for (const shard of this.shards) {
      ctx.save(); ctx.translate(shard.x, shard.y); ctx.globalAlpha = clamp((2.4 - shard.age) / 0.5);
      const tilt=shard.landed?.32:.3+.7*Math.abs(Math.cos(shard.age*5+shard.angle));
      // Project onto the table AFTER in-plane rotation: landed flakes stay flat.
      ctx.scale(1,tilt);ctx.rotate(shard.angle);
      const points=shard.polygon??[[-1,-.7],[1,-1],[.5,1],[-.7,.5]].map(([x,y])=>({x:x*shard.size,y:y*shard.size}));
      ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();
      // Edge polygons extend beyond the toy; only the source image has the true shell silhouette.
      ctx.save();ctx.clip();
      ctx.drawImage(this.shell, (shard.sourceX - shard.size) * SIZE, (shard.sourceY - shard.size) * SIZE, shard.size * 2 * SIZE, shard.size * 2 * SIZE, -shard.size, -shard.size, shard.size * 2, shard.size * 2);
      ctx.restore();
      ctx.restore();
    }
    ctx.restore();
    if(this.model.contact) {
      const contact=this.model.contact,p=this.toScreen(contact),force=contact.force;
      ctx.beginPath();ctx.arc(p.x,p.y,19,-Math.PI/2,-Math.PI/2+Math.PI*2*force);
      ctx.strokeStyle='rgba(122,79,49,.75)';ctx.lineWidth=2.5;ctx.stroke();
      ctx.font='12px sans-serif';ctx.fillStyle='#76503c';ctx.fillText(force<.35?'轻按':force<.7?'按压':'重按',p.x+24,p.y-16);
    }
    if (this.keyboardPoint) {
      const p = this.toScreen(this.keyboardPoint);
      ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.strokeStyle = '#76503c'; ctx.lineWidth = 2; ctx.stroke();
    }
  }
  exportState(): SquishySnapshot {
    const m = this.model;
    return { version: 1, pressCount: m.pressCount,
      ...(this.keyboard ? {keys:JSON.parse(JSON.stringify(this.keyboard.states))}:{}),
      damage: Array.from(m.damage), opened: Array.from(m.opened),
      residualX: Array.from(m.residualX), residualY: Array.from(m.residualY), residualH: Array.from(m.residualH),
      // Save the final resting state, not particles or an in-flight peel animation.
      wax: this.waxPieces.map(p => ({ damage: p.damage, state: p.state === 0 ? 0 : 2, area: p.area })),
    };
  }
  restoreState(state: SquishySnapshot): void {
    const pieces = makeWaxPieces();
    if (!validSnapshot(state) || (state.wax.length !== 0 && state.wax.length !== pieces.length)) throw new Error('收藏状态无法恢复');
    this.model.reset(); this.clear();
    if(this.keyboard && state.keys)this.keyboard.restore(state.keys);
    const m = this.model;
    m.pressCount = state.pressCount;
    m.damage.set(state.damage); m.opened.set(state.opened);
    m.residualX.set(state.residualX); m.residualY.set(state.residualY); m.residualH.set(state.residualH);
    this.vertices.forEach((v,i) => { v.x=v.u+m.residualX[i]; v.y=v.v+m.residualY[i]; v.h=m.residualH[i]; });
    this.waxPieces = state.wax.map((p,i) => ({ ...pieces[i], ...p, strength: pieces[i].strength*this.shellStrength, age: 1, delay: 0 }));
    const mask=context(this.peelLayer);
    for (const p of this.waxPieces) if (p.state === 2) {
      this.polygonPath(mask,p.polygon); mask.fillStyle='#fff'; mask.fill();
      mask.strokeStyle='#fff'; mask.lineWidth=1; mask.lineJoin='miter'; mask.stroke();
    }
    this.dirty = true;
  }
  refresh(): void { this.dirty = true; }
  clear(): void {
    this.keyboard?.reset();
    for (const canvas of [this.cracks, this.openings, this.peelLayer]) context(canvas).clearRect(0, 0, SIZE, SIZE);
    this.peeledArea=0;this.impactCooldown=0;this.renderedPress=-1;this.fractures=[];this.waxPieces=[];this.pressForce=-1;this.pressurePoint=null;
    this.vertices.forEach(v => { v.x = v.u; v.y = v.v; v.h = 0; });
    this.pending = []; this.shards = []; this.dirty = true;
  }
  dispose(): void { this.disposed = true; this.version++; window.removeEventListener('resize', this.resize); }
}
