import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

const output = join(tmpdir(), `squishy-material-${process.pid}.mjs`);
await build({
  entryPoints: ['src/core/SquishyStateMachine.ts'],
  outfile: output,
  bundle: true,
  format: 'esm',
  platform: 'node',
});
const { RADIUS, SquishyStateMachine } = await import(`${pathToFileURL(output)}?v=${Date.now()}`);
after(() => rm(output, { force: true }));

let model;
let events;
beforeEach(() => {
  model = new SquishyStateMachine();
  events = [];
  model.onEvent = event => events.push(event);
});

test('one continuous press visibly cracks, opens the shell, then reaches the soft core', () => {
  const hit = { x: 0.5, y: 0.5, pan: 0 };

  assert.equal(model.begin(hit, 0.5), true);
  const firstCrack = events.find(event => event.type === 'micro_crack');
  assert.ok(firstCrack, 'pointerdown should produce a visible crack event');
  assert.deepEqual(firstCrack.segments[0].a, {x:hit.x,y:hit.y});
  assert.ok(firstCrack.segments.slice(1).every(s=>firstCrack.segments.some(p=>p.b.x===s.a.x && p.b.y===s.a.y)), 'branches must connect to an existing crack');
  const visibleLength = firstCrack.segments.reduce((sum, segment) =>
    sum + Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y), 0);
  assert.ok(visibleLength >= 0.4, 'the first crack should span a broad local area');
  assert.equal(events.some(event => event.type === 'shell_break'), false);

  model.update(0.7);

  assert.ok(events.some(event => event.type === 'shell_break'), 'holding should open the local shell');
  assert.ok(model.opened.reduce((sum, value) => sum + value, 0) >= 8, 'the exposed soft-core area should be broad');
  assert.equal(model.contact.soft, true, 'the same press should continue into the exposed soft core');
  assert.ok(events.some(event => event.type === 'soft_squish'), 'opening should emit soft contact feedback');
});

test('continuous pressure stays local', () => {
  model.begin({ x: 0.5, y: 0.5, pan: 0 }, 0.5);
  model.update(0.7);
  const far = model.cellAt(0.5 + RADIUS * 2.1, 0.5);
  assert.equal(model.damage[far], 0);
  assert.equal(model.opened[far], 0);
});

test('holding after the first fracture does not keep breaking new rings', () => {
  model.begin({ x: 0.5, y: 0.5, pan: 0 }, 0.5);
  model.update(0.7);
  const broken = model.opened.reduce((sum, value) => sum + value, 0);
  const breaks = events.filter(event => event.type === 'shell_break').length;

  model.update(10);

  assert.equal(model.opened.reduce((sum, value) => sum + value, 0), broken);
  assert.equal(events.filter(event => event.type === 'shell_break').length, breaks);
});

test('soft clay keeps the deformation after release', () => {
  model.begin({ x: 0.5, y: 0.5, pan: 0 }, 0.7);
  for (let i = 0; i < 30; i++) model.update(0.05);
  const dent = Math.min(...model.residualH);
  const spread = Math.max(...model.residualY);
  model.end();
  assert.ok(dent < -0.025 && spread > 0.008, 'holding should permanently dent and spread the clay');
  assert.equal(Math.min(...model.residualH), dent);
  assert.equal(Math.max(...model.residualY), spread);
});

test('a quick repeat press deepens the existing soft dent', () => {
  const hit = { x: 0.5, y: 0.5, pan: 0 };
  model.begin(hit, 0.7); model.update(0.7); model.end();
  const first = Math.min(...model.residualH);
  model.begin(hit, 0.7); model.end();
  assert.ok(Math.min(...model.residualH) < first - 0.004);
});

test('pressure collapses the touched side toward the center', () => {
  model.begin({ x: .22, y: .5, pan: -.6 }, .8); model.update(.7);
  for (let i=0;i<12;i++) model.update(.05);
  model.end();
  const left=model.residualX.filter((_,i)=>i%(24+1)<11);
  const right=model.residualX.filter((_,i)=>i%(24+1)>18);
  assert.ok(Math.max(...left)>.012, 'left-side pressure should push that side rightward');
  assert.ok(Math.max(...right)<.004, 'the untouched right side should stay nearly still');
});

