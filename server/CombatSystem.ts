import { CLASS_DEFS } from '../shared/classes.js';
import {
  collectAllActiveColliders,
  getPlayerCombatHitboxes,
  raycastAABB,
  raycastColliders,
} from '../shared/collision.js';
import type { RoomModifiers } from '../shared/modifiers.js';
import { normalizeVec3, type Vec3 } from '../shared/projectiles.js';
import type { SectorState } from '../shared/sectors.js';
import {
  WEAPON_DEFS,
  computeDamageFalloff,
  getPelletDirections,
  type WeaponId,
} from '../shared/weapons.js';
import type { DeployableManager } from './DeployableManager.js';
import type { HistoryBuffer } from './HistoryBuffer.js';
import type { ProjectileSystem } from './ProjectileSystem.js';
import type { ServerPlayer } from './types.js';

export interface CombatEvents {
  onShotEvent?: (shooterId: string, weapon: WeaponId, origin: Vec3, hitPosList: Vec3[]) => void;
  onPlayerDamaged?: (
    victim: ServerPlayer,
    attackerId: string,
    damage: number,
    headshot: boolean,
    sourcePos: Vec3,
    weapon: WeaponId
  ) => void;
}

export class CombatSystem {
  private events: CombatEvents;

  constructor(events: CombatEvents = {}) {
    this.events = events;
  }

  public setEvents(events: CombatEvents): void {
    this.events = events;
  }

  public handleFire(
    shooter: ServerPlayer,
    origin: Vec3,
    dir: Vec3,
    weaponId: WeaponId,
    clientTime: number,
    simTimeMs: number,
    players: Map<string, ServerPlayer>,
    sectors: Map<string, SectorState>,
    deployables: DeployableManager,
    projectiles: ProjectileSystem,
    history: HistoryBuffer,
    activeRing: number,
    modifiers: RoomModifiers,
    isTeamMode: boolean
  ): boolean {
    if (!shooter.alive) return false;
    if (shooter.weapon !== weaponId) return false;
    if (simTimeMs < shooter.reloadingUntil) return false;
    if (simTimeMs < shooter.nextFireAt) return false;

    const def = WEAPON_DEFS[weaponId];
    const classDef = CLASS_DEFS[shooter.classId];

    if (!modifiers.infiniteAmmo) {
      if (shooter.ammo[weaponId] <= 0) return false;
      shooter.ammo[weaponId] -= 1;
    }

    const intervalMs = 60_000 / (def.rpm * classDef.fireRateMult);
    shooter.nextFireAt = simTimeMs + intervalMs;
    shooter.lastShotTime = simTimeMs;

    // Shooting immediately breaks Ghost optical cloak
    if (shooter.cloakTimer > 0) {
      shooter.cloakTimer = 0;
    }

    const normDir = normalizeVec3(dir);
    // Clamp origin near shooter's eye position to prevent spoofed shoot-through-wall origins
    const eyeH = (shooter.phys.crouching || shooter.phys.sliding ? 0.85 : 1.62) * modifiers.playerScale;
    const expectedEye: Vec3 = {
      x: shooter.phys.x,
      y: shooter.phys.y + eyeH,
      z: shooter.phys.z,
    };
    const dx = origin.x - expectedEye.x;
    const dy = origin.y - expectedEye.y;
    const dz = origin.z - expectedEye.z;
    const safeOrigin: Vec3 =
      dx * dx + dy * dy + dz * dz > 2.25 * modifiers.playerScale * modifiers.playerScale
        ? expectedEye
        : origin;

    if (def.isProjectile) {
      projectiles.spawn('kunai', shooter, safeOrigin, normDir, modifiers, simTimeMs);
      this.events.onShotEvent?.(shooter.id, weaponId, safeOrigin, []);
      return true;
    }

    // Hitscan with lag compensation rewind
    const sample = history.sampleAt(clientTime, simTimeMs);
    const evalSimTime = sample ? sample.effectiveSimTimeMs : simTimeMs;
    const worldCols = collectAllActiveColliders(
      sectors,
      deployables.walls,
      activeRing,
      evalSimTime
    );

    const rays = getPelletDirections(normDir, weaponId);
    const hitPosList: Vec3[] = [];
    const damageAccumulator = new Map<string, { player: ServerPlayer; damage: number; headshot: boolean }>();
    const wallDamageAccumulator = new Map<string, number>();

    for (const rayDir of rays) {
      const worldHit = raycastColliders(safeOrigin, rayDir, def.range, worldCols);
      let maxT = worldHit ? worldHit.t : def.range;
      let endPoint: Vec3 = worldHit
        ? worldHit.point
        : {
            x: safeOrigin.x + rayDir.x * def.range,
            y: safeOrigin.y + rayDir.y * def.range,
            z: safeOrigin.z + rayDir.z * def.range,
          };

      let hitPlayer: ServerPlayer | null = null;
      let hitHead = false;
      let hitDist = maxT;

      for (const target of players.values()) {
        if (!target.alive || target.id === shooter.id) continue;
        if (isTeamMode && shooter.team !== 'NONE' && target.team === shooter.team) continue;

        const sampledPose = sample?.poses.get(target.id);
        const tx = sampledPose ? sampledPose.x : target.phys.x;
        const ty = sampledPose ? sampledPose.y : target.phys.y;
        const tz = sampledPose ? sampledPose.z : target.phys.z;
        const tCrouched = sampledPose
          ? sampledPose.crouched
          : target.phys.crouching || target.phys.sliding;

        const hb = getPlayerCombatHitboxes(tx, ty, tz, tCrouched, modifiers.playerScale);

        const hHit = raycastAABB(safeOrigin, rayDir, maxT, hb.head);
        if (hHit && hHit.t < maxT) {
          maxT = hHit.t;
          hitDist = hHit.t;
          endPoint = hHit.point;
          hitPlayer = target;
          hitHead = true;
        }

        const bHit = raycastAABB(safeOrigin, rayDir, maxT, hb.body);
        if (bHit && bHit.t < maxT) {
          maxT = bHit.t;
          hitDist = bHit.t;
          endPoint = bHit.point;
          hitPlayer = target;
          hitHead = false;
        }
      }

      hitPosList.push(endPoint);

      if (hitPlayer) {
        const base = hitHead ? def.headDamage : def.bodyDamage;
        const mult = computeDamageFalloff(weaponId, hitDist);
        const dmg = Math.max(1, Math.round(base * mult));
        const prev = damageAccumulator.get(hitPlayer.id);
        if (prev) {
          prev.damage += dmg;
          prev.headshot = prev.headshot || hitHead;
        } else {
          damageAccumulator.set(hitPlayer.id, { player: hitPlayer, damage: dmg, headshot: hitHead });
        }
      } else if (worldHit?.box.wallId) {
        const wallDmg = Math.max(1, Math.round(def.bodyDamage * def.wallDamageMult));
        wallDamageAccumulator.set(
          worldHit.box.wallId,
          (wallDamageAccumulator.get(worldHit.box.wallId) ?? 0) + wallDmg
        );
      }
    }

    this.events.onShotEvent?.(shooter.id, weaponId, safeOrigin, hitPosList);

    for (const [wallId, dmg] of wallDamageAccumulator) {
      deployables.damageWall(wallId, dmg, 'damage');
    }

    for (const entry of damageAccumulator.values()) {
      this.events.onPlayerDamaged?.(
        entry.player,
        shooter.id,
        entry.damage,
        entry.headshot,
        safeOrigin,
        weaponId
      );
    }

    return true;
  }
}
