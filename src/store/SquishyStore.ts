import { GRID } from '../core/SquishyStateMachine';
import { validSnapshot, snapshotStats, type SquishySnapshot } from '../core/SquishySnapshot';
import { characters, dailyCharacters, baseMysteryCharacters, hiddenMysteryCharacters, isBoxCharacter, starterCharacters } from '../data/characters';

type EventName = 'app_open' | 'daily_squishy_open' | 'squishy_press' | 'squishy_drag' | 'squishy_reset' | 'mystery_box_open' | 'mystery_box_claim' | 'collection_save' | 'collection_open' | 'continue_squish' | 'favorite_toggle' | 'squishy_open';
type LocalEvent = { event: EventName; characterId?: string; timestamp: string };
type Analytics = { version: 1; events: LocalEvent[]; counts: Record<string, number>; characterPresses: Record<string, number>; characterUses: Record<string, number> };
const ANALYTICS_KEY = 'cracky-squishy:analytics:v1';
const emptyAnalytics = (): Analytics => ({ version: 1, events: [], counts: {}, characterPresses: {}, characterUses: {} });
const dayNumber = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
export const STORE_KEY = 'cracky-squishy:v1';
const createId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export interface CollectionRecord {
  id: string;
  characterId: string;
  characterName: string;
  obtainedAt: string;
  lastPlayedAt: string;
  pressCount: number;
  damageLevel: number;
  deformationLevel: number;
  totalPlayTime: number;
  favorite: boolean;
  finalState: SquishySnapshot;
}
function validCollection(value: unknown): value is CollectionRecord {
  const r=value as CollectionRecord | null;
  return !!r && typeof r.id === 'string' && typeof r.characterId === 'string' && typeof r.characterName === 'string'
    && validDate(r.obtainedAt) && validDate(r.lastPlayedAt) && typeof r.favorite === 'boolean'
    && Number.isFinite(r.totalPlayTime) && r.totalPlayTime >= 0 && validSnapshot(r.finalState);
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
type StoreData = {
  version: 1;
  player: { firstVisitAt: string; lastVisitAt: string; streak: number; totalSessions: number };
  daily: { date: string; squishyId: string; mysteryBoxClaimed: boolean; mysteryReward: unknown; collectionId?: string };
  unlocked: unknown[];
  collection: unknown[];
};
const dateKey = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
function validData(value: any): value is StoreData {
  return value?.version === 1 && validDate(value.player?.firstVisitAt) && validDate(value.player?.lastVisitAt)
    && Number.isInteger(value.player.streak) && value.player.streak >= 0
    && Number.isInteger(value.player.totalSessions) && value.player.totalSessions >= 0
    && typeof value.daily?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.daily.date)
    && validDate(value.daily.date) && typeof value.daily.squishyId === 'string'
    && typeof value.daily.mysteryBoxClaimed === 'boolean'
    && Array.isArray(value.unlocked) && Array.isArray(value.collection);
}

