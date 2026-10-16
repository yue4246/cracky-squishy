import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { build } from 'esbuild';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { rm } from 'node:fs/promises';
const output=join(tmpdir(),`squishy-mesh-${process.pid}.mjs`);
await build({stdin:{contents:"export * from './src/core/SquishyStateMachine'; export * from './src/rendering/ClayRenderer'; export * from './src/rendering/SceneManager'; export * from './src/input/PointerController';",resolveDir:process.cwd(),loader:'ts'},outfile:output,bundle:true,platform:'node',format:'esm'});
after(()=>rm(output,{force:true}));
const {ClayRenderer,SceneManager,SquishyStateMachine,bendWax,makeWaxPieces,insideWax,overscanTriangle,PointerController}=await import(pathToFileURL(output));
globalThis.matchMedia=()=>({matches:true});
globalThis.devicePixelRatio=1;
globalThis.window={addEventListener(){},removeEventListener(){}};
const canvas=(width=600,height=700)=>({width:512,height:512,getContext:()=>({clearRect(){},putImageData(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},stroke(){},createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)})}),getBoundingClientRect:()=>({width,height,top:0,left:0})});
globalThis.document={hidden:false,createElement:canvas,querySelector:()=>null,addEventListener(){},removeEventListener(){}};
test('toy grows inside the space between controls and lower panels',()=>{
 const oldQuery=document.querySelector;
 try {
  for(const [width,height,controlsBottom,statusTop,dockTop,minimumSize] of [[623,804,236,623,654,420],[390,600,236,435,450,180]]) {
   document.querySelector=selector=>({
    '#controls':{hidden:false,getBoundingClientRect:()=>({bottom:controlsBottom})},
    '#status':{hidden:false,getBoundingClientRect:()=>({top:statusTop})},
    '.dessert-dock':{hidden:false,getBoundingClientRect:()=>({top:dockTop})},
   })[selector];
   const r=new ClayRenderer(canvas(width,height),new SquishyStateMachine());
   assert.ok(r.interactionSize>minimumSize,'toy uses the available room');
   assert.ok(r.top+r.interactionSize*.08>=controlsBottom+9,'shell clears controls');
   assert.ok(r.top+r.interactionSize*.92<=statusTop-9,'shell clears status');
   r.dispose();
  }
 } finally {document.querySelector=oldQuery;}
});
test('texture triangles overlap slightly so antialiasing cannot reveal a grid',()=>{
 const triangle=[{x:0,y:0},{x:1,y:0},{x:0,y:1}],expanded=overscanTriangle(triangle,.01);
 const center={x:1/3,y:1/3};
 for(let i=0;i<3;i++) assert.ok(Math.hypot(expanded[i].x-center.x,expanded[i].y-center.y)>Math.hypot(triangle[i].x-center.x,triangle[i].y-center.y));
});
test('rendered mesh stays unfolded through long opposing grabs and can be hit again',()=>{
 const model=new SquishyStateMachine(), renderer=new ClayRenderer(canvas(),model);
 renderer.ready=true; renderer.alpha.fill(255);
 // Exercise production vertex updates, excluding paint calls unavailable in Node.
 renderer.compose=()=>{}; renderer.render=()=>{};
 model.onEvent=e=>renderer.handleEvent(e);
 for(let n=0;n<20;n++) {
   const point={x:n%2?.75:.25,y:.48,pan:0};
   assert.ok(model.begin(point,.9));
   model.drag(n%2?-2:2,n%3?.3:-.3);
   for(let frame=0;frame<75;frame++) {
     model.update(1/60);renderer.update(1/60);
     for(const [i,j,k] of renderer.triangles){
       const a=renderer.vertices[i],b=renderer.vertices[j],c=renderer.vertices[k];
       const area=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
       assert.ok(area>0.0001,`triangle collapsed: ${area}`);
       assert.ok(Math.hypot(b.x-a.x,b.y-a.y)<.11,'stretched edge became a spike');
     }
   }
   model.end(); for(let f=0;f<30;f++)renderer.update(1/60);
   const screen=renderer.toScreen(point),hit=renderer.hitTest(screen.x,screen.y);
   assert.ok(hit && Math.hypot(hit.x-point.x,hit.y-point.y)<1e-4,'deformed surface remains hittable');
 }
 renderer.dispose();
});

