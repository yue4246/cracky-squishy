import { shellPolygons } from './WaxTopology';
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, GRID, influence, type Point, type SquishyStateMachine } from '../core/SquishyStateMachine';

export const TOY_SCALE = 2.8;
export const WAX_THICKNESS = .018;
export type Outline = Point[];

// The single-character silhouette is star shaped around its body center.
export function radiusAt(outline:Outline, angle:number):number {
  const t=((angle/(Math.PI*2))%1+1)%1*outline.length,i=Math.floor(t),f=t-i;
  const a=outline[i],b=outline[(i+1)%outline.length];
  return Math.hypot(a.x-.5,a.y-.5)*(1-f)+Math.hypot(b.x-.5,b.y-.5)*f;
}
export function surfacePoint(outline:Outline,u:number,v:number,back=false):THREE.Vector3 {
  const dx=u-.5,dy=v-.5,r=Math.hypot(dx,dy)/Math.max(.01,radiusAt(outline,Math.atan2(dy,dx)));
  // Ears must not project radial ridges across the forehead. The central dome
  // is smooth in XY; only its outer band follows the character silhouette.
  const edge=clamp((r-.72)/.28),taper=1-edge*edge*(3-2*edge);
  const depth=Math.sqrt(Math.max(0,1-(dx*dx+dy*dy)/(.48*.48)))*Math.sqrt(taper);
  return new THREE.Vector3(dx*TOY_SCALE,-dy*TOY_SCALE,depth*(back?-.36:.58));
}
export function sampleField(field:Float32Array,u:number,v:number):number {
  const gx=clamp(u,0,.999999)*GRID,gy=clamp(v,0,.999999)*GRID,x=Math.floor(gx),y=Math.floor(gy),fx=gx-x,fy=gy-y,i=y*(GRID+1)+x;
  return (field[i]*(1-fx)+field[i+1]*fx)*(1-fy)+(field[i+GRID+1]*(1-fx)+field[i+GRID+2]*fx)*fy;
}
export function deformPoint(base:THREE.Vector3,u:number,v:number,model:SquishyStateMachine,back=false):THREE.Vector3 {
  const point=base.clone();
  point.x+=sampleField(model.residualX,u,v)*TOY_SCALE;
  point.y-=sampleField(model.residualY,u,v)*TOY_SCALE;
  if(!back) point.z+=sampleField(model.residualH,u,v)*1.8;
  const contact=model.contact;
  if(contact) {
    const distance=Math.hypot(u-contact.x,v-contact.y),w=influence(distance,.34);
    point.x+=contact.dragX*TOY_SCALE*w*.45;
    point.y-=contact.dragY*TOY_SCALE*w*.45;
    if(!back) point.z-=(.025+contact.force*.045)*influence(distance,.21);
  }
  // Front/back separation is retained even at the thinnest rim.
  if(!back) point.z=Math.max(base.z*.12,point.z);
  return point;
}
/** A persistent opening front: three unequal stress paths, then broader separation.
 * ponytail: propagates across existing shell topology; it does not remesh fractures.
 */
