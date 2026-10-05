/**
 * Canvas2D SKYWAY: a flight corridor with approaching energy barriers.
 * Accepted keys drive travel and impact; word completion breaks a barrier.
 *
 * All coordinates are in stage space (1920x1080). Nothing here ever draws on
 * the input panel area's text: the panel is a DOM element above the canvas.
 */

type P2 = [number, number];

const W = 1920;
const H = 1080;
const CX = 975;
const CY = 435;
const FOCAL = 900;

const CYAN = '101,245,237';
const PINK = '255,88,200';
const RED = '255,80,100';
const WHITE = '235,255,250';

interface Packet { from: P2; to: P2; t: number; dur: number; critical: boolean; generation: number; completion?: 'layer' | 'breach' }
interface Opening { pts: P2[]; life: number; max: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; len: number }
interface Shard { pts: P2[]; x: number; y: number; vx: number; vy: number; rot: number; vr: number; life: number; max: number; color: string }
interface Crack { pts: P2[]; born: number } // relative to cube center, in units of cube radius
interface FloatText { x: number; y: number; text: string; sub: string; life: number; max: number }
interface Ring { r: number; life: number; max: number; color: string; grow: number; at?: P2 }
interface Drifter { x: number; y: number; z: number; size: number; rx: number; ry: number; color: string }

