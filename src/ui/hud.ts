import * as THREE from 'three';
import '@fontsource/russo-one';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/700.css';
import type { Fighter } from '../game/fighter';

const CSS = /* css */ `
.hud { position:absolute; inset:0; pointer-events:none; font-family:'Chakra Petch',sans-serif; color:#fff; overflow:hidden; user-select:none; }
.hud.hidden { display:none; }
.hud.calm .hud-weap, .hud.calm .hud-fuel, .hud.calm .hud-hint, .hud.calm .hud-lock, .hud.calm .hud-off { opacity:0 !important; transition:opacity .4s; }
.hud-top { position:absolute; top:22px; left:28px; right:28px; display:flex; justify-content:space-between; align-items:flex-start; gap:24px; }
.hud-pan { width:min(38vw,520px); }
.hud-pan.r { text-align:right; }
.hud-name { font-family:'Russo One',sans-serif; font-size:clamp(14px,1.25vw,20px); letter-spacing:.08em; text-transform:uppercase; display:flex; gap:10px; align-items:baseline; text-shadow:0 2px 6px #000a; }
.hud-pan.r .hud-name { justify-content:flex-end; }
.hud-name small { font-family:'Chakra Petch'; font-weight:700; font-size:.68em; opacity:.7; letter-spacing:.14em; }
.hud-hpnum { font-family:'Russo One'; font-size:clamp(26px,2.6vw,42px); line-height:1; margin-top:2px; text-shadow:0 3px 10px #000c; font-variant-numeric:tabular-nums; }
.hud-hpnum span { font-size:.42em; opacity:.6; margin-left:4px; }
.hud-bar { position:relative; height:16px; margin-top:6px; background:#0b0d12cc; clip-path:polygon(0 0,100% 0,calc(100% - 12px) 100%,0 100%); box-shadow:inset 0 0 0 1px #ffffff22; }
.hud-pan.r .hud-bar { clip-path:polygon(0 0,100% 0,100% 100%,12px 100%); }
.hud-bar i { position:absolute; top:0; bottom:0; left:0; transform-origin:left; }
.hud-pan.r .hud-bar i { left:auto; right:0; transform-origin:right; width:100%; }
.hud-bar .chip { width:100%; background:#fff; opacity:.85; }
.hud-bar .fill { width:100%; background:linear-gradient(180deg,#9dffc0,#21d07a 55%,#14a35e); box-shadow:0 0 12px #2fff9a88; }
.hud-bar .fill.mid { background:linear-gradient(180deg,#ffe58a,#ffb42a 55%,#e08a10); box-shadow:0 0 12px #ffb42a88; }
.hud-bar .fill.low { background:linear-gradient(180deg,#ff9a8a,#ff3b3b 55%,#c21d2a); box-shadow:0 0 14px #ff3b3baa; animation:hudPulse .5s infinite alternate; }
.hud-bar .tick { position:absolute; top:0; bottom:0; width:2px; background:#0008; }
.hud-down { position:relative; height:6px; margin-top:4px; width:62%; background:#0b0d12bb; overflow:hidden; }
.hud-pan.r .hud-down { margin-left:auto; }
.hud-down i { position:absolute; inset:0; transform-origin:left; background:linear-gradient(90deg,#37e8ff,#ff6a1f); }
.hud-pan.r .hud-down i { transform-origin:right; }
.hud-down.hot i { animation:hudPulse .25s infinite alternate; }
.hud-downlbl { font-size:11px; letter-spacing:.2em; opacity:.6; margin-top:3px; font-weight:700; }
.hud-timer { font-family:'Russo One'; font-size:clamp(34px,3.4vw,56px); line-height:1; padding:6px 22px 8px; background:linear-gradient(180deg,#0e1118dd,#0e111888); clip-path:polygon(10px 0,calc(100% - 10px) 0,100% 50%,calc(100% - 10px) 100%,10px 100%,0 50%); font-variant-numeric:tabular-nums; text-shadow:0 0 18px #37e8ff66; }
.hud-timer.warn { color:#ff5a3a; text-shadow:0 0 18px #ff3a2a; animation:hudPulse .5s infinite alternate; }
.hud-combat-state { margin-top:6px; font-size:12px; font-weight:700; letter-spacing:.12em; color:#9ddfc9; min-height:17px; text-shadow:0 1px 3px #000; }
.hud-combat-state[data-state="opening"] { color:#ffbd72; }
.hud-combat-state[data-state="guard"] { color:#86d9ff; }
.hud-mobility { position:absolute;left:50%;bottom:145px;transform:translateX(-50%);font-size:12px;font-weight:700;letter-spacing:.12em;background:#09121ddd;padding:6px 12px;border-bottom:2px solid #68c6ca; }
.hud-weap { position:absolute; bottom:26px; left:50%; transform:translateX(-50%); display:flex; gap:14px; align-items:flex-end; }
.hud-w { width:64px; text-align:center; }
.hud-dial { position:relative; width:58px; height:58px; margin:0 auto; border-radius:50%; background:conic-gradient(var(--c) calc(var(--p)*1%), #ffffff14 0); box-shadow:0 0 0 2px #0009, 0 4px 14px #0008; transition:filter .15s; }
.hud-dial::after { content:''; position:absolute; inset:5px; border-radius:50%; background:radial-gradient(circle at 40% 35%,#2a3040,#0d1017); }
.hud-dial b { position:absolute; inset:0; z-index:1; display:grid; place-items:center; font-family:'Russo One'; font-size:15px; letter-spacing:.04em; }
.hud-w.ready .hud-dial { filter:drop-shadow(0 0 7px var(--c)); }
.hud-w.flash .hud-dial { animation:hudReady .35s ease-out; }
.hud-w label { display:block; margin-top:5px; font-size:11px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; opacity:.8; }
.hud-w kbd { display:inline-block; margin-top:3px; font:700 10px 'Chakra Petch'; padding:1px 6px; border-radius:3px; background:#ffffff1c; opacity:.75; }
.hud-fuel { position:absolute; bottom:112px; left:50%; width:140px; height:4px; margin-left:-70px; background:#0009; border-radius:2px; overflow:hidden; opacity:0; transition:opacity .2s; }
.hud-fuel.on { opacity:1; }
.hud-fuel i { position:absolute; inset:0; background:#37e8ff; transform-origin:left; box-shadow:0 0 8px #37e8ff; }
.hud-lock { position:absolute; left:0; top:0; width:70px; height:70px; margin:-35px 0 0 -35px; transition:opacity .15s; }
.hud-lock svg { width:100%; height:100%; overflow:visible; animation:hudSpin 4s linear infinite; }
.hud-lock.hard svg { animation-duration:1.4s; }
.hud-lock.hard path { stroke:#ff6a1f; }
.hud-lock path { stroke:#37e8ff; stroke-width:3; fill:none; filter:drop-shadow(0 0 4px currentColor); }
.hud-off { position:absolute; width:0; height:0; border-left:14px solid transparent; border-right:14px solid transparent; border-bottom:26px solid #ff6a1f; filter:drop-shadow(0 0 6px #ff6a1f); opacity:0; }
.hud-ann { position:absolute; left:0; right:0; top:38%; text-align:center; font-family:'Russo One'; font-size:clamp(56px,9vw,150px); letter-spacing:.06em; line-height:1; opacity:0; -webkit-text-stroke:2px #0008; text-shadow:0 6px 0 #0007, 0 0 40px var(--glow,#ff6a1f); }
.hud-ann.show { animation:hudSlam .9s cubic-bezier(.2,1.4,.4,1) forwards; }
.hud-ann.long { animation:hudSlamLong 2.4s cubic-bezier(.2,1.4,.4,1) forwards; }
.hud-ann small { display:block; font-size:.22em; letter-spacing:.4em; margin-top:.4em; font-family:'Chakra Petch'; font-weight:700; opacity:.85; }
.hud-pop { position:absolute; font-family:'Russo One'; font-size:28px; white-space:nowrap; transform:translate(-50%,-50%); text-shadow:0 3px 0 #000a, 0 0 12px var(--c,#fff); animation:hudPop .9s ease-out forwards; }
.hud-pop.big { font-size:40px; }
.hud-pop.tag { font-size:20px; letter-spacing:.18em; color:#37e8ff; }
.hud-hint { position:absolute; bottom:120px; left:50%; transform:translateX(-50%); font-size:14px; font-weight:700; letter-spacing:.06em; padding:8px 18px; background:#0b0d12bb; border-left:3px solid #ff6a1f; opacity:0; transition:opacity .5s; white-space:nowrap; }
.hud-hint.on { opacity:.9; }
.hud-pips { display:flex; gap:4px; justify-content:center; margin-top:4px; }
.hud-pips i { width:12px; height:5px; background:#ffffff22; transform:skewX(-20deg); }
.hud-pips i.on { background:#37e8ff; box-shadow:0 0 6px #37e8ff; }
.hud-buffs { position:absolute; bottom:120px; left:28px; display:flex; flex-direction:column; gap:6px; }
.hud-buff { font:700 13px 'Chakra Petch'; letter-spacing:.14em; padding:4px 10px; background:#0b0d12cc; border-left:3px solid var(--c); }
.hud-lock.confirm svg { animation: hudSpin 4s linear infinite, hudConfirm .18s ease-out; }
.hud-lock.confirm path { stroke:#ffffff !important; }
@keyframes hudConfirm { 0%{transform:scale(1.35)} 100%{transform:scale(1)} }
.hud-threat { position:absolute; width:0; height:0; border-left:11px solid transparent; border-right:11px solid transparent; border-bottom:20px solid var(--c); filter:drop-shadow(0 0 6px var(--c)); opacity:0; transition:opacity .1s; }
.hud-downlbl2 { font:700 10px 'Chakra Petch'; letter-spacing:.2em; opacity:.65; margin-top:2px; }
.hud-pan.r .hud-downlbl2 { text-align:right; }
.hud-practice { position:absolute; top:120px; right:28px; padding:12px 16px; background:#0b0d12cc; border-right:3px solid #37e8ff; font:700 14px 'Chakra Petch'; letter-spacing:.08em; display:none; min-width:190px; }
.hud-practice.on { display:block; }
.hud-practice div { display:flex; justify-content:space-between; gap:18px; }
.hud-practice b { font-family:'Russo One'; color:#37e8ff; }
.hud-heat { position:absolute; left:50%; bottom:-10px; width:54px; height:4px; margin-left:-27px; background:#0008; border-radius:2px; overflow:hidden; }
.hud-heat i { position:absolute; inset:0; transform-origin:left; background:linear-gradient(90deg,#ffd23a,#ff3b3b); }
.hud-heat.hot i { animation:hudPulse .2s infinite alternate; }
.hud-w.over .hud-dial { filter:grayscale(1) brightness(.6); }
.hud-lock.primed path { stroke:var(--pc) !important; stroke-width:4; }
.hud-lock .hud-prime { position:absolute; left:50%; top:-22px; transform:translateX(-50%); font:700 11px 'Chakra Petch'; letter-spacing:.2em; color:var(--pc); text-shadow:0 0 6px var(--pc); white-space:nowrap; }
.hud-combo { position:absolute; right:28px; top:46%; font-family:'Russo One'; font-size:44px; line-height:1; text-align:right; color:#ffd23a; text-shadow:0 3px 0 #000a, 0 0 18px #ffd23a88; opacity:0; transition:opacity .2s; }
.hud-combo small { display:block; font:700 13px 'Chakra Petch'; letter-spacing:.3em; color:#fff; }
.hud-combo.on { opacity:1; }
.hud-vign { position:absolute; inset:0; box-shadow:inset 0 0 160px #ff1a1a; opacity:0; transition:opacity .2s; }
@keyframes hudPulse { from{filter:brightness(1)} to{filter:brightness(1.6)} }
@keyframes hudSpin { to { transform:rotate(360deg) } }
@keyframes hudReady { 0%{transform:scale(1.25)} 100%{transform:scale(1)} }
@keyframes hudSlam { 0%{opacity:0;transform:scale(2.4)} 18%{opacity:1;transform:scale(.94)} 30%{transform:scale(1)} 78%{opacity:1} 100%{opacity:0;transform:scale(1.06)} }
@keyframes hudSlamLong { 0%{opacity:0;transform:scale(2.4)} 8%{opacity:1;transform:scale(.94)} 14%{transform:scale(1)} 88%{opacity:1} 100%{opacity:0;transform:scale(1.04)} }
@keyframes hudPop { 0%{opacity:0;transform:translate(-50%,-30%) scale(.6)} 15%{opacity:1;transform:translate(-50%,-70%) scale(1.15)} 30%{transform:translate(-50%,-80%) scale(1)} 100%{opacity:0;transform:translate(-50%,-170%) scale(.95)} }
`;

