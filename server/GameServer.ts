import {
  CLASS_DEFS,
  CLASS_TO_INDEX,
  isValidClassId,
  type ClassId,
} from '../shared/classes.js';
import {
  FFA_RESPAWN_DELAY_MS,
  FIXED_DT,
  FLAG_ADS,
  FLAG_ALIVE,
  FLAG_CLASS_SHIFT,
  FLAG_CLOAKED,
  FLAG_CROUCHING,
  FLAG_DASHING,
  FLAG_GROUNDED,
  FLAG_PLANT_DEFUSE,
  FLAG_SLIDING,
  FLAG_SPECTATING,
  FLAG_SPRINTING,
  FLAG_STIM,
  KEY_ADS,
  KEY_INTERACT,
  RESPAWN_DELAY_MS,
  SECTOR_SIZE,
  SNAPSHOT_INTERVAL_MS,
  TICK_RATE,
} from '../shared/constants.js';
import {
  collectAllActiveColliders,
  computeBlinkDestination,
  ensureUnstuck,
  querySectorColliders,
  raycastColliders,
} from '../shared/collision.js';
import {
  GUN_GAME_LADDER,
  isTeamMode,
  type MatchConfig,
} from '../shared/gamemodes.js';
import { KILLSTREAK_DEFS, getStreakForKills } from '../shared/killstreaks.js';
import type { RoomModifiers } from '../shared/modifiers.js';
import { createInitialPhysState, stepPlayerPhysics } from '../shared/physics.js';
import {
  distSqVec3,
  yawPitchToForward,
  type Vec3,
} from '../shared/projectiles.js';
import type {
  AdminRole,
  ClientMessage,
  PlayerSnapshotTuple,
  ServerMessage,
  TeamId,
} from '../shared/protocol.js';
import type { SectorLevel, SectorState } from '../shared/sectors.js';
import { WEAPON_DEFS, isValidWeaponId, type WeaponId } from '../shared/weapons.js';
import { AdminManager } from './AdminManager.js';
import { CombatSystem } from './CombatSystem.js';
import { DeployableManager } from './DeployableManager.js';
import { HistoryBuffer } from './HistoryBuffer.js';
import { MatchManager } from './MatchManager.js';
import { ObjectiveManager } from './ObjectiveManager.js';
import { ProjectileSystem } from './ProjectileSystem.js';
import { SectorDirector } from './SectorDirector.js';
import type { ServerPlayer } from './types.js';

export interface PlayerSessionBridge {
  id: string;
  ip: string;
  send: (msg: ServerMessage) => void;
  disconnect: (reason?: string) => void;
}

export class GameServer {
  public readonly players: Map<string, ServerPlayer> = new Map();
  public readonly sectors: SectorDirector;
  public readonly match: MatchManager;
  public readonly objectives: ObjectiveManager;
  public readonly deployables: DeployableManager;
  public readonly projectiles: ProjectileSystem;
  public readonly combat: CombatSystem;
  public readonly history: HistoryBuffer;
  public readonly admin: AdminManager;

  private simTimeMs = 0;
  private sleeping = true;
  private simTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private lastObjectiveSyncMs = 0;
  private rng: () => number;

  constructor(options?: { adminPassword?: string; rng?: () => number }) {
    this.rng = options?.rng ?? Math.random;
    this.sectors = new SectorDirector(this.rng);
    this.match = new MatchManager(this.rng);
    this.objectives = new ObjectiveManager(this.rng);
    this.deployables = new DeployableManager();
    this.projectiles = new ProjectileSystem();
    this.combat = new CombatSystem();
    this.history = new HistoryBuffer();
    this.admin = new AdminManager(options?.adminPassword);

    this.wireEvents();
    this.objectives.resetForMatch(
      this.match.config,
      this.match.activeRing,
      this.simTimeMs,
      this.players.values()
    );
  }

