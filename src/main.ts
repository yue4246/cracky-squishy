import './style.css';
import { trackEvent } from './analytics';
import { AudioEngine } from './core/AudioEngine';
import { SquishyStateMachine, clamp, type Point } from './core/SquishyStateMachine';
import { PointerController, type PointerInput } from './input/PointerController';
import { SceneManager } from './rendering/SceneManager';
import { characters, starterCharacters, isBoxCharacter } from './data/characters';
import { SquishyStore, type CollectionRecord } from './store/SquishyStore';
import { setupMysteryBox } from './mysteryBox';
import { setupCabinet } from './collection';
import { setupCatalog } from './catalog';

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const status = document.querySelector<HTMLElement>('#status')!;
const select = document.querySelector<HTMLSelectElement>('#character')!;
const start = document.querySelector<HTMLButtonElement>('#start-btn')!;
const sound = document.querySelector<HTMLButtonElement>('#sound')!;
const retry = document.querySelector<HTMLButtonElement>('#retry')!;
const audioStatus = document.querySelector<HTMLElement>('#audio-status')!;
const model = new SquishyStateMachine();
const audio = new AudioEngine();
const scene = new SceneManager(canvas, model);
let index = 0, started = false, loading = false, loadVersion = 0;
let keyHeld = false;
let keyboardPoint: Point = { x: 0.5, y: 0.5 };
let pointer: PointerController;
let grab: Point | null = null;
let dragged = false;
function trackDrag(): void {
  if (!dragged) { store.track('squishy_drag', characters[index].id); dragged = true; }
}
let activeCollection: CollectionRecord | null = null;
let requestedRestore: CollectionRecord | undefined;
let obtainedAt = new Date();
let activeSince: number | null = null;
let dirtyCollection = false;
let saveTimer: ReturnType<typeof setTimeout>;
function saveCurrent(pause = true, create = false): boolean {
  clearTimeout(saveTimer);
  if (loading || !scene.squishy.ready || (!model.pressCount && !create)) return true;
  if (!dirtyCollection && activeSince === null && !create) return true;
  const elapsed = activeSince === null ? 0 : performance.now() - activeSince;
  const totalPlayTime = (activeCollection?.totalPlayTime ?? 0) + elapsed;
  const finalState = scene.squishy.exportState();
  const saved = activeCollection
    ? store.updateCollection(activeCollection.id, { finalState, totalPlayTime, lastPlayedAt: new Date().toISOString() })
    : !!(activeCollection = store.addCollection(characters[index].id, finalState, totalPlayTime, obtainedAt));
  if (!saved) {
    status.hidden=false; status.textContent='这只还没保存成功，请重试；当前状态仍保留';
    return false;
  }
  activeCollection = store.getCollection(activeCollection!.id);
  activeSince = pause ? null : activeSince === null ? null : performance.now();
  dirtyCollection = false;
  return true;
}
function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (!model.contact) saveCurrent(false); }, 700);
}

