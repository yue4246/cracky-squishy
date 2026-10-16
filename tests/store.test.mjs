import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm, access } from 'node:fs/promises';
const output = join(tmpdir(), `squishy-store-${process.pid}.mjs`);
await build({stdin:{contents:"export * from './src/store/SquishyStore'; export * from './src/data/characters';",resolveDir:process.cwd(),loader:'ts'},outfile:output,bundle:true,platform:'node',format:'esm'});
const { SquishyStore, STORE_KEY, characters, dailyCharacters, starterCharacters, mysteryCharacters, baseMysteryCharacters, hiddenMysteryCharacters } = await import(pathToFileURL(output));
after(() => rm(output, {force:true}));
function memory() { const data = new Map(); return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}; }
const today = new Date(2026,9,5,23,59);
test('daily selection survives refresh and changes at local midnight, month and year boundaries', () => {
 const storage=memory(); const store=new SquishyStore(storage,today);
 const first=store.getDailySquishy(today);
 assert.equal(store.getDailySquishy(new Date(2026,9,5,0)).id,first.id);
 assert.equal(new SquishyStore(storage,today).getDailySquishy(today).id,first.id);
 for(const date of [new Date(2026,9,6),new Date(2026,10,1),new Date(2027,0,1)]) {
  const previous=new Date(date); previous.setDate(date.getDate()-1);
  assert.notEqual(store.getDailySquishy(previous).id,store.getDailySquishy(date).id);
 }
 assert.equal(JSON.parse(storage.getItem(STORE_KEY)).version,1);
});
test('daily selection works without storage; unavailable writes report failure', () => {
 const storage={getItem(){throw Error('denied');},setItem(){throw Error('quota');}};
 const store=new SquishyStore(storage,today);
 assert.equal(store.getDailySquishy(today).id,new SquishyStore(storage,today).getDailySquishy(today).id);
 assert.equal(store.save(),false);
 assert.ok(store.error);
});
test('malformed and future saves are preserved instead of overwritten', () => {
 for(const raw of ['{broken',JSON.stringify({version:2}),JSON.stringify({version:1,daily:null})]) {
  const storage=memory(); storage.setItem(STORE_KEY,raw);
  const store=new SquishyStore(storage,today);
  assert.ok(store.getDailySquishy(today).id);
  assert.equal(store.save(),false);
  assert.equal(storage.getItem(STORE_KEY),raw);
 }
});
test('existing daily result and unrelated saved fields survive loading', () => {
 const storage=memory(); new SquishyStore(storage,today).getDailySquishy(today);
 const data=JSON.parse(storage.getItem(STORE_KEY));
 data.daily.squishyId=dailyCharacters[0].id; data.unlocked=['test']; data.collection=[{id:'existing'}];
 storage.setItem(STORE_KEY,JSON.stringify(data));
 const store=new SquishyStore(storage,today);
 assert.equal(store.getDailySquishy(today).id,dailyCharacters[0].id);
 store.getDailySquishy(new Date(2026,9,6));
 assert.deepEqual(JSON.parse(storage.getItem(STORE_KEY)).collection,data.collection);
 assert.deepEqual(JSON.parse(storage.getItem(STORE_KEY)).unlocked,data.unlocked);
});
test('daily pool has stable unique IDs, real images and material labels', async () => {
 assert.equal(new Set(characters.map(c=>c.id)).size,characters.length);
 assert.ok(dailyCharacters.length>1);
 for(const c of dailyCharacters) { await access(join('public/characters',c.image)); assert.ok(c.filling); }
});

test('five new dessert designs form the base mystery pool with complete material metadata', async()=>{
 assert.deepEqual(baseMysteryCharacters.map(c=>c.id),['bunny-bread','little-dumpling','donut','puppy-bread','bath-egg']);
 for(const c of baseMysteryCharacters){
  await access(join('public/characters',c.image));
  assert.equal(c.tier,'base-box');assert.ok(c.filling);assert.ok(c.coreMaterial);
 }
 assert.ok(hiddenMysteryCharacters.length>0);
 assert.ok(mysteryCharacters.length===baseMysteryCharacters.length+hiddenMysteryCharacters.length);
});