export class SquishyStore {
  private data: StoreData;
  private writable = true;
  private pending = emptyAnalytics();
  private analyticsTimer?: ReturnType<typeof setTimeout>;
  error = '';
  constructor(private storage?: Pick<Storage, 'getItem' | 'setItem'>, now = new Date(), private random:()=>number=Math.random) {
    this.data = {
      version: 1,
      player: { firstVisitAt: now.toISOString(), lastVisitAt: now.toISOString(), streak: 0, totalSessions: 0 },
      daily: { date: '', squishyId: '', mysteryBoxClaimed: false, mysteryReward: null },
      unlocked: [], collection: [],
    };
    if (!storage) {
      try { this.storage = window.localStorage; }
      catch { this.error = '本地存储不可用，仍可体验普通捏捏'; }
    }
    this.load();
  }
  load(): void {
    try {
      const raw = this.storage?.getItem(STORE_KEY);
      if (raw == null) return;
      const data: unknown = JSON.parse(raw);
      if (!validData(data)) throw new Error('Unsupported save');
      this.data = data;
    } catch {
      this.writable = false;
      this.error = '本地存档无法读取，已保留原数据；仍可体验普通捏捏';
    }
  }
  save(): boolean {
    if (!this.writable) return false;
    try {
      if (!this.storage) throw new Error('Storage unavailable');
      this.storage.setItem(STORE_KEY, JSON.stringify(this.data));
      this.error = '';
      return true;
    } catch {
      this.error = '本地保存不可用，仍可体验普通捏捏';
      return false;
    }
  }
  recordVisit(now = new Date(), session = true) {
    this.getDailySquishy(now);
    const player = this.data.player;
    const gap = dayNumber(now) - dayNumber(new Date(player.lastVisitAt));
    const next = { ...player,
      streak: player.streak === 0 || gap > 1 ? 1 : gap === 1 ? player.streak + 1 : player.streak,
      lastVisitAt: now.getTime() >= Date.parse(player.lastVisitAt) ? now.toISOString() : player.lastVisitAt,
      totalSessions: player.totalSessions + Number(session) };
    // Returning to an already-counted day needs no storage write.
    if (session || gap > 0 || player.streak === 0) { this.data.player = next; this.save(); }
    if (session) { this.track('app_open', undefined, now); this.flushAnalytics(); }
    return { ...this.data.player };
  }
  track(event: EventName, characterId?: string, now = new Date()): void {
    this.pending.events.push({ event, characterId, timestamp: now.toISOString() });
    if (this.pending.events.length > 2000) this.pending.events.shift();
    this.pending.counts[event] = (this.pending.counts[event] ?? 0) + 1;
    if (characterId && (event === 'squishy_press' || event === 'squishy_open')) {
      const counts = event === 'squishy_press' ? this.pending.characterPresses : this.pending.characterUses;
      counts[characterId] = (counts[characterId] ?? 0) + 1;
    }
    // Batch telemetry separately from large saved toy states, never write on each pointer move.
    if (typeof window !== 'undefined' && !this.analyticsTimer)
      this.analyticsTimer = setTimeout(() => this.flushAnalytics(), 1000);
  }
  getAnalytics(): Analytics {
    const raw = this.storage?.getItem(ANALYTICS_KEY);
    const saved: Analytics = raw ? JSON.parse(raw) : emptyAnalytics();
    if (saved?.version !== 1 || !Array.isArray(saved.events) || saved.events.some(e => !e || typeof e.event !== 'string' || !validDate(e.timestamp))) throw new Error('Unsupported analytics');
    for (const field of ['counts', 'characterPresses', 'characterUses'] as const) {
      if (!saved[field] || typeof saved[field] !== 'object' || Array.isArray(saved[field]) || Object.values(saved[field]).some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('Invalid analytics');
      for (const [key, count] of Object.entries(this.pending[field])) saved[field][key] = (saved[field][key] ?? 0) + count;
    }
    saved.events = [...saved.events, ...this.pending.events].slice(-2000);
    return copy(saved);
  }
  flushAnalytics(): boolean {
    clearTimeout(this.analyticsTimer); this.analyticsTimer = undefined;
    if (!this.pending.events.length) return true;
    try {
      if (!this.storage) return false;
      // ponytail: synchronous merge is enough for local testing; simultaneous cross-tab telemetry may lose a batch.
      this.storage.setItem(ANALYTICS_KEY, JSON.stringify(this.getAnalytics()));
      this.pending = emptyAnalytics(); return true;
    } catch { return false; } // Telemetry failure never blocks play or overwrites unreadable analytics.
  }
  getDailySquishy(now = new Date()) {
    this.load();
    const date = dateKey(now);
    const saved = dailyCharacters.find(character => character.id === this.data.daily.squishyId);
    if (this.data.daily.date === date && saved) return saved;
    // UTC arithmetic on local calendar components avoids daylight-saving day lengths.
    const seed = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
    const character = dailyCharacters[((seed % dailyCharacters.length) + dailyCharacters.length) % dailyCharacters.length];
    this.data.daily = { date, squishyId: character.id, mysteryBoxClaimed: false, mysteryReward: null };
    this.save();
    return character;
  }
  getMysteryBox(now = new Date()) {
    this.getDailySquishy(now);
    return {
      claimed: this.data.daily.mysteryBoxClaimed,
      reward: characters.find(character => character.id === this.data.daily.mysteryReward) ?? null,
      collectionId: this.data.daily.collectionId ?? null,
    };
  }
  async claimMysteryBox(now?: Date) {
    const claim = () => {
      const date = now ?? new Date();
      if (this.getMysteryBox(date).claimed) return null;
      const tier = this.random() < .8 ? baseMysteryCharacters : hiddenMysteryCharacters;
      const remaining = tier.filter(character => !this.data.unlocked.includes(character.id));
      const pool = remaining.length ? remaining : tier;
      const reward = pool[Math.floor(this.random() * pool.length)];
      const state: SquishySnapshot = { version: 1, pressCount: 0,
        damage: Array(GRID*GRID).fill(0), opened: Array(GRID*GRID).fill(0),
        residualX: Array((GRID+1)**2).fill(0), residualY: Array((GRID+1)**2).fill(0), residualH: Array((GRID+1)**2).fill(0), wax: [] };
      const record: CollectionRecord = { id: createId(), characterId: reward.id, characterName: reward.name,
        obtainedAt: date.toISOString(), lastPlayedAt: date.toISOString(), ...snapshotStats(state),
        totalPlayTime: 0, favorite: false, finalState: state };
      const previous = this.data;
      this.data = { ...previous,
        daily: { ...previous.daily, mysteryBoxClaimed: true, mysteryReward: reward.id, collectionId: record.id },
        collection: [...previous.collection, record],
        unlocked: previous.unlocked.includes(reward.id) ? previous.unlocked : [...previous.unlocked, reward.id],
      };
      if (this.save()) { this.track('mystery_box_claim', reward.id, date); this.track('collection_save', reward.id, date); return { ...reward, collectionId: record.id }; }
      this.data = previous;
      return null;
    };
    return claim();
  }

  getDiscoveredIds(): string[] {
    this.load();
    const ids=new Set([...starterCharacters.map(character=>character.id),...this.data.unlocked.filter((id):id is string=>typeof id==='string')]);
    return characters.filter(character=>ids.has(character.id)).map(character=>character.id);
  }

  getCollection(): CollectionRecord[];
  getCollection(id: string): CollectionRecord | null;
  getCollection(id?: string): CollectionRecord[] | CollectionRecord | null {
    this.load();
    const records = this.data.collection.filter(validCollection);
    return copy(id === undefined ? records : records.find(record => record.id === id) ?? null);
  }
  addCollection(characterId: string, finalState: SquishySnapshot, totalPlayTime = 0, obtainedAt = new Date()): CollectionRecord | null {
    this.getDailySquishy();
    const character = characters.find(c => c.id === characterId);
    if (!character || (isBoxCharacter(characterId) && !this.data.unlocked.includes(characterId)) || !validSnapshot(finalState) || !Number.isFinite(totalPlayTime) || totalPlayTime < 0 || !Number.isFinite(obtainedAt.getTime())) return null;
    const record: CollectionRecord = { id: createId(), characterId, characterName: character.name,
      obtainedAt: obtainedAt.toISOString(), lastPlayedAt: new Date().toISOString(),
      ...snapshotStats(finalState), totalPlayTime, favorite: false, finalState: copy(finalState) };
    const previous = this.data.collection;
    this.data.collection = [...previous, record];
    if (this.save()) { this.track('collection_save', characterId); return copy(record); }
    this.data.collection = previous;
    return null;
  }
  updateCollection(id: string, changes: Partial<Pick<CollectionRecord, 'favorite' | 'totalPlayTime' | 'lastPlayedAt' | 'finalState'>>): boolean {
    this.load();
    const current = this.data.collection.find((r): r is CollectionRecord => validCollection(r) && r.id === id);
    if (!current) return false;
    const record = { ...current, ...changes };
    if (!validCollection(record)) return false;
    Object.assign(record, snapshotStats(record.finalState));
    const previous = this.data.collection;
    this.data.collection = previous.map(r => r === current ? copy(record) : r);
    if (this.save()) {
      if (changes.finalState) this.track('collection_save', current.characterId);
      if (changes.favorite !== undefined && changes.favorite !== current.favorite) this.track('favorite_toggle', current.characterId);
      return true;
    }
    this.data.collection = previous;
    return false;
  }

}
