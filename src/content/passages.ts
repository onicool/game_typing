import type { Word } from './words';

// Original practice text authored for this game; no external quotations.
// Sentence boundaries align display and reading for reliable cursor following.
const passage = (segments: { display: string; reading: string }[]): Word => ({
  display: segments.map(s => s.display).join(''),
  reading: segments.map(s => s.reading).join(''), segments,
});

export const PASSAGES: Word[] = [
  passage([
    { display: '雨がやんだ朝、窓を開けると冷たい風が入ってきた。', reading: 'あめがやんだあさ、まどをあけるとつめたいかぜがはいってきた。' },
    { display: '道に残った小さな水たまりが、明るい空を映している。', reading: 'みちにのこったちいさなみずたまりが、あかるいそらをうつしている。' },
    { display: '今日は少し遠くまで歩いて、新しい景色を見つけよう。', reading: 'きょうはすこしとおくまであるいて、あたらしいけしきをみつけよう。' },
  ]),
  passage([
    { display: '図書館の奥で、まだ読んだことのない本を選んだ。', reading: 'としょかんのおくで、まだよんだことのないほんをえらんだ。' },
    { display: '最初のページを開くと、知らない町の音が聞こえる気がした。', reading: 'さいしょのぺーじをひらくと、しらないまちのおとがきこえるきがした。' },
    { display: '急がずに読み進めれば、言葉の向こうにある世界が広がっていく。', reading: 'いそがずによみすすめれば、ことばのむこうにあるせかいがひろがっていく。' },
  ]),
  passage([
    { display: '駅前の時計を見上げて、友達が来るのを待っていた。', reading: 'えきまえのとけいをみあげて、ともだちがくるのをまっていた。' },
    { display: '人の流れの向こうから、聞き慣れた声が近づいてくる。', reading: 'ひとのながれのむこうから、ききなれたこえがちかづいてくる。' },
    { display: '二人で今日の予定を話しながら、いつもの店へゆっくり歩いた。', reading: 'ふたりできょうのよていをはなしながら、いつものみせへゆっくりあるいた。' },
  ]),
  passage([
    { display: '小さな机の上に、紙と鉛筆を並べてみた。', reading: 'ちいさなつくえのうえに、かみとえんぴつをならべてみた。' },
    { display: '思いついたことを一つずつ書けば、曖昧だった考えに形が生まれる。', reading: 'おもいついたことをひとつずつかけば、あいまいだったかんがえにかたちがうまれる。' },
    { display: 'うまく書けなくても、明日また続きから始めればいい。', reading: 'うまくかけなくても、あしたまたつづきからはじめればいい。' },
  ]),
];
