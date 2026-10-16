import { characters } from './data/characters';
import { SquishyStore, type CollectionRecord } from './store/SquishyStore';

export function setupMysteryBox(store: SquishyStore, enter: (record: CollectionRecord) => Promise<boolean>, playRustle: () => void) {
  const open = document.querySelector<HTMLButtonElement>('#mystery-open')!;
  const view = document.querySelector<HTMLButtonElement>('#mystery-view')!;
  const note = document.querySelector<HTMLElement>('#mystery-note')!;
  const dialog = document.querySelector<HTMLDialogElement>('#mystery-dialog')!;
  const stage = document.querySelector<HTMLElement>('#mystery-stage')!;
  const box = document.querySelector<HTMLElement>('#mystery-parcel')!;
  const result = document.querySelector<HTMLElement>('#mystery-result')!;
  const heading = document.querySelector<HTMLElement>('#mystery-title')!;
  const image = document.querySelector<HTMLImageElement>('#mystery-image')!;
  const name = document.querySelector<HTMLElement>('#mystery-name')!;
  const play = document.querySelector<HTMLButtonElement>('#mystery-play')!;
  let busy = false;
  let collectionId: string | null = null;
  let reward: typeof characters[number] | null = null;
  let timer: ReturnType<typeof setTimeout>;
  function refresh(): void {
    const state = store.getMysteryBox();
    open.disabled = busy || state.claimed;
    open.textContent = state.claimed ? '明天再来' : busy ? '正在打开…' : '打开饭盒';
    view.hidden = !state.reward || busy;
  }
  function reveal(): void {
    clearTimeout(timer); box.hidden = true;
    if (!reward) return;
    heading.textContent = reward.tier === 'hidden-box' ? '你获得了 · 隐藏甜品' : '你获得了 · 基础甜品';
    stage.classList.remove('opening');
    image.src = `./characters/${encodeURIComponent(reward.image)}`;
    image.alt = reward.name;
    name.textContent = reward.name;
    result.hidden = false; busy = false; refresh();
    play.disabled = !collectionId;
    document.querySelector<HTMLElement>('#mystery-saved')!.textContent = collectionId ? '这份小甜品，已经住进你的捏捏柜' : '旧版奖励已保留，新甜品盲盒明天开启';
    if (dialog.open) play.focus();
  }
  open.addEventListener('click', async () => {
    if (busy) return;
    busy = true; open.disabled = true; note.textContent = '';
    try {
      store.track('mystery_box_open');
      const claimed = await store.claimMysteryBox();
      reward = claimed;
      if (!reward) {
        busy = false; refresh();
        if (!store.getMysteryBox().claimed) note.textContent = '暂时无法保存领取，请稍后重试';
        return;
      }
      collectionId = claimed!.collectionId;
      heading.textContent = '掀开一份软软的惊喜'; result.hidden = true; box.hidden = false;
      image.src = `./characters/${encodeURIComponent(reward.image)}`; image.alt = reward.name;
      dialog.showModal();
      stage.classList.remove('opening'); void stage.offsetWidth; stage.classList.add('opening');
      playRustle();
      timer = setTimeout(reveal, 1800);
    } catch {
      busy = false; refresh(); note.textContent = '开盒暂时不可用，请稍后重试';
    }
  });
  view.addEventListener('click', () => {
    const state = store.getMysteryBox();
    reward = state.reward; collectionId = state.collectionId;
    if (reward) { dialog.showModal(); reveal(); }
  });
  document.querySelector('#mystery-close')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { clearTimeout(timer); busy = false; refresh(); });
  play.addEventListener('click', async () => {
    const record = collectionId ? store.getCollection(collectionId) : null;
    if (!record || busy) return;
    busy=true;play.disabled=true;
    try {
      if (await enter(record)) { dialog.close(); document.querySelector<HTMLCanvasElement>('#scene')!.focus({preventScroll:true}); }
      else document.querySelector<HTMLElement>('#mystery-saved')!.textContent='暂时无法加载；甜品已在捏捏柜中，可以稍后继续';
    } finally {busy=false;play.disabled=false;}
  });
  window.addEventListener('storage', refresh);
  refresh();
  return refresh;
}
