import { CLASS_DEFS, type ClassId } from '../../../shared/classes.js';
import { SLIDE_COOLDOWN } from '../../../shared/constants.js';
import { GAME_MODE_DEFS, type GameModeId } from '../../../shared/gamemodes.js';
import { KILLSTREAK_DEFS, type KillstreakId } from '../../../shared/killstreaks.js';
import type { RoomModifiers } from '../../../shared/modifiers.js';
import type { MatchPhase, ObjectiveSnapshot } from '../../../shared/protocol.js';
import { WEAPON_DEFS, WEAPON_LIST, type WeaponId } from '../../../shared/weapons.js';

export class HUD {
  private root = document.getElementById('hud')!;
  private modeEl = document.getElementById('hud-mode')!;
  private scoreAEl = document.getElementById('hud-score-a')!;
  private scoreBEl = document.getElementById('hud-score-b')!;
  private timerEl = document.getElementById('hud-timer')!;
  private ringEl = document.getElementById('hud-ring')!;
  private perfEl = document.getElementById('hud-perf')!;
  private objEl = document.getElementById('hud-objective')!;
  private phaseBanner = document.getElementById('hud-phase-banner')!;
  private sectorAlert = document.getElementById('sector-alert')!;
  private streakBanner = document.getElementById('streak-banner')!;
  private spectatorBanner = document.getElementById('spectator-banner')!;
  private killfeed = document.getElementById('killfeed')!;
  private interactBar = document.getElementById('hud-interact-bar')!;
  private interactLabel = document.getElementById('hud-interact-label')!;
  private interactFill = document.getElementById('hud-interact-fill')!;
  private crosshair = document.getElementById('crosshair')!;
  private hitmarker = document.getElementById('hitmarker')!;
  private sniperScope = document.getElementById('sniper-scope')!;
  private reconLayer = document.getElementById('recon-layer')!;
  private smokeVignette = document.getElementById('smoke-vignette')!;
  private damageVignette = document.getElementById('damage-vignette')!;
  private classBadge = document.getElementById('hud-class-badge')!;
  private hpText = document.getElementById('hud-hp-text')!;
  private hpBar = document.getElementById('hud-hp-bar')!;
  private slideBar = document.getElementById('hud-slide-bar')!;
  private streakBox = document.getElementById('hud-streak-box')!;
  private streakCountEl = document.getElementById('hud-streak-count')!;
  private streakNameEl = document.getElementById('hud-streak-name')!;
  private abEBox = document.getElementById('hud-ability-e')!;
  private abEName = document.getElementById('hud-ability-e-name')!;
  private abECd = document.getElementById('hud-ability-e-cd')!;
  private abQBox = document.getElementById('hud-ability-q')!;
  private abQName = document.getElementById('hud-ability-q-name')!;
  private abQCd = document.getElementById('hud-ability-q-cd')!;
  private weaponName = document.getElementById('hud-weapon-name')!;
  private ammoText = document.getElementById('hud-ammo-text')!;
  private weaponSlots = document.getElementById('hud-weapon-slots')!;

  private hitmarkerUntil = 0;
  private damageFlashUntil = 0;
  private streakBannerUntil = 0;
  private lastPerfSampleMs = 0;
  private textCache = new Map<HTMLElement, string>();

  constructor() {
    this.weaponSlots.innerHTML = WEAPON_LIST.map(
      (id) => `<div class="w-slot" data-wid="${id}">${id + 1}:${WEAPON_DEFS[id].shortName}</div>`
    ).join('');
  }

  private setText(el: HTMLElement, text: string): void {
    if (this.textCache.get(el) === text) return;
    this.textCache.set(el, text);
    el.textContent = text;
  }

  public show(): void {
    this.root.classList.remove('hidden');
  }

  public triggerHitmarker(headshot: boolean): void {
    this.hitmarkerUntil = performance.now() + 140;
    this.hitmarker.classList.remove('hidden');
    this.hitmarker.classList.toggle('hs', headshot);
  }

  public triggerDamageFlash(): void {
    this.damageFlashUntil = performance.now() + 260;
    this.damageVignette.classList.remove('hidden');
  }

  public showStreakBanner(playerName: string, streakId: KillstreakId, streakCount: number): void {
    this.streakBannerUntil = performance.now() + 3500;
    const def = KILLSTREAK_DEFS[streakId];
    this.setText(
      this.streakBanner,
      `RACHA (${streakCount} BAJAS) · ${playerName} activo ${def.name.toUpperCase()}`
    );
    this.streakBanner.classList.remove('hidden');
  }