test('mystery draw uses the base pool for the first 80 percent and the hidden pool for the rest',async()=>{
 const base=new SquishyStore(memory(),today,()=>.5),hidden=new SquishyStore(memory(),today,()=>.95);
 assert.equal((await base.claimMysteryBox(today)).tier,'base-box');
 assert.equal((await hidden.claimMysteryBox(today)).tier,'hidden-box');
});

test('catalog discovery includes permanent styles and claimed rewards without changing old saves',async()=>{
 const storage=memory(),store=new SquishyStore(storage,today,()=>.5);
 const before=JSON.parse(storage.getItem(STORE_KEY)??'null');
 assert.deepEqual(new Set(store.getDiscoveredIds()),new Set(starterCharacters.map(c=>c.id)));
 const reward=await store.claimMysteryBox(today);
 assert.ok(store.getDiscoveredIds().includes(reward.id));
 assert.equal(JSON.parse(storage.getItem(STORE_KEY)).version,1);
 assert.equal(before?.version??1,1);
});

test('mystery box claims once, persists unlock and survives refresh/stale tabs', async () => {
 const storage=memory(), first=new SquishyStore(storage,today), stale=new SquishyStore(storage,today);
 const reward=await first.claimMysteryBox(today);
 assert.ok(reward?.id);
 assert.equal(await first.claimMysteryBox(today),null);
 assert.equal(await stale.claimMysteryBox(today),null);
 const restored=new SquishyStore(storage,today);
 assert.equal(restored.getMysteryBox(today).reward.id,reward.id);
 assert.equal(restored.getMysteryBox(today).claimed,true);
 assert.ok(JSON.parse(storage.getItem(STORE_KEY)).unlocked.includes(reward.id));
 assert.ok(await restored.claimMysteryBox(new Date(2026,9,6)));
});
test('failed mystery save does not grant a reward or consume the claim', async () => {
 const storage=memory(); const store=new SquishyStore(storage,today);store.getDailySquishy(today);
 const set=storage.setItem;storage.setItem=()=>{throw Error('quota');};
 assert.equal(await store.claimMysteryBox(today),null);
 assert.equal(store.getMysteryBox(today).claimed,false);
 storage.setItem=set;
 assert.ok(await store.claimMysteryBox(today));
});
test('mystery reward cannot be duplicated by concurrent calls', async () => {
 const store=new SquishyStore(memory(),today);
 const results=await Promise.all([store.claimMysteryBox(today),store.claimMysteryBox(today)]);
 assert.equal(results.filter(Boolean).length,1);
});

test('cabinet preserves separate instances, history and favorites through refresh', () => {
 const storage=memory(),store=new SquishyStore(storage,today);store.getDailySquishy(today);
 const state={version:1,pressCount:3,damage:Array(576).fill(.5),opened:Array(576).fill(0),residualX:Array(625).fill(0),residualY:Array(625).fill(0),residualH:Array(625).fill(-.05),wax:[]};
 const first=store.addCollection('cat-bread',state,1000,today);
 assert.ok(first?.id);
 const second=store.addCollection('cat-bread',state,0,today);
 assert.notEqual(first.id,second.id);
 assert.ok(store.updateCollection(first.id,{favorite:true,totalPlayTime:2100}));
 const refreshed=new SquishyStore(storage,today);
 assert.equal(refreshed.getCollection().length,2);
 assert.equal(refreshed.getCollection(first.id).favorite,true);
 assert.equal(refreshed.getCollection(first.id).totalPlayTime,2100);
 assert.equal(refreshed.getCollection(second.id).favorite,false);
 assert.equal(refreshed.getCollection(first.id).pressCount,3);
 const copy=refreshed.getCollection(first.id);copy.finalState.pressCount=999;
 assert.equal(refreshed.getCollection(first.id).finalState.pressCount,3);
 assert.equal(store.addCollection('missing',state,0,today),null);
 assert.equal(store.updateCollection(first.id,{totalPlayTime:-1}),false);
 const set=storage.setItem;storage.setItem=()=>{throw Error('quota');};
 assert.equal(store.updateCollection(first.id,{favorite:false}),false);
 storage.setItem=set;
 assert.equal(store.getCollection(first.id).favorite,true);
});

