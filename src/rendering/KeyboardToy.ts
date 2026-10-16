import { makeWaxPieces, insideWax } from './WaxDamage';
import { clamp, type Point, type MaterialEvent } from '../core/SquishyStateMachine';
import type { PointerInput } from '../input/PointerController';

export const KEY_LAYOUT = [
  ['Esc','1','2','3','4','5','6','7','8','9','0','⌫'],
  ['Tab','Q','W','E','R','T','Y','U','I','O','P','↵'],
  ['Caps','A','S','D','F','G','H','J','K','L',';','↑'],
  ['Shift','Z','X','C','V','B','N','M',',','.','←','→'],
  ['Ctrl','Alt','Space','Fn','↓'],
].flatMap((row,r) => {
  let x=[25,41,20,45,56][r];
  return row.map((label,c)=>{
    const variation=((r*19+c*13)%11)-5;
    const w=label==='Space'?548:r===4?83+variation:70+variation;
    const key={label,x,y:30+r*82+((r*5+c*7)%15)-7,w,h:70+((r*11+c*3)%9)-4,
      angle:(((r*17+c*11)%15)-7)*.0055};
    x+=w+6+((r+c*2)%3)-1;return key;
  });
});
export interface KeyState { damage:number; depth:number; wax?: {damage:number; state:0|1|2}[] }
// Each key reuses the toy shell topology and pressure budget, in local coordinates.
export class KeyboardToy {
  states:KeyState[]=KEY_LAYOUT.map(()=>({damage:0,depth:0}));
  offset:Point={x:0,y:0};
  private origin:Point|null=null;
  private active=-1;
  private force=-1;
  private pieces=KEY_LAYOUT.map(()=>makeWaxPieces(17));
  private baseDepth=0;
  private scale=1;
  private left=0;
  private top=0;
  private width=0;
  private height=0;
  private sugar:CanvasPattern|null=null;
  layout(width:number,height:number):void {
    this.width=width;this.height=height;
    this.scale=Math.min(Math.max(width*.9,640),920,height*.95)/1000;
    this.clampPan();
  }
  private clampPan():void {
    const x=Math.max(0,(1000*this.scale-this.width)/2)+45;
    const y=Math.max(40,(480*this.scale-this.height*.45)/2);
    this.offset.x=clamp(this.offset.x,-x,x);this.offset.y=clamp(this.offset.y,-y,y);
    this.left=(this.width-1000*this.scale)/2+this.offset.x;
    this.top=(this.height-480*this.scale)/2+this.offset.y;
  }
  keyAt(p:Point):number {
    return KEY_LAYOUT.findIndex(k=>{const q=this.keyLocal(p,k);return q.x>=0&&q.x<=1&&q.y>=0&&q.y<=1;});
  }
  private keyLocal(p:Point,k:typeof KEY_LAYOUT[number]):Point {
    const dx=p.x*1000-k.x-k.w/2,dy=p.y*480-k.y-k.h/2,c=Math.cos(k.angle),s=Math.sin(k.angle);
    return {x:(c*dx+s*dy)/k.w+.5,y:(-s*dx+c*dy)/k.h+.5};
  }
  point(x:number,y:number):Point {return {x:(x-this.left)/(1000*this.scale),y:(y-this.top)/(480*this.scale)};}
  screen(p:Point):Point {return {x:this.left+p.x*1000*this.scale,y:this.top+p.y*480*this.scale};}
  pan(input:PointerInput):boolean {
    if(input.type==='down' && this.keyAt(this.point(input.x,input.y))<0)
      this.origin={x:input.x-this.offset.x,y:input.y-this.offset.y};
    if(!this.origin)return false;
    if(input.type==='move'){this.offset={x:input.x-this.origin.x,y:input.y-this.origin.y};this.clampPan();}
    if(input.type==='up'||input.type==='cancel')this.origin=null;
    return true;
  }
  event(event:MaterialEvent):void {
    if(event.type==='press'){
      this.active=this.keyAt(event);if(this.active<0)return;
      this.baseDepth=this.states[this.active].depth;this.force=-1;
      this.press(event.force??event.intensity);
    }
    if(event.type==='release')this.active=-1;
  }
  press(force:number):void {
    if(this.active<0)return;
    const s=this.states[this.active];
    if(force<=this.force)return;
    if(!s.wax || s.damage<1){
      s.wax=this.pieces[this.active].map(()=>({damage:1,state:2 as const}));
      s.damage=1;
    }
    s.depth=Math.max(s.depth,Math.min(.8,this.baseDepth+.11+force*.18));
    this.force=Math.max(this.force,force);
  }
  update(_dt:number):void {}
  exposed(p:Point):boolean {
    const i=this.keyAt(p);if(i<0)return false;
    const k=KEY_LAYOUT[i],local=this.keyLocal(p,k);
    return this.pieces[i].some((piece,n)=>this.states[i].wax?.[n]?.state===2 && insideWax(local,piece.polygon));
  }
  stop():void {this.active=-1;}
  restore(states:KeyState[]):void {
    this.pieces=KEY_LAYOUT.map(()=>makeWaxPieces(17));
    this.states=states.map((state,key)=>{
      const broken=state.damage>0 || state.wax?.some(piece=>piece.state!==0 || piece.damage>0);
      if(!broken)return {damage:0,depth:state.depth};
      return {...state,damage:1,wax:this.pieces[key].map(()=>({damage:1,state:2 as const}))};
    });
  }
  reset():void {this.pieces=KEY_LAYOUT.map(()=>makeWaxPieces(17));this.states=KEY_LAYOUT.map(()=>({damage:0,depth:0}));this.stop();this.origin=null;this.offset={x:0,y:0};this.clampPan();}
  draw(ctx:CanvasRenderingContext2D,dt:number,dpr:number):void {
    this.update(dt);
    if(!this.sugar){
      // Cache the sugar surface once; repeated frames only paint the native pattern.
      const tile=document.createElement('canvas');tile.width=128;tile.height=128;
      const grain=tile.getContext('2d')!;let seed=721;
      const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      for(let n=0;n<1260;n++){
        const x=random()*128,y=random()*128,r=.32+random()*.98;
        grain.beginPath();grain.ellipse(x,y,r,r*(.55+random()*.5),random()*Math.PI,0,Math.PI*2);
        grain.fillStyle=n%8?'#fffdf0b8':'#75402930';grain.fill();
        if(n%5===0){grain.beginPath();grain.arc(x-r*.28,y-r*.3,Math.max(.18,r*.3),0,Math.PI*2);grain.fillStyle='#ffffffd6';grain.fill();}
      }
      this.sugar=ctx.createPattern(tile,'repeat');
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,this.width,this.height);
    ctx.save();ctx.translate(this.left,this.top);ctx.scale(this.scale,this.scale);
    const handmade=(x:number,y:number,w:number,h:number,r:number,seed:number)=>{
      const a=((seed*17)%11)-5,b=((seed*29)%11)-5,c=((seed*43)%11)-5,d=((seed*61)%11)-5;
      ctx.beginPath();ctx.moveTo(x+r,y+a*.72);
      ctx.bezierCurveTo(x+w*.34,y+b*.78,x+w*.68,y+c*.7,x+w-r,y+d*.62);
      ctx.quadraticCurveTo(x+w+a*.25,y,x+w+b*.25,y+r);
      ctx.bezierCurveTo(x+w+c*.55,y+h*.34,x+w+d*.52,y+h*.7,x+w-r,y+h+a*.62);
      ctx.quadraticCurveTo(x+w,y+h,x+w-r-b*.2,y+h);
      ctx.bezierCurveTo(x+w*.68,y+h+c*.72,x+w*.33,y+h+d*.7,x+r,y+h+b*.62);
      ctx.quadraticCurveTo(x,y+h,x+a*.25,y+h-r);
      ctx.bezierCurveTo(x+b*.52,y+h*.7,x+c*.55,y+h*.34,x+r,y+a*.72);ctx.closePath();
    };
    ctx.shadowColor='#6e3a2638';ctx.shadowBlur=26;ctx.shadowOffsetY=15;
    const base=ctx.createLinearGradient(0,0,0,480);base.addColorStop(0,'#d89b73');base.addColorStop(.52,'#b97867');base.addColorStop(1,'#8f5b58');
    ctx.beginPath();ctx.moveTo(88,9);ctx.bezierCurveTo(282,-4,710,2,914,13);ctx.bezierCurveTo(976,17,995,61,985,124);ctx.bezierCurveTo(1000,249,988,382,960,430);ctx.bezierCurveTo(936,474,872,477,790,468);ctx.bezierCurveTo(592,481,280,475,91,467);ctx.bezierCurveTo(30,465,5,426,17,365);ctx.bezierCurveTo(3,247,9,112,27,62);ctx.bezierCurveTo(39,27,57,13,88,9);ctx.closePath();ctx.fillStyle=base;ctx.fill();ctx.shadowColor='transparent';
    ctx.beginPath();ctx.moveTo(91,24);ctx.bezierCurveTo(320,11,712,15,908,28);ctx.bezierCurveTo(958,32,977,68,968,126);ctx.bezierCurveTo(980,245,966,370,943,418);ctx.bezierCurveTo(922,453,862,458,783,450);ctx.bezierCurveTo(571,463,297,457,98,450);ctx.bezierCurveTo(48,447,28,416,37,363);ctx.bezierCurveTo(26,247,30,121,45,70);ctx.bezierCurveTo(55,40,70,28,91,24);ctx.closePath();ctx.fillStyle='#c98869';ctx.fill();
    ctx.save();ctx.clip();ctx.fillStyle=this.sugar!;ctx.fillRect(0,0,1000,480);ctx.restore();
    ctx.strokeStyle='#ffe7bd88';ctx.lineWidth=3;ctx.stroke();
    KEY_LAYOUT.forEach((k,i)=>{
      const s=this.states[i],pressed=i===this.active,broken=s.damage>=1,depth=s.depth*14+(pressed?3:0);
      ctx.save();ctx.translate(k.x+k.w/2,k.y+k.h/2);ctx.rotate(k.angle);ctx.translate(-k.w/2,-k.h/2);
      ctx.shadowColor='#6c392947';ctx.shadowBlur=7;ctx.shadowOffsetY=5;
      handmade(-1,4,k.w+2,k.h+1,19,i+71);ctx.fillStyle='#8f4d38';ctx.fill();
      ctx.shadowColor='transparent';
      if(!broken){
        const hue=18+27*(k.x/960),g=ctx.createLinearGradient(0,depth,0,k.h);
        g.addColorStop(0,`hsl(${hue+5} 88% 76%)`);g.addColorStop(.56,`hsl(${hue} 86% 67%)`);g.addColorStop(1,`hsl(${hue-5} 72% 57%)`);
        handmade(0,depth,k.w,k.h-depth,19,i+1);ctx.fillStyle=g;ctx.fill();
        ctx.save();ctx.clip();ctx.globalAlpha=.72;ctx.fillStyle=this.sugar!;ctx.fillRect(0,depth,k.w,k.h-depth);ctx.restore();
        handmade(1,depth+1,k.w-2,k.h-depth-2,18,i+101);ctx.strokeStyle='#fff2ce70';ctx.lineWidth=1.1;ctx.stroke();
        ctx.save();ctx.translate(((i*7)%5)-2,((i*11)%4)-1);ctx.rotate((((i*13)%7)-3)*.012);
        ctx.fillStyle='#71432f';ctx.font=`600 ${k.label.length>1?12:19}px "Comic Sans MS","Kaiti SC",cursive`;ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(k.label==='Space'?'橘 子 汽 水':k.label,k.w/2,depth+(k.h-depth)*.47);ctx.restore();
      }else{
        const core=ctx.createRadialGradient(k.w*.38,k.h*.34,2,k.w*.5,k.h*.55,Math.max(k.w,k.h)*.7);
        core.addColorStop(0,'#ffe5a6');core.addColorStop(.55,'#f8bd72');core.addColorStop(1,'#d98558');
        ctx.shadowColor='#713b2e50';ctx.shadowBlur=5;ctx.shadowOffsetY=2;
        handmade(5,depth+7,k.w-10,Math.max(20,k.h-depth-12),14,i+151);ctx.fillStyle=core;ctx.fill();ctx.shadowColor='transparent';
        ctx.save();ctx.clip();ctx.globalAlpha=.4;ctx.fillStyle=this.sugar!;ctx.fillRect(4,depth+6,k.w-8,k.h-depth-10);ctx.restore();
        ctx.beginPath();ctx.moveTo(k.w*.25,depth+k.h*.48);ctx.quadraticCurveTo(k.w*.49,depth+k.h*.34,k.w*.74,depth+k.h*.52);
        ctx.strokeStyle='#b76d4c88';ctx.lineWidth=1.4;ctx.lineCap='round';ctx.stroke();
      }
      ctx.restore();
    });
    ctx.restore();
  }
}
