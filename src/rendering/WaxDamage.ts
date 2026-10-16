import { shellPolygons } from './WaxTopology';
import type { Point } from '../core/SquishyStateMachine';
export interface WaxPiece { center:Point; polygon:Point[]; damage:number; strength:number; area:number; state:0|1|2; age:number; delay:number }
// A stable partition: adjacent flakes share straight fracture edges. Only loaded
// pieces become visible as cracks; the intact image never shows a polygon grid.
export function makeWaxPieces(count=64):WaxPiece[] {
  return shellPolygons([{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],count).map((cell,i)=>({
    ...cell,area:Math.abs(cell.polygon.reduce((sum,p,i)=>{const q=cell.polygon[(i+1)%cell.polygon.length];return sum+p.x*q.y-q.x*p.y;},0))/2,damage:0,strength:.8+(i%7)*.07,state:0,age:0,delay:0,
  }));
}
export function insideWax(p:Point, polygon:Point[]):boolean {
  return polygon.every((a,i)=>{const b=polygon[(i+1)%polygon.length];return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)>=-1e-9;});
}

export function stressWaxPieces(pieces:WaxPiece[],hit:Point,force:number,previousForce:number,peeledArea:number):number {
    const primary=pieces.find(p=>insideWax(hit,p.polygon));
    // One bounded load per gesture. Increasing pressure adds only the difference;
    // holding still never keeps damaging the shell. Bare-core presses have less leverage.
    const gain=(previousForce<0?.55:0)+2.0*(force-Math.max(0,previousForce));
    const radius=.25+.20*force,leverage=primary?.state===2?.6:1;
    const total=pieces.reduce((sum,p)=>sum+p.area,0);
    const shed=pieces.reduce((sum,p)=>sum+(p.state!==0?p.area:0),0);
    // A generous first fracture, then smaller local flakes; never clear by press count.
    const budget=total*(shed-peeledArea<.001 ? .23+.10*force : .065+.035*force);
    let queued=0;
    const nearest=[...pieces].sort((a,b)=>Math.hypot(a.center.x-hit.x,a.center.y-hit.y)-Math.hypot(b.center.x-hit.x,b.center.y-hit.y));
    for(const piece of nearest) {
      if(piece.state!==0 || !piece.area)continue;
      const d=Math.hypot(piece.center.x-hit.x,piece.center.y-hit.y);
      const weight=piece===primary?1:Math.sqrt(Math.max(0,1-d/radius));
      if(!weight)continue;
      piece.damage+=gain*weight*leverage;piece.age=0;
      // Cracked edges loosen nearby remaining flakes; no global count-based clearing.
      const loose=pieces.some(p=>p!==piece && p.state!==0 && Math.hypot(p.center.x-piece.center.x,p.center.y-piece.center.y)<.18);
      if(piece.damage>=piece.strength*(loose?.65:1) && peeledArea+piece.area<=budget) {peeledArea+=piece.area;piece.state=1;piece.delay=.08+queued++*.055;}
    }
    return peeledArea;
}