  public pushKillfeed(text: string): void {
    const div = document.createElement('div');
    div.className = 'kf-entry';
    div.textContent = text;
    this.killfeed.prepend(div);
    while (this.killfeed.children.length > 5) {
      this.killfeed.lastElementChild?.remove();
    }
    setTimeout(() => div.remove(), 5000);
  }

  public updateReconMarkers(markers: Array<{ sx: number; sy: number }>): void {
    if (markers.length === 0) {
      if (this.reconLayer.childElementCount > 0) this.reconLayer.innerHTML = '';
      return;
    }
    this.reconLayer.innerHTML = markers
      .map((m) => `<div class="recon-marker" style="left:${m.sx}px;top:${m.sy}px;"></div>`)
      .join('');
  }

  public update(params: {
    nowMs: number;
    simTimeMs: number;
    fps: number;
    drawCalls: number;
    classId: ClassId;
    hp: number;
    maxHp: number;
    alive: boolean;
    spectatingName: string | null;
    weapon: WeaponId;
    ammo: number;
    reloading: boolean;
    infiniteAmmo: boolean;
    cdE: number;
    cdQ: number;
    slideCooldown: number;
    isSniperScope: boolean;
    adsBlend: number;
    inSmoke: boolean;
    gameMode: GameModeId;
    matchPhase: MatchPhase;
    phaseEndsAt: number;
    activeRing: number;
    scoreA: number;
    scoreB: number;
    objective: ObjectiveSnapshot | null;
    modifiers: RoomModifiers;
    sectorWarnSeconds: number | null;
    gunGameLevel: number;
    killStreak: number;
    readyStreak: KillstreakId | null;
  }): void {
    const classDef = CLASS_DEFS[params.classId];
    const wDef = WEAPON_DEFS[params.weapon];

    if (params.nowMs > this.hitmarkerUntil) this.hitmarker.classList.add('hidden');
    if (params.nowMs > this.damageFlashUntil) this.damageVignette.classList.add('hidden');
    if (params.nowMs > this.streakBannerUntil) this.streakBanner.classList.add('hidden');

    this.smokeVignette.classList.toggle('hidden', !params.inSmoke);
    this.sniperScope.classList.toggle('hidden', !params.isSniperScope);
    this.crosshair.classList.toggle('hidden', params.isSniperScope || !params.alive);
    if (!params.isSniperScope && params.alive) {
      this.crosshair.style.opacity = params.adsBlend > 0.35 ? '0.25' : '0.92';
    }

    // Top bar
    this.setText(this.modeEl, GAME_MODE_DEFS[params.gameMode].shortName);
    this.setText(this.scoreAEl, String(params.scoreA));
    this.setText(this.scoreBEl, String(params.scoreB));
    const ringDims = params.activeRing === 1 ? '3x3' : params.activeRing === 2 ? '5x5' : '7x7';
    this.setText(this.ringEl, `Arena ${ringDims}`);

    if (params.nowMs - this.lastPerfSampleMs >= 250) {
      this.lastPerfSampleMs = params.nowMs;
      this.setText(this.perfEl, `${Math.round(params.fps)} FPS · ${params.drawCalls} DC`);
    }

    const remSec = Math.max(0, Math.ceil((params.phaseEndsAt - params.simTimeMs) / 1000));
    const min = Math.floor(remSec / 60);
    const sec = remSec % 60;
    this.setText(this.timerEl, `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`);

    // Phase Banner
    if (params.matchPhase === 'PAUSED') {
      this.setText(this.phaseBanner, 'PARTIDA PAUSADA POR ADMIN');
      this.phaseBanner.classList.remove('hidden');
    } else if (params.matchPhase === 'WAITING_WARMUP') {
      this.setText(this.phaseBanner, 'Calentamiento — Esperando 2+ jugadores');
      this.phaseBanner.classList.remove('hidden');
    } else if (params.matchPhase === 'COUNTDOWN') {
      this.setText(this.phaseBanner, `INICIANDO EN ${remSec}s`);
      this.phaseBanner.classList.remove('hidden');
    } else if (params.matchPhase === 'ROUND_END') {
      this.setText(this.phaseBanner, `FIN DE RONDA — Siguiente partida en ${remSec}s`);
      this.phaseBanner.classList.remove('hidden');
    } else {
      this.phaseBanner.classList.add('hidden');
    }

    // Sector Warning Toast
    if (params.sectorWarnSeconds !== null) {
      this.setText(
        this.sectorAlert,
        `CUADRANTE EN TRANSICION (${params.sectorWarnSeconds.toFixed(1)}s) — Sube o sal de la zona marcada`
      );
      this.sectorAlert.classList.remove('hidden');
    } else {
      this.sectorAlert.classList.add('hidden');
    }

    // Spectator banner (S&D)
    if (!params.alive && params.spectatingName) {
      this.setText(this.spectatorBanner, `Espectando a ${params.spectatingName}`);
      this.spectatorBanner.classList.remove('hidden');
    } else {
      this.spectatorBanner.classList.add('hidden');
    }

    // Objective bar
    let showObj = false;
    let showInteract = false;
    if (params.objective) {
      if (params.objective.mode === 'snd' && params.objective.snd) {
        const s = params.objective.snd;
        const bombSec = s.plantedSite
          ? Math.max(0, Math.ceil((s.bombExplodesAt - params.simTimeMs) / 1000))
          : 0;
        this.setText(
          this.objEl,
          `S&D R${s.subRound}/${s.maxRounds} · Atacante: ${s.attackerTeam} · ${
            s.plantedSite ? `BOMBA EN ${s.plantedSite} (${bombSec}s)` : '[F] Plantar en A/B'
          }`
        );
        showObj = true;
        if (s.plantProgress > 0 || s.defuseProgress > 0) {
          showInteract = true;
          const pct = Math.max(s.plantProgress, s.defuseProgress) * 100;
          this.setText(
            this.interactLabel,
            s.plantProgress > 0 ? 'Plantando bomba...' : 'Desactivando bomba...'
          );
          this.interactFill.style.width = `${pct}%`;
        }
      } else if (params.objective.mode === 'hardpoint' && params.objective.hardpoint) {
        const hp = params.objective.hardpoint;
        const rSec = Math.max(0, Math.ceil((hp.rotatesAt - params.simTimeMs) / 1000));
        this.setText(this.objEl, `PUNTO CALIENTE: ${hp.owner} · Rota en ${rSec}s`);
        showObj = true;
      } else if (params.objective.mode === 'domination' && params.objective.domination) {
        const zStr = params.objective.domination.zones
          .map((z) => `${z.label}:[${z.owner === 'NONE' ? '-' : z.owner}]`)
          .join('  ');
        this.setText(this.objEl, `DOMINACION · ${zStr}`);
        showObj = true;
      } else if (params.objective.mode === 'gungame') {
        this.setText(this.objEl, `JUEGO DE ARMAS · Nivel ${params.gunGameLevel + 1} / 6`);
        showObj = true;
      }
    }
    this.objEl.classList.toggle('hidden', !showObj);
    this.interactBar.classList.toggle('hidden', !showInteract);

    // Bottom Left: Class, HP, Slide
    this.setText(this.classBadge, classDef.name.toUpperCase());
    this.setText(this.hpText, String(params.hp));
    const hpPct = Math.max(0, Math.min(100, (params.hp / params.maxHp) * 100));
    this.hpBar.style.width = `${hpPct}%`;
    this.hpBar.style.background = hpPct > 45 ? '#22c55e' : hpPct > 20 ? '#facc15' : '#ef4444';

    const slideReadyPct = Math.max(
      0,
      Math.min(100, (1 - params.slideCooldown / SLIDE_COOLDOWN) * 100)
    );
    this.slideBar.style.width = `${slideReadyPct}%`;

    // Bottom Right: Streak + Abilities + Weapon
    this.setText(this.streakCountEl, String(params.killStreak));
    if (params.readyStreak) {
      this.setText(
        this.streakNameEl,
        `[X] ${KILLSTREAK_DEFS[params.readyStreak].name.toUpperCase()}`
      );
      this.streakBox.classList.add('ready');
    } else {
      const nextGoal = params.killStreak < 3 ? 3 : params.killStreak < 5 ? 5 : 7;
      this.setText(this.streakNameEl, `${params.killStreak}/${nextGoal} para racha`);
      this.streakBox.classList.remove('ready');
    }

    this.setText(this.abEName, classDef.abilityE.name);
    this.setText(this.abECd, params.cdE <= 0.05 ? 'LISTO' : `${params.cdE.toFixed(1)}s`);
    this.abEBox.classList.toggle('ready', params.cdE <= 0.05);

    this.setText(this.abQName, classDef.abilityQ.name);
    this.setText(this.abQCd, params.cdQ <= 0.05 ? 'LISTO' : `${params.cdQ.toFixed(1)}s`);
    this.abQBox.classList.toggle('ready', params.cdQ <= 0.05);

    this.setText(this.weaponName, wDef.name);
    this.setText(
      this.ammoText,
      params.reloading
        ? 'RECARGANDO...'
        : params.infiniteAmmo
          ? '∞'
          : `${params.ammo} / ${wDef.magSize}`
    );

    const slotNodes = this.weaponSlots.querySelectorAll('.w-slot');
    slotNodes.forEach((n) => {
      const wid = Number(n.getAttribute('data-wid'));
      n.classList.toggle('active', wid === params.weapon);
    });
  }
}