  private wireEvents(): void {
    this.sectors.setEvents({
      onSectorWarning: (sector: SectorState) => {
        this.broadcast({ t: 'S_SECTOR_WARNING', sector });
      },
      onSectorUpdate: (sector: SectorState) => {
        this.broadcast({
          t: 'S_SECTOR_UPDATE',
          sector,
          activeRing: this.match.activeRing,
        });
      },
    });

    this.deployables.setEvents({
      onWallSpawn: (wall) => this.broadcast({ t: 'S_WALL_SPAWN', wall }),
      onWallDamage: (id, hp) => this.broadcast({ t: 'S_WALL_DAMAGE', id, hp }),
      onWallDestroy: (id, reason) => this.broadcast({ t: 'S_WALL_DESTROY', id, reason }),
      onSmokeSpawn: (smoke) => this.broadcast({ t: 'S_SMOKE_SPAWN', smoke }),
      onSmokeExpire: (id) => this.broadcast({ t: 'S_SMOKE_EXPIRE', id }),
    });

    this.projectiles.setEvents({
      onSpawn: (proj) =>
        this.broadcast({
          t: 'S_PROJ_SPAWN',
          projId: proj.id,
          kind: proj.kind,
          shooterId: proj.shooterId,
          origin: proj.pos,
          vel: proj.vel,
          gravity: proj.gravity,
          spawnedAt: proj.spawnedAt,
        }),
      onHit: (proj, hitPos, hitType) =>
        this.broadcast({
          t: 'S_PROJ_HIT',
          projId: proj.id,
          kind: proj.kind,
          hitPos,
          hitType,
        }),
      onPlayerDamaged: (victim, attackerId, damage, headshot, sourcePos, weapon) =>
        this.applyDamage(victim, attackerId, damage, headshot, sourcePos, weapon),
      onImpulseExplode: (center, shooterId) =>
        this.broadcast({
          t: 'S_ABILITY_FX',
          fxType: 'impulse_explode',
          playerId: shooterId,
          origin: center,
        }),
    });

    this.combat.setEvents({
      onShotEvent: (shooterId, weapon, origin, hitPosList) =>
        this.broadcast({ t: 'S_SHOT_EVENT', shooterId, weapon, origin, hitPosList }),
      onPlayerDamaged: (victim, attackerId, damage, headshot, sourcePos, weapon) =>
        this.applyDamage(victim, attackerId, damage, headshot, sourcePos, weapon),
    });

    this.match.setEvents({
      onMatchState: () => this.broadcastMatchState(),
      onVoteStart: (extraId, extraName, endsAt) =>
        this.broadcast({ t: 'S_VOTE_START', extraId, extraName, endsAt }),
      onVoteUpdate: (votesA, votesB) =>
        this.broadcast({ t: 'S_VOTE_UPDATE', votesA, votesB }),
      onVoteResult: (winnerTeam, extraId, coinFlip) =>
        this.broadcast({ t: 'S_VOTE_RESULT', winnerTeam, extraId, coinFlip }),
      onRoundResetPlayers: () => this.resetAllPlayersForRound(),
    });
  }

  public isSleeping(): boolean {
    return this.sleeping;
  }

  public hasActiveTimers(): boolean {
    return this.simTimer !== null || this.snapshotTimer !== null;
  }

  public getSimTimeMs(): number {
    return this.simTimeMs;
  }

  private wakeUp(): void {
    if (!this.sleeping) return;
    this.sleeping = false;
    let lastWallMs = performance.now();
    let accSec = 0;

    // 8ms high-resolution polling accumulator prevents Windows 15.6ms timer throttling
    // from dropping the server tick below 60.0 Hz.
    this.simTimer = setInterval(() => {
      const now = performance.now();
      const elapsedSec = Math.min(0.1, Math.max(0, (now - lastWallMs) / 1000));
      lastWallMs = now;
      accSec += elapsedSec;
      let steps = 0;
      while (accSec >= FIXED_DT && steps < 6) {
        accSec -= FIXED_DT;
        this.stepSimulation(FIXED_DT);
        steps++;
      }
    }, 8);

    this.snapshotTimer = setInterval(() => {
      this.broadcastSnapshot();
    }, SNAPSHOT_INTERVAL_MS);
  }

  private enterIdleSleep(): void {
    if (this.sleeping) return;
    this.sleeping = true;
    if (this.simTimer !== null) {
      clearInterval(this.simTimer);
      this.simTimer = null;
    }
    if (this.snapshotTimer !== null) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    this.history.clear();
    this.projectiles.clear();
  }

  public dispose(): void {
    this.enterIdleSleep();
  }

  public broadcast(msg: ServerMessage, excludeId?: string): void {
    for (const p of this.players.values()) {
      if (p.id !== excludeId) p.send(msg);
    }
  }

  private broadcastMatchState(): void {
    this.broadcast({
      t: 'S_MATCH_STATE',
      phase: this.match.phase,
      phaseEndsAt: this.match.phaseEndsAt,
      isPaused: this.match.phase === 'PAUSED',
      gameMode: this.match.config.gameMode,
      matchConfig: { ...this.match.config },
      activeRing: this.match.activeRing,
      scoreA: this.match.scoreA,
      scoreB: this.match.scoreB,
      teams: this.match.getTeamMap(this.players),
      winner: this.match.winner,
    });
  }

  private createFreshAmmo(): Record<WeaponId, number> {
    return {
      0: WEAPON_DEFS[0].magSize,
      1: WEAPON_DEFS[1].magSize,
      2: WEAPON_DEFS[2].magSize,
      3: WEAPON_DEFS[3].magSize,
      4: WEAPON_DEFS[4].magSize,
      5: WEAPON_DEFS[5].magSize,
    };
  }

  private findSafeSpawn(team: TeamId): Vec3 {
    const ring = this.match.activeRing;
    const span = Math.max(1, ring) * SECTOR_SIZE;
    const cols = collectAllActiveColliders(
      this.sectors.grid,
      this.deployables.walls,
      ring,
      this.simTimeMs
    );

    let fallback: Vec3 = { x: 0, y: 0.05, z: 0 };
    for (let attempt = 0; attempt < 10; attempt++) {
      let baseX = 0;
      let baseZ = 0;
      if (team === 'A') {
        baseX = -span + 5 + this.rng() * 6;
        baseZ = (this.rng() - 0.5) * (span * 1.2);
      } else if (team === 'B') {
        baseX = span - 5 - this.rng() * 6;
        baseZ = (this.rng() - 0.5) * (span * 1.2);
      } else {
        const angle = this.rng() * Math.PI * 2;
        const dist = (0.25 + this.rng() * 0.55) * span;
        baseX = Math.cos(angle) * dist;
        baseZ = Math.sin(angle) * dist;
      }

      const candidate = ensureUnstuck(
        { x: baseX, y: 0.05, z: baseZ },
        false,
        this.admin.modifiers.playerScale,
        cols,
        ring
      );
      fallback = candidate;
      const ceiling = raycastColliders(
        { x: candidate.x, y: candidate.y + 0.5, z: candidate.z },
        { x: 0, y: 1, z: 0 },
        20,
        cols
      );
      if (candidate.y < 1.0 && !ceiling) {
        return candidate;
      }
    }
    return fallback;
  }

