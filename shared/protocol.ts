import type { AABB } from './collision.js';
import type { ClassId } from './classes.js';
import type { GameModeId, MatchConfig } from './gamemodes.js';
import type { KillstreakId } from './killstreaks.js';
import type { RoomModifiers } from './modifiers.js';
import type { ProjectileKind, Vec3 } from './projectiles.js';
import type { SectorState } from './sectors.js';
import type { WeaponId } from './weapons.js';

export type TeamId = 'A' | 'B' | 'NONE';
export type AdminRole = 'none' | 'temp' | 'master';
export type MatchPhase =
  | 'WAITING_WARMUP'
  | 'TEAM_ASSIGNMENT'
  | 'ODD_VOTE'
  | 'COUNTDOWN'
  | 'IN_PROGRESS'
  | 'PAUSED'
  | 'ROUND_END';

export interface WallState {
  id: string;
  ownerId: string;
  team: TeamId;
  box: AABB;
  hp: number;
  maxHp: number;
  expiresAt: number;
}

export interface SmokeState {
  id: string;
  ownerId: string;
  pos: Vec3;
  radius: number;
  expiresAt: number;
}

export interface ObjectiveSnapshot {
  mode: GameModeId;
  snd?: {
    subRound: number;
    maxRounds: number;
    attackerTeam: 'A' | 'B';
    siteA: Vec3;
    siteB: Vec3;
    plantedSite: 'A' | 'B' | null;
    bombExplodesAt: number;
    plantProgress: number;
    defuseProgress: number;
  };
  hardpoint?: {
    zoneCenter: Vec3;
    nextCenter: Vec3 | null;
    rotatesAt: number;
    owner: 'A' | 'B' | 'CONTESTED' | 'NONE';
  };
  domination?: {
    zones: Array<{
      label: 'A' | 'B' | 'C';
      pos: Vec3;
      owner: 'A' | 'B' | 'NONE';
      captureProgress: number;
      capturingTeam: 'A' | 'B' | 'NONE';
    }>;
  };
  gungame?: {
    levels: Record<string, number>;
  };
}

export interface MapEvolutionSettings {
  autoEvolutionEnabled: boolean;
  speedMultiplier: 1 | 2 | 4;
}

export interface TempKeyInfo {
  code: string;
  mode: 'duration' | 'single_session';
  expiresAtMs: number | null;
  boundPlayerId: string | null;
  revoked: boolean;
}

// [id, x, y, z, vx, vy, vz, yaw, pitch, flags, hp, weapon, cdE, cdQ, slideCd]
export type PlayerSnapshotTuple = [
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  WeaponId,
  number,
  number,
  number
];

export type ClientMessage =
  | { t: 'C_JOIN'; name: string; classId?: ClassId }
  | { t: 'C_SELECT_CLASS'; classId: ClassId }
  | {
      t: 'C_INPUT';
      seq: number;
      dt: number;
      keys: number;
      yaw: number;
      pitch: number;
      weapon: WeaponId;
    }
  | {
      t: 'C_FIRE';
      seq: number;
      weapon: WeaponId;
      shotIdx: number;
      origin: Vec3;
      dir: Vec3;
      clientTime: number;
    }
  | { t: 'C_RELOAD'; weapon: WeaponId }
  | { t: 'C_ABILITY_ACTIVATE'; slot: 'E' | 'Q'; yaw: number; pitch: number }
  | { t: 'C_ACTIVATE_STREAK'; yaw: number; pitch: number }
  | { t: 'C_VOTE'; team: 'A' | 'B' }
  | { t: 'C_ADMIN_AUTH'; password: string }
  | { t: 'C_ADMIN_ACTION'; action: string; payload?: Record<string, unknown> }
  | { t: 'C_PING'; clientTime: number };