test('dessert box grants a locked instance atomically, never a starter',async()=>{
 const store=new SquishyStore(memory(),today);
 const reward=await store.claimMysteryBox(today);
 assert.ok(!['cat-bread','watermelon','flower-bunny','sugar-bread'].includes(reward.id));
 const box=store.getMysteryBox(today);
 assert.ok(box.collectionId);
 assert.equal(store.getCollection(box.collectionId).characterId,reward.id);
 assert.equal(store.getCollection(box.collectionId).pressCount,0);
 assert.equal(store.getCollection().length,1);
 assert.equal(await store.claimMysteryBox(today),null);
 assert.equal(store.getCollection().length,1);
 assert.ok(store.addCollection(reward.id,store.getCollection(box.collectionId).finalState),'an unlocked hidden toy can be replaced with a fresh copy');
 const locked=mysteryCharacters.find(c=>c.id!==reward.id);
 assert.equal(store.addCollection(locked.id,store.getCollection(box.collectionId).finalState),null,'unobtained hidden toys remain locked');
});


test('starter selector excludes the retired keyboard and every box reward has artwork', async()=>{
 assert.deepEqual(starterCharacters.map(c=>c.id),['cat-bread','watermelon','flower-bunny','sugar-bread']);
 assert.ok(!characters.some(c=>c.id==='orange-keyboard'));
 for(const c of mysteryCharacters) {
  assert.ok(!starterCharacters.some(s=>s.id===c.id));
  await access(join('public/characters',c.image));
 }
 const storage=memory(),store=new SquishyStore(storage,today);store.getDailySquishy(today);
 const raw=storage.getItem(STORE_KEY);storage.setItem=()=>{throw Error('quota');};
 assert.equal(await store.claimMysteryBox(today),null);
 assert.equal(storage.getItem(STORE_KEY),raw,'failed grant must not consume box or add hidden instance');
});

test('visits count sessions once and streak follows local calendar days',()=>{
 const storage=memory(),store=new SquishyStore(storage,today);
 assert.equal(store.recordVisit(today).streak,1);
 assert.equal(store.recordVisit(today,false).totalSessions,1);
 assert.equal(new SquishyStore(storage,today).recordVisit(today).streak,1);
 assert.equal(store.recordVisit(new Date(2026,9,6),false).streak,2);
 assert.equal(store.recordVisit(new Date(2026,9,8),false).streak,1);
 assert.equal(store.recordVisit(new Date(2026,9,7),false).streak,1);
 store.flushAnalytics();
 assert.equal(store.getAnalytics().counts.app_open,2);
});
test('analytics batches writes, retains totals beyond its bounded event history',()=>{
 const storage=memory(),store=new SquishyStore(storage,today);
 for(let i=0;i<2100;i++) store.track('squishy_press','cat-bread');
 assert.equal(storage.getItem('cracky-squishy:analytics:v1'),null);
 store.flushAnalytics();
 const restored=new SquishyStore(storage,today).getAnalytics();
 assert.equal(restored.counts.squishy_press,2100);
 assert.equal(restored.events.length,2000);
 assert.equal(restored.characterPresses['cat-bread'],2100);
 assert.doesNotThrow(()=>{const denied=new SquishyStore({getItem(){throw Error();},setItem(){throw Error();}},today);denied.track('app_open');denied.flushAnalytics();});
});

test('streak crosses leap day and year boundaries without treating refresh as a new day',()=>{
 for (const [a,b] of [[new Date(2024,1,28),new Date(2024,1,29)],[new Date(2024,1,29),new Date(2024,2,1)],[new Date(2026,11,31),new Date(2027,0,1)]]) {
  const store=new SquishyStore(memory(),a);store.recordVisit(a);
  assert.equal(store.recordVisit(b,false).streak,2);
  assert.equal(store.recordVisit(b,false).streak,2);
 }
});
test('broken telemetry is preserved and cannot prevent successful toy storage',async()=>{
 const storage=memory(),store=new SquishyStore(storage,today);
 storage.setItem('cracky-squishy:analytics:v1','{broken');
 store.track('app_open');assert.equal(store.flushAnalytics(),false);
 assert.ok(await store.claimMysteryBox(today));
 assert.equal(store.getCollection().length,1);
 assert.equal(storage.getItem('cracky-squishy:analytics:v1'),'{broken');
});
