import { clamp, type MaterialEvent } from './SquishyStateMachine';
import type { Character } from '../rendering/ClayRenderer';
import { SOUND_BANK } from '../generated/sound-bank';

type EngineState = 'LOCKED' | 'LOADING' | 'READY' | 'SILENT' | 'SUSPENDED';
type Material = Character['material'];

function encodedAudio(base64: string): ArrayBuffer {
  const raw = atob(base64), bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

export class AudioEngine {
  state: EngineState = 'LOCKED';
  muted = false;
  onStatus: () => void = () => {};
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: AudioBufferSourceNode[] = [];
  private sounds = new Map<string, AudioBuffer[]>();
  private loading = new Map<string, Promise<AudioBuffer[]>>();
  private pending = new Map<string, MaterialEvent>();
  private generation = 0;
  private material: Material = 'mochi';
  private coreMaterial: Material | null = null;
  private keyboard = false;
  private innerVoice: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private lastInnerTime = -Infinity;
  private innerReleased = false;
  private lastInnerPress = -1;

  async init(): Promise<void> {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.6;
        this.master.connect(this.ctx.destination);
        this.ctx.onstatechange = () => {
          if (this.state !== 'LOADING') this.state = this.ctx && this.ctx.state === 'suspended' ? 'SUSPENDED' : 'READY';
          this.onStatus();
        };
      }
      this.state = 'LOADING'; this.onStatus();
      await this.ctx.resume();
      await this.load('press_light_crust');
      this.state = 'READY';
    } catch { this.state = 'SILENT'; }
    this.onStatus();
  }

  private load(name: string): Promise<AudioBuffer[]> {
    const ready = this.sounds.get(name);
    if (ready) return Promise.resolve(ready);
    const active = this.loading.get(name);
    if (active) return active;
    if (!this.ctx) return Promise.resolve([]);
    const encoded = Object.entries(SOUND_BANK)
      .filter(([path]) => path.slice(path.lastIndexOf('/') + 1).replace(/_v\d+$/, '') === name)
      .map(([, base64]) => base64);
    const task = Promise.all(encoded.map(base64 => this.ctx!.decodeAudioData(encodedAudio(base64))));
    this.loading.set(name, task);
    task.then(buffers => { this.sounds.set(name, buffers); this.loading.delete(name); }, () => this.loading.delete(name));
    return task;
  }

  setMuted(value: boolean): void {
    this.muted = value;
    if(value)this.stop();
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(value ? 0 : 0.6, this.ctx.currentTime, 0.015);
    this.onStatus();
  }

  reset(generation: number, material: Material, coreMaterial: Material = material, keyboard = false): void {
    this.stop(); this.pending.clear(); this.generation = generation; this.material = material; this.coreMaterial=coreMaterial;this.keyboard=keyboard;
  }

  private sample(event: MaterialEvent): string {
    if(this.keyboard) {
      if(event.type==='press')return event.intensity>.68?'key_deep_thock':'key_mechanical_click';
      return '';
    }
    if (event.soft) {
      const core=this.coreMaterial ?? this.material;
      const wet = core === 'ice' || core === 'jelly';
      if(event.type === 'release') return core === 'jelly' ? 'cont_jelly_wobble' : '';
      if(event.type === 'press') return wet ? 'cont_poke_slime' : 'cont_squeeze';
      if(event.type === 'soft_squish' || event.type === 'scrape') {
        if((event.dragDistance ?? 0) > .06) return 'cont_stretch_slime';
        if((event.force ?? 0) > .65) return 'cont_deep_press_clay';
        if(core==='bread')return 'soft_bread_dough';
        if(core==='chocolate')return 'stick_caramel_string';
        return core === 'mochi' ? 'cont_knead_mochi' : wet ? 'cont_squelch_slime' : 'cont_squeeze';
      }
    }
    if (event.type === 'press') return event.soft ? 'press_soft_finger' : 'press_light_crust';
    if (event.type === 'micro_crack') return event.intensity > .4 ? 'micro_spreading' : event.intensity < .25 ? 'micro_tiny_fracture' : 'micro_first_crack';
    if (event.type === 'fragment') return event.intensity > .55 ? 'frag_large_pieces_roll' : event.intensity > .35 ? 'frag_pieces_falling' : event.intensity > .2 ? 'frag_table_impact' : 'frag_crumbs';
    if (event.type === 'release') return event.soft ? 'release_soft_rebound' : 'release_pop_back';
    if (event.type === 'scrape') return event.soft ? 'scrape_rub_crumbs' : 'scrape_surface';
    if (event.type === 'soft_squish') return this.material === 'bread' ? 'soft_bread_dough' : this.material === 'mochi' ? 'soft_mochi' : this.material === 'chocolate' ? 'stick_caramel_string' : this.material === 'jelly' ? 'soft_jelly' : 'soft_clay';
    if (this.material === 'ice') return 'special_ice_crack';
    if (this.material === 'sugar') return event.intensity > .75 ? 'shell_sugar_grit_crush' : 'shell_sugar_grit_crack';
    if (this.material === 'chocolate') return event.intensity > .75 ? 'shell_chocolate_crunch' : 'shell_chocolate_break';
    if (this.material === 'bread') return event.intensity > .7 ? 'break_heavy_crunchy' : 'break_cookie_crust';
    if (this.material === 'mochi') return event.intensity > .75 ? 'break_triple_layer' : 'break_multilayer';
    return event.intensity > .7 ? 'break_thick_collapse' : 'break_thin_crispy';
  }

  handleEvent(event: MaterialEvent): void {
    if (event.generation !== this.generation || this.state !== 'READY' || this.muted || !this.ctx || !this.master) return;
    const name = this.sample(event), inner = event.soft && ['press','soft_squish','scrape'].includes(event.type);
    // One continuous core voice; separate gestures still respond immediately.
    if(inner && event.pressId === this.lastInnerPress && this.ctx.currentTime-this.lastInnerTime < .22) return;
    // A normal soft release lets the 1–2s sample finish; the next gesture replaces it.
    if(event.type === 'release' && event.soft && !name) {this.innerReleased=true;return;}
    if(event.type === 'press' || event.type === 'release' || inner) this.release(true);
    const variants = this.sounds.get(name);
    if (!variants?.length) {
      this.pending.set(name, event);
      void this.load(name).then(() => {
        const pending = this.pending.get(name);
        this.pending.delete(name);
        if (pending) this.handleEvent(pending);
      }).catch(() => {});
      return;
    }
    const source = this.ctx.createBufferSource(), gain = this.ctx.createGain(), pan = this.ctx.createStereoPanner();
    source.buffer = variants[Math.floor(Math.random() * variants.length)];
    gain.gain.value = clamp(event.intensity * .72, .08, .72) * (event.type === 'fragment' ? .4 : 1);
    pan.pan.value = clamp(event.pan, -.8, .8);
    source.connect(gain); gain.connect(pan); pan.connect(this.master);
    source.onended = () => { source.disconnect(); gain.disconnect(); pan.disconnect(); this.voices = this.voices.filter(item => item !== source); };
    if (this.voices.length >= 12) { try { this.voices.shift()?.stop(); } catch {} }
    this.voices.push(source);
    if(inner) {
      this.innerReleased=false;this.innerVoice={source,gain}; this.lastInnerPress=event.pressId; this.lastInnerTime=this.ctx.currentTime;
    }
    source.start();
  }

  release(interrupt = false): void {
    if(this.innerReleased && !interrupt)return;
    if(!this.innerVoice || !this.ctx)return;
    const {source,gain}=this.innerVoice;this.innerVoice=null;
    gain.gain.cancelScheduledValues(this.ctx.currentTime);
    gain.gain.setTargetAtTime(0,this.ctx.currentTime,.012);
    try {source.stop(this.ctx.currentTime+.05);} catch {}
  }
  stop(): void { this.innerReleased=false;this.innerVoice=null;this.lastInnerTime=-Infinity;this.lastInnerPress=-1; for (const source of this.voices) { try { source.stop(); } catch {} } this.voices = []; }
  dispose(): void { this.stop(); if (this.ctx) { this.ctx.onstatechange = null; void this.ctx.close(); } }
}
