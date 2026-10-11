import { CHAPTER_VERSION } from '../content/chapters';
import type { SessionMeta } from '../stats/store';
import { isCompatibleDifficulty } from './battle';
import { isCharacter, PLACES } from './journey';
import { readBossMeasure } from './training';

/** Stable collection IDs and version-one rules survive later chapter versions. */
export const MEMORY_VERSION = 1;
const FIRST_CHAPTER_VERSION = 2;
const contents: Record<string, [string, string][]> = {
  heaven: [
    ['出立の約束', '自分たちの言葉で下界への道をひらく。その約束を胸に、天使は出立の門を越えた。'],
    ['澄んだ祈り', 'ひとつずつ正確に唱えた言葉が、空へ続く光の道になった。'],
    ['門を守る光', '迫る反撃を言葉で弾き返した。出立の門には、ひびのない光が残った。'],
  ],
  town: [
    ['広場の返事', '「取りすぎた税を返して」。町の声を届けた祈りが、代官の結界をひらいた。'],
    ['届いた言葉', '町の人の願いを、ひとつずつ正確に唱えた。広場で交わす言葉に、光が戻った。'],
    ['広場を守る光', '代官の反撃を弾き返し、結界を守った。町の声を届けるための光は、最後まで割れなかった。'],
  ],
  road: [
    ['分かれ道の声', '奪われた荷が商人へ戻った。脇道にはニコを待つ子どもがいる。被害も、明日の暮らしも、ひとつの答えでは片づかなかった。'],
    ['夕映えの祈り', '街道の言葉をひとつずつ正確に唱えた。麦畑と小屋に届く声を、急いでひとつにまとめずに聞いた。'],
    ['荷車を守る光', 'ニコの反撃を言葉で弾き返した。奪われた荷を取り戻す祈りを、ひびのない結界が支えた。'],
  ],
  canal: [
    ['薬院の窓口', '煙が止まり、水が澄み始めた。その先では、薬を求める人が窓口に並ぶ。止めた手の先にも、暮らしは続いていた。'],
    ['水路に届く祈り', '岸辺の言葉をひとつずつ正確に唱えた。被害を受けた声と薬を待つ声を、急いでひとつの答えへまとめなかった。'],
    ['岸辺を守る光', 'マルタの反撃を言葉で弾き返した。危険な廃液を止める祈りを、ひびのない結界が支えた。'],
  ],
  theatre: [
    ['閉じた幕の先', '危険な見世物の幕が閉じ、人が裏口から出ていく。ヴェルは変わらない。止められたことと、届かなかった言葉の両方が残った。'],
    ['聞かれない祈り', '舞台の言葉をひとつずつ正確に唱えた。それでも相手が聞こうとするとは限らない。危険な舞台を止める祈りを、最後まで続けた。'],
    ['出口を守る光', 'ヴェルの反撃を言葉で弾き返した。舞台を降りたい人の出口へ、ひびのない結界が光を残した。'],
  ],
  snow: [
    ['最後の橋', '橋が残り、避難の列が渡った。その先へ戦火は広がっている。救えた声と、判断の先に残る問いを、両方見続ける。'],
    ['橋に届く祈り', '雪の国境で言葉をひとつずつ正確に唱えた。橋に残る人も、遠い街の暮らしも、ひとつの数だけでは決められなかった。'],
    ['橋を守る光', 'イサクの反撃を言葉で弾き返した。避難の列を支える橋へ、ひびのない結界が光を残した。'],
  ],
  city: [
    ['白い街の二つの声', '出たい人へ扉がひらいた。街に残って暮らしたい人の感謝も消えない。救い方への答えは決めず、二つの声を聞き続ける。'],
    ['選ぶ言葉を返す', '白い街の言葉をひとつずつ正確に唱えた。出たい人と残る人を、同じ願いにまとめなかった。'],
    ['扉を守る光', 'アステルの反撃を言葉で弾き返した。自分で行く先を選ぶための扉へ、ひびのない結界が光を残した。'],
  ],
};
const conditions = ['章を最初から通して撃破する', '章を通して撃破し、全体の正確率95%以上', '章を通して撃破し、弾き返し1回以上・ひび0回'];
export const MEMORIES = PLACES.flatMap((place, index) => [0, 1, 2].map(slot => ({
  id: `${place.key}:${slot + 1}`, place: index, bit: 1 << slot,
  implemented: !!contents[place.key],
  title: contents[place.key]?.[slot]?.[0] ?? `${place.name}の記憶 ${slot + 1}`,
  text: contents[place.key]?.[slot]?.[1] ?? '',
  condition: contents[place.key] ? conditions[slot] : '章を実装後に取得条件を確定します',
})));
export interface MemoryProof { session: string; endedAt: number; chapterVersion: number }
export type OwnedMemories = Record<string, MemoryProof>;