  private respawnPlayer(player: ServerPlayer): void {
    if (player.pendingClassId) {
      player.classId = player.pendingClassId;
      player.pendingClassId = null;
      player.maxHp = CLASS_DEFS[player.classId].maxHp;
      this.broadcast({
        t: 'S_CLASS_UPDATE',
        playerId: player.id,
        classId: player.classId,
        maxHp: player.maxHp,
      });
    }

    const pos = this.findSafeSpawn(player.team);
    player.phys = createInitialPhysState(pos.x, pos.y, pos.z);
    player.maxHp = CLASS_DEFS[player.classId].maxHp;
    player.hp = player.maxHp;
    player.alive = true;
    player.spectatingId = null;
    player.cloakTimer = 0;
    player.cdE = 0;
    player.cdQ = 0;
    player.overdriveTimer = 0;
    player.inputQueue = [];
    player.ammo = this.createFreshAmmo();
    player.reloadingUntil = 0;

    if (this.match.config.gameMode === 'gungame') {
      const lvl = Math.min(GUN_GAME_LADDER.length - 1, player.gunGameLevel);
      player.weapon = GUN_GAME_LADDER[lvl];
    }

    this.broadcast({
      t: 'S_RESPAWN',
      playerId: player.id,
      spawnPos: pos,
      maxHp: player.maxHp,
      weapon: player.weapon,
    });
  }

  private resetAllPlayersForRound(): void {
    this.deployables.clearAll();
    this.projectiles.clear();
    this.objectives.resetForMatch(
      this.match.config,
      this.match.activeRing,
      this.simTimeMs,
      this.players.values()
    );

    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      p.killStreak = 0;
      p.readyStreak = null;
      p.gunGameLevel = 0;
      p.send({ t: 'S_STREAK_UPDATE', streakCount: 0, readyStreak: null });
      if (this.match.config.gameMode === 'gungame') {
        p.weapon = GUN_GAME_LADDER[0];
      }
      this.respawnPlayer(p);
    }

