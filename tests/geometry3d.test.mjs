import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {build} from 'esbuild';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {rm} from 'node:fs/promises';
const output=join(tmpdir(),`squishy-3d-${process.pid}.mjs`);
await build({stdin:{contents:"export * from './src/rendering/ToyGeometry';export {WaxToyRenderer} from './src/rendering/WaxToyRenderer';export * from './src/core/SquishyStateMachine';export {Vector3,Raycaster,Mesh,MeshBasicMaterial,DoubleSide} from 'three';",resolveDir:process.cwd(),loader:'ts'},outfile:output,bundle:true,platform:'node',format:'esm'});
after(()=>rm(output,{force:true}));
const {fractureOpening,WaxToyRenderer,coreGeometry,shellCells,shellGeometry,surfacePoint,deformPoint,WAX_THICKNESS,SquishyStateMachine,Vector3,Raycaster,Mesh,MeshBasicMaterial,DoubleSide}=await import(pathToFileURL(output));
const outline=Array.from({length:128},(_,n)=>{const a=n/128*Math.PI*2;return{x:.5+Math.cos(a)*.4,y:.5+Math.sin(a)*.4};});

test('core is a volumetric front/back mesh; a press changes actual z and stays after release',()=>{
 const geometry=coreGeometry(outline),p=geometry.attributes.position;
 let min=Infinity,max=-Infinity;for(let i=0;i<p.count;i++){min=Math.min(min,p.getZ(i));max=Math.max(max,p.getZ(i));}
 assert.ok(max-min>.9,'core must have volume, not a flat image plane');
 const model=new SquishyStateMachine();model.opened.fill(1);model.begin({x:.5,y:.5,pan:0},.8);
 for(let i=0;i<40;i++)model.update(.05);model.end();
 const base=surfacePoint(outline,.5,.5),dent=deformPoint(base,.5,.5,model);
 assert.ok(dent.z<base.z-.18,'dent is geometry displacement');
 model.update(2);assert.equal(deformPoint(base,.5,.5,model).z,dent.z);
 const back=surfacePoint(outline,.5,.5,true);assert.ok(dent.z>back.z+.2,'front cannot pass through the back');
 geometry.dispose();
});

test('wax pieces have actual sidewalls and separate front/back faces of the specified thickness',()=>{
 const cells=shellCells(outline);assert.ok(cells.length>20);
 for(const {polygon} of cells){
   const g=shellGeometry(outline,polygon),p=g.attributes.position,uv=g.attributes.uv;
   assert.equal(g.groups.length,2);assert.ok(g.groups[1].count>polygon.length*6);
   let min=Infinity,max=-Infinity;
   for(let i=0;i<p.count;i++) {const offset=p.getZ(i)-surfacePoint(outline,uv.getX(i),uv.getY(i)).z;min=Math.min(min,offset);max=Math.max(max,offset);assert.ok(Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)));}
   assert.ok(Math.abs((max-min)-WAX_THICKNESS)<.001,`wax thickness mismatch: ${max-min}`);
   g.dispose();
 }
});

test('ray picking returns material coordinates on the deformed 3D core',()=>{
 const g=coreGeometry(outline),p=g.attributes.position,uv=g.attributes.uv,back=g.attributes.back;
 const model=new SquishyStateMachine();model.opened.fill(1);model.begin({x:.4,y:.45,pan:0},.8);model.drag(.12,.04);
 for(let i=0;i<30;i++)model.update(.05);model.end();
 for(let i=0;i<p.count;i++){const q=deformPoint(new Vector3().fromBufferAttribute(p,i),uv.getX(i),uv.getY(i),model,!!back.getX(i));p.setXYZ(i,q.x,q.y,q.z);}
 g.computeBoundingSphere();const mesh=new Mesh(g,new MeshBasicMaterial({side:DoubleSide}));mesh.updateMatrixWorld(true);
 const q=deformPoint(surfacePoint(outline,.4,.45),.4,.45,model),ray=new Raycaster(new Vector3(q.x,q.y,3),new Vector3(0,0,-1));
 const hit=ray.intersectObject(mesh)[0];assert.ok(hit?.uv);assert.ok(Math.hypot(hit.uv.x-.4,hit.uv.y-.45)<.008);
 g.dispose();mesh.material.dispose();
});

