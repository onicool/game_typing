import type { Word } from '../content/words';
import { normalizeReading } from '../engine/romaji';

export type CombatPhase = 'idle' | 'windup' | 'approach' | 'guard' | 'impact' | 'recover';
export type CombatHit = 'key' | 'milestone' | 'word';
export interface CombatOptions { motion: boolean; low: boolean; intensity: number }
export const COMBAT_CYCLE_MS = 5200;
export const COMBAT_CONTACT_MS = 600;
/** Purely theatrical attacks. This timeline never owns Round, input or damage. */
export function combatPhase(elapsed: number): { phase: CombatPhase; progress: number } {
  const t = Math.max(0, elapsed) % COMBAT_CYCLE_MS;
  const cycle = Math.floor(Math.max(0, elapsed) / COMBAT_CYCLE_MS);
  if (t < 1200) return { phase: 'idle', progress: t / 1200 };
  if (t < 2300) return { phase: 'windup', progress: (t - 1200) / 1100 };
  if (t < 2680) return { phase: 'approach', progress: (t - 2300) / 380 };
  const contactEnd = 2680 + COMBAT_CONTACT_MS;
  if (t < contactEnd) return { phase: cycle % 2 ? 'impact' : 'guard', progress: (t - 2680) / COMBAT_CONTACT_MS };
  return { phase: 'recover', progress: (t - contactEnd) / (COMBAT_CYCLE_MS - contactEnd) };
}
/** Kana boundaries, including punctuation; no timing/score side effects. */
export function crossedMilestone(word: Word, before: number, after: number): boolean {
  let end = 0;
  return !!word.segments?.slice(0, -1).some(segment => {
    end += normalizeReading(segment.reading).length;
    return before < end && after >= end;
  });
}
const strength = { key: 1, milestone: 2, word: 3 } as const;
const labels: Record<CombatPhase, string> = {
  idle: '輪腕衛機〈仮〉 · 言葉で光の術を放つ', windup: '予兆 · 輪腕に光が集まる',
  approach: '反撃が接近 · 自分のペースで入力', guard: '防御 · 青い結界が受け止めた',
  impact: '結界への衝撃 · 入力への影響なし', recover: '構えを戻す · 次の言葉を唱えよう',
};

/** Original vector placeholder for the unconfirmed ring-bracer design B.
 * Fixed SVG pool; no timers, listeners, network, unbounded nodes or input hooks. */
