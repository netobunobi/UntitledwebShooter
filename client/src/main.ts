import type { ClassId } from '../../shared/classes.js';
import {
  FIXED_DT,
  FLAG_SPECTATING,
  KEY_ADS,
  SECTOR_SIZE,
} from '../../shared/constants.js';
import type { GameModeId, MatchConfig } from '../../shared/gamemodes.js';
import type { KillstreakId } from '../../shared/killstreaks.js';
import { DEFAULT_MODIFIERS, type RoomModifiers } from '../../shared/modifiers.js';
import { distSqVec3 } from '../../shared/projectiles.js';
import type {
  MatchPhase,
  ObjectiveSnapshot,
  SmokeState,
  TeamId,
  WallState,
} from '../../shared/protocol.js';
import { sectorCenterWorld, sectorKey, type SectorState } from '../../shared/sectors.js';
import { AudioSynth } from './engine/AudioSynth.js';
import { EffectsPool } from './engine/EffectsPool.js';
import { PlayerRenderer, type RemotePlayerMeta } from './engine/PlayerRenderer.js';
import { Renderer } from './engine/Renderer.js';
import { SectorRenderer } from './engine/SectorRenderer.js';
import { ViewModel } from './engine/ViewModel.js';
import { CameraController } from './gameplay/CameraController.js';
import { InputManager } from './gameplay/InputManager.js';
import { LocalPlayer } from './gameplay/LocalPlayer.js';
import { NetworkClient } from './net/NetworkClient.js';
import { AdminPanel } from './ui/AdminPanel.js';
import { ClassSelector } from './ui/ClassSelector.js';
import { EscMenu } from './ui/EscMenu.js';
import { HUD } from './ui/HUD.js';
import { VoteOverlay } from './ui/VoteOverlay.js';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const joinOverlay = document.getElementById('join-overlay')!;
const joinNameInput = document.getElementById('join-name') as HTMLInputElement;
const joinBtn = document.getElementById('join-btn')!;

const net = new NetworkClient();
const input = new InputManager(canvas);
const renderer = new Renderer(canvas, input.settings.quality);
const sectorRenderer = new SectorRenderer(renderer.scene);
const playerRenderer = new PlayerRenderer(renderer.scene);
const viewModel = new ViewModel(renderer.camera);
const effects = new EffectsPool(renderer.scene);
const audio = new AudioSynth();
audio.setVolume(input.settings.volume / 100);

const localPlayer = new LocalPlayer();
const cameraCtrl = new CameraController();
const hud = new HUD();
const adminPanel = new AdminPanel(net);

let selectedJoinClass: ClassId = 'assault';
const joinClassSelector = new ClassSelector('join-class-grid', selectedJoinClass, (c) => {
  selectedJoinClass = c;
});

let escMenu: EscMenu | null = null;
const voteOverlay = new VoteOverlay((team) => net.send({ t: 'C_VOTE', team }));

// Client arena state
const sectors = new Map<string, SectorState>();
const playerMeta = new Map<string, RemotePlayerMeta>();
let walls: WallState[] = [];
let smokes: SmokeState[] = [];
let objective: ObjectiveSnapshot | null = null;
let modifiers: RoomModifiers = { ...DEFAULT_MODIFIERS };
let gameMode: GameModeId = 'tdm';
let matchConfig: MatchConfig = {
  gameMode: 'tdm',
  gunGameTeams: false,
  scoreLimit: 50,
  roundLimit: 7,
  roundDurationMin: 5,
  randomModeRotation: false,
};
let matchPhase: MatchPhase = 'WAITING_WARMUP';
let phaseEndsAt = 0;
let activeRing = 1;
let scoreA = 0;
let scoreB = 0;
let localTeam: TeamId = 'NONE';
let gunGameLevel = 0;
let spectatingId: string | null = null;
let reconTargetIds: string[] = [];
let reconExpiresAt = 0;
let killStreak = 0;
let readyStreak: KillstreakId | null = null;

let joined = false;
let lastWarnBeepAt = 0;
const rumbledTransitions = new Set<string>();

