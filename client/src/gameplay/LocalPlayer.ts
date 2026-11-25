import { CLASS_DEFS, type ClassId } from '../../../shared/classes.js';
import { querySectorColliders } from '../../../shared/collision.js';
import {
  FIXED_DT,
  FLAG_ALIVE,
  FLAG_CLOAKED,
  FLAG_CROUCHING,
  FLAG_DASHING,
  FLAG_GROUNDED,
  FLAG_SLIDING,
  FLAG_STIM,
  KEY_FIRE,
} from '../../../shared/constants.js';
import { DEFAULT_MODIFIERS, type RoomModifiers } from '../../../shared/modifiers.js';
import {
  createInitialPhysState,
  stepPlayerPhysics,
  type PlayerPhysState,
} from '../../../shared/physics.js';
import { yawPitchToForward, type Vec3 } from '../../../shared/projectiles.js';
import type { PlayerSnapshotTuple, WallState } from '../../../shared/protocol.js';
import type { SectorState } from '../../../shared/sectors.js';
import { WEAPON_DEFS, getRecoilStep, type WeaponId } from '../../../shared/weapons.js';

interface PendingInput {
  seq: number;
  keys: number;
  yaw: number;
}

export class LocalPlayer {
  public id = '';
  public classId: ClassId = 'assault';
  public phys: PlayerPhysState = createInitialPhysState();
  public hp = 100;
  public maxHp = 100;
  public alive = true;
  public cloaked = false;
  public weapon: WeaponId = 0;
  public ammo: Record<WeaponId, number> = { 0: 30, 1: 28, 2: 6, 3: 6, 4: 5, 5: 8 };
  public reloadingUntil = 0;
  public cdE = 0;
  public cdQ = 0;

  // Deterministic recoil tracking
  public shotIdx = 0;
  public recoilPitchOffset = 0;
  public recoilYawOffset = 0;
  private nextFireSimMs = 0;
  private lastShotSimMs = 0;
  private prevFireHeld = false;

  private nextSeq = 1;
  private pendingInputs: PendingInput[] = [];

  public resetForSpawn(pos: Vec3, maxHp: number, weapon: WeaponId): void {
    this.phys = createInitialPhysState(pos.x, pos.y, pos.z);
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.alive = true;
    this.cloaked = false;
    this.weapon = weapon;
    this.ammo = {
      0: WEAPON_DEFS[0].magSize,
      1: WEAPON_DEFS[1].magSize,
      2: WEAPON_DEFS[2].magSize,
      3: WEAPON_DEFS[3].magSize,
      4: WEAPON_DEFS[4].magSize,
      5: WEAPON_DEFS[5].magSize,
    };
    this.reloadingUntil = 0;
    this.shotIdx = 0;
    this.recoilPitchOffset = 0;
    this.recoilYawOffset = 0;
    this.pendingInputs = [];
  }

  public predictTick(
    keys: number,
    yaw: number,
    pitch: number,
    weapon: WeaponId,
    sectors: Map<string, SectorState>,
    walls: WallState[],
    activeRing: number,
    modifiers: RoomModifiers,
    simTimeMs: number,
    canAct: boolean
  ): {
    seq: number;
    fired: { origin: Vec3; dir: Vec3; shotIdx: number; dpitch: number; dyaw: number } | null;
  } {
    const seq = this.nextSeq++;
    this.weapon = weapon;

    // Reload completion
    if (this.reloadingUntil > 0 && simTimeMs >= this.reloadingUntil) {
      this.ammo[this.weapon] = WEAPON_DEFS[this.weapon].magSize;
      this.reloadingUntil = 0;
    }

    // Recover recoil smoothly when not firing
    const def = WEAPON_DEFS[this.weapon];
    if (simTimeMs - this.lastShotSimMs > def.recoveryTimeSec * 1000) {
      this.shotIdx = 0;
      const rec = Math.min(1, FIXED_DT * 8);
      this.recoilPitchOffset *= 1 - rec;
      this.recoilYawOffset *= 1 - rec;
    }

    let fired: { origin: Vec3; dir: Vec3; shotIdx: number; dpitch: number; dyaw: number } | null = null;

    if (this.alive && canAct) {
      const cols = querySectorColliders(
        this.phys.x,
        this.phys.z,
        2.5 * modifiers.playerScale,
        sectors,
        walls,
        activeRing,
        simTimeMs
      );
      stepPlayerPhysics(
        this.phys,
        { keys, yaw },
        cols,
        activeRing,
        modifiers,
        CLASS_DEFS[this.classId],
        FIXED_DT
      );
      this.pendingInputs.push({ seq, keys, yaw });
      if (this.pendingInputs.length > 90) this.pendingInputs.shift();

      const fireHeld = Boolean(keys & KEY_FIRE);
      const wantShot = def.automatic ? fireHeld : fireHeld && !this.prevFireHeld;
      this.prevFireHeld = fireHeld;

      if (
        wantShot &&
        this.reloadingUntil <= 0 &&
        simTimeMs >= this.nextFireSimMs &&
        (this.ammo[this.weapon] > 0 || modifiers.infiniteAmmo)
      ) {
        if (!modifiers.infiniteAmmo) {
          this.ammo[this.weapon] -= 1;
        }
        const classDef = CLASS_DEFS[this.classId];
        this.nextFireSimMs = simTimeMs + 60_000 / (def.rpm * classDef.fireRateMult);
        this.lastShotSimMs = simTimeMs;

        const eyeH = (this.phys.crouching || this.phys.sliding ? 0.85 : 1.62) * modifiers.playerScale;
        const origin: Vec3 = {
          x: this.phys.x,
          y: this.phys.y + eyeH,
          z: this.phys.z,
        };
        const dir = yawPitchToForward(yaw + this.recoilYawOffset, pitch + this.recoilPitchOffset);
        const step = getRecoilStep(this.weapon, this.shotIdx, classDef.recoilMult);
        this.recoilPitchOffset = Math.min(0.45, this.recoilPitchOffset + step.dpitch);
        this.recoilYawOffset += step.dyaw;
        this.shotIdx = Math.min(def.recoilPattern.length - 1, this.shotIdx + 1);
        fired = { origin, dir, shotIdx: this.shotIdx, dpitch: step.dpitch, dyaw: step.dyaw };
      }
    } else {
      this.prevFireHeld = Boolean(keys & KEY_FIRE);
    }

    return { seq, fired };
  }

