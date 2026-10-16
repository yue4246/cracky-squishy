import type { Point } from '../core/SquishyStateMachine';

function clip(polygon:Point[],nx:number,ny:number,d:number):Point[] {
  const result:Point[]=[];
  for(let i=0;i<polygon.length;i++) {
    const a=polygon[i],b=polygon[(i+1)%polygon.length],da=a.x*nx+a.y*ny-d,db=b.x*nx+b.y*ny-d;
    if(da<=1e-9) result.push(a);
    if((da<0)!==(db<0)) {const t=da/(da-db);result.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}
  }
  return result;
}
export function shellPolygons(outline:Point[], count=43):{center:Point;polygon:Point[]}[] {
  const sites:Point[]=[];
  // Unequal, non-lattice pieces; keep the seed stable so repeat presses share fractures.
  let seed=721;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<300 && sites.length<count;i++) {
    const p={x:.04+random()*.92,y:.04+random()*.92};
    if(sites.every(q=>Math.hypot(q.x-p.x,q.y-p.y)>(count===43?.065:.045)))sites.push(p);
  }
  const cells=[];
  for(const site of sites) {
    let polygon=outline.slice();
    for(const other of sites) {
      if(other===site) continue;
      polygon=clip(polygon,other.x-site.x,other.y-site.y,(other.x**2+other.y**2-site.x**2-site.y**2)/2);
      if(polygon.length<3) break;
    }
    if(polygon.length<3) continue;
    const center=polygon.reduce((p,v)=>({x:p.x+v.x/polygon.length,y:p.y+v.y/polygon.length}),{x:0,y:0});
    cells.push({center,polygon});
  }
  return cells;
}