interface Side {
  root: HTMLElement;
  num: HTMLElement;
  fill: HTMLElement;
  chip: HTMLElement;
  down: HTMLElement;
  chipV: number;
  chipDelay: number;
  lastHp: number;
}

export class HUD {
  readonly el: HTMLElement;
  private sides: Side[] = [];
  private timer: HTMLElement;
  private weaps: { el: HTMLElement; key: 'gunCd' | 'bombCd' | 'podCd' | 'chargeCd' | 'skillCd'; max: number; ready: boolean }[] = [];
  private lockEl: HTMLElement;
  private offEl: HTMLElement;
  private ann: HTMLElement;
  private fuel: HTMLElement;
  private hint: HTMLElement;
  private vign: HTMLElement;
  private pips: HTMLElement | null = null;
  private buffsEl!: HTMLElement;
  private threatEls: HTMLElement[] = [];
  damageNumbers = true;

  constructor(parent: HTMLElement) {
    if (!document.getElementById('hud-css')) {
      const s = document.createElement('style');
      s.id = 'hud-css';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    this.el = document.createElement('div');
    this.el.className = 'hud hidden';
    this.el.innerHTML = `
      <div class="hud-vign"></div>
      <div class="hud-top">
        ${[0, 1].map((i) => `
        <div class="hud-pan ${i ? 'r' : ''}">
          <div class="hud-name"></div>
          <div class="hud-hpnum">1000<span>HP</span></div>
          <div class="hud-bar"><i class="chip"></i><i class="fill"></i>${[1, 2, 3].map((k) => `<span class="tick" style="left:${k * 25}%"></span>`).join('')}</div>
          <div class="hud-down"><i></i></div><div class="hud-downlbl2">DOWN</div><div class="hud-combat-state"></div>
        </div>`).join('<div class="hud-timer">90</div>')}
      </div>
      <div class="hud-lock"><span class="hud-prime"></span><svg viewBox="-35 -35 70 70"><path d="M-30 -12 V-30 H-12 M12 -30 H30 V-12 M30 12 V30 H12 M-12 30 H-30 V12"/></svg></div>
      <div class="hud-off"></div>
      <div class="hud-fuel"><i></i></div>
      <div class="hud-weap"></div>
      <div class="hud-buffs"></div><div class="hud-mobility"></div>
      ${[0, 1, 2, 3].map(() => '<div class="hud-threat"></div>').join('')}
      <div class="hud-hint"></div>
      <div class="hud-combo"></div>
      <div class="hud-practice"></div>
      <div class="hud-ann"></div>`;
    parent.appendChild(this.el);
    for (const pan of Array.from(this.el.querySelectorAll<HTMLElement>('.hud-pan'))) {
      this.sides.push({
        root: pan,
        num: pan.querySelector('.hud-hpnum')!,
        fill: pan.querySelector('.fill')!,
        chip: pan.querySelector('.chip')!,
        down: pan.querySelector('.hud-down')!,
        chipV: 1,
        chipDelay: 0,
        lastHp: -1,
      });
    }
    this.timer = this.el.querySelector('.hud-timer')!;
    this.lockEl = this.el.querySelector('.hud-lock')!;
    this.offEl = this.el.querySelector('.hud-off')!;
    this.ann = this.el.querySelector('.hud-ann')!;
    this.fuel = this.el.querySelector('.hud-fuel')!;
    this.hint = this.el.querySelector('.hud-hint')!;
    this.vign = this.el.querySelector('.hud-vign')!;
    this.buffsEl = this.el.querySelector('.hud-buffs')!;
    this.threatEls = Array.from(this.el.querySelectorAll<HTMLElement>('.hud-threat'));
  }

  setup(p: Fighter, e: Fighter, names: [string, string, string, string], pad: boolean) {
    const sNames = [names[0], names[2]];
    const sSub = [names[1], names[3]];
    this.sides.forEach((s, i) => {
      s.root.querySelector('.hud-name')!.innerHTML = i ? `<small>${sSub[i]}</small>${sNames[i]}` : `${sNames[i]}<small>${sSub[i]}</small>`;
      s.chipV = 1;
      s.lastHp = -1;
    });
    const wrap = this.el.querySelector('.hud-weap')!;
    const defs: [string, string, 'gunCd' | 'bombCd' | 'podCd' | 'chargeCd' | 'skillCd', number, string, string][] = [
      ['GUN', '#' + new THREE.Color(p.lo.gun.color).getHexString(), 'gunCd', p.lo.gun.cooldown, pad ? 'RT' : 'LMB', p.lo.gun.name],
      ['BOMB', '#' + new THREE.Color(p.lo.bomb.color).getHexString(), 'bombCd', p.lo.bomb.cooldown, pad ? 'LT' : 'RMB', p.lo.bomb.name],
      ['POD', '#' + new THREE.Color(p.lo.pod.color).getHexString(), 'podCd', p.lo.pod.cooldown, pad ? 'RB' : 'E', p.lo.pod.name],
      ['GUARD', '#ffffff', 'chargeCd', p.lo.body.charge.cooldown, pad ? 'X' : 'Q', p.lo.body.chargeName],
      ['SKILL', '#' + new THREE.Color(p.lo.skill.color).getHexString(), 'skillCd', p.lo.skill.cooldown, pad ? 'Y' : 'R', p.lo.skill.name],
    ];
    this.pips = null;
    wrap.innerHTML = defs
      .map(([lbl, c, , , k, name], i) => `<div class="hud-w" title="${name}"><div class="hud-dial" style="--c:${c};--p:100"><b>${i === 3 ? '✦' : lbl[0]}</b></div><label>${i === 3 ? 'CHARGE' : lbl}</label><kbd>${k}</kbd></div>`)
      .join('');
    this.weaps = Array.from(wrap.children).map((el, i) => ({ el: el as HTMLElement, key: defs[i][2], max: defs[i][3], ready: true }));
  }

  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
  }