test('polygon wax has fixed straight shared edges and covers the entire surface',()=>{
 const cells=makeWaxPieces();assert.deepEqual(cells,makeWaxPieces());
 assert.ok(cells.length>40);
 for(let y=.013;y<1;y+=.039)for(let x=.017;x<1;x+=.037)
   assert.equal(cells.filter(p=>insideWax({x,y},p.polygon)).length,1,'one piece per material point');
 for(const p of cells){assert.ok(p.polygon.length>=3 && p.polygon.length<=10);}
});

test('wax shedding is local and pressure driven, with no press-count completion',()=>{
 const setup=()=>{const m=new SquishyStateMachine(),r=new ClayRenderer(canvas(),m);r.ready=true;r.alpha.fill(255);r.authoredDamage=true;m.onEvent=e=>r.handleEvent(e);return {m,r};};
 const hit={x:.35,y:.45,pan:0},light=setup(),heavy=setup();
 light.m.begin(hit,.15);heavy.m.begin(hit,.9);
 assert.ok(heavy.r.waxPieces.filter(p=>p.state===1).length>light.r.waxPieces.filter(p=>p.state===1).length);
 const shape=heavy.r.waxPieces.map(p=>p.polygon);
 const damage=heavy.r.waxPieces.map(p=>p.damage);heavy.r.stressWax(.9);assert.deepEqual(heavy.r.waxPieces.map(p=>p.damage),damage,'holding constant force never adds load');
 light.m.end();heavy.m.end();heavy.r.advancePeeling(.5);
 assert.ok(heavy.r.waxPieces.some(p=>p.state===2));assert.deepEqual(heavy.r.waxPieces.map(p=>p.polygon),shape);
 for(let n=0;n<25;n++){heavy.m.begin(hit,.5);heavy.m.end();heavy.r.advancePeeling(.5);}
 assert.ok(heavy.r.waxPieces.some(p=>p.damage===0),'distant untouched wax survives even 25 presses');
 // Moving onto each remaining piece can eventually remove every piece, with no islands locked on.
 for(const piece of heavy.r.waxPieces){heavy.m.begin({...piece.center,pan:0},1);heavy.m.end();heavy.r.advancePeeling(.5);}
 assert.ok(heavy.r.waxPieces.every(p=>p.state===2));
 heavy.m.begin(hit);assert.equal(heavy.m.contact.soft,true);heavy.m.end();
 heavy.r.clear();assert.equal(heavy.r.waxPieces.length,0);assert.equal(heavy.m.isExposed(hit.x,hit.y),false);
 light.r.dispose();heavy.r.dispose();
});

test('core lighting follows persistent surface slopes without black or white patches',()=>{
 const model=new SquishyStateMachine(),renderer=new ClayRenderer(canvas(),model);
 renderer.corePixels={width:64,height:64,data:new Uint8ClampedArray(64*64*4)};
 renderer.shadeCore();const before=renderer.corePixels.data.slice();
 for(const v of renderer.vertices) v.h=-.09*Math.exp(-((v.u-.38)**2+(v.v-.4)**2)/.015);
 renderer.shadeCore();const after=renderer.corePixels.data.slice();
 let changed=0;
 for(let i=0;i<after.length;i+=4) {
   assert.equal(after[i+3],255);
   for(let c=0;c<3;c++) assert.ok(after[i+c]>70 && after[i+c]<255,'bounded material lighting');
   if(Math.abs(after[i]-before[i])>4) changed++;
 }
 assert.ok(changed>100,'dent changes the material lighting');
 renderer.shadeCore();assert.deepEqual(renderer.corePixels.data,after,'repaint never accumulates shading');
 renderer.dispose();
});


test('wax bends progressively while its hinge stays attached and texture never folds',()=>{
 for(const curl of [0,.1,.25,.38,1]) {
   assert.equal(bendWax(100,100,60,curl),100);
   let previous=-Infinity;
   for(let y=40;y<=100;y++) {const projected=bendWax(y,100,60,curl);assert.ok(projected>previous);previous=projected;}
 }
 assert.ok(bendWax(40,100,60,.3)-40>2*(bendWax(70,100,60,.3)-70));
});


test('increasing pressure extends damage on the same polygon network',()=>{
 const m=new SquishyStateMachine(),r=new ClayRenderer(canvas(),m);
 r.ready=true;r.alpha.fill(255);r.authoredDamage=true;m.onEvent=e=>r.handleEvent(e);
 m.begin({x:.35,y:.45,pan:0},.15);
 const shape=r.waxPieces.map(p=>p.polygon),small=r.waxPieces.reduce((n,p)=>n+p.damage,0);
 m.drag(0,0,.9);r.stressWax(m.contact.peakForce);
 assert.ok(r.waxPieces.reduce((n,p)=>n+p.damage,0)>small*1.5);
 assert.deepEqual(r.waxPieces.map(p=>p.polygon),shape);m.end();r.dispose();
});

