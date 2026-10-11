import { battleArt } from './battle-art';

const textures = new Map<string, { loaded: boolean; settled: Promise<boolean> }>();
function texture(name: string) {
  const prior = textures.get(name); if (prior) return prior;
  const image = new Image(), entry = { loaded: false, settled: Promise.resolve(false) };
  entry.settled = new Promise<boolean>(resolve => {
    image.onload = () => { entry.loaded = image.naturalWidth > 0; resolve(entry.loaded); };
    image.onerror = () => resolve(false);
  });
  textures.set(name, entry); image.src = battleArt(`effects/fx-${name}.webp`); return entry;
}
export const warmPaintedEffects = (character: 'elna' | 'towa') => Promise.all([character, 'enemy'].map(name => texture(name).settled));

/** One clipped texture cell. Its host belongs to the existing fixed pool. */
export class PaintedEffect {
  readonly host: SVGSVGElement;
  private image: SVGImageElement;
  private signature = '';
  constructor(parent: SVGElement, x: number, y: number, width: number, height = width) {
    this.host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ x, y, width, height, viewBox: '0 0 512 512', overflow: 'hidden', opacity: 0 })) this.host.setAttribute(key, String(value));
    this.host.classList.add('side-painted-effect');
    this.image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    this.image.setAttribute('width', '1536'); this.image.setAttribute('height', '1024');
    this.host.append(this.image); parent.append(this.host);
  }
  paint(name: string, cell: number, opacity: number, enabled: boolean) {
    if (!enabled || !texture(name).loaded) { this.host.setAttribute('opacity', '0'); return; }
    const signature = `${name}:${cell}`;
    if (signature !== this.signature) {
      this.signature = signature; this.image.setAttribute('href', battleArt(`effects/fx-${name}.webp`));
      this.image.setAttribute('x', String(-(cell % 3) * 512)); this.image.setAttribute('y', String(-Math.floor(cell / 3) * 512));
      this.host.dataset.texture = signature;
    }
    this.host.setAttribute('opacity', String(opacity));
  }
}
