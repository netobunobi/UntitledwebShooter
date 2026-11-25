import type { ClassId } from '../shared/classes.js';
import type { KillstreakId } from '../shared/killstreaks.js';
import type { PlayerPhysState } from '../shared/physics.js';
import type { AdminRole, ServerMessage, TeamId } from '../shared/protocol.js';
import type { WeaponId } from '../shared/weapons.js';

export interface QueuedInput {
  seq: number;
  keys: number;
  yaw: number;
  pitch: number;
  weapon: WeaponId;
}

export interface ServerPlayer {
  id: string;
  name: string;
  team: TeamId;
  classId: ClassId;
  pendingClassId: ClassId | null;
  adminRole: AdminRole;
  phys: PlayerPhysState;
  yaw: number;
  pitch: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnAt: number;
  spectatingId: string | null;
  weapon: WeaponId;
  ammo: Record<WeaponId, number>;
  reloadingUntil: number;
  nextFireAt: number;
  lastShotIdx: number;
  lastShotTime: number;
  cdE: number;
  cdQ: number;
  cloakTimer: number;
  adsActive: boolean;
  interacting: boolean;
  lastAckSeq: number;
  gunGameLevel: number;
  kills: number;
  deaths: number;
  killStreak: number;
  readyStreak: KillstreakId | null;
  overdriveTimer: number;
  lastInputKeys: number;
  inputQueue: QueuedInput[];
  ip: string;
  send: (msg: ServerMessage) => void;
  disconnect: (reason?: string) => void;
}