    this.broadcast({
      t: 'S_OBJECTIVE_UPDATE',
      objective: this.objectives.getSnapshot(this.players.values()),
    });
  }

  public addPlayer(bridge: PlayerSessionBridge, name: string, classId: ClassId = 'assault'): ServerPlayer {
    const validClass = isValidClassId(classId) ? classId : 'assault';
    const classDef = CLASS_DEFS[validClass];
    const spawn = this.findSafeSpawn('NONE');

    const player: ServerPlayer = {
      id: bridge.id,
      name: name.trim().slice(0, 20) || `Player-${bridge.id}`,
      team: 'NONE',
      classId: validClass,
      pendingClassId: null,
      adminRole: 'none',
      phys: createInitialPhysState(spawn.x, spawn.y, spawn.z),
      yaw: 0,
      pitch: 0,
      hp: classDef.maxHp,
      maxHp: classDef.maxHp,
      alive: true,
      respawnAt: 0,
      spectatingId: null,
      weapon: this.match.config.gameMode === 'gungame' ? GUN_GAME_LADDER[0] : 0,
      ammo: this.createFreshAmmo(),
      reloadingUntil: 0,
      nextFireAt: 0,
      lastShotIdx: 0,
      lastShotTime: 0,
      cdE: 0,
      cdQ: 0,
      cloakTimer: 0,
      adsActive: false,
      interacting: false,
      lastAckSeq: 0,
      gunGameLevel: 0,
      kills: 0,
      deaths: 0,
      killStreak: 0,
      readyStreak: null,
      overdriveTimer: 0,
      lastInputKeys: 0,
      inputQueue: [],
      ip: bridge.ip,
      send: bridge.send,
      disconnect: bridge.disconnect,
    };

    const wasEmpty = this.players.size === 0;
    this.players.set(player.id, player);
    if (wasEmpty) {
      this.wakeUp();
    }

    this.match.handlePlayerJoin(player, this.players, this.simTimeMs);
    const updatedSpawn = this.findSafeSpawn(player.team);
    player.phys.x = updatedSpawn.x;
    player.phys.y = updatedSpawn.y;
    player.phys.z = updatedSpawn.z;

    if (this.match.config.gameMode === 'snd' && this.match.phase === 'IN_PROGRESS') {
      player.alive = false;
    }

    player.send({
      t: 'S_WELCOME',
      id: player.id,
      team: player.team,
      classId: player.classId,
      gameMode: this.match.config.gameMode,
      matchConfig: { ...this.match.config },
      mapEvolution: { ...this.sectors.settings },
      activeRing: this.match.activeRing,
      matchPhase: this.match.phase,
      phaseEndsAt: this.match.phaseEndsAt,
      isPaused: this.match.phase === 'PAUSED',
      sectors: this.sectors.getAllSectors(),
      walls: this.deployables.walls,
      smokes: this.deployables.smokes,
      objectives: this.objectives.getSnapshot(this.players.values()),
      modifiers: { ...this.admin.modifiers },
      adminRole: player.adminRole,
      players: Array.from(this.players.values()).map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        classId: p.classId,
        kills: p.kills,
        deaths: p.deaths,
      })),
      scoreA: this.match.scoreA,
      scoreB: this.match.scoreB,
      serverTime: this.simTimeMs,
      tickRate: TICK_RATE,
    });

    if (this.match.phase === 'ODD_VOTE' && this.match.oddExtraId) {
      const extra = this.players.get(this.match.oddExtraId);
      player.send({
        t: 'S_VOTE_START',
        extraId: this.match.oddExtraId,
        extraName: extra?.name ?? 'Extra',
        endsAt: this.match.phaseEndsAt,
      });
    }

    this.broadcast(
      {
        t: 'S_PLAYER_JOIN',
        id: player.id,
        name: player.name,
        team: player.team,
        classId: player.classId,
      },
      player.id
    );

    return player;
  }

  public removePlayer(playerId: string): void {
    const existing = this.players.get(playerId);
    if (!existing) return;

    this.players.delete(playerId);
    this.admin.onPlayerDisconnect(playerId);
    this.match.handlePlayerLeave(playerId, this.players, this.simTimeMs);
    this.broadcast({ t: 'S_PLAYER_LEAVE', id: playerId });

    if (this.players.size === 0) {
      this.enterIdleSleep();
    }
  }

  public handleMessage(playerId: string, msg: ClientMessage): void {
    const player = this.players.get(playerId);
    if (!player) return;

    switch (msg.t) {
      case 'C_PING':
        player.send({ t: 'S_PONG', clientTime: msg.clientTime, serverTime: this.simTimeMs });
        return;

      case 'C_SELECT_CLASS': {
        if (!isValidClassId(msg.classId)) return;
        if (!player.alive || this.match.phase === 'WAITING_WARMUP' || this.match.phase === 'COUNTDOWN') {
          player.classId = msg.classId;
          player.pendingClassId = null;
          player.maxHp = CLASS_DEFS[msg.classId].maxHp;
          player.hp = player.maxHp;
          this.broadcast({
            t: 'S_CLASS_UPDATE',
            playerId: player.id,
            classId: player.classId,
            maxHp: player.maxHp,
          });
        } else {
          player.pendingClassId = msg.classId;
        }
        return;
      }

      case 'C_INPUT': {
        if (this.match.phase === 'PAUSED') return;
        player.inputQueue.push({
          seq: msg.seq,
          keys: msg.keys,
          yaw: msg.yaw,
          pitch: msg.pitch,
          weapon: msg.weapon,
        });
        if (player.inputQueue.length > 10) {
          player.inputQueue.shift();
        }
        player.yaw = msg.yaw;
        player.pitch = msg.pitch;
        player.adsActive = Boolean(msg.keys & KEY_ADS);
        player.interacting = Boolean(msg.keys & KEY_INTERACT);
        if (this.match.config.gameMode !== 'gungame' && isValidWeaponId(msg.weapon)) {
          if (player.weapon !== msg.weapon) {
            player.weapon = msg.weapon;
            player.reloadingUntil = 0;
          }
        }
        return;
      }

      case 'C_RELOAD': {
        if (!player.alive || this.match.phase === 'PAUSED') return;
        const w = player.weapon;
        const def = WEAPON_DEFS[w];
        if (player.ammo[w] >= def.magSize) return;
        const classDef = CLASS_DEFS[player.classId];
        player.reloadingUntil = this.simTimeMs + (def.reloadTimeSec * 1000) / classDef.reloadSpeedMult;
        return;
      }

      case 'C_FIRE': {
        if (
          this.match.phase === 'PAUSED' ||
          this.match.phase === 'COUNTDOWN' ||
          this.match.phase === 'ODD_VOTE' ||
          this.match.phase === 'ROUND_END'
        ) {
          return;
        }
        this.combat.handleFire(
          player,
          msg.origin,
          msg.dir,
          msg.weapon,
          msg.clientTime,
          this.simTimeMs,
          this.players,
          this.sectors.grid,
          this.deployables,
          this.projectiles,
          this.history,
          this.match.activeRing,
          this.admin.modifiers,
          isTeamMode(this.match.config)
        );
        return;
      }

      case 'C_ABILITY_ACTIVATE': {
        if (!player.alive || this.match.phase === 'PAUSED') return;
        this.activateAbility(player, msg.slot, msg.yaw, msg.pitch);
        return;
      }

      case 'C_ACTIVATE_STREAK': {
        if (!player.alive || this.match.phase === 'PAUSED') return;
        this.activateKillstreak(player, msg.yaw, msg.pitch);
        return;
      }

      case 'C_VOTE': {
        if (msg.team === 'A' || msg.team === 'B') {
          this.match.castVote(player.id, msg.team, this.players, this.simTimeMs);
        }
        return;
      }

      case 'C_ADMIN_AUTH': {
        this.admin.authenticate(player, msg.password);
        return;
      }

      case 'C_ADMIN_ACTION': {
        this.admin.handleAction(player, msg.action, msg.payload ?? {}, {
          getPlayers: () => this.players,
          getSimTimeMs: () => this.simTimeMs,
          getActiveRing: () => this.match.activeRing,
          startRound: () => this.match.startRound(this.players, this.simTimeMs),
          pauseRound: () => this.match.pause(this.simTimeMs),
          resumeRound: () => this.match.resume(this.simTimeMs),
          resetRound: () => this.match.startRound(this.players, this.simTimeMs),
          applyMatchConfig: (partial: Partial<MatchConfig>) => {
            Object.assign(this.match.config, partial);
            this.match.startRound(this.players, this.simTimeMs);
          },
          setMapEvolution: (enabled?: boolean, speed?: 1 | 2 | 4) => {
            const settings = this.sectors.setEvolutionSettings({
              autoEvolutionEnabled: enabled,
              speedMultiplier: speed,
            });
            this.broadcast({ t: 'S_MAP_SETTINGS_UPDATE', settings });
          },
          forceSector: (gx: number, gz: number, level: SectorLevel) => {
            this.sectors.forceSectorLevel(gx, gz, level, this.simTimeMs, this.match.activeRing);
          },
          movePlayerTeam: (targetId: string, team: 'A' | 'B') => {
            const target = this.players.get(targetId);
            if (!target) return;
            target.team = team;
            this.broadcastMatchState();
          },
          kickPlayer: (targetId: string, reason: string) => {
            const target = this.players.get(targetId);
            if (!target) return;
            target.send({ t: 'S_KICKED', reason });
            target.disconnect(reason);
            this.removePlayer(targetId);
          },
          applyModifiers: (next: RoomModifiers, changedBy: string) => {
            const prevScale = this.admin.modifiers.playerScale;
            this.admin.modifiers = next;
            if (next.playerScale >= prevScale) {
              const cols = collectAllActiveColliders(
                this.sectors.grid,
                this.deployables.walls,
                this.match.activeRing,
                this.simTimeMs
              );
              for (const p of this.players.values()) {
                const rescued = ensureUnstuck(
                  { x: p.phys.x, y: p.phys.y, z: p.phys.z },
                  p.phys.crouching || p.phys.sliding,
                  next.playerScale,
                  cols,
                  this.match.activeRing
                );
                p.phys.x = rescued.x;
                p.phys.y = rescued.y;
                p.phys.z = rescued.z;
              }
            }
            this.broadcast({ t: 'S_MODIFIERS_UPDATE', modifiers: next, changedBy });
          },
        });
        return;
      }
    }
  }

  public activateAbility(
    player: ServerPlayer,
    slot: 'E' | 'Q',
    yaw: number,
    pitch: number
  ): boolean {
    const classDef = CLASS_DEFS[player.classId];
    const scale = this.admin.modifiers.playerScale;
    const eyePos: Vec3 = {
      x: player.phys.x,
      y: player.phys.y + (player.phys.crouching || player.phys.sliding ? 0.85 : 1.62) * scale,
      z: player.phys.z,
    };
    const fwd = yawPitchToForward(yaw, pitch);

    if (slot === 'E') {
      if (player.cdE > 0) return false;
      player.cdE = classDef.abilityE.cooldownSec;

      if (player.classId === 'ghost') {
        player.cloakTimer = classDef.abilityE.durationSec;
        this.broadcast({ t: 'S_ABILITY_FX', fxType: 'cloak', playerId: player.id, origin: eyePos });
      } else if (player.classId === 'assault') {
        player.phys.dashing = true;
        player.phys.dashTimer = classDef.abilityE.dashDurationSec ?? 0.18;
        player.phys.dashCooldown = classDef.abilityE.cooldownSec;
        player.phys.dashDirX = -Math.sin(yaw);
        player.phys.dashDirZ = -Math.cos(yaw);
        this.broadcast({ t: 'S_ABILITY_FX', fxType: 'dash', playerId: player.id, origin: eyePos });
      } else if (player.classId === 'ninja') {
        const cols = collectAllActiveColliders(
          this.sectors.grid,
          this.deployables.walls,
          this.match.activeRing,
          this.simTimeMs
        );
        const dest = computeBlinkDestination(
          { x: player.phys.x, y: player.phys.y, z: player.phys.z },
          -Math.sin(yaw),
          -Math.cos(yaw),
          classDef.abilityE.blinkMaxDist ?? 10.0,
          player.phys.crouching || player.phys.sliding,
          scale,
          cols,
          this.match.activeRing
        );
        player.phys.x = dest.x;
        player.phys.y = dest.y;
        player.phys.z = dest.z;
        this.broadcast({
          t: 'S_ABILITY_FX',
          fxType: 'shadow_blink',
          playerId: player.id,
          origin: eyePos,
          targetPos: dest,
        });
      } else if (player.classId === 'vanguard') {
        this.projectiles.spawn(
          'impulse_grenade',
          player,
          eyePos,
          fwd,
          this.admin.modifiers,
          this.simTimeMs
        );
      }
      return true;
    }

    // Slot Q
    if (player.cdQ > 0) return false;
    player.cdQ = classDef.abilityQ.cooldownSec;

    if (player.classId === 'ghost') {
      const radius = classDef.abilityQ.reconRadius ?? 30.0;
      const rSq = radius * radius;
      const teamMode = isTeamMode(this.match.config);
      const revealedIds: string[] = [];

      for (const other of this.players.values()) {
        if (!other.alive || other.id === player.id) continue;
        if (teamMode && player.team !== 'NONE' && other.team === player.team) continue;
        const targetPos: Vec3 = { x: other.phys.x, y: other.phys.y + 0.9, z: other.phys.z };
        if (distSqVec3(eyePos, targetPos) <= rSq) {
          // Ninja smoke bomb blocks Recon Pulse line/point detection
          if (
            !this.deployables.isPointInSmoke(targetPos) &&
            !this.deployables.isSegmentBlockedBySmoke(eyePos, targetPos)
          ) {
            revealedIds.push(other.id);
          }
        }
      }

      const expiresAt = this.simTimeMs + classDef.abilityQ.durationSec * 1000;
      this.broadcast({ t: 'S_ABILITY_FX', fxType: 'recon_pulse', playerId: player.id, origin: eyePos });
      for (const ally of this.players.values()) {
        if (ally.id === player.id || (teamMode && ally.team === player.team && player.team !== 'NONE')) {
          ally.send({ t: 'S_RECON_PING', targetIds: revealedIds, expiresAt });
        }
      }
    } else if (player.classId === 'assault') {
      const heal = classDef.abilityQ.stimHeal ?? 40;
      player.hp = Math.min(player.maxHp, player.hp + heal);
      player.phys.stimTimer = classDef.abilityQ.durationSec;
      this.broadcast({ t: 'S_ABILITY_FX', fxType: 'stim', playerId: player.id, origin: eyePos });
    } else if (player.classId === 'ninja') {
      this.projectiles.spawn(
        'smoke_bomb',
        player,
        eyePos,
        fwd,
        this.admin.modifiers,
        this.simTimeMs
      );
    } else if (player.classId === 'vanguard') {
      this.deployables.spawnTacticalWall(
        player.id,
        player.team,
        { x: player.phys.x, y: player.phys.y, z: player.phys.z },
        yaw,
        this.sectors.grid,
        this.match.activeRing,
        this.simTimeMs
      );
    }
    return true;
  }

  public activateKillstreak(player: ServerPlayer, yaw: number, _pitch: number): boolean {
    if (!player.readyStreak) return false;
    const streakId = player.readyStreak;
    const def = KILLSTREAK_DEFS[streakId];
    player.readyStreak = null;
    player.send({ t: 'S_STREAK_UPDATE', streakCount: player.killStreak, readyStreak: null });

    const teamMode = isTeamMode(this.match.config);
    const eyePos: Vec3 = {
      x: player.phys.x,
      y: player.phys.y + 1.5,
      z: player.phys.z,
    };

    if (streakId === 'uav') {
      const targetIds: string[] = [];
      for (const other of this.players.values()) {
        if (!other.alive || other.id === player.id) continue;
        if (teamMode && player.team !== 'NONE' && other.team === player.team) continue;
        targetIds.push(other.id);
      }
      const expiresAt = this.simTimeMs + def.durationSec * 1000;
      for (const ally of this.players.values()) {
        if (ally.id === player.id || (teamMode && ally.team === player.team && player.team !== 'NONE')) {
          ally.send({ t: 'S_RECON_PING', targetIds, expiresAt });
        }
      }
      this.broadcast({ t: 'S_ABILITY_FX', fxType: 'recon_pulse', playerId: player.id, origin: eyePos });
    } else if (streakId === 'overdrive') {
      player.hp = player.maxHp;
      player.ammo[player.weapon] = WEAPON_DEFS[player.weapon].magSize;
      player.reloadingUntil = 0;
      player.overdriveTimer = def.durationSec;
      player.phys.stimTimer = Math.max(player.phys.stimTimer, def.durationSec);
      this.broadcast({ t: 'S_ABILITY_FX', fxType: 'stim', playerId: player.id, origin: eyePos });
    } else if (streakId === 'emp_strike') {
      // Destroy all enemy tactical walls
      for (let i = this.deployables.walls.length - 1; i >= 0; i--) {
        const w = this.deployables.walls[i];
        if (!teamMode || player.team === 'NONE' || w.team !== player.team) {
          this.deployables.damageWall(w.id, 9999, 'impulse');
        }
      }
      // Strip enemy cloaks, reveal 6s, and blast shockwave 18m ahead
      const fwdX = -Math.sin(yaw);
      const fwdZ = -Math.cos(yaw);
      const blastCenter: Vec3 = {
        x: player.phys.x + fwdX * 6,
        y: player.phys.y + 0.8,
        z: player.phys.z + fwdZ * 6,
      };
      const targetIds: string[] = [];
      for (const other of this.players.values()) {
        if (!other.alive || other.id === player.id) continue;
        if (teamMode && player.team !== 'NONE' && other.team === player.team) continue;
        other.cloakTimer = 0;
        targetIds.push(other.id);
        const dSq = distSqVec3(blastCenter, { x: other.phys.x, y: other.phys.y + 0.8, z: other.phys.z });
        if (dSq <= 18 * 18) {
          other.phys.vx += fwdX * 10;
          other.phys.vz += fwdZ * 10;
          other.phys.vy = Math.max(other.phys.vy, 6.0);
          other.phys.grounded = false;
          this.applyDamage(other, player.id, 35, false, blastCenter, 'impulse');
        }
      }
      const expiresAt = this.simTimeMs + def.durationSec * 1000;
      for (const ally of this.players.values()) {
        if (ally.id === player.id || (teamMode && ally.team === player.team && player.team !== 'NONE')) {
          ally.send({ t: 'S_RECON_PING', targetIds, expiresAt });
        }
      }
      this.broadcast({ t: 'S_ABILITY_FX', fxType: 'impulse_explode', playerId: player.id, origin: blastCenter });
    }

    this.broadcast({
      t: 'S_STREAK_BANNER',
      playerName: player.name,
      streakId,
      streakCount: player.killStreak,
    });
    return true;
  }

  private applyDamage(
    victim: ServerPlayer,
    attackerId: string,
    damage: number,
    headshot: boolean,
    sourcePos: Vec3,
    weapon: WeaponId | 'impulse'
  ): void {
    if (!victim.alive || damage <= 0) return;

    // Taking damage breaks Ghost optical cloak
    if (victim.cloakTimer > 0) victim.cloakTimer = 0;

    victim.hp = Math.max(0, victim.hp - damage);
    const attacker = this.players.get(attackerId);
    const killed = victim.hp === 0;

    if (attacker) {
      attacker.send({
        t: 'S_HIT_CONFIRM',
        targetId: victim.id,
        damage,
        headshot,
        killed,
      });
    }

    victim.send({
      t: 'S_DAMAGE',
      victimId: victim.id,
      attackerId,
      damage,
      fromPos: sourcePos,
    });

    if (!killed) return;

    victim.alive = false;
    victim.deaths += 1;
    victim.adsActive = false;
    victim.killStreak = 0;
    victim.readyStreak = null;
    victim.overdriveTimer = 0;
    victim.send({ t: 'S_STREAK_UPDATE', streakCount: 0, readyStreak: null });

    const respawnDelay =
      this.match.config.gameMode === 'ffa' || this.match.config.gameMode === 'gungame'
        ? FFA_RESPAWN_DELAY_MS
        : RESPAWN_DELAY_MS;
    victim.respawnAt = this.simTimeMs + respawnDelay;

    if (attacker && attacker.id !== victim.id) {
      attacker.kills += 1;
      attacker.killStreak += 1;
      const unlocked = getStreakForKills(attacker.killStreak);
      if (unlocked) {
        attacker.readyStreak = unlocked;
      }
      attacker.send({
        t: 'S_STREAK_UPDATE',
        streakCount: attacker.killStreak,
        readyStreak: attacker.readyStreak,
      });
      if (this.match.config.gameMode === 'tdm') {
        if (attacker.team === 'A') this.match.scoreA += 1;
        else if (attacker.team === 'B') this.match.scoreB += 1;
      }
    }

    if (this.match.config.gameMode === 'snd') {
      // Assign spectator target to alive teammate
      const teammate = Array.from(this.players.values()).find(
        (p) => p.alive && p.team === victim.team && p.id !== victim.id
      );
      victim.spectatingId = teammate?.id ?? null;
    }

    this.objectives.onPlayerKill(attacker, victim, weapon, this.match.config);
    this.broadcast({
      t: 'S_KILL',
      victimId: victim.id,
      attackerId,
      weapon,
      headshot,
    });
  }

  /**
   * Advances the entire authoritative simulation by dt seconds (frozen during Idle Sleep & PAUSED).
   */
  public stepSimulation(dt: number): void {
    if (this.players.size === 0 || this.match.phase === 'PAUSED') {
      return;
    }

    this.simTimeMs += dt * 1000;

    // 1. Sectors & Deployables
    this.sectors.update(this.simTimeMs, this.match.activeRing);
    this.deployables.update(this.simTimeMs);

    // 2. Players physics, timers, reloads & respawns
    for (const p of this.players.values()) {
      if (p.cdE > 0) p.cdE = Math.max(0, p.cdE - dt);
      if (p.cdQ > 0) p.cdQ = Math.max(0, p.cdQ - dt);
      if (p.cloakTimer > 0) p.cloakTimer = Math.max(0, p.cloakTimer - dt);
      if (p.overdriveTimer > 0) {
        p.overdriveTimer = Math.max(0, p.overdriveTimer - dt);
        p.phys.stimTimer = Math.max(p.phys.stimTimer, p.overdriveTimer);
      }

      if (!p.alive) {
        p.inputQueue = [];
        if (
          this.match.phase === 'IN_PROGRESS' &&
          this.match.config.gameMode !== 'snd' &&
          this.simTimeMs >= p.respawnAt
        ) {
          this.respawnPlayer(p);
        }
        continue;
      }

      if (p.reloadingUntil > 0 && this.simTimeMs >= p.reloadingUntil) {
        p.ammo[p.weapon] = WEAPON_DEFS[p.weapon].magSize;
        p.reloadingUntil = 0;
      }

      if (this.match.phase === 'COUNTDOWN' || this.match.phase === 'ODD_VOTE') {
        p.inputQueue = [];
        continue;
      }

      const queued = p.inputQueue.shift();
      if (queued) {
        p.yaw = queued.yaw;
        p.pitch = queued.pitch;
        p.lastInputKeys = queued.keys;
        p.adsActive = Boolean(queued.keys & KEY_ADS);
        p.interacting = Boolean(queued.keys & KEY_INTERACT);
        if (this.match.config.gameMode !== 'gungame' && isValidWeaponId(queued.weapon)) {
          p.weapon = queued.weapon;
        }
      }

      const cols = querySectorColliders(
        p.phys.x,
        p.phys.z,
        2.5 * this.admin.modifiers.playerScale,
        this.sectors.grid,
        this.deployables.walls,
        this.match.activeRing,
        this.simTimeMs
      );
      stepPlayerPhysics(
        p.phys,
        { keys: p.lastInputKeys, yaw: p.yaw },
        cols,
        this.match.activeRing,
        this.admin.modifiers,
        CLASS_DEFS[p.classId],
        dt
      );
      if (queued) {
        p.lastAckSeq = queued.seq;
      }
      if (p.classId === 'assault') {
        p.cdE = Math.max(p.cdE, p.phys.dashCooldown);
        p.phys.dashCooldown = p.cdE;
      }
    }

    // 3. Projectiles
    this.projectiles.update(
      dt,
      this.simTimeMs,
      this.players,
      this.sectors.grid,
      this.deployables,
      this.match.activeRing,
      this.admin.modifiers,
      isTeamMode(this.match.config)
    );

    // 4. History Buffer for Lag Compensation
    this.history.record(this.simTimeMs, this.players.values());

    // 5. Match & Mode Objectives
    const matchJustTransitioned = this.match.update(this.simTimeMs, this.players);
    if (matchJustTransitioned && this.match.phase === 'IN_PROGRESS') {
      this.objectives.resetForMatch(
        this.match.config,
        this.match.activeRing,
        this.simTimeMs,
        this.players.values()
      );
    }

    if (this.match.phase === 'IN_PROGRESS') {
      const scores = { scoreA: this.match.scoreA, scoreB: this.match.scoreB };
      const objRes = this.objectives.tick(
        dt,
        this.simTimeMs,
        this.players,
        this.match.config,
        this.match.activeRing,
        scores
      );
      this.match.scoreA = scores.scoreA;
      this.match.scoreB = scores.scoreB;

      if (objRes.subRoundWinner && this.match.config.gameMode === 'snd') {
        if (objRes.subRoundWinner === 'A') this.match.scoreA += 1;
        else this.match.scoreB += 1;

        const needed = Math.ceil(this.objectives.sndMaxRounds / 2);
        if (this.match.scoreA >= needed) {
          this.match.endRound('A', this.simTimeMs);
        } else if (this.match.scoreB >= needed) {
          this.match.endRound('B', this.simTimeMs);
        } else {
          const nextSub = this.objectives.sndSubRound + 1;
          const switchPoint = Math.ceil(this.objectives.sndMaxRounds / 2);
          const nextAttacker: 'A' | 'B' =
            nextSub > switchPoint ? 'B' : 'A';
          this.objectives.setupSndSubRound(nextSub, nextAttacker, this.match.activeRing);
          this.deployables.clearAll();
          this.projectiles.clear();
          for (const p of this.players.values()) this.respawnPlayer(p);
          this.broadcastMatchState();
        }
      } else if (objRes.roundWinner) {
        this.match.endRound(objRes.roundWinner, this.simTimeMs);
      }

      if (objRes.dirtySnapshot || this.simTimeMs - this.lastObjectiveSyncMs >= 250) {
        this.lastObjectiveSyncMs = this.simTimeMs;
        this.broadcast({
          t: 'S_OBJECTIVE_UPDATE',
          objective: this.objectives.getSnapshot(this.players.values()),
        });
      }
    }
  }

  public buildSnapshotFor(recipient: ServerPlayer): {
    st: number;
    ack: number;
    players: PlayerSnapshotTuple[];
    scoreA: number;
    scoreB: number;
  } {
    const tuples: PlayerSnapshotTuple[] = [];
    for (const p of this.players.values()) {
      let flags = 0;
      if (p.phys.grounded) flags |= FLAG_GROUNDED;
      if (p.phys.sliding) flags |= FLAG_SLIDING;
      if (p.phys.crouching) flags |= FLAG_CROUCHING;
      if (p.alive) flags |= FLAG_ALIVE;
      if (p.cloakTimer > 0) flags |= FLAG_CLOAKED;
      if (p.phys.stimTimer > 0) flags |= FLAG_STIM;
      if (p.spectatingId) flags |= FLAG_SPECTATING;
      if (p.interacting) flags |= FLAG_PLANT_DEFUSE;
      if (p.adsActive) flags |= FLAG_ADS;
      if (p.phys.dashing) flags |= FLAG_DASHING;
      if (p.phys.sprinting) flags |= FLAG_SPRINTING;
      flags |= (CLASS_TO_INDEX[p.classId] & 0x3) << FLAG_CLASS_SHIFT;

      tuples.push([
        p.id,
        Number(p.phys.x.toFixed(3)),
        Number(p.phys.y.toFixed(3)),
        Number(p.phys.z.toFixed(3)),
        Number(p.phys.vx.toFixed(2)),
        Number(p.phys.vy.toFixed(2)),
        Number(p.phys.vz.toFixed(2)),
        Number(p.yaw.toFixed(3)),
        Number(p.pitch.toFixed(3)),
        flags,
        p.hp,
        p.weapon,
        Number(p.cdE.toFixed(2)),
        Number(p.cdQ.toFixed(2)),
        Number(p.phys.slideCooldown.toFixed(2)),
      ]);
    }

    return {
      st: Math.round(this.simTimeMs),
      ack: recipient.lastAckSeq,
      players: tuples,
      scoreA: this.match.scoreA,
      scoreB: this.match.scoreB,
    };
  }

  public broadcastSnapshot(): void {
    for (const p of this.players.values()) {
      const snap = this.buildSnapshotFor(p);
      p.send({ t: 'S_SNAPSHOT', ...snap });
    }
  }
}