test('pointer input distinguishes real pressure from the mouse default',()=>{
 const target={canvas:{getBoundingClientRect:()=>({left:10,top:20})}};
 const input=(pointerType,pressure)=>PointerController.prototype.input.call(target,{clientX:30,clientY:50,pointerType,pressure},'down');
 assert.equal(input('mouse',.5).simulated,true);assert.equal(input('mouse',.5).force,.18);
 assert.equal(input('pen',.8).simulated,false);assert.equal(input('pen',.8).force,.8);
 assert.equal(input('touch',.5).simulated,true);assert.equal(input('touch',.7).simulated,false);
});

 test('released visible pose retains at least 90 percent on intact and bare core presses',()=>{
 const m=new SquishyStateMachine(),r=new ClayRenderer(canvas(),m);
 r.ready=true;r.alpha.fill(255);r.compose=()=>{};r.render=()=>{};
 m.onEvent=e=>r.handleEvent(e);
 const hit={x:.3,y:.4,pan:0};
 for(const bare of [false,true]) {
   m.isExposed=()=>bare;
   for(let n=0;n<3;n++) {
     const before=r.vertices.map(v=>[v.x,v.y,v.h]);
     m.begin(hit,.5);
     for(let f=0;f<8;f++){m.update(1/60);r.update(1/60);}
     const pressed=r.vertices.map(v=>[v.x,v.y,v.h]);
     m.end();for(let f=0;f<180;f++){m.update(1/60);r.update(1/60);}
     let displacement=0,rebound=0;
     r.vertices.forEach((v,i)=>{
       [v.x,v.y,v.h].forEach((value,k)=>{displacement+=(pressed[i][k]-before[i][k])**2;rebound+=(value-pressed[i][k])**2;});
     });
     assert.ok(displacement>1e-6,'each press visibly changes the pose');
     assert.ok(Math.sqrt(rebound/displacement)<.1,'release must not undo the press');
   }
 }
 r.dispose();
});

test('early presses shed clusters and later presses loosen the local remnants',()=>{
 const m=new SquishyStateMachine(),r=new ClayRenderer(canvas(),m);
 r.ready=true;r.alpha.fill(255);r.authoredDamage=true;m.onEvent=e=>r.handleEvent(e);
 const hit={x:.45,y:.45,pan:0},drops=[];
 for(let i=0;i<16;i++) {
   const before=r.waxPieces.filter(p=>p.state===2).length;
   m.begin(hit,.5);m.end();r.advancePeeling(1);
   drops.push(r.waxPieces.filter(p=>p.state===2).length-before);
 }
 assert.ok(drops[0]>=3,'first press releases multiple flakes');
 assert.ok(drops[0]+drops[1]>drops[8]+drops[9],'early shedding is greater');
 assert.ok(r.waxPieces.filter(p=>Math.hypot(p.center.x-hit.x,p.center.y-hit.y)<.30).every(p=>p.state===2),'nearby remnants do not stay glued');
 assert.ok(r.waxPieces.some(p=>p.state===0),'distant shell is not globally cleared');
 r.dispose();
});

test('one gesture sheds at most a third of visible wax and impact waits for landing',()=>{
 const m=new SquishyStateMachine(),r=new ClayRenderer(canvas(),m),events=[];
 r.ready=true;r.alpha.fill(255);r.authoredDamage=true;r.reducedMotion=false;r.compose=()=>{};r.render=()=>{};
 m.onEvent=e=>{events.push(e);r.handleEvent(e);};
 m.begin({x:.5,y:.5,pan:0},.5);
 let area=r.waxPieces.filter(p=>p.state!==0).reduce((n,p)=>n+p.area,0);
 assert.ok(area>=.23 && area<=.29,`normal press area ${area}`);
 r.stressWax(1);
 area=r.waxPieces.filter(p=>p.state!==0).reduce((n,p)=>n+p.area,0);
 assert.ok(area<=.33,'pressure escalation shares the same gesture budget');
 r.advancePeeling(1);
 assert.equal(events.filter(e=>e.type==='fragment').length,0,'detachment is not a table impact');
 m.end();
 for(let f=0;f<100;f++)r.update(1/60);
 assert.ok(events.some(e=>e.type==='fragment'),'falling flakes eventually sound on landing');
 r.dispose();
});

