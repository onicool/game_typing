import type { Word, Dictionary } from './words';
import type { Character } from '../game/journey';
import { TOWN_ROUTE, TOWN_BOSS, TOWN_BOSS_INTRO, townIntro, townOutro } from './town';
import { ROAD_ROUTE, ROAD_BOSS, ROAD_BOSS_INTRO, roadIntro, roadOutro } from './road';
import { CANAL_ROUTE, CANAL_BOSS, CANAL_BOSS_INTRO, canalIntro, canalOutro } from './canal';
import { THEATRE_ROUTE, THEATRE_BOSS, THEATRE_BOSS_INTRO, theatreIntro, theatreOutro } from './theatre';
import { SNOW_ROUTE, SNOW_BOSS, SNOW_BOSS_INTRO, snowIntro, snowOutro } from './snow';
import { CITY_ROUTE, CITY_BOSS, CITY_BOSS_INTRO, cityIntro, cityOutro } from './city';
export const CHAPTER_ROUTE_WORDS = 8;
export const CHAPTER_WORD_LIMIT = 60;
export const CHAPTER_VERSION = 2;
const words = (pairs: [string, string][]): Word[] => pairs.map(([display, reading]) => ({ display, reading }));
/** Original prayers derived from the departure-gate setting. Dialogue remains a reversible draft. */
export const HEAVEN_ROUTE = words([
  ['青い空', 'あおいそら'], ['朝の光', 'あさのひかり'], ['白い羽', 'しろいはね'], ['雲の海', 'くものうみ'],
  ['門の前へ', 'もんのまえへ'], ['風の道', 'かぜのみち'],
  ['翼を広げる', 'つばさをひろげる'], ['光の橋を渡る', 'ひかりのはしをわたる'], ['下界へ向かう', 'げかいへむかう'],
  ['遠くの声を聞く', 'とおくのこえをきく'], ['祈りを届ける', 'いのりをとどける'], ['大きな門を開く', 'おおきなもんをひらく'],
  ['一緒に飛ぼう', 'いっしょにとぼう'], ['真っすぐ進む', 'まっすぐすすむ'], ['信じて進もう', 'しんじてすすもう'],
  ['小さな決心', 'ちいさなけっしん'], ['祈りの共鳴', 'いのりのきょうめい'], ['出発の合図', 'しゅっぱつのあいず'],
  ['雲間の音響', 'くもまのおんきょう'], ['天使の約束', 'てんしのやくそく'],
]);
export const HEAVEN_BOSS = words([
  ['門の向こうへ行く', 'もんのむこうへいく'], ['白い翼を広げる', 'しろいつばさをひろげる'], ['光の道をひらく', 'ひかりのみちをひらく'],
  ['祈りは空を渡る', 'いのりはそらをわたる'], ['帰る場所を忘れない', 'かえるばしょをわすれない'], ['怖くても進める', 'こわくてもすすめる'],
  ['言葉に力をこめる', 'ことばにちからをこめる'], ['朝の鐘に応える', 'あさのかねにこたえる'], ['翼の先まで光を', 'つばさのさきまでひかりを'],
  ['この声を届けたい', 'このこえをとどけたい'], ['風の中で手を取る', 'かぜのなかでてをとる'], ['遠い雲を越えよう', 'とおいくもをこえよう'],
  ['祈りの輪をつなぐ', 'いのりのわをつなぐ'], ['まなざしをそらさない', 'まなざしをそらさない'], ['自分の足で選ぼう', 'じぶんのあしでえらぼう'],
  ['間違いは直せる', 'まちがいはなおせる'], ['話せば分かり合える', 'はなせばわかりあえる'], ['約束を胸に抱く', 'やくそくをむねにだく'],
  ['やさしさを信じたい', 'やさしさをしんじたい'], ['揺れる光を守る', 'ゆれるひかりをまもる'], ['雲海へ踏み出そう', 'うんかいへふみだそう'],
  ['立ち止まらず唱える', 'たちどまらずとなえる'], ['空の果てを見に行く', 'そらのはてをみにいく'], ['心を結ぶ光輪', 'こころをむすぶこうりん'],
  ['筆先に朝を描く', 'ふでさきにあさをえがく'], ['光の筋を重ねる', 'ひかりのすじをかさねる'], ['静かな声も響く', 'しずかなこえもひびく'],
  ['守る言葉を唱える', 'まもることばをとなえる'], ['伸ばした手を離さない', 'のばしたてをはなさない'], ['もう一度だけ祈ろう', 'もういちどだけいのろう'],
  ['まぶしい輪をひらく', 'まぶしいわをひらく'], ['飛び方は覚えている', 'とびかたはおぼえている'], ['遠くても声は届く', 'とおくてもこえはとどく'],
  ['青い窓に光さす', 'あおいまどにひかりさす'], ['門の鍵を見つめる', 'もんのかぎをみつめる'], ['まだ見ぬ人を思う', 'まだみぬひとをおもう'],
  ['迷いも連れて行こう', 'まよいもつれていこう'], ['朝風を抱きしめる', 'あさかぜをだきしめる'], ['白い塔を振り返る', 'しろいとうをふりかえる'],
  ['自分の声で応える', 'じぶんのこえでこたえる'], ['言葉の先へ羽ばたく', 'ことばのさきへはばたく'], ['ひとつの祈りを結ぶ', 'ひとつのいのりをむすぶ'],
  ['次の朝も忘れない', 'つぎのあさもわすれない'], ['金の留め具に誓う', 'きんのとめぐにちかう'], ['今日の光を持って行く', 'きょうのひかりをもっていく'],
  ['羽の音に耳を澄ます', 'はねのおとにみみをすます'], ['救いたいと願っている', 'すくいたいとねがっている'], ['まっすぐ門へ飛ぼう', 'まっすぐもんへとぼう'],
  ['小さな祈りを束ねる', 'ちいさないのりをたばねる'], ['心の結界をひらく', 'こころのけっかいをひらく'], ['白い羽飾りを守る', 'しろいはねかざりをまもる'],
  ['この空へ帰ってくる', 'このそらへかえってくる'], ['雲の先で手を差し出す', 'くものさきでてをさしだす'], ['光を途切れさせない', 'ひかりをとぎれさせない'],
  ['一緒に朝を迎える', 'いっしょにあさをむかえる'], ['帰る日の声を思う', 'かえるひのこえをおもう'],
  ['朝焼けに羽を染める', 'あさやけにはねをそめる'], ['祈る声を重ねよう', 'いのるこえをかさねよう'],
  ['雲の階段を登る', 'くものかいだんをのぼる'], ['光る道標を読む', 'ひかるみちしるべをよむ'],
  ['明日の空へつなごう', 'あしたのそらへつなごう'], ['風に名前を預ける', 'かぜになまえをあずける'],
  ['鐘の余韻を抱いて', 'かねのよいんをだいて'], ['翼の影を追いかける', 'つばさのかげをおいかける'],
]);
export function chapterDictionary(place = 0): Dictionary {
  const chapter = getChapter(place);
  if (!chapter) throw new Error('No completed chapter content for this place');
  const id = `jp-angel-${chapter.key}`;
  return { id, name: chapter.title, label: '祈り / ROMAJI',
    words: [...chapter.route, ...chapter.boss].map((w, i) => ({ ...w, id: `${id}:chapter:${i}` })) };
}
export interface Line { speaker: 'sera' | 'steward' | 'villager' | 'nico' | 'merchant' | 'marta' | 'canal-resident' | 'vel' | 'performer' | 'isaac' | 'refugee' | 'aster' | 'city-resident' | 'city-leaver' | Character; text: string }
export const SPEAKER_NAMES: Record<Line['speaker'], string> = { sera: 'セラ', elna: 'エルナ', towa: 'トワ', steward: '代官', villager: '町の人', nico: 'ニコ', merchant: '商人', marta: 'マルタ', 'canal-resident': '水路の人', vel: 'ヴェル', performer: '舞台の人', isaac: 'イサク', refugee: '橋の人', aster: 'アステル', 'city-resident': '残る人', 'city-leaver': '出たい人' };
export function chapterIntro(character: Character, tutorial: boolean): Line[] {
  return [
    { speaker: 'sera', text: '二人とも、出立の門まで来たのですね。' },
    { speaker: character, text: character === 'elna' ? '下へ行けば、きっと役に立てます。' : '困っている人が、待ってるはずだよ。' },
    { speaker: 'sera', text: '帰ってきたときも、同じことが言えますか。' },
    { speaker: character, text: character === 'elna' ? '自分の目で確かめます。門をひらいてください。' : '確かめてくるよ。ちゃんと、帰ってくるから。' },
    ...(tutorial ? [{ speaker: 'sera' as const, text: '祈りは英数入力で唱えてください。IMEはオフに。' },
      { speaker: 'sera' as const, text: '間違えても消す必要はありません。そのまま、もう一度。' }] : []),
  ];
}
export const BOSS_INTRO: Line[] = [{ speaker: 'sera', text: 'ならば、門の守護機に祈りを届けてみなさい。' },
  { speaker: 'sera', text: '予兆が見えたら、金の枠の言葉を唱え切るのです。' }];