const unit = (v: number) => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
const points = (n: number): P2[] => Array.from({ length: n }, () => [0, 0]);
const EDGE_WIDTHS = [9, 4, 1.6];
const CRACK_STROKES = [[5, 0.2], [1.5, 0.95]] as const;
const PACKET_STROKES = [[7, 0.25], [2, 1]] as const;
// Stable compaction avoids fresh particle arrays on every frame.
function retain<T>(items: T[], keep: (item: T) => boolean) {
  let n = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (keep(item)) items[n++] = item;
  }
  items.length = n;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Scene {
  private ctx!: CanvasRenderingContext2D;
  private available = false;
  private viewScale = 1;
  private lowGraphics = false;
  private active = true;
  private arenaBottom = 650;
  private background: HTMLImageElement | null = null;
  private target: HTMLImageElement | null = null;
  private thrust = 0;
  private approach = 0;
  private progressByGeneration = new Map<number, number>();
  private skyGradient: CanvasGradient | null = null;
  private last = 0;
  private time = 0; // world time, frozen during hit-stop
  private motionTime = 0; // separate rotation clock; cracks age even with motion disabled
  private hitStop = 0;
  private shake = 0;
  private shakeOffset: P2 = [0, 0];
  private flash = 0;
  private missFlash = 0;
  private tunnelZ = 0;
  private speed = 0;
  private stage = 0;
  private generation = 0;
  private inputGeneration = 0;
  private openings: Opening[] = [];
  private effects = { shake: 1, flash: 1, motion: 1 };
  private damage = 0; // 0 = intact, 1 = about to break
  private kick = 0;
  private spawnT = 1; // firewall approach animation 0..1
  private packets: Packet[] = [];
  private sparks: Spark[] = [];
  private shards: Shard[] = [];
  private cracks: Crack[] = [];
  private texts: FloatText[] = [];
  private rings: Ring[] = [];
  private drifters: Drifter[] = [];
  private cubeRadius = 230;
  private hullPts: P2[] = [];
  private cubePts = points(8);
  private projectA: P2 = [0, 0];
  private projectB: P2 = [0, 0];
  private coreGradients = new Map<number, CanvasGradient>();

  constructor(private canvas: HTMLCanvasElement) {
    this.restoreContext();
    canvas.addEventListener('contextlost', () => {
      this.setAvailable(false);
      this.reset();
    });
    canvas.addEventListener('contextrestored', () => this.restoreContext());
    for (let i = 0; i < 14; i++) this.drifters.push(this.newDrifter(rand(600, 4200)));
  }

  /** Optional artwork: unavailable/loading images retain the procedural sky. */
  setBackground(url: string) {
    this.loadImage(url, image => { this.background = image; });
  }

  setTarget(url: string) { this.loadImage(url, image => { this.target = image; }); }

  private loadImage(url: string, ready: (image: HTMLImageElement) => void) {
    try {
      const image = new Image();
      image.onload = () => { if (image.naturalWidth > 0 && image.naturalHeight > 0) ready(image); };
      image.onerror = () => { /* Optional art keeps its procedural fallback. */ };
      image.src = url;
    } catch { /* Optional image construction must never prevent typing. */ }
  }

  setActive(active: boolean) { this.active = active; }
  setArenaBottom(bottom: number) { this.arenaBottom = Math.max(220, Math.min(680, bottom)); }
  setProgress(progress: number) { this.progressByGeneration.set(this.inputGeneration, unit(progress)); }

  private setAvailable(available: boolean) {
    this.available = available;
    this.canvas.parentElement?.classList.toggle('scene-unavailable', !available);
  }

  private restoreContext() {
    try {
      const ctx = this.canvas.getContext('2d', { alpha: false });
      if (!ctx) return this.setAvailable(false);
      this.ctx = ctx;
      this.setAvailable(true);
      this.resize(this.viewScale);
    } catch { this.setAvailable(false); }
  }

  resize(scale: number) {
    this.viewScale = scale;
    if (!this.available) return;
    // Cap the backing store at 4K while retaining stage-space coordinates.
    const pixelScale = Math.min(scale * (window.devicePixelRatio || 1), this.lowGraphics ? 1 : 2);
    this.canvas.width = Math.max(1, Math.round(W * pixelScale));
    this.canvas.height = Math.max(1, Math.round(H * pixelScale));
    this.ctx.setTransform(this.canvas.width / W, 0, 0, this.canvas.height / H, 0, 0);
    this.coreGradients.clear();
    this.skyGradient = null;
  }

  setLowGraphics(low: boolean) {
    if (this.lowGraphics === low) return;
    this.lowGraphics = low;
    this.resize(this.viewScale);
  }

  setStage(stage: number) { this.stage = stage; }
  setDamage(d: number) { this.damage = d; }

  setEffects(e: { shake: number; flash: number; motion: number }) {
    this.effects.shake = unit(e.shake);
    this.effects.flash = unit(e.flash);
    this.effects.motion = unit(e.motion);
  }

  reset() {
    this.packets.length = this.sparks.length = this.shards.length = this.cracks.length = this.texts.length = this.rings.length = 0;
    this.openings.length = 0;
    this.speed = this.shake = this.flash = this.missFlash = this.kick = this.hitStop = 0;
    this.damage = this.stage = this.generation = 0;
    this.inputGeneration = 0;
    this.last = this.time = this.motionTime = this.tunnelZ = 0;
    this.spawnT = 1;
    this.thrust = this.approach = 0;
    this.shakeOffset[0] = this.shakeOffset[1] = 0;
    this.progressByGeneration.clear();
    this.cubeRadius = 230;
    this.hullPts.length = 0;
  }

  /** Accepted keystroke: fire a packet at the firewall. */
  hit(critical: boolean, gainMs = 0) {
    if (!this.available) return;
    this.thrust = Math.min(1, this.thrust + (critical ? 0.24 : 0.14));
    const n = critical && !this.lowGraphics && this.effects.motion > 0 ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const from: P2 = [960 + rand(-160, 160), 750];
      const a = rand(0, Math.PI * 2);
      const r = Math.sqrt(Math.random()) * Math.min(this.cubeRadius * 0.4, 90);
      const to: P2 = [CX + Math.cos(a) * r, CY + Math.sin(a) * r];
      this.packets.push({ from, to, t: 0, dur: critical ? 0.07 : 0.085, critical, generation: this.inputGeneration });
      // Visible on the first frame, before the packet reaches the firewall.
      const color = critical ? PINK : CYAN;
      if (this.effects.motion === 0 || this.lowGraphics) continue;
      this.rings.push({ r: 2, life: 0, max: 0.1, color, grow: 7, at: from });
      const angle = rand(-Math.PI, 0);
      const speed = rand(35, 80);
      this.sparks.push({ x: from[0], y: from[1], vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 0, max: 0.09, color, len: rand(3, 6) });
    }
    if (critical) {
      const p = this.packets[this.packets.length - 1].to;
      this.texts.push({ x: p[0] + 40, y: p[1] - 30, text: '✦ CRITICAL', sub: gainMs > 0 ? `SELF-BASELINE −${Math.round(gainMs)}ms` : '', life: 0, max: 0.75 });
    }
  }

  miss() {
    this.missFlash = 1;
    this.shake = Math.max(this.shake, 4);
  }

  /** A word was completed: one firewall layer breaks. */
  layerBreak() {
    const last = this.packets.at(-1);
    if (last && !last.completion) { last.completion = 'layer'; this.inputGeneration++; }
  }

  /** Attach the completion to its final packet, without delaying input/scoring. */
  breach() {
    const last = this.packets.at(-1);
    if (last) { if (!last.completion) this.inputGeneration++; last.completion = 'breach'; }
  }

  private showLayerBreak() {
    this.progressByGeneration.delete(this.generation);
    this.generation++;
    this.hitStop = 0.05;
    this.kick = 1;
    this.shake = Math.max(this.shake, 9);
    this.rings.push({ r: this.cubeRadius * 0.8, life: 0, max: 0.45, color: CYAN, grow: 320 });
    this.speed = 1600;
    this.approach = 0;
    this.spawnT = this.effects.motion === 0 ? 1 : 0;
    this.cracks.length = 0;
    this.burstShards(this.lowGraphics ? 3 : 18, 0.9);
    if (this.effects.motion > 0) for (let i = 0; i < (this.lowGraphics ? 4 : 12); i++) this.spark(CX + rand(-60, 60), CY + rand(-60, 60), rand(300, 900), CYAN, 0.4);
  }

  /** The whole firewall is destroyed: shatter, flash, rush forward. */
  private showBreach() {
    // User preference: A's shattering feedback, with the fixed packet-arrival
    // timing and existing low-load/reduced-motion protections preserved.
    this.progressByGeneration.delete(this.generation);
    this.generation++;
    this.hitStop = 0.06;
    this.flash = 1;
    this.shake = 18;
    this.speed = 2600;
    this.burstShards(this.lowGraphics ? 5 : 34, 1.2);
    this.rings.push({ r: this.cubeRadius, life: 0, max: 0.7, color: PINK, grow: 520 });
    this.rings.push({ r: this.cubeRadius * 0.6, life: 0, max: 0.55, color: CYAN, grow: 420 });
    if (this.effects.motion > 0) for (let i = 0; i < (this.lowGraphics ? 4 : 22); i++) this.spark(CX + rand(-40, 40), CY + rand(-40, 40), rand(700, 1600), Math.random() < 0.5 ? CYAN : PINK, 0.6);
    this.cracks.length = 0;
    this.damage = 0;
    this.approach = 0;
    this.spawnT = this.effects.motion === 0 ? 1 : 0;
  }

  frame(now: number) {
    if (!this.available) return;
    try { this.drawFrame(now); }
    catch {
      // A graphics failure must not stop the application's clock/input loop.
      this.setAvailable(false);
      this.reset();
    }
  }

  private drawFrame(now: number) {
    const dt = this.active ? (this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016) : 0;
    this.last = now;
    const worldDt = this.hitStop > 0 ? dt * (1 - this.effects.motion) : dt;
    this.hitStop = Math.max(0, this.hitStop - dt);
    this.time += worldDt;
    this.motionTime += worldDt * this.effects.motion;

    // motion
    const cruise = 180 + this.thrust * 1000 + this.stage * 25;
    this.speed += (cruise - this.speed) * Math.min(1, dt * 2.2);
    const tunnelSpeed = this.speed * this.effects.motion;
    this.tunnelZ = (this.tunnelZ + tunnelSpeed * worldDt) % 420;
    this.thrust = Math.max(0, this.thrust - dt * 1.3);
    this.shake *= Math.pow(0.0008, dt);
    this.flash = Math.max(0, this.flash - dt * 2.8);
    this.missFlash = Math.max(0, this.missFlash - dt * 6);
    this.kick = Math.max(0, this.kick - dt * 7);
    this.spawnT = Math.min(1, this.spawnT + dt * 2.2);
    this.approach += ((this.progressByGeneration.get(this.generation) ?? 0) - this.approach) * Math.min(1, dt * 8);

    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'source-over';
    this.drawSky();

    if (this.active) {
      this.shakeOffset[0] = (Math.random() - 0.5) * this.shake * this.effects.shake;
      this.shakeOffset[1] = (Math.random() - 0.5) * this.shake * this.effects.shake;
    }
    const [sx, sy] = this.shakeOffset;
    ctx.save();
    const arenaScale = Math.min(1, Math.max(0.25, (this.arenaBottom - 150) / 490));
    ctx.translate(CX, 140 + (this.arenaBottom - 140) * 0.48);
    ctx.scale(arenaScale, arenaScale);
    ctx.translate(-CX, -CY);
    ctx.translate(sx, sy);

    // Resolve packet arrival before drawing the new wall and its opening.
    this.updatePackets(dt);
    this.drawTunnel(worldDt, tunnelSpeed);
    this.drawCube();
    this.drawCracks();
    this.updateOpenings(dt);
    // effects that should not shake as much
    this.drawPackets();
    this.updateSparks(dt);
    this.updateShards(dt);
    this.updateRings(dt);
    this.updateTexts(dt);
    ctx.restore();

    if (this.flash > 0 && this.effects.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(${WHITE},${this.flash * this.effects.flash * 0.16})`;
      // Confine a breakthrough's light to the scenery, never the input panel.
      ctx.fillRect(0, 130, W, Math.max(0, this.arenaBottom - 130));
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawSky() {
    const ctx = this.ctx;
    if (!this.skyGradient) {
      this.skyGradient = ctx.createRadialGradient(1100, 240, 30, 960, 400, 1300);
      this.skyGradient.addColorStop(0, '#438db2');
      this.skyGradient.addColorStop(0.45, '#17364f');
      this.skyGradient.addColorStop(1, '#070e20');
    }
    ctx.fillStyle = this.skyGradient;
    ctx.fillRect(0, 0, W, H);
    if (this.background) {
      const image = this.background;
      const zoom = 1 + this.thrust * 0.018 * this.effects.motion;
      const scale = Math.max(W / image.naturalWidth, H / image.naturalHeight) * zoom;
      const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
      ctx.drawImage(image, (W - w) / 2, (H - h) / 2, w, h);
    }
    // The scenery remains legible, while the opaque DOM input owns its contrast.
    ctx.fillStyle = '#07152655';
    ctx.fillRect(0, 0, W, H);
  }

  // ---- tunnel -------------------------------------------------------------

  private project(x: number, y: number, z: number, out: P2): P2 {
    out[0] = CX + (x * FOCAL) / z;
    out[1] = CY + (y * FOCAL) / z;
    return out;
  }

  private drawTunnel(_dt: number, _speed: number) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    // Flight beacons have no key labels, lanes, or timing targets.
    for (let i = 0; i < (this.lowGraphics ? 6 : 11); i++) {
      const z = 300 + i * 420 - this.tunnelZ;
      if (z < 150) continue;
      const alpha = Math.min(0.7, 0.8 - z / 6500);
      for (const side of [-1, 1]) {
        const a = this.project(side * 760, 430, z, this.projectA);
        const b = this.project(side * 760, 200, z, this.projectB);
        ctx.strokeStyle = `rgba(${CYAN},${alpha})`;
        ctx.lineWidth = this.lowGraphics ? 1 : 3;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
    }
    for (const side of [-1, 1]) {
      const a = this.project(side * 760, 430, 220, this.projectA);
      const b = this.project(side * 760, 430, 5000, this.projectB);
      ctx.strokeStyle = `rgba(${CYAN},0.18)`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    // Short radial streaks grow with accepted-key acceleration.
    if (this.effects.motion > 0 && this.thrust > 0.05) {
      for (let i = 0; i < (this.lowGraphics ? 4 : 18); i++) {
        const a = i * Math.PI * 2 / 18;
        const r = 360 + ((this.motionTime * 420 + i * 97) % 500);
        const length = 25 + this.thrust * 90;
        ctx.strokeStyle = `rgba(220,243,255,${this.thrust * 0.45})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(CX + Math.cos(a) * r, CY + Math.sin(a) * r * 0.6);
        ctx.lineTo(CX + Math.cos(a) * (r + length), CY + Math.sin(a) * (r + length) * 0.6); ctx.stroke();
      }
    }
    ctx.lineWidth = 1;
  }

  private newDrifter(z: number): Drifter {
    let x = 0, y = 0;
    do {
      x = rand(-1500, 1500);
      y = rand(-900, 700);
    } while (Math.abs(x) < 450 && Math.abs(y) < 420);
    return { x, y, z, size: rand(50, 110), rx: rand(0, 6), ry: rand(0, 6), color: Math.random() < 0.3 ? PINK : CYAN };
  }

  // ---- firewall cube -------------------------------------------------------

  private drawCube() {
    const ctx = this.ctx;
    // A faceted energy barrier approaches with actual word progress. It cannot
    // collide, expire, or impose an extra music/animation timing judgement.
    const approach = this.effects.motion === 0 ? 1 : Math.min(1, this.spawnT * 1.7);
    const scale = this.effects.motion === 0 ? 0.8
      : (0.44 + this.approach * 0.42 + approach * 0.14) * (1 - this.kick * this.effects.motion * 0.04);
    const R = this.cubeRadius = 250 * scale;
    const pts = this.cubePts;
    this.hullPts.length = 0;
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i + Math.PI / 6;
      pts[i][0] = CX + Math.cos(a) * R * 1.18;
      pts[i][1] = CY + Math.sin(a) * R * 0.9;
      this.hullPts.push(pts[i]);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    this.hullPts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.closePath(); ctx.fillStyle = `rgba(${10 + Math.round(this.damage * 25)},35,66,0.66)`; ctx.fill();
    if (this.target && this.spawnT > 0.2) {
      const size = R * 1.85;
      const height = size * this.target.naturalHeight / this.target.naturalWidth;
      ctx.save(); ctx.clip();
      ctx.globalAlpha = Math.min(1, this.spawnT * 3);
      ctx.drawImage(this.target, CX - size / 2, CY - height / 2, size, height);
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'lighter';
    const col = this.missFlash > 0.2 && this.effects.flash > 0 ? RED : CYAN;
    for (let i = this.lowGraphics ? 2 : 0; i < 3; i++) {
      ctx.strokeStyle = `rgba(${col},${i === 2 ? 0.95 : 0.18})`;
      ctx.lineWidth = EDGE_WIDTHS[i]; ctx.stroke();
    }
    // Six plates converge on a luminous impact core, rather than a wire cube.
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${CYAN},0.38)`;
    for (const p of this.hullPts) {
      ctx.beginPath(); ctx.moveTo(p[0], p[1]);
      ctx.lineTo(CX + (p[0] - CX) * 0.25, CY + (p[1] - CY) * 0.25); ctx.stroke();
    }
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI / 3 * i + Math.PI / 6;
      const x = CX + Math.cos(a) * R * 0.27, y = CY + Math.sin(a) * R * 0.27;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.fillStyle = `rgba(${this.approach > 0.65 ? PINK : CYAN},${0.18 + this.kick * 0.2})`;
    if (!this.target) ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  private drawCracks() {
    if (!this.cracks.length || !this.hullPts.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    this.hullPts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const R = this.cubeRadius;
    for (const [w, a] of CRACK_STROKES) {
      ctx.lineWidth = w;
      for (const c of this.cracks) {
        const age = this.time - c.born;
        const fresh = Math.max(0, 1 - age * 3);
        ctx.strokeStyle = `rgba(${fresh > 0 ? WHITE : CYAN},${a})`;
        ctx.beginPath();
        c.pts.forEach((p, i) => (i ? ctx.lineTo(CX + p[0] * R, CY + p[1] * R) : ctx.moveTo(CX + p[0] * R, CY + p[1] * R)));
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.lineWidth = 1;
  }

  private addCrack(at: P2) {
    const R = this.cubeRadius;
    let x = (at[0] - CX) / R;
    let y = (at[1] - CY) / R;
    const pts: P2[] = [[x, y]];
    let a = Math.atan2(y, x) + rand(-0.8, 0.8);
    const segs = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < segs; i++) {
      const len = rand(0.06, 0.16);
      a += rand(-0.7, 0.7);
      x += Math.cos(a) * len;
      y += Math.sin(a) * len;
      pts.push([x, y]);
    }
    this.cracks.push({ pts, born: this.time });
    // connect toward the center sometimes so cracks form a web
    if (Math.random() < 0.5) this.cracks.push({ pts: [[pts[0][0], pts[0][1]], [pts[0][0] * 0.4 + rand(-0.05, 0.05), pts[0][1] * 0.4 + rand(-0.05, 0.05)]], born: this.time });
    // Long passages must not bury the enemy under a dense web of old cracks.
    if (this.cracks.length > (this.lowGraphics ? 12 : 36)) this.cracks.splice(0, 2);
  }

  // ---- particles -----------------------------------------------------------

  private updatePackets(dt: number) {
    if (!this.active) return;
    retain(this.packets, (p) => {
      p.t += dt;
      if (p.t < p.dur && this.effects.motion > 0) return true;
      // A quicker critical packet for the next wall must wait for the
      // preceding wall's completion; stale packets cannot crack a new wall.
      if (p.generation > this.generation) return true;
      if (p.generation < this.generation) return false;
      this.kick = Math.max(this.kick, p.critical ? 0.45 : 0.2);
      this.addCrack(p.to);
      if (this.effects.motion > 0) {
        const n = this.lowGraphics ? 2 : p.critical ? 10 : 5;
        for (let i = 0; i < n; i++) this.spark(p.to[0], p.to[1], rand(150, p.critical ? 700 : 420), p.critical ? PINK : CYAN, 0.3);
      }
      this.rings.push({ r: 4, life: 0, max: 0.22, color: p.critical ? PINK : CYAN, grow: p.critical ? 70 : 40, at: p.to });
      if (p.completion === 'breach') this.showBreach();
      else if (p.completion === 'layer') this.showLayerBreak();
      return false;
    });
  }

  private drawPackets() {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.packets) {
      const k = Math.min(1, p.t / p.dur);
      const e = k * k;
      const motion = this.effects.motion;
      const x = p.to[0] + (p.from[0] - p.to[0]) * (1 - e) * motion;
      const y = p.to[1] + (p.from[1] - p.to[1]) * (1 - e) * motion;
      const back = Math.max(0, e - 0.25);
      const bx = motion === 0 ? x - 12 : p.to[0] + (p.from[0] - p.to[0]) * (1 - back) * motion;
      const by = motion === 0 ? y : p.to[1] + (p.from[1] - p.to[1]) * (1 - back) * motion;
      const current = p.generation === this.generation;
      const fade = (current ? 1 : 1 - k) * (motion === 0 ? k : 1);
      const col = p.critical ? PINK : CYAN;
      for (const [w, a] of PACKET_STROKES) {
        ctx.lineWidth = w;
        ctx.strokeStyle = `rgba(${col},${a * fade})`;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      if (p.completion) {
        ctx.strokeStyle = `rgba(${WHITE},${fade})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y);
        ctx.lineTo(x, y + 7); ctx.lineTo(x - 7, y);
        ctx.closePath(); ctx.stroke();
      }
    }
    ctx.lineWidth = 1;
  }

  private updateOpenings(dt: number) {
    const ctx = this.ctx;
    retain(this.openings, opening => {
      opening.life += dt;
      const k = opening.life / opening.max;
      if (k >= 1) return false;
      const spread = (1 - Math.pow(1 - k, 3)) * 160 * this.effects.motion;
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * spread, 0);
        ctx.beginPath();
        ctx.rect(side < 0 ? 0 : CX, 0, side < 0 ? CX : W - CX, H);
        ctx.clip();
        ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath();
        opening.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.closePath();
        ctx.fillStyle = `rgba(${CYAN},${(1 - k) * 0.07})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${CYAN},${(1 - k) * 0.8})`;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
      }
      return true;
    });
    ctx.lineWidth = 1;
  }

  private spark(x: number, y: number, speed: number, color: string, life: number) {
    const a = rand(0, Math.PI * 2);
    this.sparks.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 0, max: life * rand(0.6, 1.2), color, len: rand(6, 18) });
  }

  private updateSparks(dt: number) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.5;
    retain(this.sparks, (s) => {
      s.life += dt;
      s.x += s.vx * dt * this.effects.motion;
      s.y += s.vy * dt * this.effects.motion;
      s.vx *= Math.pow(0.02, dt);
      s.vy *= Math.pow(0.02, dt);
      const a = 1 - s.life / s.max;
      if (a <= 0) return false;
      const v = Math.hypot(s.vx, s.vy) || 1;
      ctx.strokeStyle = `rgba(${s.color},${a})`;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - (s.vx / v) * s.len, s.y - (s.vy / v) * s.len);
      ctx.stroke();
      return true;
    });
    ctx.lineWidth = 1;
  }

  private burstShards(n: number, power: number) {
    if (this.effects.motion === 0) return;
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const r = Math.sqrt(Math.random()) * this.cubeRadius * 0.8;
      const size = rand(10, 34);
      const pts: P2[] = [[rand(-1, 1) * size, rand(-1, 1) * size], [rand(-1, 1) * size, rand(-1, 1) * size], [rand(-1, 1) * size, rand(-1, 1) * size]];
      const sp = rand(200, 900) * power;
      this.shards.push({
        pts, x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80,
        rot: rand(0, 6), vr: rand(-8, 8), life: 0, max: rand(0.5, 1.1) * Math.max(0.7, power),
        color: Math.random() < 0.35 ? PINK : CYAN,
      });
    }
  }

  private updateShards(dt: number) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    retain(this.shards, (s) => {
      s.life += dt;
      s.x += s.vx * dt * this.effects.motion;
      s.y += s.vy * dt * this.effects.motion;
      s.vy += 300 * dt;
      s.rot += s.vr * dt * this.effects.motion;
      const a = 1 - s.life / s.max;
      if (a <= 0) return false;
      const c = Math.cos(s.rot), sn = Math.sin(s.rot);
      ctx.beginPath();
      s.pts.forEach(([px, py], i) => {
        const x = s.x + px * c - py * sn;
        const y = s.y + px * sn + py * c;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = `rgba(${s.color},${a * 0.18})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${s.color},${a * 0.9})`;
      ctx.stroke();
      return true;
    });
  }

  private updateRings(dt: number) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    retain(this.rings, (r) => {
      r.life += dt;
      const k = r.life / r.max;
      if (k >= 1) return false;
      const x0 = r.at ? r.at[0] : CX;
      const y0 = r.at ? r.at[1] : CY;
      const rad = r.r + k * r.grow * this.effects.motion;
      ctx.strokeStyle = `rgba(${r.color},${(1 - k) * 0.8})`;
      ctx.lineWidth = 2 * (1 - k) + 0.5;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        const x = x0 + Math.cos(a) * rad;
        const y = y0 + Math.sin(a) * rad;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
      return true;
    });
    ctx.lineWidth = 1;
  }

  private updateTexts(dt: number) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    retain(this.texts, (t) => {
      t.life += dt;
      const k = t.life / t.max;
      if (k >= 1) return false;
      const a = k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9;
      ctx.save();
      ctx.translate(t.x, t.y - k * 26 * this.effects.motion);
      ctx.rotate(-0.12);
      ctx.font = '600 22px Menlo, monospace';
      ctx.fillStyle = `rgba(255,214,236,${a})`;
      ctx.fillText(t.text, 0, 0);
      if (t.sub) {
        ctx.font = '11px Menlo, monospace';
        ctx.fillStyle = `rgba(${PINK},${a * 0.8})`;
        ctx.fillText(t.sub, 4, 20);
      }
      ctx.restore();
      return true;
    });
  }
}
