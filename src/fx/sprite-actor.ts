import { battleArt } from './battle-art';
import { MOTION_FRAMES } from './motion-manifest';
import type { MotionSample } from './battle-motion';

const cache = new Map<string, { image: HTMLImageElement; loaded: boolean; settled: Promise<boolean> }>();
function load(name: string) {
  const existing = cache.get(name); if (existing) return existing;
  const image = new Image();
  const entry = { image, loaded: false, settled: Promise.resolve(false) };
  entry.settled = new Promise<boolean>(resolve => {
    image.onload = () => { entry.loaded = image.naturalWidth > 0; resolve(entry.loaded); };
    image.onerror = () => resolve(false);
  });
  cache.set(name, entry); image.src = battleArt(`motion/${name}.webp`); return entry;
}
export function warmBattleSprites(character: 'elna' | 'towa') {
  return Promise.all(Object.keys(MOTION_FRAMES).filter(name => name.startsWith(character + '-') || name.startsWith('sentinel-')).map(name => load(name).settled));
}

/** Registration moves the drawn frames to a common planted boot. The six
 * underlying drawings articulate the body; registration is not the motion. */
export class SpriteActor {
  private image: SVGImageElement;
  private film: SVGElement;
  private poster: SVGImageElement;
  private signature = '';
  constructor(private host: SVGElement, private actor: 'elna' | 'towa' | 'sentinel', x: number) {
    host.innerHTML = `<image class="side-sprite" href="${battleArt(`${actor}-idle.webp`)}" x="${x}" y="0" width="260" height="247"/>
      <svg class="side-film" x="${x}" y="0" width="260" height="247" viewBox="0 0 512 512" overflow="hidden" opacity="0"><image class="side-atlas" width="1536" height="1024"/></svg>`;
    this.poster = host.querySelector('.side-sprite')!;
    this.film = host.querySelector('.side-film')!; this.image = host.querySelector('.side-atlas')!;
  }
  paint(sample: MotionSample | null, guarding = false, posterOnly = false) {
    const move = sample?.move ?? (guarding ? 'guard' : this.actor === 'sentinel' ? 'hit' : this.actor === 'elna' ? 'thrust' : 'jab');
    const mapped = this.actor !== 'sentinel' && sample ? sample.kind === 'hit' ? [3, 3, 3, 4, 5, 5][sample.frame] : sample.kind === 'parry' ? [2, 4, 4, 4, 5, 5][sample.frame] : sample.frame : sample?.frame;
    const name = `${this.actor}-${move}`, frame = mapped ?? (guarding ? 2 : 5), registration = MOTION_FRAMES[name]?.[frame];
    if (posterOnly || !registration || !load(name).loaded) {
      this.film.setAttribute('opacity', '0'); this.poster.setAttribute('opacity', '1');
      const pose = sample ? this.actor === 'sentinel' ? sample.kind === 'enemy' ? 'attack' : 'hit' : sample.kind === 'normal' || sample.kind === 'combo' ? 'attack' : 'guard' : guarding ? 'guard' : 'idle';
      this.poster.setAttribute('href', battleArt(`${this.actor}-${pose}.webp`));
      this.host.dataset.pose = pose; this.host.dataset.phase = sample ? 'loading' : 'ready'; return;
    }
    this.film.setAttribute('opacity', '1'); this.poster.setAttribute('opacity', '0');
    const signature = `${name}:${frame}`;
    if (signature !== this.signature) {
      this.signature = signature;
      this.image.setAttribute('href', battleArt(`motion/${name}.webp`));
      this.image.setAttribute('x', String(-(frame % 3) * 512 + registration.x));
      this.image.setAttribute('y', String(-Math.floor(frame / 3) * 512 + registration.y));
    }
    this.host.dataset.motion = move; this.host.dataset.frame = String(frame);
    this.host.dataset.phase = sample?.phase ?? 'ready';
    this.host.dataset.chain = String(sample?.chain ?? false);
    this.host.dataset.reaction = sample?.kind ?? '';
    this.host.dataset.pose = sample ? sample.kind === 'guard' || sample.kind === 'parry' ? 'guard' : this.actor === 'sentinel' ? sample.kind === 'enemy' ? 'attack' : 'hit' : 'attack' : guarding ? 'guard' : 'idle';
  }
}