  announce(text: string, opts: { sub?: string; color?: string; long?: boolean } = {}) {
    this.ann.className = 'hud-ann';
    void this.ann.offsetWidth;
    this.ann.innerHTML = text + (opts.sub ? `<small>${opts.sub}</small>` : '');
    this.ann.style.setProperty('--glow', opts.color ?? '#ff6a1f');
    this.ann.classList.add(opts.long ? 'long' : 'show');
  }

  clearAnnounce() {
    this.ann.className = 'hud-ann';
  }

  showHint(text: string, seconds: number) {
    this.hint.textContent = text;
    this.hint.classList.add('on');
    setTimeout(() => this.hint.classList.remove('on'), seconds * 1000);
  }

  popup(screen: { x: number; y: number }, text: string, cls = '', color = '#fff') {
    if (!this.damageNumbers && cls !== 'tag') return;
    const d = document.createElement('div');
    d.className = 'hud-pop ' + cls;
    d.textContent = text;
    d.style.left = `${screen.x + (Math.random() - 0.5) * 30}px`;
    d.style.top = `${screen.y}px`;
    d.style.setProperty('--c', color);
    d.style.color = cls === 'tag' ? '' : color;
    this.el.appendChild(d);
    setTimeout(() => d.remove(), 950);
  }

  /** Reticle flash when the player's attack lands. */
  confirm(heavy: boolean) {
    this.lockEl.classList.remove('confirm');
    void this.lockEl.offsetWidth;
    this.lockEl.classList.add('confirm');
    if (heavy) this.lockEl.style.setProperty('scale', '1.15');
    setTimeout(() => this.lockEl.style.removeProperty('scale'), 160);
  }