test('slow frames advance falling fragments by real elapsed time instead of entering slow motion',()=>{
 const m=new SquishyStateMachine(),r=new ClayRenderer(canvas(),m);
 r.ready=true;r.alpha.fill(255);r.compose=()=>{};r.render=()=>{};
 r.shards=[{x:.5,y:.2,pan:0,vx:0,vy:0,size:.02,angle:0,spin:0,age:0,landed:false,sourceX:.5,sourceY:.5}];
 r.update(.1);
 assert.equal(r.shards[0].age,.1,'a 100ms frame must advance 100ms of fragment animation');
 r.dispose();
});

test('mobile canvas limits high-density pixel work',()=>{
 const previous=globalThis.devicePixelRatio;
 try {
  globalThis.devicePixelRatio=3;
  const r=new ClayRenderer(canvas(400,600),new SquishyStateMachine());
  assert.equal(r.dpr,1.25);
  r.dispose();
 } finally {globalThis.devicePixelRatio=previous;}
});

test('mobile drawing uses a coarse mesh without changing saved physics geometry',()=>{
 const r=new ClayRenderer(canvas(),new SquishyStateMachine());
 assert.equal(r.vertices.length,625);
 assert.equal(r.triangles.length,1152);
 assert.equal(r.renderTriangles.length,288);
 r.dispose();
});

test('the scene can present the first touch response on the next 60 Hz frame',()=>{
 const callbacks=[],oldRaf=globalThis.requestAnimationFrame,oldCancel=globalThis.cancelAnimationFrame;
 globalThis.requestAnimationFrame=callback=>(callbacks.push(callback),callbacks.length);
 globalThis.cancelAnimationFrame=()=>{};
 try {
  const updates=[],model=new SquishyStateMachine(),scene=new SceneManager(canvas(),model);
  model.update=dt=>updates.push(dt);scene.squishy.update=()=>{};
  const base=performance.now();scene.start();
  callbacks.shift()(base+17);
  assert.equal(updates.length,1,'17ms must not wait for a 30 FPS deadline');
  scene.dispose();
 } finally {globalThis.requestAnimationFrame=oldRaf;globalThis.cancelAnimationFrame=oldCancel;}
});

test('canvas blocks native long-press behavior without focusing touch input',()=>{
 const listeners=new Map(),removed=[],focus=[],blur=[];
 const target={
  addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener:(name)=>removed.push(name),
  getBoundingClientRect:()=>({left:0,top:0}),focus:()=>focus.push(true),blur:()=>blur.push(true),setPointerCapture(){},hasPointerCapture:()=>false,
 };
 const pointer=new PointerController(target,()=>true),event={pointerId:1,button:0,isPrimary:true,pointerType:'touch',pressure:.5,clientX:10,clientY:10,preventDefault(){this.prevented=true;}};
 listeners.get('pointerdown')(event);
 assert.equal(event.prevented,true);assert.equal(focus.length,0,'touch must not create an iOS focus ring');assert.equal(blur.length,1);
 const menu={preventDefault(){this.prevented=true;}};listeners.get('contextmenu')(menu);
 assert.equal(menu.prevented,true,'long press must not open the native callout');
 pointer.release();listeners.get('pointerdown')({...event,pointerId:2,pointerType:'mouse',prevented:false});
 assert.equal(focus.length,1,'mouse users retain keyboard focus');
 pointer.dispose();assert.ok(removed.includes('contextmenu'));
});

test('fallen flakes project flat after rotation and use the source texture',()=>{
 const m=new SquishyStateMachine(),r=new ClayRenderer(canvas(),m),calls=[];
 r.ctx=new Proxy({}, {get:(_,name)=>(...args)=>calls.push([name,...args]),set:()=>true});
 r.vertices.length=0;r.triangles.length=0;r.renderTriangles.length=0;
 r.shards=[{x:.4,y:.93,angle:Math.PI/2,age:1,landed:true,size:.05,sourceX:.01,sourceY:.01,polygon:[{x:-.04,y:-.04},{x:.04,y:-.04},{x:0,y:.04}]}];
 r.render();
 const rotation=calls.findIndex(c=>c[0]==='rotate');
 assert.deepEqual(calls[rotation-1],['scale',1,.32],'table projection must follow the in-plane rotation geometrically');
 const draw=calls.find(c=>c[0]==='drawImage');
 assert.equal(draw[8],.1,'texture is projected once, not squashed twice');
 r.dispose();
});

