import './title.css';
import { battleArt } from '../fx/battle-art';

/** The title uses the same side-view art as the playable battle. */
export function renderTitle(): string {
  return `<section class="av-title" aria-labelledby="title-name">
    <div class="av-title-backdrop" style="background-image:url('${battleArt('celestial-terrace.webp')}')" aria-hidden="true"></div>
    <div class="av-title-top"><span>DATENSHI <i>／</i> TYPING BATTLE</span><button type="button" class="av-title-settings" data-action="settings">音と演出</button></div>
    <div class="av-title-copy"><p class="av-title-reading">だてんし</p><h1 id="title-name" tabindex="-1">打天使</h1><p class="av-title-tagline">その一打が、翼になる。</p></div>
    <div class="av-title-stage" role="img" aria-label="左のエルナと右の守護機が、天空の回廊で向き合う横視点の風景">
      <div class="av-title-actor av-title-elna"><img src="${battleArt('elna-idle.webp')}" alt="" width="1280" height="1280" fetchpriority="high" decoding="async"><span>エルナ</span></div>
      <div class="av-title-actor av-title-sentinel"><img src="${battleArt('sentinel-idle.webp')}" alt="" width="1280" height="1280" decoding="async"><span>守護機</span></div>
      <div class="av-title-versus" aria-hidden="true"><span>✦</span><i></i></div>
    </div>
    <div class="av-title-entry"><button type="button" id="title-start" class="av-title-start" data-action="title-start" aria-label="スペースキーでエルナの横視点バトルを始める"><kbd>SPACE</kbd><span>でスタート</span><i aria-hidden="true">→</i></button><p class="av-title-start-note">エルナで、すぐにバトルへ</p>
      <nav class="av-title-menu" aria-label="ほかの遊び方"><button type="button" data-view="characters">天使を選ぶ</button><button type="button" data-view="journey">旅の地図</button><button type="button" data-view="training">練習</button><button type="button" data-view="records">記録</button></nav>
      <p class="av-title-help">英数入力でプレイ <span>·</span> Escで一時停止</p>
    </div>
  </section>`;
}