  private placeEdge(el: HTMLElement, x: number, y: number, behind: boolean, W: number, H: number, pad: number) {
    let dx = x - W / 2;
    let dy = y - H / 2;
    if (behind) {
      dx = -dx;
      dy = Math.abs(dy) + H;
    }
    const a = Math.atan2(dy, dx);
    const rx = W / 2 - pad;
    const ry = H / 2 - pad;
    const k = Math.min(Math.abs(rx / Math.cos(a)), Math.abs(ry / Math.sin(a)));
    el.style.transform = `translate(${W / 2 + Math.cos(a) * k - 11}px, ${H / 2 + Math.sin(a) * k - 10}px) rotate(${a + Math.PI / 2}rad)`;
  }

  setPractice(on: boolean) {
    const el = this.el.querySelector<HTMLElement>('.hud-practice')!;
    el.classList.toggle('on', on);
    el.innerHTML = '';
  }

  practiceInfo(i: { last: number; combo: number; dps: number; down: number }) {
    const el = this.el.querySelector<HTMLElement>('.hud-practice')!;
    el.innerHTML = `<div>LAST HIT<b>${i.last}</b></div><div>COMBO (2s)<b>${i.combo}</b></div><div>DPS (5s)<b>${i.dps.toFixed(0)}</b></div><div>DOWN<b>${i.down}%</b></div>`;
  }

