import { describe, expect, it } from 'vitest';
import { normalizeReading, TypingSession } from '../engine/romaji';
import { chapterDictionary, getChapter } from '../content/chapters';
import { ROAD_ROUTE, ROAD_BOSS, roadIntro, roadOutro } from '../content/road';
import { ChapterSource } from './chapter';
import { Round } from './round';
import { canEnterPlace, emptyProgress, emptyRecord, migrateProgress, recordResult } from './progress';
import { canPlaySeraph } from './seraph';

describe('Nico at the harvest road', () => {
  it('has typeable unique prayers, short opening words, and a finite 8-14-kana boss pool', () => {
    expect(ROAD_ROUTE).toHaveLength(20); expect(ROAD_BOSS.length).toBeGreaterThanOrEqual(60);
    const dict = chapterDictionary(2);expect(dict.id).toBe('jp-angel-road');
    expect(new Set(dict.words.map(w => w.reading)).size).toBe(dict.words.length);
    for (const w of dict.words) {
      const s = new TypingSession(w.reading);for(const key of s.guide)s.input(key);expect(s.complete,w.display).toBe(true);
    }
    expect(ROAD_ROUTE.slice(0,6).every(w => normalizeReading(w.reading).length <= 7)).toBe(true);
    expect(ROAD_ROUTE.slice(12).every(w => /[ゃゅょっん]/.test(w.reading))).toBe(true);
    for (const w of ROAD_BOSS) {
      expect(normalizeReading(w.reading).length,w.display).toBeGreaterThanOrEqual(8);
      expect(normalizeReading(w.reading).length,w.display).toBeLessThanOrEqual(14);
    }
    for(const i of [7]) {expect(getChapter(i)).toBeNull();expect(()=>chapterDictionary(i)).toThrow();}
  });
  it.each([0,42,0xffffffff])('keeps the typed answer and unique seeded chapter/retry order (%i)',seed => {
    for(const bossOnly of [false,true]) {
      const a = new ChapterSource(seed,bossOnly,2), b = new ChapterSource(seed,bossOnly,2);
      const picks = Array.from({length:60},()=>a.next());expect(picks).toEqual(Array.from({length:60},()=>b.next()));
      expect(new Set(picks.map(p=>p.id)).size).toBe(60);expect(picks[bossOnly?0:8].word.reading).toBe(ROAD_BOSS[0].reading);
    }
  });
  it('freezes dialogue time and preserves the answer and both promised words', () => {
    const r = new Round(chapterDictionary(2),{}, {mode:'journey',wordLimit:60,source:new ChapterSource(42,false,2)});
    let t = 1;for(let i=0;i<8;i++)for(const key of r.session.guide)r.input(key,t+=50);
    const words=[r.word,r.nextWord,r.followingWord];r.pause(t);const elapsed=r.elapsedMs(t);r.resume(t+5000);
    expect([r.word,r.nextWord,r.followingWord]).toEqual(words);expect(r.word.reading).toBe(ROAD_BOSS[0].reading);
    expect(r.elapsedMs(t+5000)).toBe(elapsed);
  });
  it.each(['elna','towa'] as const)('keeps theft, victims and the waiting child unresolved for %s',character => {
    const other = character === 'elna' ? 'towa' : 'elna';
    expect(roadIntro(character)).toHaveLength(4);expect(roadIntro(character).some(l=>l.speaker===other)).toBe(true);
    const after=roadOutro(character);expect(after).toHaveLength(4);
    expect(after.some(l=>l.speaker==='merchant'&&l.text.includes('荷が戻ってきた'))).toBe(true);
    expect(after.some(l=>l.speaker===other&&l.text.includes('待'))).toBe(true);
    expect(after.some(l=>l.speaker==='nico'&&l.text.includes('まだ残'))).toBe(true);
    expect(after.at(-1)?.speaker).toBe(character);
  });
  it('uses only the current town clear as a key and preserves old road scores independently', () => {
    const clear={...emptyRecord(),cleared:true,bestScore:999999,bestTimeMs:1,stars:[true,true,true] as [boolean,boolean,boolean]};
    const old={version:1 as const,places:{heaven:{routeVersion:2,current:clear},town:{routeVersion:2,current:clear},road:{routeVersion:1,current:clear}}};
    const original=structuredClone(old),versions={heaven:2,town:2,road:2};
    const migrated=migrateProgress(old,versions);expect(old).toEqual(original);
    expect(migrated.places.heaven).toEqual(old.places.heaven);expect(migrated.places.town).toEqual(old.places.town);
    expect(migrated.places.road.current).toEqual(emptyRecord());expect(migrated.places.road.legacy).toEqual(clear);
    expect(canEnterPlace('road',emptyProgress(),versions)).toBe(false);expect(canEnterPlace('road',migrated,versions)).toBe(true);
    expect(canEnterPlace('road',emptyProgress(),{})).toBe(false);expect(canPlaySeraph(2,emptyProgress(),{})).toBe(false);
    for(const version of [1,3])expect(canEnterPlace('road',{version:1,places:{town:{routeVersion:version,current:clear}}},versions)).toBe(false);
    for(const scope of ['chapter','boss'] as const) {
      const result=recordResult(migrated,{key:'road',routeVersion:2,completed:true,score:100,rank:'A',elapsedMs:50000,stars:[true,false,false],scope});
      expect(result.places.road.legacy).toEqual(clear);expect(result.places.road.current.bestScore).toBe(scope==='boss'?0:100);
      expect(result.places.road.current.bestTimeMs).toBe(scope==='boss'?null:50000);
      expect(result.places.town).toEqual(old.places.town);
    }
  });
});