export const CHAPTER_OUTRO: Line[] = [{ speaker: 'sera', text: '……羽飾りを落としましたよ。忘れていかないで。' },
  { speaker: 'sera', text: '行ってらっしゃい。帰る空は、ここにあります。' }];
export const PHASE2_LINE = 'まだ唱えられますね。二つの言葉も、つないでみなさい。';
export const bossOpening = (character: Character) => character === 'elna' ? '門の向こうへ、祈りを届けます。' : '金の言葉も、ちゃんとつなげるよ。';

export interface ChapterDefinition {
  key: string; title: string; route: Word[]; boss: Word[]; bossName: string;
  quest: string; bossQuest: string; phase2Line: string; victory: string; clearLabel: string;
  intro(character: Character, tutorial: boolean): Line[];
  bossIntro: Line[]; outro(character: Character): Line[];
  opening(character: Character): string; openingReply?: boolean;
}
const CHAPTERS: ChapterDefinition[] = [
  { key: 'heaven', title: '暁の天界 · 出立の門', route: HEAVEN_ROUTE, boss: HEAVEN_BOSS,
    bossName: '門の守護機', quest: '出立の門へ', bossQuest: '守護機に祈りを届ける',
    phase2Line: PHASE2_LINE, victory: '出立の門がひらいた。セラが、あなたを待っている。', clearLabel: '守護機を撃破',
    intro: chapterIntro, bossIntro: BOSS_INTRO, outro: () => CHAPTER_OUTRO, opening: bossOpening },
  { key: 'town', title: '風車の町 · 晴れ渡る広場', route: TOWN_ROUTE, boss: TOWN_BOSS,
    bossName: '代官の結界', quest: '町の人の訴えを聞く', bossQuest: '代官へ言葉を届ける',
    phase2Line: 'まだ、こんなに声が集まるのか……！', victory: '代官の結界がほどけた。町の人の声が、届いた。', clearLabel: '代官の結界を突破',
    intro: townIntro, bossIntro: TOWN_BOSS_INTRO, outro: townOutro, openingReply: true,
    opening: () => '代官「弱い者は黙って払えばよい」 · 最初の祈りで返事を届けよう。' },
  { key: 'road', title: '豊穣の街道 · 夕映えの分かれ道', route: ROAD_ROUTE, boss: ROAD_BOSS,
    bossName: 'ニコの結界', quest: '奪われた荷を追う', bossQuest: '奪われた荷を取り戻す',
    phase2Line: '荷を返して、それからどう暮らせばいい？', victory: '奪われた荷が戻った。脇道には、ニコを待つ子どもがいた。', clearLabel: 'ニコの結界を突破',
    intro: roadIntro, bossIntro: ROAD_BOSS_INTRO, outro: roadOutro, openingReply: true,
    opening: () => 'ニコ「全部返せって？」 · 奪った荷を返して、と祈りを届けよう。' },
  { key: 'canal', title: '煤煙の運河都市 · 薬院の水路', route: CANAL_ROUTE, boss: CANAL_BOSS,
    bossName: 'マルタの結界', quest: '水路の被害をたどる', bossQuest: '危険な廃液を止める',
    phase2Line: '薬を止めたら、待つ人はどうなる？', victory: '煙が止まり、水が澄み始めた。薬院の窓口には、薬を求める列ができた。', clearLabel: 'マルタの結界を突破',
    intro: canalIntro, bossIntro: CANAL_BOSS_INTRO, outro: canalOutro, openingReply: true,
    opening: () => 'マルタ「明日の薬をあなたが作って」 · 危険な廃液を止めて、と祈りを届けよう。' },
  { key: 'theatre', title: '花灯りの歓楽街 · 仮面の劇場', route: THEATRE_ROUTE, boss: THEATRE_BOSS,
    bossName: 'ヴェルの結界', quest: '閉ざされた入口へ', bossQuest: '危険な見世物を止める',
    phase2Line: 'よく響く声だね。もっと客を楽しませて。', victory: '危険な見世物の幕が閉じた。ヴェルの仮面は、変わらない。', clearLabel: 'ヴェルの結界を突破',
    intro: theatreIntro, bossIntro: THEATRE_BOSS_INTRO, outro: theatreOutro, openingReply: true,
    opening: () => 'ヴェル「嫌なら出なければよかったでしょう？」 · 危険な見世物をやめて、と祈りを届けよう。' },
  { key: 'snow', title: '雪の国境城塞 · 最後の橋', route: SNOW_ROUTE, boss: SNOW_BOSS,
    bossName: 'イサクの結界', quest: '橋に残る人を確かめる', bossQuest: '橋を守る',
    phase2Line: 'この橋だけを守って、その先はどうする。', victory: '橋は残り、避難の列が渡った。その先の街へ、戦火は広がっている。', clearLabel: 'イサクの結界を突破',
    intro: snowIntro, bossIntro: SNOW_BOSS_INTRO, outro: snowOutro, openingReply: true,
    opening: () => 'イサク「待てば、向こうの街まで焼かれる」 · 橋を落とさないで、と祈りを届けよう。' },
  { key: 'city', title: '白い救済都市 · 翼の大聖堂', route: CITY_ROUTE, boss: CITY_BOSS,
    bossName: 'アステルの結界', quest: '白い街の二つの声を聞く', bossQuest: '出たい人の扉をひらく',
    phase2Line: '離れた人を、この先も守れるのですか。', victory: '出たい人へ扉がひらいた。街に残る人の感謝も、これからの暮らしへの問いも残る。', clearLabel: 'アステルの結界を突破',
    intro: cityIntro, bossIntro: CITY_BOSS_INTRO, outro: cityOutro, openingReply: true,
    opening: character => `アステル「では、あなたはどう救うのですか」 · ${character === 'elna' ? 'エルナ「まだ、分からない」' : 'トワ「まだ、分からないよ」'} · 出たい人を閉じ込めないで、と祈りを届けよう。` },
];
export const getChapter = (place: number): ChapterDefinition | null => CHAPTERS[place] ?? null;
