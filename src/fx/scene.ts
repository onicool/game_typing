/**
 * Canvas2D pseudo-3D cyberspace: hexagonal tunnel, a wireframe "firewall"
 * cube that cracks with every packet, and shards when it breaks.
 *
 * All coordinates are in stage space (1920x1080). Nothing here ever draws on
 * the input panel area's text: the panel is a DOM element above the canvas.
 */

type V3 = [number, number, number];
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

interface Packet { from: P2; to: P2; t: number; dur: number; critical: boolean; generation: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; len: number }
interface Shard { pts: P2[]; x: number; y: number; vx: number; vy: number; rot: number; vr: number; life: number; max: number; color: string }
interface Crack { pts: P2[]; born: number } // relative to cube center, in units of cube radius
interface FloatText { x: number; y: number; text: string; sub: string; life: number; max: number }
interface Ring { r: number; life: number; max: number; color: string; grow: number; at?: P2 }
interface Drifter { x: number; y: number; z: number; size: number; rx: number; ry: number; color: string }

const CUBE: V3[] = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7],
];
const FACES: number[][] = [
  [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4],
];

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

function hull(points: P2[], sorted: P2[], out: P2[]) {
  for (let i = 0; i < points.length; i++) sorted[i] = points[i];
  sorted.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  out.length = 0;
  for (const q of sorted) {
    while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
    out.push(q);
  }
  const upperStart = out.length + 1;
  for (let i = sorted.length - 2; i >= 0; i--) {
    const q = sorted[i];
    while (out.length >= upperStart && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
    out.push(q);
  }
  out.pop();
}

export class Scene {
  private ctx: CanvasRenderingContext2D;
  private last = 0;
  private time = 0; // world time, frozen during hit-stop
  private motionTime = 0; // separate rotation clock; cracks age even with motion disabled
  private hitStop = 0;
  private shake = 0;
  private flash = 0;
  private missFlash = 0;
  private tunnelZ = 0;
  private speed = 0;
  private stage = 0;
  private generation = 0;
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
  private hullSorted: P2[] = [];
  private cubePts = points(8);
  private cubeRot: V3[] = Array.from({ length: 8 }, () => [0, 0, 0]);
  private driftPts = points(8);
  private rotated: V3 = [0, 0, 0];
  private projectA: P2 = [0, 0];
  private projectB: P2 = [0, 0];
  private tunnelPts = Array.from({ length: 11 }, () => points(6));
  private tunnelDepths: number[] = Array(11).fill(0);
  private faceOrder = FACES.map((_, i) => ({ i, z: 0 }));
  private coreGradients = new Map<number, CanvasGradient>();

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    for (let i = 0; i < 14; i++) this.drifters.push(this.newDrifter(rand(600, 4200)));
  }

  resize(scale: number) {
    // Cap the backing store at 4K while retaining stage-space coordinates.
    const pixelScale = Math.min(scale * (window.devicePixelRatio || 1), 2);
    this.canvas.width = Math.max(1, Math.round(W * pixelScale));
    this.canvas.height = Math.max(1, Math.round(H * pixelScale));
    this.ctx.setTransform(this.canvas.width / W, 0, 0, this.canvas.height / H, 0, 0);
    this.coreGradients.clear();
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
    this.speed = this.shake = this.flash = this.missFlash = this.kick = this.hitStop = 0;
    this.damage = this.stage = this.generation = 0;
    this.last = this.time = this.motionTime = this.tunnelZ = 0;
    this.spawnT = 1;
    this.cubeRadius = 230;
    this.hullPts.length = 0;
  }

  /** Accepted keystroke: fire a packet at the firewall. */
  hit(critical: boolean, gainMs = 0) {
    const n = critical ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const from: P2 = [960 + rand(-160, 160), 750];
      const a = rand(0, Math.PI * 2);
      const r = Math.sqrt(Math.random()) * this.cubeRadius * 0.6;
      const to: P2 = [CX + Math.cos(a) * r, CY + Math.sin(a) * r];
      this.packets.push({ from, to, t: 0, dur: critical ? 0.07 : 0.085, critical, generation: this.generation });
      // Visible on the first frame, before the packet reaches the firewall.
      const color = critical ? PINK : CYAN;
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
    this.hitStop = 0.05;
    this.kick = 1;
    this.shake = Math.max(this.shake, 9);
    this.rings.push({ r: this.cubeRadius * 0.8, life: 0, max: 0.45, color: CYAN, grow: 320 });
    this.burstShards(10, 0.6);
    for (let i = 0; i < 16; i++) this.spark(CX + rand(-60, 60), CY + rand(-60, 60), rand(300, 900), CYAN, 0.4);
  }

  /** The whole firewall is destroyed: shatter, flash, rush forward. */
  breach() {
    this.generation++;
    this.hitStop = 0.06;
    this.flash = 1;
    this.shake = 18;
    this.speed = 2600;
    this.burstShards(34, 1.2);
    this.rings.push({ r: this.cubeRadius, life: 0, max: 0.7, color: PINK, grow: 520 });
    this.rings.push({ r: this.cubeRadius * 0.6, life: 0, max: 0.55, color: CYAN, grow: 420 });
    for (let i = 0; i < 22; i++) this.spark(CX + rand(-40, 40), CY + rand(-40, 40), rand(700, 1600), Math.random() < 0.5 ? CYAN : PINK, 0.6);
    this.cracks.length = 0;
    this.damage = 0;
    this.spawnT = this.effects.motion === 0 ? 1 : 0;
  }

  frame(now: number) {
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
    this.last = now;
    const worldDt = this.hitStop > 0 ? dt * (1 - this.effects.motion) : dt;
    this.hitStop = Math.max(0, this.hitStop - dt);
    this.time += worldDt;
    this.motionTime += worldDt * this.effects.motion;

    // motion
    const cruise = 60 + this.stage * 25;
    this.speed += (cruise - this.speed) * Math.min(1, dt * 2.2);
    const tunnelSpeed = this.speed * this.effects.motion;
    this.tunnelZ = (this.tunnelZ + tunnelSpeed * worldDt) % 420;
    this.shake *= Math.pow(0.0008, dt);
    this.flash = Math.max(0, this.flash - dt * 2.8);
    this.missFlash = Math.max(0, this.missFlash - dt * 6);
    this.kick = Math.max(0, this.kick - dt * 7);
    this.spawnT = Math.min(1, this.spawnT + dt * 2.2);

    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#03070b';
    ctx.fillRect(0, 0, W, H);

    const sx = (Math.random() - 0.5) * this.shake * this.effects.shake;
    const sy = (Math.random() - 0.5) * this.shake * this.effects.shake;
    ctx.save();
    ctx.translate(sx, sy);

    this.drawTunnel(worldDt, tunnelSpeed);
    this.drawCube();
    this.drawCracks();
    ctx.restore();

    // effects that should not shake as much
    this.updatePackets(dt);
    this.updateSparks(dt);
    this.updateShards(dt);
    this.updateRings(dt);
    this.updateTexts(dt);

    if (this.flash > 0 && this.effects.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(${WHITE},${this.flash * this.effects.flash * 0.16})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- tunnel -------------------------------------------------------------

  private project(x: number, y: number, z: number, out: P2): P2 {
    out[0] = CX + (x * FOCAL) / z;
    out[1] = CY + (y * FOCAL) / z;
    return out;
  }

  private drawTunnel(dt: number, speed: number) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    const R = 1250;
    const rings = this.tunnelPts;
    const zs = this.tunnelDepths;
    let count = 0;
    for (let i = 0; i < 11; i++) {
      const z = 260 + i * 420 - this.tunnelZ;
      if (z < 120) continue;
      zs[count] = z;
      const pts = rings[count++];
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        this.project(Math.cos(a) * R * 1.35, Math.sin(a) * R, z, pts[k]);
      }
    }
    const oc = this.stage / 3;
    for (let i = 0; i < count; i++) {
      const pts = rings[i];
      const a = Math.max(0, 0.38 - zs[i] / 12000) * (1 + oc * 0.6);
      ctx.strokeStyle = `rgba(${CYAN},${a * 0.55})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.stroke();
    }
    // longitudinal edges
    for (let k = 0; k < 6; k++) {
      ctx.strokeStyle = `rgba(${CYAN},${0.12 + oc * 0.08})`;
      ctx.beginPath();
      const a = (Math.PI / 3) * k + Math.PI / 6;
      const near = this.project(Math.cos(a) * R * 1.35, Math.sin(a) * R, 120, this.projectA);
      const far = this.project(Math.cos(a) * R * 1.35, Math.sin(a) * R, 5000, this.projectB);
      ctx.moveTo(near[0], near[1]);
      ctx.lineTo(far[0], far[1]);
      ctx.stroke();
    }
    // floor grid lines converging
    ctx.strokeStyle = `rgba(${CYAN},0.06)`;
    for (let i = -8; i <= 8; i++) {
      const a = this.project(i * 260, 900, 140, this.projectA);
      const b = this.project(i * 260, 900, 5000, this.projectB);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    // drifting wire cubes
    for (const d of this.drifters) {
      d.z -= speed * dt * 0.9;
      d.rx += dt * 0.2 * this.effects.motion;
      d.ry += dt * 0.3 * this.effects.motion;
      if (d.z < 150) Object.assign(d, this.newDrifter(rand(3800, 4600)));
      const [px, py] = this.project(d.x, d.y, d.z, this.projectA);
      // keep clear of the HUD columns and the top bar
      const side = Math.max(0, Math.abs(px - 960) - 420) / 140;
      const top = Math.max(0, 170 - py) / 80;
      const hudFade = Math.max(0, 1 - Math.max(side, top));
      const alpha = Math.min(1, (4600 - d.z) / 1200) * Math.min(1, (d.z - 150) / 300) * 0.4 * hudFade;
      if (alpha <= 0.01) continue;
      const pts = this.driftPts;
      for (let i = 0; i < CUBE.length; i++) {
        const [x, y, z] = CUBE[i];
        this.rotate(x * d.size, y * d.size, z * d.size, d.rx, d.ry, this.rotated);
        this.project(d.x + this.rotated[0], d.y + this.rotated[1], d.z + this.rotated[2], pts[i]);
      }
      ctx.strokeStyle = `rgba(${d.color},${alpha})`;
      ctx.beginPath();
      for (const [a, b] of EDGES) {
        ctx.moveTo(pts[a][0], pts[a][1]);
        ctx.lineTo(pts[b][0], pts[b][1]);
      }
      ctx.stroke();
    }
  }

  private newDrifter(z: number): Drifter {
    let x = 0, y = 0;
    do {
      x = rand(-1500, 1500);
      y = rand(-900, 700);
    } while (Math.abs(x) < 450 && Math.abs(y) < 420);
    return { x, y, z, size: rand(50, 110), rx: rand(0, 6), ry: rand(0, 6), color: Math.random() < 0.3 ? PINK : CYAN };
  }

  private rotate(x: number, y: number, z: number, ax: number, ay: number, out: V3) {
    const cy = Math.cos(ay), sy = Math.sin(ay);
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    const cx = Math.cos(ax), sx = Math.sin(ax);
    out[0] = x1;
    out[1] = y * cx - z1 * sx;
    out[2] = y * sx + z1 * cx;
  }

  // ---- firewall cube -------------------------------------------------------

  private drawCube() {
    const ctx = this.ctx;
    const t = this.motionTime;
    // near the body-diagonal view the cube reads as a hexagon (like the concept art)
    const ay = Math.PI / 4 + Math.sin(t * 0.35) * 0.22 + t * 0.05;
    const ax = 0.6155 + Math.sin(t * 0.27) * 0.08;
    const approach = 1 - Math.pow(1 - this.spawnT, 3) * this.effects.motion;
    const scale = (0.25 + 0.75 * approach) * (1 - this.kick * this.effects.motion * 0.06);
    const size = 132 * scale;
    this.cubeRadius = 230 * scale;

    const rot = this.cubeRot;
    const pts = this.cubePts;
    for (let i = 0; i < CUBE.length; i++) {
      const v = CUBE[i];
      this.rotate(v[0] * size, v[1] * size, v[2] * size, ax, ay, rot[i]);
      this.project(rot[i][0], rot[i][1], 900 + rot[i][2], pts[i]);
    }
    hull(pts, this.hullSorted, this.hullPts);

    // faces, back to front; retain the ordering buffer across frames
    const order = this.faceOrder;
    for (const face of order) {
      const f = FACES[face.i];
      face.z = (rot[f[0]][2] + rot[f[1]][2] + rot[f[2]][2] + rot[f[3]][2]) / 4;
    }
    order.sort((a, b) => b.z - a.z);
    ctx.globalCompositeOperation = 'source-over';
    for (const { i, z } of order) {
      const f = FACES[i];
      const front = z < 0;
      // Average the old gradient stops for a similar translucent face tint.
      ctx.fillStyle = `rgba(${Math.round(26 + 30 * this.damage)},40,${Math.round(60 + 10 * this.damage)},${front ? 0.425 + this.damage * 0.075 : 0.215})`;
      ctx.beginPath();
      f.forEach((k, j) => (j ? ctx.lineTo(pts[k][0], pts[k][1]) : ctx.moveTo(pts[k][0], pts[k][1])));
      ctx.closePath();
      ctx.fill();
    }

    // glowing edges
    ctx.globalCompositeOperation = 'lighter';
    const flicker = this.missFlash > 0.2 ? this.effects.flash : 0;
    const col = flicker === 1 ? RED : flicker === 0 ? CYAN
      : `${Math.round(101 + 154 * flicker)},${Math.round(245 - 165 * flicker)},${Math.round(237 - 137 * flicker)}`;
    const glow = 0.18 + this.stage * 0.06 + this.kick * 0.3;
    for (let i = 0; i < EDGE_WIDTHS.length; i++) {
      const a = i === 0 ? glow * 0.5 : i === 1 ? glow : 0.95;
      ctx.lineWidth = EDGE_WIDTHS[i];
      ctx.strokeStyle = `rgba(${col},${a * approach})`;
      ctx.beginPath();
      for (const [a1, b1] of EDGES) {
        ctx.moveTo(pts[a1][0], pts[a1][1]);
        ctx.lineTo(pts[b1][0], pts[b1][1]);
      }
      ctx.stroke();
    }

    // damage: pink core glow grows as the firewall weakens
    if (this.damage > 0) {
      const radius = Math.max(8, Math.round(this.cubeRadius / 8) * 8);
      let rg = this.coreGradients.get(radius);
      if (!rg) {
        // Cache in stage space, independent of the current shake offset.
        ctx.save();
        ctx.setTransform(this.canvas.width / W, 0, 0, this.canvas.height / H, 0, 0);
        rg = ctx.createRadialGradient(CX + 40, CY + 40, 10, CX + 40, CY + 40, radius);
        ctx.restore();
        rg.addColorStop(0, `rgba(${PINK},0.25)`);
        rg.addColorStop(1, `rgba(${PINK},0)`);
        this.coreGradients.set(radius, rg);
      }
      ctx.save();
      ctx.globalAlpha = this.damage;
      ctx.fillStyle = rg;
      ctx.beginPath();
      this.hullPts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
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
    if (this.cracks.length > 160) this.cracks.splice(0, 2);
  }

  // ---- particles -----------------------------------------------------------

  private updatePackets(dt: number) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    retain(this.packets, (p) => {
      p.t += dt;
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
      if (k >= 1) {
        if (!current) return false;
        this.addCrack(p.to);
        const n = p.critical ? 14 : 7;
        for (let i = 0; i < n; i++) this.spark(p.to[0], p.to[1], rand(150, p.critical ? 700 : 420), p.critical ? PINK : CYAN, 0.3);
        this.rings.push({ r: 4, life: 0, max: 0.22, color: p.critical ? PINK : CYAN, grow: p.critical ? 70 : 40, at: p.to });
        return false;
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