// Settings wiring
input.onSettingsChanged = (s) => {
  renderer.applyQuality(s.quality);
  audio.setVolume(s.volume / 100);
};
input.onEscToggle = (open) => {
  if (!joined) return;
  escMenu?.setVisible(open);
  if (!open) adminPanel.hide();
};
input.onVoteKey = (team) => net.send({ t: 'C_VOTE', team });
input.onAbilityTrigger = (slot) => {
  if (!joined || !localPlayer.alive || matchPhase === 'PAUSED') return;
  net.send({ t: 'C_ABILITY_ACTIVATE', slot, yaw: input.yaw, pitch: input.pitch });
};
input.onStreakTrigger = () => {
  if (!joined || !localPlayer.alive || !readyStreak || matchPhase === 'PAUSED') return;
  net.send({ t: 'C_ACTIVATE_STREAK', yaw: input.yaw, pitch: input.pitch });
};
input.onReloadTrigger = () => {
  if (!joined || matchPhase === 'PAUSED') return;
  if (localPlayer.startReload(net.getServerSimTime())) {
    net.send({ t: 'C_RELOAD', weapon: localPlayer.weapon });
  }
};

// Server message dispatcher
net.onMessage((msg) => {
  switch (msg.t) {
    case 'S_WELCOME': {
      localPlayer.id = msg.id;
      localPlayer.classId = msg.classId;
      localTeam = msg.team;
      gameMode = msg.gameMode;
      matchConfig = msg.matchConfig;
      matchPhase = msg.matchPhase;
      phaseEndsAt = msg.phaseEndsAt;
      activeRing = msg.activeRing;
      scoreA = msg.scoreA;
      scoreB = msg.scoreB;
      modifiers = msg.modifiers;
      walls = msg.walls;
      smokes = msg.smokes;
      objective = msg.objectives;

      sectors.clear();
      for (const s of msg.sectors) sectors.set(sectorKey(s.gx, s.gz), s);

      playerMeta.clear();
      for (const p of msg.players) {
        playerMeta.set(p.id, { id: p.id, name: p.name, team: p.team });
      }

      sectorRenderer.updateActiveRing(activeRing);
      sectorRenderer.markDirty();
      adminPanel.setRole(msg.adminRole);
      adminPanel.syncMatchConfig(msg.matchConfig, msg.isPaused);
      adminPanel.syncMapSettings(msg.mapEvolution);
      adminPanel.syncModifiers(msg.modifiers);
      adminPanel.renderSectorGrid(sectors);
      adminPanel.renderPlayers(playerMeta);
      break;
    }

    case 'S_SNAPSHOT': {
      scoreA = msg.scoreA;
      scoreB = msg.scoreB;
      const localTuple = msg.players.find((t) => t[0] === localPlayer.id);
      if (localTuple) {
        localPlayer.reconcileFromServer(
          localTuple,
          msg.ack,
          sectors,
          walls,
          activeRing,
          modifiers,
          net.getServerSimTime()
        );
        if (gameMode === 'gungame') {
          input.setWeapon(localTuple[11]);
          localPlayer.weapon = localTuple[11];
        }
        const flags = localTuple[9];
        if ((flags & FLAG_SPECTATING) === 0) spectatingId = null;
      }
      break;
    }

    case 'S_PLAYER_JOIN':
      playerMeta.set(msg.id, { id: msg.id, name: msg.name, team: msg.team });
      adminPanel.renderPlayers(playerMeta);
      break;

    case 'S_PLAYER_LEAVE':
      playerMeta.delete(msg.id);
      adminPanel.renderPlayers(playerMeta);
      break;

    case 'S_CLASS_UPDATE':
      if (msg.playerId === localPlayer.id) {
        localPlayer.classId = msg.classId;
        localPlayer.maxHp = msg.maxHp;
        escMenu?.classSelector.setSelected(msg.classId);
      }
      break;

    case 'S_RESPAWN':
      if (msg.playerId === localPlayer.id) {
        localPlayer.resetForSpawn(msg.spawnPos, msg.maxHp, msg.weapon);
        input.setWeapon(msg.weapon);
        spectatingId = null;
      }
      break;

    case 'S_SHOT_EVENT': {
      const now = performance.now();
      for (const hit of msg.hitPosList) {
        effects.spawnTracer(msg.origin, hit, now);
        effects.spawnSparks(hit, now, 4);
      }
      const d = Math.hypot(
        msg.origin.x - localPlayer.phys.x,
        msg.origin.y - localPlayer.phys.y,
        msg.origin.z - localPlayer.phys.z
      );
      if (msg.shooterId !== localPlayer.id) {
        audio.playWeaponFire(msg.weapon, d);
      }
      break;
    }

    case 'S_PROJ_SPAWN':
      effects.spawnProjectile(
        msg.projId,
        msg.kind,
        msg.origin,
        msg.vel,
        msg.gravity,
        msg.spawnedAt
      );
      if (msg.shooterId !== localPlayer.id && msg.kind === 'kunai') {
        const d = Math.hypot(
          msg.origin.x - localPlayer.phys.x,
          msg.origin.y - localPlayer.phys.y,
          msg.origin.z - localPlayer.phys.z
        );
        audio.playWeaponFire(5, d);
      }
      break;

    case 'S_PROJ_HIT':
      effects.removeProjectile(msg.projId);
      effects.spawnSparks(msg.hitPos, performance.now(), 6);
      break;

    case 'S_ABILITY_FX':
      if (msg.fxType === 'recon_pulse' || msg.fxType === 'impulse_explode') {
        effects.triggerRingPulse(
          msg.origin,
          msg.fxType === 'impulse_explode' ? 0xf97316 : 0x38bdf8,
          650,
          performance.now()
        );
      }
      if (msg.fxType === 'shadow_blink' && msg.playerId === localPlayer.id && msg.targetPos) {
        localPlayer.phys.x = msg.targetPos.x;
        localPlayer.phys.y = msg.targetPos.y;
        localPlayer.phys.z = msg.targetPos.z;
      }
      audio.playAbility(msg.fxType);
      break;

    case 'S_RECON_PING':
      reconTargetIds = msg.targetIds;
      reconExpiresAt = msg.expiresAt;
      break;

    case 'S_WALL_SPAWN':
      walls.push(msg.wall);
      audio.playAbility('wall_spawn');
      break;

    case 'S_WALL_DAMAGE': {
      const w = walls.find((x) => x.id === msg.id);
      if (w) w.hp = msg.hp;
      break;
    }

    case 'S_WALL_DESTROY':
      walls = walls.filter((w) => w.id !== msg.id);
      break;

    case 'S_SMOKE_SPAWN':
      smokes.push(msg.smoke);
      audio.playAbility('smoke');
      break;

    case 'S_SMOKE_EXPIRE':
      smokes = smokes.filter((s) => s.id !== msg.id);
      break;

    case 'S_OBJECTIVE_UPDATE':
      objective = msg.objective;
      if (msg.objective.mode === 'gungame' && msg.objective.gungame) {
        gunGameLevel = msg.objective.gungame.levels[localPlayer.id] ?? 0;
      }
      break;

    case 'S_HIT_CONFIRM':
      hud.triggerHitmarker(msg.headshot);
      audio.playHitmarker(msg.headshot);
      break;

    case 'S_DAMAGE':
      if (msg.victimId === localPlayer.id) hud.triggerDamageFlash();
      break;

    case 'S_KILL': {
      const atk = playerMeta.get(msg.attackerId)?.name ?? msg.attackerId;
      const vic = playerMeta.get(msg.victimId)?.name ?? msg.victimId;
      hud.pushKillfeed(`${atk} ${msg.headshot ? '[HS]' : '->'} ${vic}`);
      if (msg.victimId === localPlayer.id && gameMode === 'snd') {
        const ally = Array.from(playerMeta.values()).find(
          (m) => m.team === localTeam && m.id !== localPlayer.id
        );
        spectatingId = ally?.id ?? null;
      }
      break;
    }

    case 'S_SECTOR_WARNING':
      sectors.set(sectorKey(msg.sector.gx, msg.sector.gz), msg.sector);
      sectorRenderer.markDirty();
      adminPanel.renderSectorGrid(sectors);
      break;

    case 'S_SECTOR_UPDATE':
      sectors.set(sectorKey(msg.sector.gx, msg.sector.gz), msg.sector);
      sectorRenderer.markDirty();
      if (msg.activeRing !== activeRing) {
        activeRing = msg.activeRing;
        sectorRenderer.updateActiveRing(activeRing);
      }
      adminPanel.renderSectorGrid(sectors);
      break;

    case 'S_MATCH_STATE':
      matchPhase = msg.phase;
      phaseEndsAt = msg.phaseEndsAt;
      gameMode = msg.gameMode;
      matchConfig = msg.matchConfig;
      scoreA = msg.scoreA;
      scoreB = msg.scoreB;
      if (msg.activeRing !== activeRing) {
        activeRing = msg.activeRing;
        sectorRenderer.updateActiveRing(activeRing);
      }
      for (const [id, team] of Object.entries(msg.teams)) {
        const m = playerMeta.get(id);
        if (m) m.team = team;
        if (id === localPlayer.id) localTeam = team;
      }
      adminPanel.syncMatchConfig(msg.matchConfig, msg.isPaused);
      adminPanel.renderPlayers(playerMeta);
      break;

    case 'S_MAP_SETTINGS_UPDATE':
      adminPanel.syncMapSettings(msg.settings);
      break;

    case 'S_VOTE_START':
      input.setVoteOpen(true);
      voteOverlay.start(msg.extraName, msg.endsAt);
      break;

    case 'S_VOTE_UPDATE':
      voteOverlay.updateCounts(msg.votesA, msg.votesB);
      break;

    case 'S_VOTE_RESULT':
      input.setVoteOpen(false);
      voteOverlay.showResult(msg.winnerTeam, msg.coinFlip);
      break;

    case 'S_MODIFIERS_UPDATE':
      modifiers = msg.modifiers;
      adminPanel.syncModifiers(msg.modifiers);
      break;

    case 'S_ADMIN_STATUS':
      adminPanel.setRole(msg.role, msg.error);
      break;

    case 'S_ADMIN_KEYS':
      adminPanel.renderKeys(msg.keys);
      break;

    case 'S_STREAK_UPDATE':
      killStreak = msg.streakCount;
      readyStreak = msg.readyStreak;
      break;

    case 'S_STREAK_BANNER':
      hud.showStreakBanner(msg.playerName, msg.streakId, msg.streakCount);
      if (msg.streakId === 'emp_strike') {
        cameraCtrl.addShake(1.0, 0.35);
      }
      break;

    case 'S_KICKED':
      alert(msg.reason);
      window.location.reload();
      break;
  }
});