test('intact shell covers the curved core without intersections',()=>{
 const material=new MeshBasicMaterial({side:DoubleSide});
 const meshes=shellCells(outline).map(c=>new Mesh(shellGeometry(outline,c.polygon),material));
 for(const m of meshes)m.updateMatrixWorld(true);
 let worst=1;
 for(let y=.2;y<=.8;y+=.04)for(let x=.2;x<=.8;x+=.04){
   if(Math.hypot(x-.5,y-.5)>.36)continue;
   const base=surfacePoint(outline,x,y),ray=new Raycaster(new Vector3(base.x,base.y,3),new Vector3(0,0,-1));
   const hit=ray.intersectObjects(meshes)[0];assert.ok(hit,'shell coverage gap');
   worst=Math.min(worst,hit.point.z-base.z);
 }
 for(const m of meshes)m.geometry.dispose();material.dispose();
 assert.ok(worst>0,`shell intersects core by ${worst}`);
});


test('3D shell accumulates local damage, fully detaches and resets its geometry',()=>{
 const model=new SquishyStateMachine(),r=Object.create(WaxToyRenderer.prototype);
 r.model=model;r.ready=true;r.reducedMotion=false;r.core=null;
 const material=new MeshBasicMaterial();
 r.plates=shellCells(outline).map(c=>{
   const mesh=new Mesh(shellGeometry(outline,c.polygon),[material,material]);
   return {mesh,base:new Float32Array(mesh.geometry.attributes.position.array),center:c.center,damage:0,bend:0,detached:false,age:0,velocity:new Vector3(),spin:new Vector3(),landed:false};
 });
 const event={type:'press',x:.3,y:.35,pan:0};
 model.pressCount=1;r.handleEvent(event);
 const close=r.plates.find(p=>Math.hypot(p.center.x-.3,p.center.y-.35)<.1);
 const far=r.plates.find(p=>p.center.x>.7&&p.center.y>.6);
 assert.ok(close.damage>0);assert.equal(far.damage,0);
 const previous=close.damage;model.pressCount=2;r.handleEvent(event);assert.ok(close.damage>previous);
 for(let n=3;n<=10;n++){model.pressCount=n;r.handleEvent(event);}
 assert.ok(r.plates.every(p=>p.detached));assert.ok(model.opened.every(Boolean));
 r.clear();
 for(const p of r.plates){assert.equal(p.detached,false);assert.equal(p.damage,0);assert.deepEqual(p.mesh.geometry.attributes.position.array,p.base);p.mesh.geometry.dispose();}
 material.dispose();
});


test('fracture front grows along persistent unequal paths instead of opening a whole ring',()=>{
 const origin={x:.4,y:.4};
 assert.equal(fractureOpening(origin,.4,.4,0),0);
 assert.equal(fractureOpening(origin,.8,.8,.7),0);
 const ring=Array.from({length:60},(_,i)=>{const a=i/60*Math.PI*2;return{x:.4+.14*Math.cos(a),y:.4+.14*Math.sin(a)};});
 const early=ring.map(p=>fractureOpening(origin,p.x,p.y,.5));
 assert.ok(early.some(v=>v>.1));assert.ok(early.some(v=>v===0),'unreached portions must remain sealed');
 for(let i=0;i<ring.length;i++){
   const p=ring[i];assert.ok(fractureOpening(origin,p.x,p.y,.85)>=early[i]);
   assert.equal(fractureOpening(origin,p.x,p.y,.5),early[i],'same damage retains the same paths');
 }
});