function eligible(meta: SessionMeta): boolean {
  return typeof meta.session === 'string' && meta.session.trim().length > 0
    && typeof meta.dict === 'string' && Object.keys(contents).some(key => meta.dict === `jp-angel-${key}`)
    && meta.mode === 'journey' && meta.scope === 'chapter' && meta.outcome === 'cleared'
    && (meta.endReason === undefined || meta.endReason === 'finish')
    && isCharacter(meta.character) && isCompatibleDifficulty(meta)
    && Number.isSafeInteger(meta.routeVersion) && meta.routeVersion! >= FIRST_CHAPTER_VERSION
    && typeof meta.accuracy === 'number' && Number.isFinite(meta.accuracy) && meta.accuracy >= 0 && meta.accuracy <= 1
    && typeof meta.endedAt === 'number' && Number.isFinite(meta.endedAt) && meta.endedAt >= 0 && meta.endedAt <= 8.64e15;
}

/** New clears carry this flat claim in the same atomic write as their input log. */
export function memoryBits(meta: SessionMeta): number {
  if (!eligible(meta)) return 0;
  const boss = readBossMeasure(meta);
  return 1 | (meta.accuracy >= .95 ? 2 : 0)
    | (boss && boss.parries >= 1 && boss.attempts >= boss.parries && boss.parries === boss.resolved
      && boss.cracks === 0 && boss.resets === 0 ? 4 : 0);
}

export function mergeMemories(...collections: OwnedMemories[]): OwnedMemories {
  const merged: OwnedMemories = {};
  for (const slot of MEMORIES.filter(m => m.implemented)) for (const collection of collections) {
    const next = collection[slot.id], previous = merged[slot.id];
    if (next && (!previous || next.endedAt < previous.endedAt || (next.endedAt === previous.endedAt && next.session < previous.session)))
      merged[slot.id] = { ...next };
  }
  return merged;
}

/** Read only. Never stamp, repair or rewrite old, malformed or future records. */
export function collectMemories(records: unknown[]): { owned: OwnedMemories; unreadable: number } {
  let owned: OwnedMemories = {}, unreadable = 0;
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) { unreadable++; continue; }
    const meta = record as SessionMeta;
    const stamped = Object.hasOwn(meta, 'memoryVersion') || Object.hasOwn(meta, 'memoryBits');
    let bits = memoryBits(meta);
    if (stamped) {
      // A corrupt claim must not silently fall back to a legacy award.
      if (!bits || meta.memoryVersion !== MEMORY_VERSION || meta.memoryBits !== bits) { unreadable++; continue; }
    } else if (meta.routeVersion! > CHAPTER_VERSION) bits = 0;
    if (!bits) continue;
    const claim: OwnedMemories = {};
    for (const slot of MEMORIES) if (slot.implemented && meta.dict === `jp-angel-${PLACES[slot.place].key}` && (bits & slot.bit))
      claim[slot.id] = { session: meta.session, endedAt: meta.endedAt, chapterVersion: meta.routeVersion! };
    owned = mergeMemories(owned, claim);
  }
  return { owned, unreadable };
}
