import { describe, expect, it } from 'vitest';
import { normalizeReading, TypingSession } from '../engine/romaji';
import { chapterDictionary, getChapter } from '../content/chapters';
import { CITY_ROUTE, CITY_BOSS, cityIntro, cityOutro } from '../content/city';
import { ChapterSource } from './chapter';
import { Round } from './round';
import { canEnterPlace, emptyProgress, emptyRecord, migrateProgress, recordResult } from './progress';
import { canPlaySeraph } from './seraph';

describe('Aster in the white city', () => {
  it('has typeable unique prayers, short opening words, and a finite 8-14-kana boss pool', () => {
    expect(CITY_ROUTE).toHaveLength(20); expect(CITY_BOSS.length).toBeGreaterThanOrEqual(60);
    const dict = chapterDictionary(6);expect(dict.id).toBe('jp-angel-city');
    expect(new Set(dict.words.map(w => w.reading)).size).toBe(dict.words.length);
    for (const w of dict.words) {
      const s = new TypingSession(w.reading);for(const key of s.guide)s.input(key);expect(s.complete,w.display).toBe(true);
    }
    expect(CITY_ROUTE.slice(0,6).every(w => normalizeReading(w.reading).length <= 7)).toBe(true);
    expect(CITY_ROUTE.slice(12).every(w => /[ゃゅょっん]/.test(w.reading))).toBe(true);
    for (const w of CITY_BOSS) {
      expect(normalizeReading(w.reading).length,w.display).toBeGreaterThanOrEqual(8);
      expect(normalizeReading(w.reading).length,w.display).toBeLessThanOrEqual(14);
    }
    for(const i of [7]) {expect(getChapter(i)).toBeNull();expect(()=>chapterDictionary(i)).toThrow();}
  });
  it.each([0,42,0xffffffff])('keeps the typed answer and unique seeded chapter/retry order (%i)',seed => {
    for(const bossOnly of [false,true]) {
      const a = new ChapterSource(seed,bossOnly,6), b = new ChapterSource(seed,bossOnly,6);
      const picks = Array.from({length:60},()=>a.next());expect(picks).toEqual(Array.from({length:60},()=>b.next()));
      expect(new Set(picks.map(p=>p.id)).size).toBe(60);expect(picks[bossOnly?0:8].word.reading).toBe(CITY_BOSS[0].reading);
    }
  });
  it('freezes dialogue time and preserves the answer and both promised words', () => {
    const r = new Round(chapterDictionary(6),{}, {mode:'journey',wordLimit:60,source:new ChapterSource(42,false,6)});
    let t = 1;for(let i=0;i<8;i++)for(const key of r.session.guide)r.input(key,t+=50);
    const words=[r.word,r.nextWord,r.followingWord];r.pause(t);const elapsed=r.elapsedMs(t);r.resume(t+5000);
    expect([r.word,r.nextWord,r.followingWord]).toEqual(words);expect(r.word.reading).toBe(CITY_BOSS[0].reading);
    expect(r.elapsedMs(t+5000)).toBe(elapsed);
  });
  it.each(['elna','towa'] as const)('keeps gratitude and the wish to leave without deciding the ending for %s',character => {
    const other = character === 'elna' ? 'towa' : 'elna';
    expect(cityIntro(character)).toHaveLength(4);expect(cityIntro(character).some(l=>l.speaker===other)).toBe(true);
    const after=cityOutro(character);expect(after).toHaveLength(5);
    expect(after.some(l=>l.speaker==='city-leaver'&&l.text.includes('扉が開いた'))).toBe(true);
    expect(after.some(l=>l.speaker===other&&l.text.includes('聞き続け'))).toBe(true);
    expect(after.some(l=>l.speaker==='city-resident'&&l.text.includes('残って暮らしたい'))).toBe(true);
    expect(after.at(-1)?.speaker).toBe(character);
  });
  it('uses only the current snow clear as a key and preserves old city scores independently', () => {
    const clear={...emptyRecord(),cleared:true,bestScore:999999,bestTimeMs:1,stars:[true,true,true] as [boolean,boolean,boolean]};
    const old={version:1 as const,places:{heaven:{routeVersion:2,current:clear},town:{routeVersion:2,current:clear},road:{routeVersion:2,current:clear},canal:{routeVersion:2,current:clear},theatre:{routeVersion:2,current:clear},snow:{routeVersion:2,current:clear},city:{routeVersion:1,current:clear}}};
    const original=structuredClone(old),versions={heaven:2,town:2,road:2,canal:2,theatre:2,snow:2,city:2};
    const migrated=migrateProgress(old,versions);expect(old).toEqual(original);
    expect(migrated.places.heaven).toEqual(old.places.heaven);expect(migrated.places.town).toEqual(old.places.town);expect(migrated.places.road).toEqual(old.places.road);expect(migrated.places.canal).toEqual(old.places.canal);expect(migrated.places.theatre).toEqual(old.places.theatre);expect(migrated.places.snow).toEqual(old.places.snow);
    expect(migrated.places.city.current).toEqual(emptyRecord());expect(migrated.places.city.legacy).toEqual(clear);
    expect(canEnterPlace('city',emptyProgress(),versions)).toBe(false);expect(canEnterPlace('city',migrated,versions)).toBe(true);
    expect(canEnterPlace('city',emptyProgress(),{})).toBe(false);expect(canPlaySeraph(6,emptyProgress(),{})).toBe(false);
    for(const version of [1,3])expect(canEnterPlace('city',{version:1,places:{snow:{routeVersion:version,current:clear}}},versions)).toBe(false);
    for(const scope of ['chapter','boss'] as const) {
      const result=recordResult(migrated,{key:'city',routeVersion:2,completed:true,score:100,rank:'A',elapsedMs:50000,stars:[true,false,false],scope});
      expect(result.places.city.legacy).toEqual(clear);expect(result.places.city.current.bestScore).toBe(scope==='boss'?0:100);
      expect(result.places.city.current.bestTimeMs).toBe(scope==='boss'?null:50000);
      expect(result.places.town).toEqual(old.places.town);
    }
  });
  it('holds future city current records while this chapter writes legacy and cannot unlock seraph', () => {
    const proof={...emptyRecord(),cleared:true,bestScore:999999,bestTimeMs:1};
    const future={version:1 as const,places:{snow:{routeVersion:2,current:proof},city:{routeVersion:3,current:proof}}};
    const versions={snow:2,city:2}, original=structuredClone(future);
    const migrated=migrateProgress(future,versions);expect(migrated).toEqual(original);
    for(const scope of ['chapter','boss'] as const) {
      const result=recordResult(migrated,{key:'city',routeVersion:2,completed:true,score:100,rank:'A',elapsedMs:50000,stars:[true,false,false],scope});
      expect(result.places.city.current).toEqual(proof);expect(result.places.city.routeVersion).toBe(3);
      expect(result.places.city.legacy?.cleared).toBe(true);expect(canPlaySeraph(6,result,versions)).toBe(false);
      expect(result.places.snow).toEqual(original.places.snow);
    }
    expect(future).toEqual(original);
  });
});
