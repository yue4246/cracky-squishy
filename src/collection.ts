import { characters } from './data/characters';
import { SquishyStateMachine } from './core/SquishyStateMachine';
import { ClayRenderer } from './rendering/ClayRenderer';
import { SquishyStore, type CollectionRecord } from './store/SquishyStore';

const date = (value: string) => new Date(value).toLocaleDateString('zh-CN');
const duration = (ms: number) => `${Math.floor(ms/60000)}分${Math.floor(ms/1000)%60}秒`;
export function setupCabinet(store: SquishyStore, save: () => boolean, enter: (record: CollectionRecord, fresh: boolean) => Promise<boolean>) {
  const dialog = document.querySelector<HTMLDialogElement>('#cabinet-dialog')!;
  const list = document.querySelector<HTMLElement>('#cabinet-list')!;
  const detail = document.querySelector<HTMLElement>('#cabinet-detail')!;
  const note = document.querySelector<HTMLElement>('#cabinet-note')!;
  const title = document.querySelector<HTMLElement>('#cabinet-title')!;
  let generation = 0;
  let selected: CollectionRecord | null = null;
  let busy = false;
  // Render only visible cards, once, reusing the existing renderer without an animation loop.
  let queue = Promise.resolve();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      observer.unobserve(entry.target);
      const canvas=entry.target as HTMLCanvasElement;
      const record=store.getCollection(canvas.dataset.id!);
      const token=generation;
      if (record) queue=queue.then(async () => {
        if (token!==generation || !canvas.isConnected) return;
        const character=characters.find(c=>c.id===record.characterId);
        if (!character) return;
        const renderer=new ClayRenderer(canvas,new SquishyStateMachine());
        try {
          await renderer.load(character);
          if (token!==generation || !canvas.isConnected) return;
          renderer.restoreState(record.finalState); renderer.update(0);
        } catch { canvas.setAttribute('aria-label', `${record.characterName}，历史外观暂时无法加载`); }
        finally { renderer.dispose(); }
      });
    }
  }, {root:dialog});
  function preview(record: CollectionRecord): HTMLCanvasElement {
    const canvas=document.createElement('canvas');
    canvas.className='cabinet-preview';canvas.dataset.id=record.id;
    canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`${record.characterName}，捏了${record.pressCount}次后的样子`);
    observer.observe(canvas);return canvas;
  }
  function favorite(record: CollectionRecord): HTMLButtonElement {
    const button=document.createElement('button');button.className='cabinet-favorite';
    button.textContent=record.favorite?'♥':'♡';button.setAttribute('aria-label',record.favorite?'取消喜欢':'喜欢这只');
    button.setAttribute('aria-pressed',String(record.favorite));
    button.addEventListener('click',()=>{
      const current=store.getCollection(record.id);
      if (!current || !store.updateCollection(record.id,{favorite:!current.favorite})) {note.textContent='喜欢状态未能保存，请重试';return;}
      record.favorite=!current.favorite;
      button.textContent=record.favorite?'♥':'♡';button.setAttribute('aria-pressed',String(record.favorite));
      button.setAttribute('aria-label',record.favorite?'取消喜欢':'喜欢这只');
    });return button;
  }
  function showDetail(record: CollectionRecord): void {
    generation++;observer.disconnect();selected=record;list.hidden=true;detail.hidden=false;detail.replaceChildren();
    title.textContent=record.characterName;
    detail.append(preview(record));
    const stats=document.createElement('p');stats.className='cabinet-stats';
    stats.textContent=`获得日期：${date(record.obtainedAt)}\n最近陪伴：${date(record.lastPlayedAt)}\n被你捏了：${record.pressCount}次\n脆皮破损：${record.damageLevel}%\n形变程度：${record.deformationLevel}%\n累计陪伴：${duration(record.totalPlayTime)}`;
    detail.append(stats,favorite(record));
    for (const [label,fresh] of [['继续捏',false],['重新养一只',true]] as const) {
      const button=document.createElement('button');button.textContent=label;button.className='cabinet-action';
      button.addEventListener('click',async()=>{
        if (busy || !selected) return;
        busy=true;button.disabled=true;
        try { if(await enter(selected,fresh)) { dialog.close(); document.querySelector<HTMLCanvasElement>('#scene')!.focus({preventScroll:true}); } else note.textContent='暂时无法加载或保存，请重试；原收藏仍保留'; }
        finally {busy=false;button.disabled=false;}
      });detail.append(button);
    }
    const back=document.createElement('button');back.textContent='返回捏捏柜';back.className='cabinet-back';back.addEventListener('click',render);
    detail.append(back);back.focus();
  }
  function render(): void {
    generation++;observer.disconnect();selected=null;title.textContent='我的捏捏柜';detail.hidden=true;list.hidden=false;list.replaceChildren();
    const records=store.getCollection();
    if(!records.length){list.textContent='还没有捏过的小伙伴。去捏一捏，松手后就会住进来。';return;}
    for(const record of records.slice().reverse()) {
      const card=document.createElement('article');card.className='cabinet-card';
      const button=document.createElement('button');button.className='cabinet-card-open';
      const number=records.filter(r=>r.characterId===record.characterId).findIndex(r=>r.id===record.id)+1;
      button.append(preview(record));
      const name=document.createElement('strong');name.textContent=`${record.characterName} #${String(number).padStart(2,'0')}`;
      const stats=document.createElement('span');stats.textContent=`${date(record.obtainedAt)}\n捏了 ${record.pressCount} 次 · 破损 ${record.damageLevel}%`;
      button.append(name,stats);button.addEventListener('click',()=>showDetail(record));
      card.append(button,favorite(record));list.append(card);
    }
  }
  document.querySelector('#cabinet-open')!.addEventListener('click',()=>{
    if(!save()) return;
    store.track('collection_open');
    note.textContent='';dialog.showModal();render();
  });
  document.querySelector('#cabinet-close')!.addEventListener('click',()=>{if(!busy)dialog.close();});
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  dialog.addEventListener('close',()=>{generation++;observer.disconnect();});
}
