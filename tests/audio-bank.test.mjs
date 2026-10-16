import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('all 116 approved sounds are embedded as compact browser-decodable AAC without the removed suction pop', () => {
  const bank = readFileSync('src/generated/sound-bank.ts', 'utf8');
  const engine = readFileSync('src/core/AudioEngine.ts', 'utf8');
  const entries = [...bank.matchAll(/"[^"]+": "([^"]+)"/g)];

  assert.equal(entries.length, 116);
  assert.equal([...bank.matchAll(/08_inner_continuous\/cont_/g)].length,14);
  assert.doesNotMatch(bank,/cont_release_pop/);
  for(const stem of ['key_mechanical_click','key_deep_thock','key_release','shell_chocolate_break',
    'shell_chocolate_crunch','shell_sugar_grit_crack','shell_sugar_grit_crush','fill_kinetic_sand_squeeze'])
    assert.match(bank,new RegExp(stem));
  for (const [, base64] of entries) {
    const bytes = Buffer.from(base64, 'base64');
    assert.equal(bytes.subarray(4, 8).toString(), 'ftyp');
  }
  assert.match(engine, /decodeAudioData/);
  assert.doesNotMatch(engine, /createBuffer\(/);
  const main = readFileSync('src/main.ts', 'utf8');
  assert.doesNotMatch(main, /if\(scene\.squishy\.keyboard\)[\s\S]{0,180}audio\.handleEvent/,
    'keyboard must use the same material-event audio routing as every other toy');
});

test('audio startup decodes one stem and loads later stems only when used', async () => {
  const { build } = await import('esbuild');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const temp=await mkdtemp(join(tmpdir(),'lazy-audio-'));
  try {
    const output=join(temp,'audio.mjs');
    await build({entryPoints:['src/core/AudioEngine.ts'],outfile:output,bundle:true,platform:'node',format:'esm'});
    const {AudioEngine}=await import(pathToFileURL(output));
    let decodes=0;
    const param=()=>({value:0,cancelScheduledValues(){},setTargetAtTime(){}});
    globalThis.AudioContext=class {
      state='running';currentTime=1;destination={};
      createGain(){return {gain:param(),connect(){},disconnect(){}};}
      createStereoPanner(){return {pan:param(),connect(){},disconnect(){}};}
      createBufferSource(){return {connect(){},disconnect(){},start(){},stop(){}};}
      async resume(){} async decodeAudioData(){decodes++;return {};}
    };
    const audio=new AudioEngine();await audio.init();
    assert.equal(decodes,2,'startup only prepares the two light-press variants');
    audio.handleEvent({id:1,generation:0,pressId:1,type:'micro_crack',intensity:.3,soft:false,x:.5,y:.5,pan:0});
    for(let n=0;n<20&&decodes<4;n++)await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(decodes,4,'the requested crack stem is decoded on first use');
    audio.handleEvent({id:2,generation:0,pressId:2,type:'micro_crack',intensity:.3,soft:false,x:.5,y:.5,pan:0});
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(decodes,4,'decoded stems are reused');
  } finally {delete globalThis.AudioContext;await rm(temp,{recursive:true,force:true});}
});

test('continuous core sounds route by gesture and keep one voice without throttling new presses', async () => {
  const { build } = await import('esbuild');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const temp=await mkdtemp(join(tmpdir(),'inner-audio-'));
  try {
    const output=join(temp,'audio.mjs');
    await build({entryPoints:['src/core/AudioEngine.ts'],outfile:output,bundle:true,platform:'node',format:'esm'});
    const {AudioEngine}=await import(pathToFileURL(output));
    const a=new AudioEngine(),sources=[];
    const param=()=>({value:0,cancelScheduledValues(){},setTargetAtTime(){}});
    a.ctx={currentTime:1,createGain:()=>({gain:param(),connect(){},disconnect(){}}),createStereoPanner:()=>({pan:param(),connect(){},disconnect(){}}),createBufferSource:()=>{
      const s={connect(){},disconnect(){},start(){},stop(){this.stopped=true;}};sources.push(s);return s;
    }};
    a.master={};a.state='READY';
    const e={id:1,generation:0,pressId:1,type:'press',intensity:.5,soft:true,force:.4,dragDistance:0,x:.5,y:.5,pan:0};
    const cases=[['mochi','press',.4,0,'cont_squeeze'],['ice','press',.4,0,'cont_poke_slime'],['sugar','soft_squish',.8,0,'cont_deep_press_clay'],['ice','soft_squish',.4,.1,'cont_stretch_slime'],['jelly','release',.4,0,'cont_jelly_wobble'],['mochi','soft_squish',.4,0,'cont_knead_mochi'],['ice','soft_squish',.4,0,'cont_squelch_slime'],['mochi','release',.4,0,'']];
    for(const [material,type,force,dragDistance,name] of cases){a.material=material;assert.equal(a.sample({...e,type,force,dragDistance}),name);if(name)a.sounds.set(name,[{},{}]);}
    a.handleEvent(e);a.handleEvent({...e,type:'soft_squish'});assert.equal(sources.length,1,'same-frame events do not double up');
    a.handleEvent({...e,pressId:2});assert.equal(sources.length,2,'rapid new presses respond');assert.equal(sources[0].stopped,true);
    a.ctx.currentTime+=.3;a.handleEvent({...e,pressId:2,type:'soft_squish'});assert.equal(sources.length,3);assert.equal(sources[1].stopped,true);
    a.handleEvent({...e,pressId:2,type:'release'});a.release();assert.equal(sources.length,3,'no suction pop on release');assert.ok(!sources[2].stopped,'normal release preserves the soft sample tail');
    a.handleEvent({...e,pressId:3});assert.equal(sources[2].stopped,true,'next gesture replaces the tail');
    const count=sources.length;a.handleEvent({...e,generation:99});assert.equal(sources.length,count);
    assert.ok(!a.sample({...e,soft:false}).startsWith('cont_'),'intact wax keeps its original sounds');
    a.reset(1,'ice');assert.ok(sources.every(s=>s.stopped));
    a.reset(2,'sugar','jelly');
    assert.equal(a.sample({...e,type:'shell_break',soft:false,intensity:.9}),'shell_sugar_grit_crush');
    assert.equal(a.sample(e),'cont_poke_slime','core sound is independent of shell');
    a.reset(3,'bread','mochi');assert.equal(a.sample({...e,type:'soft_squish'}),'cont_knead_mochi');
    a.reset(4,'bread','bread');assert.equal(a.sample({...e,type:'soft_squish'}),'soft_bread_dough');
    a.reset(5,'sugar','mochi',true);
    assert.equal(a.sample({...e,soft:false,type:'press',intensity:.4}),'key_mechanical_click');
    assert.equal(a.sample({...e,soft:false,type:'press',intensity:.9}),'key_deep_thock');
    assert.equal(a.sample({...e,soft:false,type:'release'}),'');
    assert.equal(a.sample({...e,soft:false,type:'micro_crack',intensity:.4}),'');
    assert.equal(a.sample({...e,soft:false,type:'shell_break',intensity:.9}),'');
    assert.equal(a.sample({...e,soft:false,type:'fragment',intensity:.9}),'');
    assert.equal(a.sample(e),'key_mechanical_click','an exposed keyboard key keeps its key press sound');
    assert.equal(a.sample({...e,type:'release'}),'','release does not add a second sound');
    a.sounds.set('key_mechanical_click',[{}]);
    const before=sources.length;
    a.handleEvent({...e,generation:5,soft:false,type:'press',intensity:.4});
    a.handleEvent({...e,generation:5,soft:false,type:'shell_break',intensity:.9});
    a.handleEvent({...e,generation:5,soft:false,type:'release'});
    assert.equal(sources.length,before+1,'one key press creates exactly one audio voice');
    a.reset(6,'sugar');assert.equal(a.sample({...e,soft:false,type:'shell_break',intensity:.4}),'shell_sugar_grit_crack');
    a.reset(7,'chocolate');
    assert.equal(a.sample({...e,soft:false,type:'shell_break',intensity:.4}),'shell_chocolate_break');
    assert.equal(a.sample({...e,soft:false,type:'shell_break',intensity:.9}),'shell_chocolate_crunch');
  } finally {await rm(temp,{recursive:true,force:true});}
});
