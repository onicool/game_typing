import type { Dictionary, Word } from '../content/words';
import type { WordSource } from './round';

export const CHARACTERS = {
  elna: { name: 'エルナ', role: '秩序を信じる天使', quote: '間違いは、直せばいいでしょう。',
    opening: '下へ行けば、きっと役に立てます。', clear: 'これで、道が開きましたね。', miss: '落ち着いて。言葉を、もう一度。' },
  towa: { name: 'トワ', role: '善意を信じる天使', quote: '話せば、きっと分かってくれるよ。',
    opening: '困っている人が、待ってるはずだよ。', clear: 'ほら、道が開いた！', miss: '大丈夫。もう一度、やってみよう。' },
} as const;
export type Character = keyof typeof CHARACTERS;
export const isCharacter = (v: unknown): v is Character => v === 'elna' || v === 'towa';

export interface Place {
  key: string; name: string; sub: string; art: string; landmark: string; words: Word[];
}
const words = (pairs: [string, string][]): Word[] => pairs.map(([display, reading]) => ({ display, reading }));
/** Source: concept/WORLD_AND_CHARACTERS.md at 31a75f3. Route words are original
 * practice content; they do not settle the proposed boss fights or ending. */
export const PLACES: Place[] = [
  { key: 'heaven', name: '暁の天界', sub: '出立の門', art: 'stage-01-heaven', landmark: '光の封印', words: words([
    ['空の向こうへ', 'そらのむこうへ'], ['翼を広げる', 'つばさをひろげる'], ['光の道', 'ひかりのみち'],
    ['朝を待つ', 'あさをまつ'], ['祈りを届ける', 'いのりをとどける'],
  ]) },
  { key: 'town', name: '風車の町', sub: '晴れ渡る広場', art: 'stage-02-windmill-town', landmark: '広場の結界', words: words([
    ['風に乗る', 'かぜにのる'], ['広場の笑顔', 'ひろばのえがお'], ['約束を守る', 'やくそくをまもる'],
    ['町に光を', 'まちにひかりを'], ['一緒に歩こう', 'いっしょにあるこう'],
  ]) },
  { key: 'road', name: '豊穣の街道', sub: '夕映えの分かれ道', art: 'stage-03-harvest-road', landmark: '街道の封印', words: words([
    ['夕日の麦畑', 'ゆうひのむぎばたけ'], ['荷車の足跡', 'にぐるまのあしあと'], ['分かれ道に立つ', 'わかれみちにたつ'],
    ['遠くの声を聞く', 'とおくのこえをきく'], ['知らない暮らし', 'しらないくらし'],
  ]) },
  { key: 'canal', name: '煤煙の運河都市', sub: '薬院の水路', art: 'stage-04-canal-industry', landmark: '水路の障壁', words: words([
    ['運河の灯り', 'うんがのあかり'], ['煙の向こう側', 'けむりのむこうがわ'], ['明日の薬', 'あしたのくすり'],
    ['水面に映る光', 'みなもにうつるひかり'], ['手を止めて考える', 'てをとめてかんがえる'],
  ]) },
  { key: 'theatre', name: '花灯りの歓楽街', sub: '仮面の劇場', art: 'stage-05-lantern-quarter', landmark: '劇場の結界', words: words([
    ['花灯りの夜', 'はなあかりのよる'], ['仮面の奥', 'かめんのおく'], ['閉ざされた扉', 'とざされたとびら'],
    ['静かな路地', 'しずかなろじ'], ['届かない言葉', 'とどかないことば'],
  ]) },
  { key: 'snow', name: '雪の国境城塞', sub: '最後の橋', art: 'stage-06-snow-fortress', landmark: '橋の封印', words: words([
    ['雪を越えて', 'ゆきをこえて'], ['最後の橋', 'さいごのはし'], ['遠くの戦火', 'とおくのせんか'],
    ['まだ人がいる', 'まだひとがいる'], ['わずかな灯り', 'わずかなあかり'],
  ]) },
  { key: 'city', name: '白い救済都市', sub: '静寂の大聖堂', art: 'stage-07-salvation-city', landmark: '白い結界', words: words([
    ['白い街路', 'しろいがいろ'], ['静寂の大聖堂', 'せいじゃくのだいせいどう'], ['守られた暮らし', 'まもられたくらし'],
    ['翼の旗', 'つばさのはた'], ['まだ分からない', 'まだわからない'],
  ]) },
];
export const isPlaceIndex = (v: unknown): v is number => Number.isInteger(v) && typeof v === 'number' && v >= 0 && v < PLACES.length;
export function journeyDictionary(place: number): Dictionary {
  const p = PLACES[place];
  return { id: `jp-angel-${p.key}`, name: p.name, label: '祈り / ROMAJI',
    words: p.words.map((w, i) => ({ ...w, id: `jp-angel-${p.key}:${i}` })) };
}
/** Keep the map's original five-word order, including the two promised previews. */
export function journeySource(dict: Dictionary): WordSource {
  let index = 0;
  return { next() { const word = dict.words[index++ % dict.words.length];
    return { word, id: word.id!, role: 'ordinary', target: null, prob: 1 }; } };
}

/** Display-only gauge. Pausing/first input after pause starts a new timing window.
 * No attack multiplier depends on this number; final speed comes from Round. */
export class RecentSpeed {
  private times: number[] = [];
  reset() { this.times = []; }
  accepted(t: number, afterPause: boolean) {
    if (afterPause) this.reset();
    if (!this.times.length || t > this.times.at(-1)!) this.times.push(t);
    this.times = this.times.slice(-12);
  }
  value(now: number) {
    if (this.times.length < 2 || now - this.times.at(-1)! > 2000) return 0;
    const duration = this.times.at(-1)! - this.times[0];
    return duration > 0 ? (this.times.length - 1) * 1000 / duration : 0;
  }
}
