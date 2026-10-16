import { characters, starterCharacters } from './data/characters';
import type { CollectionRecord, SquishyStore } from './store/SquishyStore';

export function setupCatalog(store:SquishyStore,enter:(record:CollectionRecord)=>Promise<boolean>):void {
  const dialog=document.querySelector<HTMLDialogElement>('#catalog-dialog')!;
  const trigger=document.querySelector<HTMLButtonElement>('#catalog-open')!;
  const closeButton=document.querySelector<HTMLButtonElement>('#catalog-close')!;
  const book=dialog.querySelector<HTMLElement>('.catalog-book')!;
  const list=document.querySelector<HTMLElement>('#catalog-list')!;
  const note=document.querySelector<HTMLElement>('#catalog-note')!;
  const starter=new Set(starterCharacters.map(character=>character.id));
  function render():void {
    const discovered=new Set(store.getDiscoveredIds()),records=store.getCollection();
    list.replaceChildren();note.textContent=`已点亮 ${discovered.size} / ${characters.length}`;
    for(const character of characters) {
      const owned=records.filter(record=>record.characterId===character.id),locked=!discovered.has(character.id);
      const card=document.createElement('article');card.className=`catalog-card${locked?' is-locked':''}`;
      const photo=document.createElement('div');photo.className='catalog-photo';
      const image=document.createElement('img');image.src=`./characters/${encodeURIComponent(character.image)}`;
      image.alt=locked?'':character.name;image.setAttribute('aria-hidden',String(locked));photo.append(image);
      if(locked){const mark=document.createElement('span');mark.className='catalog-locked-mark';mark.textContent='?';mark.setAttribute('aria-hidden','true');photo.append(mark);}
      const name=document.createElement('strong');name.textContent=locked?'尚未获得':character.name;
      const detail=document.createElement('small');
      detail.textContent=locked?'打开每日甜品盲盒来点亮':starter.has(character.id)?`常设款 · 已拥有 ${owned.length}`:`${character.filling} · 已拥有 ${owned.length}`;
      card.append(photo,name,detail);
      if(!locked && owned.length){
        const button=document.createElement('button');button.textContent='看看这只';
        button.addEventListener('click',async()=>{button.disabled=true;try{if(await enter(owned[owned.length-1]))dialog.close();else note.textContent='这只甜品暂时无法加载';}finally{button.disabled=false;}});
        card.append(button);
      }
      list.append(card);
    }
  }
  trigger.addEventListener('click',()=>{
    render();
    dialog.showModal();
    const from=trigger.getBoundingClientRect(),to=dialog.getBoundingClientRect();
    dialog.style.setProperty('--catalog-dx',`${from.left+from.width/2-to.left-to.width/2}px`);
    dialog.style.setProperty('--catalog-dy',`${from.top+from.height/2-to.top-to.height/2}px`);
    dialog.style.setProperty('--catalog-scale',String(Math.min(from.width/to.width,from.height/to.height)));
    closeButton.focus({preventScroll:true});
  });
  function closeCatalog():void {
    if(book.classList.contains('is-closing'))return;
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){dialog.close();return;}
    book.classList.add('is-closing');
    window.setTimeout(()=>{dialog.close();book.classList.remove('is-closing');trigger.focus();},280);
  }
  closeButton.addEventListener('click',closeCatalog);
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeCatalog();});
  dialog.addEventListener('click',event=>{if(event.target===dialog)closeCatalog();});
}