// Join button
joinBtn.addEventListener('click', async () => {
  const name = joinNameInput.value.trim() || 'Jugador';
  localPlayer.classId = selectedJoinClass;
  await net.connect(name, selectedJoinClass);
  joined = true;
  joinOverlay.classList.add('hidden');
  hud.show();

  escMenu = new EscMenu(
    input,
    selectedJoinClass,
    (newClass) => net.send({ t: 'C_SELECT_CLASS', classId: newClass }),
    () => adminPanel.show()
  );

  input.requestLock();
});

// Main 60Hz Simulation + Render Loop
let prevFrameMs = performance.now();
let accumulator = 0;
let fpsSmooth = 60;
let footstepTimer = 0;

function frame(nowMs: number): void {
  requestAnimationFrame(frame);

  const rawDt = Math.min(0.1, (nowMs - prevFrameMs) / 1000);
  prevFrameMs = nowMs;
  if (rawDt > 0) {
    fpsSmooth = fpsSmooth * 0.9 + (1 / rawDt) * 0.1;
  }

  const simTimeMs = net.getServerSimTime();

  if (joined) {
    accumulator += rawDt;
    const canAct =
      !input.isMenuOpen() &&
      matchPhase !== 'PAUSED' &&
      matchPhase !== 'COUNTDOWN' &&
      matchPhase !== 'ODD_VOTE';

    let subSteps = 0;
    while (accumulator >= FIXED_DT && subSteps < 4) {
      accumulator -= FIXED_DT;
      subSteps++;
      const stepSimMs = simTimeMs - accumulator * 1000;
      const keys = input.getKeyBitmask();
      const pred = localPlayer.predictTick(
        keys,
        input.yaw,
        input.pitch,
        input.activeWeapon,
        sectors,
        walls,
        activeRing,
        modifiers,
        stepSimMs,
        canAct
      );

      net.send({
        t: 'C_INPUT',
        seq: pred.seq,
        dt: FIXED_DT,
        keys,
        yaw: input.yaw,
        pitch: input.pitch,
        weapon: input.activeWeapon,
      });

      if (pred.fired) {
        viewModel.triggerKick();
        audio.playWeaponFire(localPlayer.weapon, 0);
        net.send({
          t: 'C_FIRE',
          seq: pred.seq,
          weapon: localPlayer.weapon,
          shotIdx: pred.fired.shotIdx,
          origin: pred.fired.origin,
          dir: pred.fired.dir,
          clientTime: stepSimMs,
        });
      }
    }

    // Audio footsteps & sector warnings/rumble
    const horizSpeed = Math.hypot(localPlayer.phys.vx, localPlayer.phys.vz);
    if (localPlayer.alive && localPlayer.phys.grounded && horizSpeed > 2.5 && !localPlayer.phys.sliding) {
      footstepTimer -= rawDt;
      if (footstepTimer <= 0) {
        footstepTimer = localPlayer.phys.sprinting ? 0.25 : 0.34;
        const mult = localPlayer.classId === 'ninja' ? 0.2 : 1.0;
        audio.playFootstep(mult);
      }
    }

    let localWarnRem: number | null = null;
    for (const s of sectors.values()) {
      if (Math.abs(s.gx) > activeRing || Math.abs(s.gz) > activeRing) continue;
      const center = sectorCenterWorld(s.gx, s.gz);
      const dist = Math.hypot(center.x - localPlayer.phys.x, center.z - localPlayer.phys.z);

      if (s.phase === 'WARNING') {
        const remSec = Math.max(0, (s.warnEnd - simTimeMs) / 1000);
        if (dist <= SECTOR_SIZE * 1.25) {
          localWarnRem = localWarnRem === null ? remSec : Math.min(localWarnRem, remSec);
        }

        const beepInterval = remSec <= 3.0 ? 500 : 2000;
        if (nowMs - lastWarnBeepAt >= beepInterval && dist < 70) {
          lastWarnBeepAt = nowMs;
          audio.playSectorWarningBeep(dist, remSec <= 3.0);
        }
      } else if (s.phase === 'TRANSITIONING') {
        const transKey = `${s.gx},${s.gz},${s.emergeStart}`;
        if (!rumbledTransitions.has(transKey) && simTimeMs >= s.emergeStart + 1500) {
          rumbledTransitions.add(transKey);
          audio.playSectorRumble(dist);
          if (dist < 48) {
            cameraCtrl.addShake(0.65, 0.35);
          }
        }
      }
    }

    // Update World & Entities
    sectorRenderer.update(sectors, walls, objective, activeRing, simTimeMs);
    playerRenderer.update(
      net.snapshots,
      simTimeMs - 100,
      localPlayer.id,
      localTeam,
      localPlayer.phys,
      playerMeta,
      modifiers.playerScale
    );
    effects.update(nowMs, simTimeMs, smokes, rawDt);

    const adsHeld = Boolean(input.getKeyBitmask() & KEY_ADS);
    const camRes = cameraCtrl.update(
      renderer.camera,
      localPlayer,
      input.yaw,
      input.pitch,
      adsHeld,
      input.settings.fov,
      modifiers,
      playerRenderer,
      spectatingId,
      rawDt
    );
    input.setAdsSensMultiplier(camRes.sensMult);

    viewModel.update(
      localPlayer.weapon,
      horizSpeed,
      localPlayer.phys.sliding,
      localPlayer.phys.sprinting,
      localPlayer.reloadingUntil > simTimeMs,
      camRes.adsBlend,
      camRes.isSniperScope,
      localPlayer.alive && !spectatingId,
      rawDt
    );

    // Recon 2D overlay
    if (simTimeMs < reconExpiresAt && reconTargetIds.length > 0) {
      const markers = playerRenderer.projectTargetsToScreen(
        renderer.camera,
        reconTargetIds,
        window.innerWidth,
        window.innerHeight
      );
      hud.updateReconMarkers(markers);
    } else {
      hud.updateReconMarkers([]);
    }

    // Check if local camera is inside Ninja smoke
    const inSmoke = smokes.some(
      (sm) =>
        distSqVec3(
          { x: renderer.camera.position.x, y: renderer.camera.position.y, z: renderer.camera.position.z },
          sm.pos
        ) <=
        sm.radius * sm.radius
    );

    voteOverlay.tick(simTimeMs);
    const specName = spectatingId ? playerMeta.get(spectatingId)?.name ?? 'Aliado' : null;
    hud.update({
      nowMs,
      simTimeMs,
      fps: fpsSmooth,
      drawCalls: renderer.getDrawCalls(),
      classId: localPlayer.classId,
      hp: localPlayer.hp,
      maxHp: localPlayer.maxHp,
      alive: localPlayer.alive,
      spectatingName: specName,
      weapon: localPlayer.weapon,
      ammo: localPlayer.ammo[localPlayer.weapon],
      reloading: localPlayer.reloadingUntil > simTimeMs,
      infiniteAmmo: modifiers.infiniteAmmo,
      cdE: localPlayer.cdE,
      cdQ: localPlayer.cdQ,
      slideCooldown: localPlayer.phys.slideCooldown,
      isSniperScope: camRes.isSniperScope,
      adsBlend: camRes.adsBlend,
      inSmoke,
      gameMode,
      matchPhase,
      phaseEndsAt,
      activeRing,
      scoreA,
      scoreB,
      objective,
      modifiers,
      sectorWarnSeconds: localWarnRem,
      gunGameLevel,
      killStreak,
      readyStreak,
    });
  } else {
    // Background idle arena camera on join screen
    const angle = nowMs * 0.00018;
    renderer.camera.position.set(Math.cos(angle) * 58, 28, Math.sin(angle) * 58);
    renderer.camera.lookAt(0, 4, 0);
    sectorRenderer.update(sectors, walls, null, activeRing, simTimeMs);
  }

  renderer.render();
}

void joinClassSelector;
requestAnimationFrame(frame);