export type ServerMessage =
  | {
      t: 'S_WELCOME';
      id: string;
      team: TeamId;
      classId: ClassId;
      gameMode: GameModeId;
      matchConfig: MatchConfig;
      mapEvolution: MapEvolutionSettings;
      activeRing: number;
      matchPhase: MatchPhase;
      phaseEndsAt: number;
      isPaused: boolean;
      sectors: SectorState[];
      walls: WallState[];
      smokes: SmokeState[];
      objectives: ObjectiveSnapshot;
      modifiers: RoomModifiers;
      adminRole: AdminRole;
      players: Array<{ id: string; name: string; team: TeamId; classId: ClassId; kills: number; deaths: number }>;
      scoreA: number;
      scoreB: number;
      serverTime: number;
      tickRate: number;
    }
  | {
      t: 'S_SNAPSHOT';
      st: number;
      ack: number;
      players: PlayerSnapshotTuple[];
      scoreA: number;
      scoreB: number;
    }
  | { t: 'S_PLAYER_JOIN'; id: string; name: string; team: TeamId; classId: ClassId }
  | { t: 'S_PLAYER_LEAVE'; id: string }
  | { t: 'S_CLASS_UPDATE'; playerId: string; classId: ClassId; maxHp: number }
  | { t: 'S_SHOT_EVENT'; shooterId: string; weapon: WeaponId; origin: Vec3; hitPosList: Vec3[] }
  | {
      t: 'S_PROJ_SPAWN';
      projId: string;
      kind: ProjectileKind;
      shooterId: string;
      origin: Vec3;
      vel: Vec3;
      gravity: number;
      spawnedAt: number;
    }
  | {
      t: 'S_PROJ_HIT';
      projId: string;
      kind: ProjectileKind;
      hitPos: Vec3;
      hitType: 'world' | 'player' | 'wall' | 'expire';
    }
  | { t: 'S_ABILITY_FX'; fxType: string; playerId: string; origin: Vec3; targetPos?: Vec3 }
  | { t: 'S_RECON_PING'; targetIds: string[]; expiresAt: number }
  | { t: 'S_WALL_SPAWN'; wall: WallState }
  | { t: 'S_WALL_DAMAGE'; id: string; hp: number }
  | { t: 'S_WALL_DESTROY'; id: string; reason: 'damage' | 'expired' | 'replaced' | 'impulse' }
  | { t: 'S_SMOKE_SPAWN'; smoke: SmokeState }
  | { t: 'S_SMOKE_EXPIRE'; id: string }
  | { t: 'S_OBJECTIVE_UPDATE'; objective: ObjectiveSnapshot }
  | { t: 'S_HIT_CONFIRM'; targetId: string; damage: number; headshot: boolean; killed: boolean }
  | { t: 'S_DAMAGE'; victimId: string; attackerId: string; damage: number; fromPos: Vec3 }
  | { t: 'S_KILL'; victimId: string; attackerId: string; weapon: WeaponId | 'impulse'; headshot: boolean }
  | { t: 'S_RESPAWN'; playerId: string; spawnPos: Vec3; maxHp: number; weapon: WeaponId }
  | { t: 'S_SECTOR_WARNING'; sector: SectorState }
  | { t: 'S_SECTOR_UPDATE'; sector: SectorState; activeRing: number }
  | {
      t: 'S_MATCH_STATE';
      phase: MatchPhase;
      phaseEndsAt: number;
      isPaused: boolean;
      gameMode: GameModeId;
      matchConfig: MatchConfig;
      activeRing: number;
      scoreA: number;
      scoreB: number;
      teams: Record<string, TeamId>;
      winner?: string;
    }
  | { t: 'S_MAP_SETTINGS_UPDATE'; settings: MapEvolutionSettings }
  | { t: 'S_VOTE_START'; extraId: string; extraName: string; endsAt: number }
  | { t: 'S_VOTE_UPDATE'; votesA: number; votesB: number }
  | { t: 'S_VOTE_RESULT'; winnerTeam: 'A' | 'B'; extraId: string; coinFlip: boolean }
  | { t: 'S_MODIFIERS_UPDATE'; modifiers: RoomModifiers; changedBy: string }
  | { t: 'S_ADMIN_STATUS'; role: AdminRole; error?: string }
  | { t: 'S_ADMIN_KEYS'; keys: TempKeyInfo[] }
  | { t: 'S_STREAK_UPDATE'; streakCount: number; readyStreak: KillstreakId | null }
  | { t: 'S_STREAK_BANNER'; playerName: string; streakId: KillstreakId; streakCount: number }
  | { t: 'S_KICKED'; reason: string }
  | { t: 'S_PONG'; clientTime: number; serverTime: number };