  public startReload(simTimeMs: number): boolean {
    const def = WEAPON_DEFS[this.weapon];
    if (!this.alive || this.reloadingUntil > 0 || this.ammo[this.weapon] >= def.magSize) {
      return false;
    }
    this.reloadingUntil =
      simTimeMs + (def.reloadTimeSec * 1000) / CLASS_DEFS[this.classId].reloadSpeedMult;
    return true;
  }

  public reconcileFromServer(
    tuple: PlayerSnapshotTuple,
    ackSeq: number,
    sectors: Map<string, SectorState>,
    walls: WallState[],
    activeRing: number,
    modifiers: RoomModifiers = DEFAULT_MODIFIERS,
    simTimeMs: number
  ): void {
    const [, sx, sy, sz, svx, svy, svz, , , flags, hp, , cdE, cdQ, slideCd] = tuple;
    this.hp = hp;
    this.alive = Boolean(flags & FLAG_ALIVE);
    this.cloaked = Boolean(flags & FLAG_CLOAKED);
    this.cdE = cdE;
    this.cdQ = cdQ;
    this.phys.slideCooldown = slideCd;
    if (flags & FLAG_STIM) {
      if (this.phys.stimTimer <= 0) this.phys.stimTimer = 0.2;
    } else {
      this.phys.stimTimer = 0;
    }

    // Discard acknowledged inputs
    while (this.pendingInputs.length > 0 && this.pendingInputs[0].seq <= ackSeq) {
      this.pendingInputs.shift();
    }

    if (!this.alive) {
      this.phys.x = sx;
      this.phys.y = sy;
      this.phys.z = sz;
      return;
    }

    // Replay unacknowledged pendingInputs on top of authoritative server state
    // so we compare against WHERE the player should be now, eliminating rubberbanding.
    const simPhys: PlayerPhysState = {
      ...this.phys,
      x: sx,
      y: sy,
      z: sz,
      vx: svx,
      vy: svy,
      vz: svz,
      grounded: Boolean(flags & FLAG_GROUNDED),
      sliding: Boolean(flags & FLAG_SLIDING),
      crouching: Boolean(flags & FLAG_CROUCHING),
      dashing: Boolean(flags & FLAG_DASHING),
      slideCooldown: slideCd,
      dashCooldown: cdE,
    };

    for (const inp of this.pendingInputs) {
      const cols = querySectorColliders(
        simPhys.x,
        simPhys.z,
        2.5 * modifiers.playerScale,
        sectors,
        walls,
        activeRing,
        simTimeMs
      );
      stepPlayerPhysics(
        simPhys,
        { keys: inp.keys, yaw: inp.yaw },
        cols,
        activeRing,
        modifiers,
        CLASS_DEFS[this.classId],
        FIXED_DT
      );
    }

    const err = Math.hypot(this.phys.x - simPhys.x, this.phys.y - simPhys.y, this.phys.z - simPhys.z);
    if (err < 0.08) return;

    if (err <= 1.5) {
      this.phys.x += (simPhys.x - this.phys.x) * 0.18;
      this.phys.y += (simPhys.y - this.phys.y) * 0.18;
      this.phys.z += (simPhys.z - this.phys.z) * 0.18;
      return;
    }

    // Large desync (>1.5m): snap cleanly to re-simulated authoritative state
    Object.assign(this.phys, simPhys);
  }
}
