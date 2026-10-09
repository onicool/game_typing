import { describe, expect, it } from 'vitest';
import { CHAPTER_VERSION } from '../content/chapters';
import { Battle, isCompatibleDifficulty, SERAPH_VERSION, type InputView } from './battle';
import { canPlaySeraph, isSeraphProgress, SERAPH_ROUTE_VERSIONS } from './seraph';
import { canEnterPlace, emptyProgress, emptyRecord, mergeProgress, migrateProgress, recordResult } from './progress';

const view: InputView = { current: { index: 8, kana: 10 }, remainingKana: 10, previews: [{ index: 9, kana: 10 }, { index: 10, kana: 12 }] };
const versions = { heaven: CHAPTER_VERSION, town: CHAPTER_VERSION, road: CHAPTER_VERSION, canal: CHAPTER_VERSION, theatre: CHAPTER_VERSION, snow: CHAPTER_VERSION, city: CHAPTER_VERSION };
const clear = { ...emptyRecord(), cleared: true, bestScore: 10000, bestRank: 'S' as const, bestTimeMs: 10000, stars: [true,true,true] as [boolean,boolean,boolean] };
const normal = { version: 1 as const, places: { heaven: { routeVersion: CHAPTER_VERSION, current: clear }, town: { routeVersion: CHAPTER_VERSION, current: clear }, road: { routeVersion: CHAPTER_VERSION, current: clear }, canal: { routeVersion: CHAPTER_VERSION, current: clear }, theatre: { routeVersion: CHAPTER_VERSION, current: clear }, snow: { routeVersion: CHAPTER_VERSION, current: clear }, city: { routeVersion: CHAPTER_VERSION, current: clear } } };
const make = (difficulty: 'standard'|'challenge'|'seraph', speed=2) => { const b = new Battle({ character:'elna',difficulty,bossHp:240,seed:12,initialKanaPerSec:speed });b.startBoss(0);return b; };
describe('seraph replay rules and separate progress', () => {
  it('requires each implemented chapter current normal clear, never a legacy or future proof', () => {
    expect([0,1,2,3,4,5,6].map(i => canPlaySeraph(i,normal,versions))).toEqual([true,true,true,true,true,true,true]);
    expect(canPlaySeraph(0,emptyProgress(),versions)).toBe(false);
    for (const version of [1,3]) expect(canPlaySeraph(0,{ version:1,places:{heaven:{routeVersion:version,current:clear}}},versions)).toBe(false);
    expect(canPlaySeraph(1,{version:1,places:{heaven:normal.places.heaven}},versions)).toBe(false);
    expect(canPlaySeraph(2,{version:1,places:{town:normal.places.town}},versions)).toBe(false);
    expect(canPlaySeraph(3,{version:1,places:{road:normal.places.road}},versions)).toBe(false);
    expect(canPlaySeraph(4,{version:1,places:{canal:normal.places.canal}},versions)).toBe(false);
    expect(canPlaySeraph(5,{version:1,places:{theatre:normal.places.theatre}},versions)).toBe(false);
    expect(canPlaySeraph(6,{version:1,places:{snow:normal.places.snow}},versions)).toBe(false);
  });
  it('keeps hard scores, stars and clears out of normal progress and its town key', () => {
    const original = structuredClone(normal), hard = recordResult(emptyProgress(),{key:'heaven',routeVersion:SERAPH_VERSION,completed:true,score:999999,rank:'S',elapsedMs:1,stars:[true,true,true],scope:'chapter'});
    expect(hard.places.heaven.current.bestScore).toBe(999999);expect(normal).toEqual(original);
    expect(canEnterPlace('town',emptyProgress(),versions)).toBe(false);
    const boss = recordResult(emptyProgress(),{key:'heaven',routeVersion:SERAPH_VERSION,completed:true,score:999999,rank:'S',elapsedMs:1,stars:[true,true,true],scope:'boss'});
    expect(boss.places.heaven.current.bestScore).toBe(0);expect(boss.places.heaven.current.bestTimeMs).toBeNull();
    expect(mergeProgress(hard,boss).places.heaven.current).toEqual(hard.places.heaven.current);
  });
  it('accepts only supported hard progress and protects future or unknown saves', () => {
    expect(isSeraphProgress(emptyProgress())).toBe(true);expect(isSeraphProgress(migrateProgress(emptyProgress(),SERAPH_ROUTE_VERSIONS))).toBe(true);
    for(const value of [null,{version:2,places:{}},{version:1,places:{heaven:{routeVersion:2,current:clear}}},{version:1,places:{unknown:{routeVersion:1,current:clear}}}]) expect(isSeraphProgress(value)).toBe(false);
  });
  it('reads unchanged normal records, requiring explicit supported hard rules', () => {
    for(const difficulty of ['standard','challenge'])expect(isCompatibleDifficulty({difficulty})).toBe(true);
    expect(isCompatibleDifficulty({difficulty:'seraph',seraphVersion:1})).toBe(true);
    for(const seraphVersion of [undefined,0,2,NaN])expect(isCompatibleDifficulty({difficulty:'seraph',seraphVersion})).toBe(false);
  });
  it('keeps a three-second first warning with an attainable measured-speed deadline', () => {
    expect(['standard','challenge','seraph'].map(d => {const b=make(d as 'standard'|'challenge'|'seraph');b.tick(3000,view);return b.snapshot().attack!.dueAt-3000;})).toEqual([16000,11500,10000]);
    for(const [speed,expected] of [[1000,2500],[.1,200000],[NaN,10000]]) {
      const b=make('seraph',speed);expect(b.tick(2999,view)).toEqual([]);b.tick(3000,view);expect(b.snapshot().attack!.dueAt-3000).toBeCloseTo(expected);
    }
  });
  it('shortens rest and marks two words on every second phase-two warning without changing a pending one', () => {
    const b=make('seraph',1000);b.tick(3000,view);const original=b.snapshot().attack!;
    b.wordDone({index:8,kana:70,clean:true,gameMs:3100},view);expect(b.snapshot().phase).toBe(2);expect(b.snapshot().attack).toEqual(original);
    let at=original.dueAt+1;b.tick(at,view);
    for(let i=1;i<=2;i++) {
      b.tick(at+999,view);expect(b.snapshot().attack).toBeNull();at+=1000;b.tick(at,view);
      const attack=b.snapshot().attack!;expect(attack.marked).toEqual(i===2?[9,10]:[9]);at=attack.dueAt+1;b.tick(at,view);
    }
    expect(b.snapshot().outcome).toBe('lost');expect(b.snapshot().stats.resets).toBe(0);
  });
  it.each([-1,0,1])('honors the same deadline boundary in hard mode: %+i ms',offset => {
    const b=make('seraph');b.tick(3000,view);const t=b.snapshot().attack!.dueAt+offset;
    b.tick(t,view);b.wordDone({index:9,kana:10,clean:true,gameMs:t},view);
    expect(b.snapshot().stats.parries).toBe(offset<=0?1:0);expect(b.snapshot().stats.cracks).toBe(offset>0?1:0);
  });
  it('has identical damage and character powers across difficulties for identical word completions', () => {
    for(const character of ['elna','towa'] as const) {
      const states=['standard','challenge','seraph'].map(difficulty => {
        const b=new Battle({character,difficulty:difficulty as 'standard'|'challenge'|'seraph',bossHp:240,seed:12});b.startBoss(0);
        for(let i=0;i<3;i++)b.wordDone({index:8+i,kana:10,clean:true,gameMs:100+i*100},view);
        return b.snapshot();
      });expect(states[0]).toEqual(states[1]);expect(states[1]).toEqual(states[2]);
    }
  });
});
