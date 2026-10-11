import type { Word } from './words';

// All wording below is original explanation or paraphrase, never a verbatim
// attributed quotation or a copied modern translation. Metadata is not typed.
const sources = {
  moon: { category: '科学', title: '国立天文台・月の潮汐変形', url: 'https://www.miz.nao.ac.jp/rise/c/news/topic/20190621.html' },
  rainbow: { category: '科学', title: '気象庁・雲と大気現象', url: 'https://www.jma.go.jp/jma/kishou/know/faq/faq13.html' },
  mathematics: { category: '歴史', title: '国立国会図書館・実学としての和算', url: 'https://www.ndl.go.jp/math/s1/4.html' },
  haniwa: { category: '歴史', title: '宮崎県総合博物館・考古の質問', url: 'https://miyazaki-archive.jp/museum/faq/kouko/' },
  dialect: { category: '言語', title: '国立国語研究所・オノマトペの方言', url: 'https://kotoba.ninjal.ac.jp/qa/yokuaru/qa-236/' },
  washoku: { category: '文化', title: '文化庁・和食の文化', url: 'https://www.bunka.go.jp/seisaku/bunkazai/shokai/mukei_bunka_isan/pdf/unesco_washoku_131205.pdf' },
  noh: { category: '文化', title: '文化遺産オンライン・能楽', url: 'https://online.bunka.go.jp/heritages/detail/214083/3' },
  fukuzawa: { category: '先人の考え方', person: '福沢諭吉', title: '学問のすすめ・二編', url: 'https://www.aozora.gr.jp/cards/000296/files/47061_29420.html' },
  soseki: { category: '先人の考え方', person: '夏目漱石', title: '私の個人主義', url: 'https://www.aozora.gr.jp/cards/000148/files/772_33100.html' },
  kenji: { category: '先人の考え方', person: '宮沢賢治', title: '農民芸術概論綱要・序論', url: 'https://www.aozora.gr.jp/cards/000081/files/2386_13825.html' },
  terada: { category: '先人の考え方', person: '寺田寅彦', title: '科学者とあたま', url: 'https://www.aozora.gr.jp/cards/000042/files/2359_13797.html' },
  lunarPeriod: { category: '科学', title: '国立天文台・暦Wiki／周期／月', url: 'https://eco.mtk.nao.ac.jp/koyomi/wiki/BCFEB4FC2FB7EE.html' },
};
type Source = keyof typeof sources;
const word = (source: Source, display: string, reading: string): Word => ({ display, reading, source: sources[source] });
const passage = (source: Source, pairs: [string, string][]): Word => {
  const segments = pairs.map(([display, reading]) => ({ display, reading }));
  return { display: segments.map(s => s.display).join(''), reading: segments.map(s => s.reading).join(''), segments, source: sources[source] };
};

export const KNOWLEDGE_WORDS: Word[] = [
  word('moon', '月は地球に、ほぼ同じ面を向けている。', 'つきはちきゅうに、ほぼおなじめんをむけている。'),
  word('rainbow', '虹は、空気中の水滴と太陽の光が作る。', 'にじは、くうきちゅうのすいてきとたいようのひかりがつくる。'),
  word('mathematics', '伊能忠敬の地図作りは、各地の協力者にも支えられた。', 'いのうただたかのちずづくりは、かくちのきょうりょくしゃにもささえられた。'),
  word('haniwa', 'はにわは、古墳の周りや頂上に並べられた。', 'はにわは、こふんのまわりやちょうじょうにならべられた。'),
  word('dialect', '音や様子を表すオノマトペにも、方言がある。', 'おとやようすをあらわすおのまとぺにも、ほうげんがある。'),
  word('washoku', '和食の文化は、正月などの年中行事とも結びついている。', 'わしょくのぶんかは、しょうがつなどのねんじゅうぎょうじともむすびついている。'),
  word('noh', '能楽とは、能と狂言を合わせた呼び名である。', 'のうがくとは、のうときょうげんをあわせたよびなである。'),
  word('fukuzawa', '学問は、本を読むことだけに限らない。', 'がくもんは、ほんをよむことだけにかぎらない。'),
  word('soseki', '自分の個性を大切にするなら、他人の個性も尊重する。', 'じぶんのこせいをたいせつにするなら、たにんのこせいもそんちょうする。'),
  word('kenji', '自分の幸せを、世界全体の幸せと切り離さずに考える。', 'じぶんのしあわせを、せかいぜんたいのしあわせときりはなさずにかんがえる。'),
  word('terada', '当たり前に見えることにも、研究の問いはひそんでいる。', 'あたりまえにみえることにも、けんきゅうのといはひそんでいる。'),
  word('rainbow', '虹を探すときは、太陽を背にして空を見る。', 'にじをさがすときは、たいようをせにしてそらをみる。'),
];

export const KNOWLEDGE_PASSAGES: Word[] = [
  passage('lunarPeriod', [
    ['月が地球を一周する時間と、満ち欠けが一周する時間は同じではない。', 'つきがちきゅうをいっしゅうするじかんと、みちかけがいっしゅうするじかんはおなじではない。'],
    ['その間に地球も太陽の周りを進むため、満ち欠けの一周には少し長くかかる。', 'そのあいだにちきゅうもたいようのまわりをすすむため、みちかけのいっしゅうにはすこしながくかかる。'],
  ]),
  passage('rainbow', [
    ['雨のあとに虹を探すなら、太陽を背にして空を見る。', 'あめのあとににじをさがすなら、たいようをせにしてそらをみる。'],
    ['太陽の光が水滴の中で曲がったり反射したりすると、見る人の方向へ色に分かれた光が届く。', 'たいようのひかりがすいてきのなかでまがったりはんしゃしたりすると、みるひとのほうこうへいろにわかれたひかりがとどく。'],
  ]),
  passage('mathematics', [
    ['江戸時代の数学は、暮らしの中でも役立っていた。', 'えどじだいのすうがくは、くらしのなかでもやくだっていた。'],
    ['田畑の面積を求めたり、水路を管理したりする仕事に、計算の知識や技術が使われていた。', 'たはたのめんせきをもとめたり、すいろをかんりしたりするしごとに、けいさんのちしきやぎじゅつがつかわれていた。'],
  ]),
  passage('washoku', [
    ['和食の文化には、食材や料理の技術だけでなく、自然を大切にする考え方も含まれる。', 'わしょくのぶんかには、しょくざいやりょうりのぎじゅつだけでなく、しぜんをたいせつにするかんがえかたもふくまれる。'],
    ['季節を感じる盛りつけや年中行事の食事も、その文化を支えている。', 'きせつをかんじるもりつけやねんじゅうぎょうじのしょくじも、そのぶんかをささえている。'],
  ]),
  passage('soseki', [
    ['夏目漱石は、自分の個性を伸ばすことと、他人の個性を認めることを結びつけて考えた。', 'なつめそうせきは、じぶんのこせいをのばすことと、たにんのこせいをみとめることをむすびつけてかんがえた。'],
    ['自分の自由を大切にするとき、相手の自由や、それぞれが負う責任にも目を向けたい。', 'じぶんのじゆうをたいせつにするとき、あいてのじゆうや、それぞれがおうせきにんにもめをむけたい。'],
  ]),
];