test('edge flakes never paint solid color outside the original shell silhouette',()=>{
 const m=new SquishyStateMachine(),r=new ClayRenderer(canvas(),m),calls=[];
 r.ctx=new Proxy({}, {get:(_,name)=>(...args)=>calls.push([name,...args]),set:()=>true});
 r.vertices.length=0;r.triangles.length=0;r.renderTriangles.length=0;
 r.shards=[{x:.4,y:.8,angle:0,age:1,landed:false,size:.05,sourceX:.01,sourceY:.5,polygon:[{x:-.04,y:-.04},{x:.04,y:-.04},{x:0,y:.04}]}];
 r.render();
 assert.equal(calls.filter(c=>c[0]==='fill').length,0,'transparent source area must not get a painted fallback face');
 assert.equal(calls.filter(c=>c[0]==='stroke').length,0,'polygon outline must not trace the transparent source area');
 assert.ok(calls.some(c=>c[0]==='drawImage' && c[1]===r.shell),'visible flake still uses the original shell texture');
 r.dispose();
});

test('saved toy restores local wax, deformation and press count without replaying events',()=>{
 const m=new SquishyStateMachine(),r=new ClayRenderer(canvas(),m);
 r.ready=true;r.alpha.fill(255);r.authoredDamage=true;r.compose=()=>{};r.render=()=>{};
 m.onEvent=e=>r.handleEvent(e);
 m.begin({x:.35,y:.45,pan:0},.8);
 for(let i=0;i<30;i++){m.update(1/60);r.update(1/60);}
 m.end();r.advancePeeling(1);
 const saved=JSON.parse(JSON.stringify(r.exportState()));
 assert.ok(saved.wax.some(p=>p.state===2));
 const m2=new SquishyStateMachine(),r2=new ClayRenderer(canvas(),m2);
 r2.ready=true;r2.alpha.fill(255);r2.authoredDamage=true;r2.compose=()=>{};r2.render=()=>{};
 let events=0;m2.onEvent=()=>events++;
 r2.restoreState(saved);
 assert.equal(events,0);assert.equal(m2.pressCount,1);
 assert.deepEqual([...m2.residualX],[...m.residualX]);
 assert.deepEqual([...m2.residualH],[...m.residualH]);
 assert.deepEqual(r2.exportState(),saved);
 assert.ok(m2.isExposed(.35,.45));
 assert.equal(m2.begin({x:.35,y:.45,pan:0},.5),true);assert.equal(m2.pressCount,2);
 assert.equal(saved.pressCount,1,'continuing must not mutate saved state');
 const before=r2.exportState();
 assert.throws(()=>r2.restoreState({...saved,residualH:[NaN]}));
 assert.deepEqual(r2.exportState(),before,'invalid snapshots cannot partially reset the toy');
});

test('repeated soft edge presses progressively compress the silhouette and retain it',()=>{
 const m=new SquishyStateMachine(),r=new ClayRenderer(canvas(),m);
 r.ready=true;r.alpha.fill(255);r.compose=()=>{};r.render=()=>{};
 m.isExposed=()=>true;m.onEvent=e=>r.handleEvent(e);
 const vertex=r.vertices[5*25+6],initial=vertex.y;
 const poses=[];
 for(let n=0;n<4;n++){
  m.begin({x:.25,y:.2,pan:0},.7);
  for(let f=0;f<35;f++){m.update(1/60);r.update(1/60);}
  m.end();for(let f=0;f<40;f++)r.update(1/60);
  poses.push(vertex.y);
 }
 assert.ok(poses[0]>initial+.01,'upper silhouette moves inward');
 assert.ok(poses[3]>poses[0]+.02,'later presses compress the existing pose');
 const held=vertex.y;for(let f=0;f<120;f++)r.update(1/60);
 assert.ok(Math.abs(vertex.y-held)<.001,'released shape stays');r.dispose();
});

test('ordinary varied presses leave shell after seven gestures instead of clearing it',()=>{
 const m=new SquishyStateMachine(),r=new ClayRenderer(canvas(),m);
 r.ready=true;r.alpha.fill(255);r.authoredDamage=true;m.onEvent=e=>r.handleEvent(e);
 for(const [x,y] of [[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75],[.5,.2],[.5,.8]]){
  m.begin({x,y,pan:0},.5);m.end();r.advancePeeling(1);
 }
 const total=r.waxPieces.reduce((sum,p)=>sum+p.area,0);
 const left=r.waxPieces.reduce((sum,p)=>sum+(p.state===0?p.area:0),0);
 assert.ok(left/total>.15,'at least some shell remains after seven ordinary presses');r.dispose();
});