  hurtFlash(v: number) {
    this.vign.style.opacity = String(v);
    setTimeout(() => (this.vign.style.opacity = '0'), 120);
  }

  update(dt: number, fighters: [Fighter, Fighter], timeLeft: number, lockScreen: { x: number; y: number; on: boolean; behind: boolean }, hardLock: boolean, threats: { x: number; y: number; behind: boolean; color: string }[] = []) {
    fighters.forEach((f, i) => {
      const s = this.sides[i];
      const frac = f.hp / f.maxHp;
      if (s.lastHp !== f.hp) {
        if (f.hp < s.lastHp) s.chipDelay = 0.55;
        s.lastHp = f.hp;
        s.num.innerHTML = `${Math.ceil(f.hp)}<span>HP</span>`;
        s.fill.style.transform = `scaleX(${frac})`;
        s.fill.className = 'fill' + (frac < 0.25 ? ' low' : frac < 0.5 ? ' mid' : '');
      }
      s.chipDelay -= dt;
      if (s.chipDelay <= 0) s.chipV = Math.max(frac, s.chipV - dt * 0.6);
      if (s.chipV < frac) s.chipV = frac;
      s.chip.style.transform = `scaleX(${s.chipV})`;
      const dn = Math.min(1, f.down / f.endurance);
      (s.down.firstElementChild as HTMLElement).style.transform = `scaleX(${dn})`;
      s.down.classList.toggle('hot', dn > 0.7);
    });
    const tl = Math.max(0, Math.ceil(timeLeft));
    this.timer.textContent = Number.isFinite(timeLeft) ? String(tl) : '∞';
    this.timer.classList.toggle('warn', tl <= 10);
    const p = fighters[0];
    fighters.forEach((f,i) => {
      const label=this.sides[i].root.querySelector<HTMLElement>('.hud-combat-state')!;
      const recovery=Math.max(f.recoveryTime,f.landT);
      const recovering=recovery>0 || f.mode==='charge' && f.chargePhase===2;
      label.dataset.state=f.guarding?'guard':recovering?'opening':'ready';
      label.textContent=f.parrying?'PARRY WINDOW':f.guarding?'FRONTAL GUARD':recovering?`${i?'PUNISH WINDOW':'RECOVERY'} ${recovery>0?recovery.toFixed(1)+'s':''}`:f.attackCommitted?'ATTACK COMMITTED':f.mode==='down'?'KNOCKED DOWN':f.mode==='getup'?'WAKE-UP PROTECTION':'';
    });
    const mobility=this.el.querySelector<HTMLElement>('.hud-mobility')!;
    mobility.textContent=p.aiming?(p.skillAimT>=0?'AIMING SKILL · RELEASE TO FIRE':'AIMING BOMB · RELEASE TO THROW'):!['ground','air'].includes(p.mode)?p.mode==='dash'||p.mode==='airdash'?'DASH ACTIVE':'ACTION COMMITTED':p.attackCommitted?'COMMITTED · DASH LOCKED':p.canDash?`DASH READY · ${p.dashCharges}/${p.st.dashCharges}`:`DASH RECOVERY · ${p.dashCharges}/${p.st.dashCharges}`;

    for (const w of this.weaps) {
      const cd = p[w.key];
      const pct = w.max > 0 ? (1 - cd / w.max) * 100 : 100;
      (w.el.firstElementChild as HTMLElement).style.setProperty('--p', pct.toFixed(1));
      const ready = cd <= 0;
      if (ready && !w.ready) {
        w.el.classList.remove('flash');
        void w.el.offsetWidth;
        w.el.classList.add('flash');
      }
      w.ready = ready;
      w.el.classList.toggle('ready', ready);
    }
    // dash charge pips (rendered under the charge dial)
    if (!this.pips) {
      this.pips = document.createElement('div');
      this.pips.className = 'hud-pips';
      this.weaps[3]?.el.appendChild(this.pips);
    }
    const pipKey = `${p.dashCharges}/${p.st.dashCharges}`;
    if (this.pips.dataset.k !== pipKey) {
      this.pips.dataset.k = pipKey;
      this.pips.innerHTML = Array.from({ length: p.st.dashCharges }, (_, i) => `<i class="${i < p.dashCharges ? 'on' : ''}"></i>`).join('');
    }
    // buffs
    const buffs: string[] = [];
    if (p.buffs.shield > 0) buffs.push(`<div class="hud-buff" style="--c:#37e8ff">SHIELD ${Math.ceil(p.buffs.shield)}</div>`);
    if (p.buffs.overdrive > 0) buffs.push(`<div class="hud-buff" style="--c:#ff3b5c">OVERDRIVE ${p.buffs.overdrive.toFixed(1)}s</div>`);
    if (p.buffs.speed > 0) buffs.push(`<div class="hud-buff" style="--c:#9dff4a">SPEED ${p.buffs.speed.toFixed(1)}s</div>`);
    if (p.lowHp) buffs.push(`<div class="hud-buff" style="--c:#ffd23a">COMEBACK: FAST RELOAD</div>`);
    const bh = buffs.join('');
    if (this.buffsEl.dataset.h !== bh) {
      this.buffsEl.dataset.h = bh;
      this.buffsEl.innerHTML = bh;
    }
    // off-screen threat arrows
    const tEls = this.threatEls;
    for (let i = 0; i < tEls.length; i++) {
      const t = threats[i];
      if (!t) {
        tEls[i].style.opacity = '0';
        continue;
      }
      tEls[i].style.opacity = '0.95';
      tEls[i].style.setProperty('--c', t.color);
      this.placeEdge(tEls[i], t.x, t.y, t.behind, this.el.clientWidth, this.el.clientHeight, 70);
    }
    const fuel = p.hoverFuel / p.maxHover;
    this.fuel.classList.toggle('on', !p.grounded && fuel < 0.999);
    (this.fuel.firstElementChild as HTMLElement).style.transform = `scaleX(${Math.max(0, fuel)})`;
    // lock-on reticle / off-screen arrow
    const W = this.el.clientWidth;
    const H = this.el.clientHeight;
    const onScreen = lockScreen.on && !lockScreen.behind && lockScreen.x > 30 && lockScreen.x < W - 30 && lockScreen.y > 30 && lockScreen.y < H - 30;
    this.lockEl.style.opacity = onScreen ? '1' : '0';
    this.lockEl.classList.toggle('hard', hardLock);
    // primed mark on the enemy: colored reticle + label
    const e = fighters[1];
    const pc = e.primed ? ({ shock: '#7ab8ff', burn: '#ff6a1f', cryo: '#9ff0ff' } as const)[e.primed.el] : null;
    this.lockEl.classList.toggle('primed', !!pc);
    if (pc) this.lockEl.style.setProperty('--pc', pc);
    (this.lockEl.firstElementChild as HTMLElement).textContent = e.primed ? `${e.primed.el.toUpperCase()} PRIMED` : '';
    // combo counter (hits landed on the enemy in the current combo)
    const combo = this.el.querySelector<HTMLElement>('.hud-combo')!;
    const ch = e.comboHits;
    combo.classList.toggle('on', ch >= 2);
    if (ch >= 2 && combo.dataset.n !== String(ch)) {
      combo.dataset.n = String(ch);
      combo.innerHTML = `${ch}<small>HIT COMBO</small>`;
    }
    // gun heat bar under the gun dial
    const gunW = this.weaps[0];
    if (gunW) {
      let hb = gunW.el.querySelector<HTMLElement>('.hud-heat');
      if (!hb) {
        hb = document.createElement('div');
        hb.className = 'hud-heat';
        hb.innerHTML = '<i></i>';
        gunW.el.style.position = 'relative';
        gunW.el.appendChild(hb);
      }
      const p0 = fighters[0];
      (hb.firstElementChild as HTMLElement).style.transform = `scaleX(${Math.min(1, p0.heat / 100)})`;
      hb.classList.toggle('hot', p0.heat > 75 || p0.overheated);
      gunW.el.classList.toggle('over', p0.overheated);
    }
    if (onScreen) this.lockEl.style.transform = `translate(${lockScreen.x}px, ${lockScreen.y}px)`;
    if (!onScreen && lockScreen.on) {
      let dx = lockScreen.x - W / 2;
      let dy = lockScreen.y - H / 2;
      if (lockScreen.behind) {
        dx = -dx;
        dy = Math.abs(dy) + H;
      }
      const a = Math.atan2(dy, dx);
      const rx = W / 2 - 50;
      const ry = H / 2 - 50;
      const k = Math.min(Math.abs(rx / Math.cos(a)), Math.abs(ry / Math.sin(a)));
      this.offEl.style.opacity = '0.9';
      this.offEl.style.transform = `translate(${W / 2 + Math.cos(a) * k - 14}px, ${H / 2 + Math.sin(a) * k - 13}px) rotate(${a + Math.PI / 2}rad)`;
    } else this.offEl.style.opacity = '0';
  }

  dispose() {
    this.el.remove();
  }
}
