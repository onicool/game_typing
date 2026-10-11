import type { BattleEvent, BattleSnapshot } from '../game/battle';
import type { CombatHit, CombatOptions } from './combat';
import { BattleMotion, PLAYER_MOVES } from './battle-motion';
import { SpriteActor, warmBattleSprites } from './sprite-actor';
import { PaintedEffect, warmPaintedEffects } from './painted-effect';
import { KeyEffects, KEY_EFFECT_MS, KEY_EFFECT_SLOTS, type KeyAction } from './key-effects';

const asset = (name: string) => `${import.meta.env.BASE_URL}fx/kenney/${name}.png`;
const shape = `<path class="side-trail" d="M-350 16Q-195 -22 -28 -8" fill="none" stroke="#9de8ff" stroke-width="2" stroke-linecap="round"/>
  <path class="side-slash" d="M-44 42Q-12 -64 50 -40Q14 -20 -44 42Z" fill="#d3faff"/>
  <path class="side-incoming" d="M92 0H0M16 -5L0 0 16 5" fill="none" stroke="#ffc67d" stroke-width="3"/>
  <path class="side-reflected" d="M-32 -4L6 -9 20 0 6 9 -32 4 -19 0Z" fill="#a7f2ff" stroke="#ecfeff"/>
  <image class="side-glint" href="${asset('light_02')}" x="-35" y="-35" width="70" height="70"/>
  <path class="side-sparks" d="M0 0L-24 -15M0 0L12 -29M0 0L28 9M0 0L-9 27" fill="none" stroke="#fff1be" stroke-width="2"/>
  <image class="side-cut" href="${asset('slash_01')}" x="-60" y="-60" width="120" height="120"/>`;

/** A side-view stage driven exclusively by accepted keys and Battle snapshots.
 * Fixed SVG pool, frozen game clock on pause, no timers or audio ownership. */
export class SideCombatScene {
  private svg: SVGSVGElement;
  private player: SVGElement;
  private weapon: SVGElement;
  private enemy: SVGElement;
  private playerActor: SpriteActor;
  private enemyActor: SpriteActor;
  private body: BattleMotion;
  private weaponTrail: PaintedEffect;
  private contactEffect: PaintedEffect;
  private enemyTrail: PaintedEffect;
  private enemyShadow: SVGElement;
  private warmGeneration = 0;
  private shield: SVGElement;
  private warning: SVGElement;
  private projectiles: SVGElement[];
  private nodes: { host: SVGElement; trail: SVGElement; slash: SVGElement; incoming: SVGElement; reflected: SVGElement; glint: SVGElement; sparks: SVGElement; cut: SVGElement; painted: PaintedEffect; id: number; visible: boolean }[];
  private outcome: SVGElement;
  private outcomeText: SVGElement;
  private effects = new KeyEffects();
  private options: CombatOptions = { motion: true, low: false, intensity: .5 };
  private lastKeyAt = -Infinity;
  private lastAction: KeyAction = 'attack';
  private contactAt = -Infinity;
  private contact: 'guard' | 'parry' | 'impact' | null = null;
  private contactDamage: number | null = null;
  private comboAt = -Infinity;
  private lastTime = 0;
  private lastLabel = '';
  private mode: HTMLElement;
  private count: HTMLElement;
  private finaleAt: number | null = null;
  private duel: BattleSnapshot['duel'];