function refreshPicker(): void {
  select.replaceChildren();
  for (const character of starterCharacters) select.add(new Option(character.name, String(characters.indexOf(character))));
  if (isBoxCharacter(characters[index].id) && activeCollection) select.add(new Option(`${characters[index].name} · ${characters[index].tier==='hidden-box'?'隐藏款':'盲盒款'}`, String(index)));
  select.value=String(index);
}
function stepCharacter(direction: number): void {
  const current=starterCharacters.findIndex(c=>c.id===characters[index].id);
  const next=(current+direction+starterCharacters.length)%starterCharacters.length;
  void changeCharacter(characters.indexOf(starterCharacters[next]));
}
function onInput(input: PointerInput): boolean {
  if (!started || loading || !scene.squishy.ready) return false;
  if(scene.squishy.keyboard?.pan(input))return true;
  if (input.type === 'up' || input.type === 'cancel') {
    grab = null; model.end(input.type === 'cancel'); audio.release(); scheduleSave(); return true;
  }
  if(input.type==='move' && grab && model.contact) {
    if(scene.squishy.keyboard){if(!input.simulated)model.contact.force=input.force;return true;}
    if (Math.hypot(input.x-grab.x, input.y-grab.y) > 3) trackDrag();
    model.drag((input.x-grab.x)/scene.squishy.interactionSize, (input.y-grab.y)/scene.squishy.interactionSize, input.force);
    return true;
  }
  const hit = scene.squishy.hitTest(input.x, input.y);
  if (!hit) { if (input.type === 'move') { model.leaveSurface(); model.end(true); audio.release(); } return false; }
  if (input.type === 'down') {
    if (model.contact) { model.end(true); audio.release(); }
    if (audio.state === 'SUSPENDED') void audio.init();
    grab = {x:input.x,y:input.y};
    return model.begin(hit, input.force, input.simulated);
  }
  if (model.contact) model.move(hit, input.force);
  return true;
}
pointer = new PointerController(canvas, onInput);
model.onEvent = event => {
  scene.squishy.handleEvent(event);
  audio.handleEvent(event);
  if (event.type === 'press') {
    dragged = false; store.track('squishy_press', characters[index].id);
    if (activeSince === null) activeSince = performance.now();
    dirtyCollection = true;
  }
  if (event.type === 'release') scheduleSave();
  const labels = { press: event.soft ? '软芯留下新的凹坑' : '触点立即脆裂', micro_crack: '真实蜡皮裂口已经出现', shell_break: '蜡皮崩开并开始掉落', soft_squish: '继续揉捏，软芯会留下新的形状', scrape: '沿着表面慢慢揉', release: '松开，刚才的形状保留下来了', fragment: '' };
  if (labels[event.type]) status.textContent = labels[event.type];
};
audio.onStatus = () => {
  sound.textContent = audio.muted ? '开启声音' : '声音已开启'; sound.setAttribute('aria-pressed', String(!audio.muted));
  audioStatus.textContent = audio.state === 'LOADING' ? '音效准备中…' : audio.state === 'SILENT' ? '音效未加载，点声音按钮重试' : audio.state === 'SUSPENDED' ? '点声音按钮恢复声音' : '';
};
function releaseAll(): void { pointer.release(); keyHeld = false; model.end(true); audio.stop(); }
async function changeCharacter(next: number, restore?: CollectionRecord, fresh = false): Promise<boolean> {
  const target=characters[(next+characters.length)%characters.length];
  if (isBoxCharacter(target.id) && (!restore || restore.characterId !== target.id || !store.getCollection(restore.id))) return false;
  releaseAll();
  if (!saveCurrent()) { select.value=String(index); return false; }
  if (restore && !fresh) {
    const latest=store.getCollection(restore.id);
    if (!latest) return false;
    restore=latest;
  }
  requestedRestore=restore;
  activeCollection=null; activeSince=null; dirtyCollection=false; obtainedAt=new Date();
  const version = ++loadVersion;
  index = (next + characters.length) % characters.length; select.value = String(index);
  document.querySelector<HTMLElement>('#material-note')!.textContent=characters[index].filling ?? '';
  loading = true; retry.hidden = true; status.textContent = '玩具准备中…';
  model.reset(); audio.reset(model.generation, characters[index].material, characters[index].coreMaterial, !!characters[index].keyboard); scene.squishy.clear();
  try {
    await scene.squishy.load(characters[index]);
    if (version !== loadVersion) return false;
    if (restore && !fresh) {
      scene.squishy.restoreState(restore.finalState);
      audio.reset(model.generation, characters[index].material, characters[index].coreMaterial, !!characters[index].keyboard);
      activeCollection=restore; obtainedAt=new Date(restore.obtainedAt);
    }
    if (fresh) {
      loading=false;
      if (!saveCurrent(true, true)) return false;
    }
    if (restore && !fresh) store.track('continue_squish', target.id);
    if (fresh) store.track('squishy_reset', target.id);
    if (started) store.track('squishy_open', target.id);
    refreshPicker();
    document.querySelector<HTMLButtonElement>('#reset')!.hidden = false;
    status.textContent = target.keyboard ? '逐键按压 · 拖动底座移动键盘 · 换新恢复全部按键' : '轻触小裂口 · 稍按裂得更开 · 反复揉捏逐渐脱壳';
    return true;
  } catch (error) {
    if (version !== loadVersion) return false;
    status.textContent = `素材加载失败：${error instanceof Error ? error.message : '请重试'}`; retry.hidden = false;
    return false;
  } finally { if (version === loadVersion) loading = false; }
}
function startPlaying(): void {
  if (!started) store.track('squishy_open', characters[index].id);
  started = true; document.querySelector<HTMLElement>('#intro')!.hidden = true;
  document.querySelector<HTMLElement>('#controls')!.hidden = false;
  status.hidden = false; void audio.init(); canvas.focus({ preventScroll: true });
  scene.squishy.relayout();
}
start.addEventListener('click', startPlaying);
select.addEventListener('change', () => { void changeCharacter(Number(select.value)); });
document.querySelector('#previous')!.addEventListener('click', () => { stepCharacter(-1); });
document.querySelector('#next')!.addEventListener('click', () => { stepCharacter(1); });
document.querySelector('#reset')!.addEventListener('click', () => { void changeCharacter(index, activeCollection ?? undefined, true); });
retry.addEventListener('click', () => { void changeCharacter(index, requestedRestore); });
sound.addEventListener('click', () => {
  if (audio.state !== 'READY') { audio.setMuted(false); void audio.init(); }
  else audio.setMuted(!audio.muted);
});
canvas.addEventListener('keydown', e => {
  if (!started || loading) return;
  if (e.code === 'Space') {
    e.preventDefault(); if (e.repeat || keyHeld || model.contact) return;
    const p = scene.squishy.toScreen(keyboardPoint), hit = scene.squishy.hitTest(p.x, p.y);
    if (hit) keyHeld = model.begin(hit, .18, true);
  } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault();
    keyboardPoint = { x: clamp(keyboardPoint.x + (e.key === 'ArrowLeft' ? -0.03 : e.key === 'ArrowRight' ? 0.03 : 0)), y: clamp(keyboardPoint.y + (e.key === 'ArrowUp' ? -0.03 : e.key === 'ArrowDown' ? 0.03 : 0)) };
    scene.squishy.keyboardPoint = keyboardPoint; scene.squishy.refresh();
    if (keyHeld) { const p = scene.squishy.toScreen(keyboardPoint), hit = scene.squishy.hitTest(p.x, p.y); if (hit) { trackDrag(); model.move(hit, 0.5); } }
  }
});
canvas.addEventListener('keyup', e => { if (e.code === 'Space' && keyHeld) { e.preventDefault(); keyHeld = false; model.end(); audio.release(); } });
canvas.addEventListener('blur', () => { keyHeld = false; model.end(true); audio.release(); scene.squishy.keyboardPoint = null; scene.squishy.refresh(); scheduleSave(); });
window.addEventListener('blur', () => { releaseAll(); saveCurrent(); store.flushAnalytics(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { releaseAll(); saveCurrent(); store.flushAnalytics(); } });
window.addEventListener('pagehide', () => { releaseAll(); saveCurrent(); store.flushAnalytics(); });
// Read-only diagnostics for local regression checks; omitted from production builds.
if (import.meta.env.DEV) Object.assign(window, { squishyDebug: { model, renderer: scene.squishy, audio, characters } });
const store = new SquishyStore();
store.recordVisit();
trackEvent('page_view');
trackEvent('app_open');
if (import.meta.env.DEV) Object.assign(window, { DEV_ANALYTICS: {
  summary: () => {
    const data = store.getAnalytics();
    const summary = { 打开次数: data.counts.app_open ?? 0, 总按压次数: data.counts.squishy_press ?? 0,
      今日角色入口次数: data.counts.daily_squishy_open ?? 0, 神秘盒领取次数: data.counts.mystery_box_claim ?? 0,
      今日已领取: store.getMysteryBox().claimed, 收藏数量: store.getCollection().length };
    console.table(summary);
    console.table(characters.map(c => ({ 角色: c.name, 进入次数: data.characterUses[c.id] ?? 0, 按压次数: data.characterPresses[c.id] ?? 0 })));
    return summary;
  }, events: () => store.getAnalytics().events,
} });
setupCabinet(store, () => { releaseAll(); return saveCurrent(); }, async (record, fresh) => {
  const next=characters.findIndex(character=>character.id===record.characterId);
  if(next<0)return false;
  const loaded=await changeCharacter(next,record,fresh);
  if(loaded) startPlaying();
  return loaded;
});
setupCatalog(store,async record=>{
  const next=characters.findIndex(character=>character.id===record.characterId);
  if(next<0)return false;
  const loaded=await changeCharacter(next,record);
  if(loaded)startPlaying();
  return loaded;
});
const refreshMysteryBox = setupMysteryBox(store, async record => {
  const loaded=await changeCharacter(characters.findIndex(c=>c.id===record.characterId),record);
  if (loaded) startPlaying();
  return loaded;
}, () => {
  const event = { id: Date.now(), generation: model.generation, pressId: model.pressCount,
    type: 'micro_crack' as const, intensity: .18, soft: false, x: .5, y: .5, pan: 0 };
  if (audio.muted) return;
  if (audio.state === 'READY') audio.handleEvent(event);
  else void audio.init().then(() => audio.handleEvent(event));
});
let boxTimer: ReturnType<typeof setTimeout>;
function refreshBox(): void {
  if (!document.hidden) {
    const player = store.recordVisit(new Date(), false);
    const streak = document.querySelector<HTMLElement>('#streak-note')!;
    streak.textContent = `连续来捏 ${player.streak} 天`; streak.hidden = player.streak < 2;
  }
  refreshMysteryBox();
  const note=document.querySelector<HTMLElement>('#storage-note')!;
  note.textContent=store.error;note.hidden=!store.error;
  clearTimeout(boxTimer);
  const now=new Date();
  boxTimer=setTimeout(refreshBox,new Date(now.getFullYear(),now.getMonth(),now.getDate()+1).getTime()-now.getTime()+50);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshBox();});
window.addEventListener('pageshow',refreshBox);
refreshBox();
scene.start(); void changeCharacter(characters.indexOf(starterCharacters[0]));
