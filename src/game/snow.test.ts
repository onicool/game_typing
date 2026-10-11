import { describe, expect, it } from 'vitest';
import { normalizeReading, TypingSession } from '../engine/romaji';
import { chapterDictionary, getChapter } from '../content/chapters';
import { SNOW_ROUTE, SNOW_BOSS, snowIntro, snowOutro } from '../content/snow';
import { ChapterSource } from './chapter';
import { Round } from './round';
import { canEnterPlace, emptyProgress, emptyRecord, migrateProgress, recordResult } from './progress';
import { canPlaySeraph } from './seraph';

describe('Isaac at the last bridge', () => {
  it('has typeable unique prayers, short opening words, and a finite 8-14-kana boss pool', () => {
    expect(SNOW_ROUTE).toHaveLength(20); expect(SNOW_BOSS.length).toBeGreaterThanOrEqual(60);
    const dict = chapterDictionary(5);expect(dict.id).toBe('jp-angel-snow');
    expect(new Set(dict.words.map(w => w.reading)).size).toBe(dict.words.length);
    for (const w of dict.words) {
      const s = new TypingSession(w.reading);for(const key of s.guide)s.input(key);expect(s.complete,w.display).toBe(true);
    }
    expect(SNOW_ROUTE.slice(0,6).every(w => normalizeReading(w.reading).length <= 7)).toBe(true);
    expect(SNOW_ROUTE.slice(12).every(w => /[ゃゅょっん]/.test(w.reading))).toBe(true);
    for (const w of SNOW_BOSS) {
      expect(normalizeReading(w.reading).length,w.display).toBeGreaterThanOrEqual(8);
      expect(normalizeReading(w.reading).length,w.display).toBeLessThanOrEqual(14);
    }
    for(const i of [7]) {expect(getChapter(i)).toBeNull();expect(()=>chapterDictionary(i)).toThrow();}
  });
  it.each([0,42,0xffffffff])('keeps the typed answer and unique seeded chapter/retry order (%i)',seed => {
    for(const bossOnly of [false,true]) {
      const a = new ChapterSource(seed,bossOnly,5), b = new ChapterSource(seed,bossOnly,5);
      const picks = Array.from({length:60},()=>a.next());expect(picks).toEqual(Array.from({length:60},()=>b.next()));
      expect(new Set(picks.map(p=>p.id)).size).toBe(60);expect(picks[bossOnly?0:8].word.reading).toBe(SNOW_BOSS[0].reading);
    }
  });
  it('freezes dialogue time and preserves the answer and both promised words', () => {
    const r = new Round(chapterDictionary(5),{}, {mode:'journey',wordLimit:60,source:new ChapterSource(42,false,5)});
    let t = 1;for(let i=0;i<8;i++)for(const key of r.session.guide)r.input(key,t+=50);
    const words=[r.word,r.nextWord,r.followingWord];r.pause(t);const elapsed=r.elapsedMs(t);r.resume(t+5000);
    expect([r.word,r.nextWord,r.followingWord]).toEqual(words);expect(r.word.reading).toBe(SNOW_BOSS[0].reading);
    expect(r.elapsedMs(t+5000)).toBe(elapsed);
  });
  it.each(['elna','towa'] as const)('keeps evacuation and distant war without a final verdict for %s',character => {
    const other = character === 'elna' ? 'towa' : 'elna';
    expect(snowIntro(character)).toHaveLength(4);expect(snowIntro(character).some(l=>l.speaker===other)).toBe(true);
    const after=snowOutro(character);expect(after).toHaveLength(4);
    expect(after.some(l=>l.speaker==='refugee'&&l.text.includes('橋は残った'))).toBe(true);
    expect(after.some(l=>l.speaker===other&&l.text.includes('戦火が広が'))).toBe(true);
    expect(after.some(l=>l.speaker==='isaac'&&l.text.includes('責任'))).toBe(true);
    expect(after.at(-1)?.speaker).toBe(character);
  });
  it('uses only the current theatre clear as a key and preserves old snow scores independently', () => {
    const clear={...emptyRecord(),cleared:true,bestScore:999999,bestTimeMs:1,stars:[true,true,true] as [boolean,boolean,boolean]};
    const old={version:1 as const,places:{heaven:{routeVersion:2,current:clear},town:{routeVersion:2,current:clear},road:{routeVersion:2,current:clear},canal:{routeVersion:2,current:clear},theatre:{routeVersion:2,current:clear},snow:{routeVersion:1,current:clear}}};
    const original=structuredClone(old),versions={heaven:2,town:2,road:2,canal:2,theatre:2,snow:2};
    const migrated=migrateProgress(old,versions);expect(old).toEqual(original);
    expect(migrated.places.heaven).toEqual(old.places.heaven);expect(migrated.places.town).toEqual(old.places.town);expect(migrated.places.road).toEqual(old.places.road);expect(migrated.places.canal).toEqual(old.places.canal);expect(migrated.places.theatre).toEqual(old.places.theatre);
    expect(migrated.places.snow.current).toEqual(emptyRecord());expect(migrated.places.snow.legacy).toEqual(clear);
    expect(canEnterPlace('snow',emptyProgress(),versions)).toBe(false);expect(canEnterPlace('snow',migrated,versions)).toBe(true);
    expect(canEnterPlace('snow',emptyProgress(),{})).toBe(false);expect(canPlaySeraph(5,emptyProgress(),{})).toBe(false);
    for(const version of [1,3])expect(canEnterPlace('snow',{version:1,places:{theatre:{routeVersion:version,current:clear}}},versions)).toBe(false);
    for(const scope of ['chapter','boss'] as const) {
      const result=recordResult(migrated,{key:'snow',routeVersion:2,completed:true,score:100,rank:'A',elapsedMs:50000,stars:[true,false,false],scope});
      expect(result.places.snow.legacy).toEqual(clear);expect(result.places.snow.current.bestScore).toBe(scope==='boss'?0:100);
      expect(result.places.snow.current.bestTimeMs).toBe(scope==='boss'?null:50000);
      expect(result.places.town).toEqual(old.places.town);
    }
  });
  it('holds future snow current records while this chapter writes legacy and cannot unlock seraph', () => {
    const proof={...emptyRecord(),cleared:true,bestScore:999999,bestTimeMs:1};
    const future={version:1 as const,places:{theatre:{routeVersion:2,current:proof},snow:{routeVersion:3,current:proof}}};
    const versions={theatre:2,snow:2}, original=structuredClone(future);
    const migrated=migrateProgress(future,versions);expect(migrated).toEqual(original);
    for(const scope of ['chapter','boss'] as const) {
      const result=recordResult(migrated,{key:'snow',routeVersion:2,completed:true,score:100,rank:'A',elapsedMs:50000,stars:[true,false,false],scope});
      expect(result.places.snow.current).toEqual(proof);expect(result.places.snow.routeVersion).toBe(3);
      expect(result.places.snow.legacy?.cleared).toBe(true);expect(canPlaySeraph(5,result,versions)).toBe(false);
      expect(result.places.theatre).toEqual(original.places.theatre);
    }
    expect(future).toEqual(original);
  });
});