  constructor(host: HTMLElement, private label: HTMLElement, character: 'elna' | 'towa', options?: CombatOptions) {
    host.classList.add('av-side-combat');
    host.style.setProperty('--battle-landscape', `url("${import.meta.env.BASE_URL}battle-art/celestial-terrace.webp")`);
    host.dataset.character = character;
    this.body = new BattleMotion(character);
    if (options) this.options = options;
    host.innerHTML = `<div class="side-captions"><span class="side-mode">攻撃 · 1文字で1斬撃</span><span class="side-count">斬撃 0 ／ 反射 0</span></div>
      <svg class="side-vector" viewBox="0 0 800 260" aria-hidden="true">
      <ellipse cx="175" cy="235" rx="62" ry="5" fill="#1a2c43" opacity=".24"/><ellipse class="side-enemy-shadow" cx="650" cy="235" rx="65" ry="5" fill="#1a2c43" opacity=".24"/>
      <g class="side-player" data-pose="idle"></g>
      <g class="side-enemy" data-pose="idle"></g>
      <g class="side-weapon" opacity="0"><path d="M247 90Q273 112 277 133" fill="none" stroke="#d1f7ff" stroke-width="2"/><path d="M253 105Q269 114 277 125" fill="none" stroke="#fff4cd" stroke-width="2"/></g>
      <ellipse class="side-warning" cx="551" cy="117" rx="34" ry="38" fill="#ffc76f15" stroke="#ffd083" stroke-width="2" stroke-dasharray="6 5" opacity="0"/>
      <g class="side-shield" opacity="0"><path class="side-guard-surface" d="M255 94Q312 132 255 187Q279 137 255 94Z" fill="#7ce9fc33" stroke="#a7f4ff" stroke-width="3"/><path class="side-guard-lines" d="M271 118L277 129 267 142 278 153" fill="none" stroke="#d0fbff" stroke-width="2"/>
        <path class="side-impact-lines" d="M252 116L274 129 251 142 271 157M248 130L237 122M250 150L239 157" fill="none" stroke="#ffb49a" stroke-width="4" opacity="0"/></g>
      <g fill="#ffc77d" stroke="#ffedc9">${Array.from({length: 4}, () => '<path class="side-threat" d="M-15 -4L0 -7 13 0 0 7 -15 4Z" opacity="0"/>').join('')}</g>
      <g class="side-key-pool">${Array.from({length: KEY_EFFECT_SLOTS}, () => `<g class="side-key-effect" opacity="0">${shape}</g>`).join('')}</g>
      <g class="side-outcome" transform="translate(400 26)" opacity="0"><rect x="-83" y="-17" width="166" height="34" rx="6" fill="#0b2134" stroke="#a7f4ff"/><text class="side-outcome-text" text-anchor="middle" y="5" font-size="16" fill="#d3faff"></text></g>
      <g fill="#10263c" opacity=".88"><rect x="125" y="241" width="100" height="19" rx="8"/><rect x="600" y="241" width="100" height="19" rx="8"/></g>
      <text x="175" y="255" fill="#eff9ff" font-size="14" text-anchor="middle">${character === 'elna' ? 'エルナ' : 'トワ'}</text><text x="650" y="255" fill="#eff9ff" font-size="14" text-anchor="middle">守護機</text>
      </svg>`;
    this.svg = host.querySelector('svg')!;
    const find = (name: string) => this.svg.querySelector<SVGElement>(`.side-${name}`)!;
    this.player = find('player'); this.weapon = find('weapon'); this.enemy = find('enemy'); this.shield = find('shield'); this.warning = find('warning');
    this.playerActor = new SpriteActor(this.player, character, 22);
    this.enemyActor = new SpriteActor(this.enemy, 'sentinel', 482);
    this.weapon.querySelectorAll('path').forEach(path => path.setAttribute('opacity', '0'));
    this.enemyShadow = find('enemy-shadow');
    this.weaponTrail = new PaintedEffect(this.weapon, -5, -30, 175, 120);
    this.contactEffect = new PaintedEffect(this.shield, -45, 85, 95);
    this.enemyTrail = new PaintedEffect(this.svg, 420, 75, 160, 120);
    this.outcome = find('outcome'); this.outcomeText = find('outcome-text');
    this.projectiles = [...this.svg.querySelectorAll<SVGElement>('.side-threat')];
    this.nodes = [...this.svg.querySelectorAll<SVGElement>('.side-key-effect')].map(host => {
      const part = (cls: string) => host.querySelector<SVGElement>(`.side-${cls}`)!;
      return { host, trail: part('trail'), slash: part('slash'), incoming: part('incoming'), reflected: part('reflected'), glint: part('glint'), sparks: part('sparks'), cut: part('cut'), painted: new PaintedEffect(host, -55, -55, 110), id: 0, visible: false };
    });
    this.mode = host.querySelector('.side-mode')!; this.count = host.querySelector('.side-count')!;
    this.warmArt(); this.paint(0, false);
  }
  private warmArt() {
    const generation = ++this.warmGeneration;
    this.svg.dataset.artReady = this.options.motion && !this.options.low ? 'loading' : 'static';
    if (this.options.motion && !this.options.low) void Promise.all([warmBattleSprites(this.body.character), warmPaintedEffects(this.body.character)]).then(results => {
      if (generation !== this.warmGeneration) return;
      this.svg.dataset.artReady = results.flat().every(Boolean) ? 'ready' : 'fallback';
      this.paint(this.lastTime, this.svg.dataset.mode === 'defend');
    });
  }
  configure(options: CombatOptions) { this.options = options; this.effects.clearVisuals(); this.body.clear(); this.lastKeyAt = -Infinity; this.warmArt(); this.paint(this.lastTime, this.svg.dataset.mode === 'defend'); }
  setComboTier(_tier: number) { /* One action per key at every combo level. */ }
  hit(_kind: CombatHit) { /* Word and special cues must not create a second swing. */ }
  acceptedKey(action: KeyAction, gameMs: number, kind: CombatHit) {
    const cue = this.body.accepted(action, gameMs);
    this.effects.emit(action, gameMs, cue.combo || kind !== 'key', cue.variant); this.lastKeyAt = gameMs; this.lastAction = action;
    this.svg.dataset.accepted = String(this.effects.accepted);
    this.svg.dataset.attacks = String(this.effects.attacks); this.svg.dataset.deflections = String(this.effects.deflections);
    this.count.textContent = `斬撃 ${this.effects.attacks} ／ 反射 ${this.effects.deflections}`;
    // main renders Battle in the same key handler; no extra full-pool repaint.
    return cue;
  }
  feedback(events: BattleEvent[], gameMs: number) {
    for (const event of events) {
      if (event.type === 'combo') { this.comboAt = gameMs; this.body.combo(gameMs); }
      if (event.type === 'parry' || event.type === 'crack' || event.type === 'chip') {
        this.contact = event.type === 'parry' ? 'parry' : event.type === 'chip' && event.guarded ? 'guard' : 'impact'; this.contactAt = gameMs;
        this.body.reaction(this.contact === 'impact' ? 'hit' : this.contact, gameMs);
        this.contactDamage = event.type === 'chip' ? event.amount : null;
      }
    }
  }
  render(snapshot: BattleSnapshot, gameMs: number) {
    this.duel = snapshot.duel;
    if (this.options.motion && !this.options.low) this.body.incoming(snapshot.attack ? this.duel ? this.duel.remaining > 0 ? this.duel.nextAt : null : snapshot.attack.dueAt : null, gameMs);
    this.paint(gameMs, !!snapshot.attack);
  }
  finale(ms: number) {
    if (this.finaleAt === null) this.finaleAt = this.lastTime;
    this.paint(this.finaleAt + ms, false); this.svg.dataset.mode = 'finale';
    this.mode.textContent = '決着 · 最後の文字まで届いた';
  }
  private paint(gameMs: number, defending: boolean) {
    this.lastTime = gameMs;
    const moving = this.options.motion && !this.options.low, intensity = Math.min(.65, this.options.intensity);
    const age = gameMs - this.lastKeyAt, recent = age >= 0 && age < KEY_EFFECT_MS;
    const playerMotion = moving ? this.body.player.sample(gameMs) : null, enemyMotion = moving ? this.body.enemy.sample(gameMs) : null;
    this.playerActor.paint(playerMotion, defending, !moving);
    this.enemyActor.paint(enemyMotion, false, !moving);
    // The melee closes the gap while its drawn joints articulate. UI stays fixed.
    const melee = enemyMotion?.kind === 'enemy' && enemyMotion.move === 'melee';
    const dash = melee ? enemyMotion.frame === 1 ? -230 * Math.min(1, (enemyMotion.progress * 660 - 250) / 150) : enemyMotion.frame === 2 ? -230 : enemyMotion.frame === 3 ? -230 * Math.max(0, 1 - (enemyMotion.progress * 660 - 440) / 70) : 0 : 0;
    if (dash) { this.enemy.setAttribute('transform', `translate(${dash} 0)`); this.enemyShadow.setAttribute('transform', `translate(${dash} 0)`); }
    else { this.enemy.removeAttribute('transform'); this.enemyShadow.removeAttribute('transform'); }
    const responseAge = gameMs - Math.max(this.lastAction === 'attack' ? this.lastKeyAt : -Infinity, this.contactAt);
    const response = moving && responseAge >= 0 && responseAge < 90 ? Math.sin(responseAge / 90 * Math.PI * 3) * intensity * 2 : 0;
    this.svg.style.transform = response ? `translateX(${response}px)` : '';
    const strike = playerMotion && (playerMotion.kind === 'normal' || playerMotion.kind === 'combo');
    this.weapon.setAttribute('opacity', strike ? '1' : '0');
    this.weapon.setAttribute('transform', `translate(${this.body.character === 'elna' ? 270 : 245} 105)`);
    const moves: readonly string[] = PLAYER_MOVES[this.body.character];
    const variant = playerMotion ? Math.max(0, moves.indexOf(playerMotion.move)) : 0;
    this.weaponTrail.host.setAttribute('width', playerMotion?.kind === 'combo' ? '235' : '175');
    this.weaponTrail.host.setAttribute('height', playerMotion?.kind === 'combo' ? '155' : '120');
    this.weaponTrail.paint(this.body.character, variant, playerMotion && playerMotion.frame >= 1 && playerMotion.frame <= 3 ? Math.min(.9, 1.6 * intensity) : 0, moving);
    this.enemyTrail.paint('enemy', enemyMotion?.move === 'volley' ? 2 : enemyMotion?.move === 'melee' ? 1 : 0, enemyMotion?.kind === 'enemy' && enemyMotion.frame === 2 ? 1.2 * intensity : 0, moving);
    this.enemyTrail.host.setAttribute('x', melee ? '220' : '420');
    this.svg.dataset.mode = defending ? 'defend' : 'attack';
    this.mode.textContent = defending ? '防御 · 1文字で1発を弾く' : '攻撃 · 1文字で1斬撃';
    if (this.duel) this.mode.textContent += ` · あと${Math.max(0, (this.duel.endsAt - gameMs) / 1000).toFixed(1)}秒${defending ? ` · 反撃あと${this.duel.remaining}回` : ''}`;
    this.warning.setAttribute('opacity', defending ? '.8' : '0');
    const contact = gameMs - this.contactAt < 650 ? this.contact : null;
    this.shield.setAttribute('opacity', defending || (recent && this.lastAction === 'defend') || contact ? '1' : '0');
    this.shield.dataset.contact = contact ?? 'ready';
    this.contactEffect.host.setAttribute('x', '230');
    this.contactEffect.paint('enemy', contact === 'parry' ? 4 : contact === 'impact' ? 5 : 3, contact ? .65 * intensity : 0, moving);
    const combo = gameMs - this.comboAt < 900 && this.comboAt >= this.contactAt;
    const result = combo ? 'combo' : contact;
    this.outcome.setAttribute('opacity', result ? '1' : '0');
    this.outcome.dataset.kind = result ?? '';
    this.outcomeText.textContent = combo ? '✦ コンボ完成' : contact === 'parry' ? '◇ パリィ完成' : contact === 'guard' ? '◇ 部分ガード' : contact === 'impact' ? this.contactDamage === null ? '⚡ 被弾' : `⚡ ガード −${this.contactDamage}` : '';
    for (let i = 0; i < this.projectiles.length; i++) {
      const projectile = this.projectiles[i];
      const remaining = this.duel?.remaining ?? 4;
      projectile.setAttribute('opacity', defending && i < remaining && !(i === 0 && melee) ? i === 0 ? '.9' : '.35' : '0');
      const progress = this.duel ? i === 0 && moving ? Math.max(0, Math.min(1, 1 - (this.duel.nextAt - gameMs) / this.duel.interval)) : 0
        : moving ? ((gameMs % 1300) / 1300 + i / 4) % 1 : i / 4;
      projectile.setAttribute('transform', `translate(${535 - progress * 255 + (i ? i * 20 : 0)} ${130 + Math.sin(i * 2) * 18}) rotate(180)`);
    }
    const activeCount = this.effects.slots.reduce((n, effect) => n + (effect && gameMs >= effect.at && gameMs - effect.at < KEY_EFFECT_MS ? 1 : 0), 0);
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i], effect = this.effects.slots[i];
      const elapsed = effect ? gameMs - effect.at : Infinity;
      if (!effect || elapsed < 0 || elapsed >= KEY_EFFECT_MS) {
        if (node.visible) node.host.setAttribute('opacity', '0');
        node.visible = false; continue;
      }
      const progress = moving ? elapsed / KEY_EFFECT_MS : 0;
      const lane = (effect.id % 5 - 2) * 9, attack = effect.action === 'attack';
      const x = attack ? 620 : 278, y = (attack ? 112 : 137) + lane;
      const latest = effect.id === this.effects.accepted;
      // Every key owns a slot, while older overlapping flashes become quieter.
      // Reuse static geometry until a slot is replaced; expired nodes stay asleep.
      if (node.id !== effect.id) {
        node.id = effect.id;
        node.host.dataset.id = String(effect.id); node.host.dataset.action = effect.action;
        node.host.setAttribute('transform', `translate(${x} ${y})`);
        node.slash.setAttribute('opacity', attack ? '.85' : '0');
        node.slash.setAttribute('transform', `rotate(${effect.id % 2 ? -25 : 25}) scale(${effect.strong ? 1.1 : .7})`);
        node.reflected.setAttribute('opacity', attack ? '0' : '1');
        node.cut.setAttribute('transform', `rotate(${effect.id % 2 ? 60 : -65})`);
      }
      node.visible = true;
      node.host.setAttribute('opacity', String((moving ? 1 - progress : .7) * (latest ? 1 : .65 / Math.sqrt(activeCount))));
      node.trail.setAttribute('opacity', attack && progress < .45 ? '.6' : '0');
      node.incoming.setAttribute('opacity', !attack && progress < .35 ? '.8' : '0');
      node.reflected.setAttribute('transform', `translate(${moving ? progress * 270 : 18} ${moving ? -progress * 30 : -4}) rotate(-10)`);
      node.glint.setAttribute('opacity', this.options.low ? '0' : latest ? '.28' : '.08');
      node.glint.setAttribute('transform', `scale(${.8 + progress * .6})`);
      node.sparks.setAttribute('transform', `rotate(${effect.id * 47 % 360}) scale(${.7 + progress * 1.1})`);
      node.cut.setAttribute('opacity', attack && !this.options.low && latest ? '.16' : '0');
      node.painted.paint(attack ? this.body.character : 'enemy', attack ? effect.variant ?? 0 : 3, latest ? Math.min(.9, 1.4 * intensity) : .2 * intensity, moving);
    }
    const text = combo ? 'コンボ完成！ 最後の文字までつながった' : contact === 'impact' ? '被弾 · そのまま入力を続けよう' : contact === 'parry' ? this.duel ? 'パリィ完成！ 被弾分のガードも回復' : 'パリィ完成！ 弾き返し' : contact === 'guard' ? '部分ガード · 入力した分で1発を防いだ' : defending ? '敵の弾を1文字ずつ反射。金の枠の言葉を完成させよう' : '正しい1文字ごとに光の一撃を、守護機へ';
    if (text !== this.lastLabel) { this.label.textContent = text; this.lastLabel = text; }
  }
}
