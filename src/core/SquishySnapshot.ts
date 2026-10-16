import { KEY_LAYOUT, type KeyState } from '../rendering/KeyboardToy';
import { GRID, clamp } from './SquishyStateMachine';

export interface SquishySnapshot {
  version: 1;
  keys?: KeyState[];
  pressCount: number;
  damage: number[];
  opened: number[];
  residualX: number[];
  residualY: number[];
  residualH: number[];
  wax: { damage: number; state: 0 | 2; area: number }[];
}
const field = (v: unknown, size: number, low: number, high: number): v is number[] =>
  Array.isArray(v) && v.length === size && v.every(n => typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high);
export function validSnapshot(value: unknown): value is SquishySnapshot {
  const s = value as SquishySnapshot | null;
  return !!s && (s.keys === undefined || (Array.isArray(s.keys) && s.keys.length===KEY_LAYOUT.length && s.keys.every(k=>k && Number.isFinite(k.damage) && k.damage>=0 && k.damage<=1 && Number.isFinite(k.depth) && k.depth>=0 && k.depth<=.8 && (k.wax===undefined || Array.isArray(k.wax) && [17,23,64].includes(k.wax.length) && k.wax.every(p=>p && Number.isFinite(p.damage) && p.damage>=0 && p.damage<=100 && [0,1,2].includes(p.state)))))) && s.version === 1 && Number.isSafeInteger(s.pressCount) && s.pressCount >= 0
    && field(s.damage, GRID * GRID, 0, 1) && field(s.opened, GRID * GRID, 0, 1) && s.opened.every(n => n === 0 || n === 1)
    && field(s.residualX, (GRID+1)**2, -1, 1) && field(s.residualY, (GRID+1)**2, -1, 1)
    && field(s.residualH, (GRID+1)**2, -1, 1) && Array.isArray(s.wax) && s.wax.length <= 128
    && s.wax.every(p => p && Number.isFinite(p.damage) && p.damage >= 0 && p.damage <= 100
      && (p.state === 0 || p.state === 2) && Number.isFinite(p.area) && p.area >= 0 && p.area <= 1);
}
export function snapshotStats(state: SquishySnapshot) {
  const area = state.wax.reduce((sum, p) => sum + p.area, 0);
  return {
    pressCount: state.pressCount,
    damageLevel: state.keys ? Math.round(100*state.keys.reduce((n,k)=>n+k.damage,0)/state.keys.length) : area ? Math.round(100 * state.wax.reduce((sum,p) => sum + p.area * (p.state === 2 ? 1 : clamp(p.damage)), 0) / area) : 0,
    deformationLevel: state.keys ? Math.round(100*Math.max(...state.keys.map(k=>k.depth))) : Math.round(100 * clamp(Math.max(...state.residualH.map((h,i) => Math.hypot(h,state.residualX[i],state.residualY[i]))) / .2)),
  };
}