export class CombatScene {
  private svg: SVGSVGElement;
  private body: SVGGElement;
  private arm: SVGGElement;
  private core: SVGElement;
  private warning: SVGElement;
  private bolt: SVGElement;
  private guard: SVGElement;
  private beam: SVGElement;
  private star: SVGElement;
  private trajectory: SVGElement;
  private guardMark: SVGElement;
  private impactMark: SVGElement;
  private contact: SVGElement;
  private hitRing: SVGElement;
  private hitBadge: SVGElement;
  private hitText: SVGElement;
  private lastHitBadge = '';
  private strongHitAt = -Infinity;
  private strongHitPower = 0;
  private shards: SVGElement[];
  private particles: { t: number; power: number; angle: number }[] = [];
  private pending = 0;
  private lastBurst = -Infinity;
  private hitAt = -Infinity;
  private hitPower = 0;
  private previousPhase: CombatPhase = 'idle';
  private options: CombatOptions = { motion: true, low: false, intensity: 1 };
  private previousLabel = '';
  constructor(host: HTMLElement, private label: HTMLElement, private cue: (kind: 'windup' | 'guard' | 'impact') => void) {
    host.innerHTML = `<svg class="av-combat-vector" viewBox="0 0 360 260" aria-hidden="true">
      <defs><linearGradient id="machine-metal" x2=".8" y2="1"><stop stop-color="#fff7df"/><stop offset=".5" stop-color="#d9e4ec"/><stop offset="1" stop-color="#667f97"/></linearGradient></defs>
      <ellipse cx="180" cy="236" rx="66" ry="9" fill="#071b31" opacity=".55"/>
      <g class="combat-body" stroke="#bc9b61" stroke-width="2" stroke-linejoin="round" fill="url(#machine-metal)">
        <path d="M161 151L157 177 145 215 146 231 163 232 180 182 184 155M193 154L194 184 208 223 206 234 228 234 224 217 219 177 214 151"/>
        <circle cx="170" cy="182" r="8" fill="#203f5e"/><circle cx="207" cy="182" r="8" fill="#203f5e"/>
        <path d="M152 140L179 135 213 141 213 159 182 169 154 158" fill="#244d6c"/>
        <path d="M146 61L159 55 210 55 223 69 214 106 204 135 165 135 149 105Z"/>
        <path d="M160 91L182 114 204 91 200 134 166 134" fill="#234a68"/>
        <path d="M158 58L181 72 209 58 203 81 182 103 162 81" fill="#f5eedb"/>
        <path d="M167 15L186 8 203 17 200 43 184 55 169 42Z"/><path d="M173 31L185 36 198 30" fill="none" stroke="#76e0f5" stroke-width="4"/>
        <path d="M159 62L139 58 126 70 136 87 153 80M211 64L233 58 245 70 233 90 217 80"/>
        <g class="combat-arm"><path d="M137 82L113 98 109 123 97 130 84 114 98 89 122 72"/><circle cx="116" cy="103" r="7" fill="#244d6c"/>
          <ellipse cx="94" cy="125" rx="27" ry="32" fill="#102d45" stroke-width="6"/><ellipse cx="94" cy="125" rx="20" ry="25" fill="none" stroke="#85e6f2" stroke-width="2"/>
          <path d="M99 122L91 120 82 125 83 133 94 140 105 136"/>
        </g>
        <path d="M236 80L257 99 261 121 274 132 287 118 277 94 250 72"/><circle cx="256" cy="102" r="7" fill="#244d6c"/>
        <ellipse cx="273" cy="129" rx="27" ry="32" fill="#102d45" stroke-width="6"/><ellipse cx="273" cy="129" rx="20" ry="25" fill="none" stroke="#85e6f2" stroke-width="2"/>
        <path d="M267 128L277 121 287 126 286 135 275 143 265 139"/>
        <path class="combat-core" d="M182 69L191 80 182 91 173 80Z" fill="#a3f1ff" stroke="#effaff"/>
        <path d="M155 105L139 139 161 132M213 104L231 140 209 132" fill="#244d6c"/>
      </g>
      <ellipse class="combat-warning" cx="94" cy="125" rx="37" ry="42" fill="none" stroke="#ffc76f" stroke-width="3" stroke-dasharray="8 6" opacity="0"/>
      <g class="combat-trajectory" fill="none" stroke="#ffc76f" stroke-width="2" opacity="0">
        <path d="M94 125Q98 175 154 209" stroke="#102d45" stroke-width="6" stroke-linecap="round" stroke-dasharray="4 5"/>
        <path d="M138 204L154 209 149 194" stroke="#102d45" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M94 125Q98 175 154 209" stroke-dasharray="4 5"/>
        <path d="M138 204L154 209 149 194" stroke-linejoin="round"/>
      </g>
      <path class="combat-bolt" d="M-12 -10Q5 -14 15 0Q5 14 -12 10L-2 0Z" fill="#ffc76f" stroke="#fff0c9" stroke-width="1.5" opacity="0"/>
      <ellipse class="combat-guard" cx="154" cy="209" rx="55" ry="17" fill="#73dff224" stroke="#87edff" stroke-width="3" opacity="0"/>
      <g class="combat-guard-mark" stroke="#b9f5ff" stroke-width="3" fill="#102d45" opacity="0">
        <path d="M154 185L170 190 168 206 154 219 140 206 138 190Z"/>
        <path d="M145 201L152 207 163 194" fill="none"/>
      </g>
      <g class="combat-impact-mark" stroke="#ffe0a1" stroke-width="3" fill="#102d45" opacity="0">
        <path d="M154 185L170 190 168 206 154 219 140 206 138 190Z"/>
        <path d="M153 191L146 202 160 200 154 212" fill="none"/>
      </g>
      <g class="combat-contact" fill="none" stroke="#ffc76f" stroke-width="3" opacity="0">
        <path d="M117 186L127 192M111 207L123 205M180 186L171 193M194 207L181 205"/>
      </g>
      <path class="combat-beam" d="M113 244L179 82L186 91L121 248Z" fill="#a3f1ff" opacity="0"/>
      <circle class="combat-hit-ring" cx="182" cy="82" r="26" fill="none" stroke="#a5efff" stroke-width="2" stroke-dasharray="14 5" opacity="0"/>
      <path class="combat-star" d="M182 61L189 77 209 80 190 87 183 109 176 89 158 83 175 78Z" fill="#e7fbff" opacity="0"/>
      <g class="combat-shards" fill="#a0eaf4">${Array.from({ length: 12 }, () => '<path d="M0 -6L3 0 0 6 -3 0Z" opacity="0"/>').join('')}</g>
      <g class="combat-hit-badge" opacity="0">
        <rect x="235" y="20" width="103" height="34" rx="5" fill="#102d45" stroke="#a5efff"/>
        <path d="M247 29L251 37 247 45 243 37Z" fill="#a5efff"/>
        <text class="combat-hit-text" x="288" y="44" text-anchor="middle" fill="#e7fbff" font-size="20">強打</text>
      </g>
    </svg>`;
    this.svg = host.querySelector('svg')!;
    const find = <T extends SVGElement>(cls: string) => this.svg.querySelector<T>(`.combat-${cls}`)!;
    this.body = find('body'); this.arm = find('arm'); this.core = find('core'); this.warning = find('warning');
    this.bolt = find('bolt'); this.guard = find('guard'); this.beam = find('beam'); this.star = find('star');
    this.trajectory = find('trajectory'); this.guardMark = find('guard-mark'); this.impactMark = find('impact-mark');
    this.contact = find('contact'); this.hitRing = find('hit-ring'); this.hitBadge = find('hit-badge'); this.hitText = find('hit-text');
    this.shards = [...this.svg.querySelectorAll<SVGElement>('.combat-shards path')];
  }
  configure(options: CombatOptions) {
    this.options = options;
    // Settings are changed while paused: do not defer removal of motion to RAF.
    this.pending = 0; this.particles = []; this.hitAt = -Infinity; this.strongHitAt = -Infinity;
    for (const el of [...this.shards, this.beam, this.star, this.bolt, this.hitRing, this.contact, this.hitBadge]) el.setAttribute('opacity', '0');
    this.body.removeAttribute('transform'); this.arm.removeAttribute('transform');
    this.guard.removeAttribute('transform');
    this.hitRing.removeAttribute('transform');
  }
  hit(kind: CombatHit) { this.pending = Math.max(this.pending, strength[kind]); }
  tick(elapsed: number, started: boolean) {
    const { motion, low, intensity } = this.options;
    const moving = motion && !low;
    const { phase, progress } = started ? combatPhase(elapsed) : { phase: 'idle' as const, progress: 0 };
    if (phase !== this.previousPhase) {
      if (phase === 'windup' || phase === 'guard' || phase === 'impact') this.cue(phase);
      this.previousPhase = phase;
    }
    this.svg.dataset.phase = phase;
    if (this.pending && (this.pending > 1 || elapsed - this.lastBurst >= 80)) {
      this.hitPower = this.pending; this.pending = 0;
      this.hitAt = elapsed; this.lastBurst = elapsed;
      // A following key cannot erase the completed-word feedback in this frame.
      if (this.hitPower > 1) { this.strongHitAt = elapsed; this.strongHitPower = this.hitPower; }
      const count = !motion ? 0 : low ? 3 : this.hitPower === 3 ? 8 : this.hitPower === 2 ? 5 : 2;
      const cap = low ? 4 : 12;
      for (let i = 0; i < count; i++) {
        if (this.particles.length === cap) this.particles.shift();
        this.particles.push({ t: elapsed, power: this.hitPower, angle: (i / count * 2 + .15) * Math.PI });
      }
    }
    this.particles = this.particles.filter(p => elapsed - p.t < 380);
    const age = elapsed - this.hitAt;
    const recoil = moving && age < 260 ? Math.max(0, 1 - Math.max(0, age - 60) / 200) * this.hitPower * intensity : 0;
    this.body.setAttribute('transform', `translate(0 ${-recoil * 1.5}) rotate(${-recoil} 182 158)`);
    this.arm.setAttribute('transform', `rotate(${moving && phase === 'windup' ? -16 * progress : 0} 134 81)`);
    this.core.setAttribute('fill', phase === 'windup' ? '#ffc76f' : '#a3f1ff');
    this.warning.setAttribute('opacity', phase === 'windup' ? '1' : '0');
    this.trajectory.setAttribute('opacity', phase === 'windup' || phase === 'approach' ? '1' : '0');
    this.bolt.setAttribute('opacity', moving && phase === 'approach' ? '1' : '0');
    // Quadratic curve exactly matches the persistent non-color-only direction cue.
    const p = progress, bx = (1-p)**2*94 + 2*(1-p)*p*98 + p*p*154;
    const by = (1-p)**2*125 + 2*(1-p)*p*175 + p*p*209;
    const angle = Math.atan2(100*(1-p)+68*p, 8*(1-p)+112*p) * 180 / Math.PI;
    this.bolt.setAttribute('transform', `translate(${bx} ${by}) rotate(${angle})`);
    const defending = phase === 'guard' || phase === 'impact';
    this.guard.setAttribute('opacity', defending || (!moving && phase === 'approach') ? '1' : '0');
    this.guard.setAttribute('stroke', phase === 'impact' ? '#ffc76f' : '#87edff');
    this.guard.setAttribute('stroke-dasharray', phase === 'impact' ? '6 4' : 'none');
    this.guard.setAttribute('transform', `translate(154 209) scale(${moving && defending ? 1 + progress * .15 : 1}) translate(-154 -209)`);
    this.guardMark.setAttribute('opacity', phase === 'guard' ? '1' : '0');
    this.impactMark.setAttribute('opacity', phase === 'impact' ? '1' : '0');
    this.contact.setAttribute('opacity', phase === 'impact' ? '1' : '0');
    this.contact.setAttribute('transform', `translate(154 202) scale(${moving && phase === 'impact' ? 1 + progress * .3 : 1}) translate(-154 -202)`);
    this.beam.setAttribute('opacity', moving && this.hitPower > 1 && age < 180 ? String(1 - age / 180) : '0');
    this.star.setAttribute('opacity', motion && age < 160 ? String((1 - age / 160) * .85) : '0');
    const strongAge = elapsed - this.strongHitAt;
    this.hitRing.setAttribute('opacity', moving && strongAge < 320 ? String((1 - strongAge / 320) * .9) : '0');
    this.hitRing.setAttribute('transform', `translate(182 82) scale(${moving && strongAge < 320 ? 1 + strongAge / 320 * .35 : 1}) translate(-182 -82)`);
    // The badge is static even in reduced motion. Only words/milestones use it.
    const badge = strongAge < 600 ? this.strongHitPower === 3 ? '強打' : '節目' : '';
    this.hitBadge.setAttribute('opacity', badge ? '1' : '0');
    if (badge !== this.lastHitBadge) { this.hitText.textContent = badge; this.lastHitBadge = badge; }
    this.shards.forEach((el, i) => {
      const p = this.particles[i];
      if (!p) { el.setAttribute('opacity', '0'); return; }
      const f = (elapsed - p.t) / 380, travel = moving ? f * (18 + p.power * 10) * intensity : 0;
      el.setAttribute('transform', `translate(${182 + Math.cos(p.angle) * travel} ${82 + Math.sin(p.angle) * travel}) rotate(${p.angle * 180 / Math.PI})`);
      el.setAttribute('opacity', String((1 - f) * .8));
    });
    const text = phase === 'idle' && age < 450 && this.hitPower > 1 ? this.hitPower === 3 ? '強打 · 一語の祈りが届いた' : '節目 · ひとつの文を届けた' : labels[phase];
    if (text !== this.previousLabel) { this.label.textContent = text; this.previousLabel = text; }
  }
}