export function fractureOpening(origin:Point,u:number,v:number,damage:number):number {
  if(damage<=0)return 0;
  const dx=u-origin.x,dy=v-origin.y,distance=Math.hypot(dx,dy);
  const angle=Math.atan2(dy,dx),phase=origin.x*7+origin.y*11;
  const branch=Math.max(0,Math.cos(angle*3+phase))**4;
  const reach=.035+damage*(.17+.19*branch);
  const edge=clamp((reach-distance)/.055);
  return damage*edge*edge*(3-2*edge);
}
export function coreGeometry(outline:Outline,rings=32):THREE.BufferGeometry {
  const positions:number[]=[],uv:number[]=[],indices:number[]=[],backFlags:number[]=[];
  const count=outline.length;
  for(let side=0;side<2;side++) for(let ring=0;ring<=rings;ring++) for(let a=0;a<count;a++) {
    const r=ring/rings,u=.5+(outline[a].x-.5)*r,v=.5+(outline[a].y-.5)*r,p=surfacePoint(outline,u,v,!!side);
    positions.push(p.x,p.y,p.z);uv.push(u,v);backFlags.push(side);
  }
  const stride=(rings+1)*count;
  for(let side=0;side<2;side++) for(let r=0;r<rings;r++) for(let a=0;a<count;a++) {
    const i=side*stride+r*count+a,j=side*stride+r*count+(a+1)%count,k=i+count,l=j+count;
    if(side) indices.push(i,k,j,j,k,l); else indices.push(i,j,k,j,l,k);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setAttribute('back',new THREE.Float32BufferAttribute(backFlags,1));
  geometry.setIndex(indices);
  const welded=mergeVertices(geometry,1e-5);geometry.dispose();welded.computeVertexNormals();return welded;
}

export function shellCells(outline:Outline):{center:Point;polygon:Point[]}[] {
  const cells=[];
  for(const {center,polygon} of shellPolygons(outline)) {
    const fractured:Point[]=[];
    for(let i=0;i<polygon.length;i++) {
      const a=polygon[i],b=polygon[(i+1)%polygon.length];
      // Both neighbouring pieces use the same edge orientation and points: no holes or overlap.
      const forward=a.x<b.x-1e-8 || (Math.abs(a.x-b.x)<1e-8 && a.y<b.y);
      const start=forward?a:b,end=forward?b:a,dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy);
      const boundary=[a,b].every(p=>Math.abs(Math.hypot(p.x-.5,p.y-.5)-radiusAt(outline,Math.atan2(p.y-.5,p.x-.5)))<.0001);
      const steps=boundary?1:Math.max(2,Math.ceil(length/.012));
      for(let j=0;j<steps;j++) {
        const t=forward?j/steps:1-j/steps;
        const phase=Math.round((start.x+start.y*3+end.x*7)*1000);
        const offset=boundary?0:Math.sin(Math.PI*t)*(Math.min(.014,length*.13)*Math.sin(t*6+phase)+.002*Math.sin(t*27+phase));
        fractured.push({x:start.x+dx*t-dy/(length||1)*offset,y:start.y+dy*t+dx/(length||1)*offset});
      }
    }
    cells.push({center,polygon:fractured});
  }
  return cells;
}
export function shellGeometry(outline:Outline,polygon:Point[]):THREE.BufferGeometry {
  const positions:number[]=[],uv:number[]=[],indices:number[]=[];
  const vertex=(p:Point,under=false)=>{const s=surfacePoint(outline,p.x,p.y);positions.push(s.x,s.y,s.z+WAX_THICKNESS+(under?0:WAX_THICKNESS));uv.push(p.x,p.y);return positions.length/3-1;};
  const midpoint=(a:Point,b:Point)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const subdivide=(a:Point,b:Point,c:Point,depth:number,under=false)=>{
    if(depth && Math.max(Math.hypot(a.x-b.x,a.y-b.y),Math.hypot(b.x-c.x,b.y-c.y),Math.hypot(c.x-a.x,c.y-a.y))>.024) {const ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);subdivide(a,ab,ca,depth-1,under);subdivide(ab,b,bc,depth-1,under);subdivide(ca,bc,c,depth-1,under);subdivide(ab,bc,ca,depth-1,under);return;}
    const ia=vertex(a,under),ib=vertex(b,under),ic=vertex(c,under);
    // Image UV y points down, world y points up.
    const area=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    if((area>0)!==under) indices.push(ia,ic,ib);else indices.push(ia,ib,ic);
  };
  const triangles=THREE.ShapeUtils.triangulateShape(polygon.map(p=>new THREE.Vector2(p.x,p.y)),[]);
  for(const [a,b,c] of triangles) subdivide(polygon[a],polygon[b],polygon[c],6);
  const frontCount=indices.length;
  for(let n=0;n<polygon.length;n++) {
    const a=polygon[n],b=polygon[(n+1)%polygon.length];
    const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)*60));
    for(let j=0;j<steps;j++) {
      const p={x:a.x+(b.x-a.x)*j/steps,y:a.y+(b.y-a.y)*j/steps},q={x:a.x+(b.x-a.x)*(j+1)/steps,y:a.y+(b.y-a.y)*(j+1)/steps};
      const i=vertex(p),k=vertex(q),l=vertex(p,true),m=vertex(q,true);indices.push(i,k,l,k,m,l);
    }
  }
  for(const [a,b,c] of triangles) subdivide(polygon[a],polygon[b],polygon[c],6,true);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);
  geometry.addGroup(0,frontCount,0);geometry.addGroup(frontCount,indices.length-frontCount,1);
  const welded=mergeVertices(geometry,1e-5);geometry.dispose();welded.computeVertexNormals();return welded;
}