test('released soft material preserves its shape and remains pressable', () => {
  model.begin({ x: .3, y: .5, pan: 0 }, .8);
  for (let i=0;i<600;i++) model.update(.05);
  model.end();
  const before = Math.max(...model.residualX);
  for (let i=0;i<160;i++) model.update(.05);
  assert.equal(Math.max(...model.residualX), before);
  assert.equal(model.begin({x:.3,y:.5,pan:0}), true);
});

test('deformation extends smoothly across the alpha silhouette boundary', () => {
  model.isSolid = (x,y) => Math.hypot(x-.5,y-.5)<.38;
  model.begin({x:.18,y:.5,pan:0}, .8);
  for(let i=0;i<400;i++) model.update(.05);
  let gradient=0;
  for(let y=0;y<=24;y++) for(let x=0;x<24;x++) {
    const i=y*25+x;
    gradient=Math.max(gradient,Math.abs(model.residualX[i+1]-model.residualX[i])*24);
  }
  assert.ok(gradient<.45, `residual gradient must not tear the mesh: ${gradient}`);
});


test('alternating extreme drags remain smooth and respond in both directions', () => {
  model.isSolid=(x,y)=>Math.hypot(x-.5,y-.5)<.38;
  for(let n=0;n<30;n++) {
    const hit={x:n%2?.72:.28,y:.46,pan:0};
    assert.ok(model.begin(hit,.9)); model.update(.7);
    model.drag(n%2?-3:3, .1);
    for(let t=0;t<30;t++) model.update(1/60);
    model.end();
    for(let y=0;y<=24;y++) for(let x=0;x<=24;x++) {
      const i=y*25+x;
      assert.ok(Number.isFinite(model.residualX[i]));
      for(const j of [x<24?i+1:-1,y<24?i+25:-1]) if(j>=0)
        assert.ok(Math.hypot(model.residualX[j]-model.residualX[i],model.residualY[j]-model.residualY[i])<.22/24);
    }
  }
  model.begin({x:.5,y:.5,pan:0});
  model.drag(2,0); const right=model.contact.dragX;
  model.drag(-2,0); assert.ok(right>0 && model.contact.dragX<0);
});


test('long pressure retains a fingertip pit and raised shoulder rather than a flat basin',()=>{
 model.opened.fill(1);model.begin({x:.5,y:.5,pan:0},.8);
 for(let i=0;i<200;i++) model.update(.05);
 const center=12*25+12,shoulder=12*25+18,far=12*25+23;
 assert.ok(model.residualH[center]<-.1);
 assert.ok(model.residualH[shoulder]>.005,'displaced core rises beside the contact');
 assert.ok(Math.abs(model.residualH[far])<.001,'long holds do not flatten the entire toy');
 const previous=model.residualH[center];model.end();model.begin({x:.75,y:.5,pan:0},.8);
 for(let i=0;i<30;i++) model.update(.05);
 assert.ok(model.residualH[center]<=previous+.00001,'neighboring pressure preserves the old pit');
});


test('simulated pressure grows once, measured pressure stays measured, release preserves peak',()=>{
 const hit={x:.5,y:.5,pan:0};
 model.begin(hit,.18,true);model.update(.3);assert.ok(model.contact.force>.45);
 model.update(.7);assert.ok(Math.abs(model.contact.force-.9)<1e-9);
 const count=events.filter(e=>e.type==='shell_break').length;
 model.update(20);assert.ok(Math.abs(model.contact.force-.9)<1e-9);assert.equal(events.filter(e=>e.type==='shell_break').length,count);
 model.end();assert.equal(events.at(-1).type,'release');assert.ok(Math.abs(events.at(-1).intensity-.9)<1e-9);
 model.reset();events.length=0;model.begin(hit,.15);model.update(.4);assert.equal(model.contact.force,.15);
 model.drag(0,0,.85);model.drag(0,0,.1);model.end();assert.equal(events.at(-1).intensity,.85);
 model.begin(hit,.5);const length=events.length;model.end(true);assert.equal(events.length,length,'cancel must not peel');
});

test('hard presses create broader damage and larger crack events than light presses',()=>{
 const press=force=>{
   const m=new SquishyStateMachine(),events=[];m.onEvent=e=>events.push(e);m.begin({x:.5,y:.5,pan:0},force);
   return {area:m.damage.filter(v=>v>0).length,crack:events.find(e=>e.type==='micro_crack')};
 };
 const light=press(.15),heavy=press(.9);
 assert.ok(heavy.area>light.area*1.6);assert.ok(heavy.crack.intensity>light.crack.intensity);
});
