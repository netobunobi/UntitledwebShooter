import { CLASS_DEFS } from '../shared/classes.js';
import {
  collectAllActiveColliders,
  getArenaHalfExtent,
  getPlayerCombatHitboxes,
  segmentRaycastAABB,
  type AABB,
} from '../shared/collision.js';
import type { RoomModifiers } from '../shared/modifiers.js';
import {
  distSqVec3,
  stepProjectile,
  type ProjectileKind,
  type Vec3,
} from '../shared/projectiles.js';
import type { TeamId } from '../shared/protocol.js';
import type { SectorState } from '../shared/sectors.js';
import { WEAPON_DEFS } from '../shared/weapons.js';
import type { DeployableManager } from './DeployableManager.js';
import type { ServerPlayer } from './types.js';

export interface ActiveProjectile {
  id: string;
  kind: ProjectileKind;
  shooterId: string;
  team: TeamId;
  pos: Vec3;
  vel: Vec3;
  gravity: number;
  spawnedAt: number;
  expiresAt: number;
  damageMult: number;
}

export interface ProjectileEvents {
  onSpawn?: (proj: ActiveProjectile) => void;
  onHit?: (
    proj: ActiveProjectile,
    hitPos: Vec3,
    hitType: 'world' | 'player' | 'wall' | 'expire'
  ) => void;
  onPlayerDamaged?: (
    victim: ServerPlayer,
    attackerId: string,
    damage: number,
    headshot: boolean,
    sourcePos: Vec3,
    weapon: 5 | 'impulse'
  ) => void;
  onImpulseExplode?: (center: Vec3, shooterId: string) => void;
}

export class ProjectileSystem {
  public active: ActiveProjectile[] = [];
  private nextId = 1;
  private events: ProjectileEvents;

  constructor(events: ProjectileEvents = {}) {
    this.events = events;
  }

  public setEvents(events: ProjectileEvents): void {
    this.events = events;
  }

  public clear(): void {
    this.active = [];
  }

  public spawn(
    kind: ProjectileKind,
    shooter: ServerPlayer,
    origin: Vec3,
    dir: Vec3,
    modifiers: RoomModifiers,
    simTimeMs: number
  ): ActiveProjectile {
    let speed = WEAPON_DEFS[5].projectileSpeed;
    let baseGrav = WEAPON_DEFS[5].projectileGravity;
    let lifeMs = 3_000;
    let damageMult = 1.0;

    if (kind === 'kunai') {
      damageMult = CLASS_DEFS[shooter.classId].kunaiDamageMult;
    } else if (kind === 'impulse_grenade') {
      speed = CLASS_DEFS.vanguard.abilityE.grenadeSpeed ?? 26.0;
      baseGrav = CLASS_DEFS.vanguard.abilityE.grenadeGravity ?? -18.0;
      lifeMs = 2_500;
    } else if (kind === 'smoke_bomb') {
      speed = CLASS_DEFS.ninja.abilityQ.smokeThrowSpeed ?? 24.0;
      baseGrav = CLASS_DEFS.ninja.abilityQ.smokeGravity ?? -18.0;
      lifeMs = 1_600;
    }

    const gravity = baseGrav * modifiers.gravityMultiplier;
    const proj: ActiveProjectile = {
      id: `pr${this.nextId++}`,
      kind,
      shooterId: shooter.id,
      team: shooter.team,
      pos: { ...origin },
      vel: { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed },
      gravity,
      spawnedAt: simTimeMs,
      expiresAt: simTimeMs + lifeMs,
      damageMult,
    };

    this.active.push(proj);
    this.events.onSpawn?.(proj);
    return proj;
  }

  private detonateImpulseGrenade(
    proj: ActiveProjectile,
    center: Vec3,
    players: Map<string, ServerPlayer>,
    deployables: DeployableManager,
    isTeamMode: boolean
  ): void {
    const spec = CLASS_DEFS.vanguard.abilityE;
    const radius = spec.grenadeRadius ?? 5.5;
    const pushH = spec.impulseHoriz ?? 12.5;
    const pushV = spec.impulseVert ?? 6.5;
    const wallDmg = spec.wallDamage ?? 300;
    const playerDmg = spec.playerDamage ?? 20;

    deployables.damageWallsInRadius(center, radius, wallDmg);
    this.events.onImpulseExplode?.(center, proj.shooterId);

    const rSq = radius * radius;
    for (const p of players.values()) {
      if (!p.alive) continue;
      const pCenter: Vec3 = { x: p.phys.x, y: p.phys.y + 0.9, z: p.phys.z };
      const dSq = distSqVec3(center, pCenter);
      if (dSq > rSq) continue;

      const dist = Math.sqrt(dSq);
      const falloff = Math.max(0.25, 1 - dist / radius);
      const dx = pCenter.x - center.x;
      const dz = pCenter.z - center.z;
      const hLen = Math.hypot(dx, dz);
      const nx = hLen > 1e-4 ? dx / hLen : 0;
      const nz = hLen > 1e-4 ? dz / hLen : 0;

      p.phys.vx += nx * pushH * falloff;
      p.phys.vz += nz * pushH * falloff;
      p.phys.vy = Math.max(p.phys.vy, pushV * falloff);
      p.phys.grounded = false;

      const isEnemy =
        p.id !== proj.shooterId && (!isTeamMode || proj.team === 'NONE' || p.team !== proj.team);
      if (isEnemy) {
        this.events.onPlayerDamaged?.(
          p,
          proj.shooterId,
          Math.round(playerDmg * falloff),
          false,
          center,
          'impulse'
        );
      }
    }
  }

  public update(
    dt: number,
    simTimeMs: number,
    players: Map<string, ServerPlayer>,
    sectors: Map<string, SectorState>,
    deployables: DeployableManager,
    activeRing: number,
    modifiers: RoomModifiers,
    isTeamMode: boolean
  ): void {
    if (this.active.length === 0) return;

    const colliders: AABB[] = collectAllActiveColliders(
      sectors,
      deployables.walls,
      activeRing,
      simTimeMs
    );
    const ext = getArenaHalfExtent(activeRing);

    for (let i = this.active.length - 1; i >= 0; i--) {
      const proj = this.active[i];
      if (simTimeMs >= proj.expiresAt) {
        if (proj.kind === 'smoke_bomb') {
          deployables.spawnSmoke(proj.shooterId, proj.pos, simTimeMs);
        } else if (proj.kind === 'impulse_grenade') {
          this.detonateImpulseGrenade(proj, proj.pos, players, deployables, isTeamMode);
        }
        this.events.onHit?.(proj, proj.pos, 'expire');
        this.active.splice(i, 1);
        continue;
      }

      const prevPos = { ...proj.pos };
      const stepped = stepProjectile(proj.pos, proj.vel, proj.gravity, dt);
      const nextPos = stepped.pos;

      let bestFrac = 2;
      let hitPos: Vec3 = nextPos;
      let hitType: 'world' | 'player' | 'wall' | null = null;
      let hitWallId: string | null = null;
      let hitPlayer: ServerPlayer | null = null;
      let hitHead = false;

      // Ground plane collision
      if (nextPos.y <= 0 && prevPos.y >= 0) {
        const dy = prevPos.y - nextPos.y;
        const frac = dy > 1e-6 ? Math.max(0, Math.min(1, prevPos.y / dy)) : 0;
        if (frac < bestFrac) {
          bestFrac = frac;
          hitPos = {
            x: prevPos.x + (nextPos.x - prevPos.x) * frac,
            y: 0.02,
            z: prevPos.z + (nextPos.z - prevPos.z) * frac,
          };
          hitType = 'world';
        }
      }

      // Arena boundary check
      if (Math.abs(nextPos.x) >= ext || Math.abs(nextPos.z) >= ext) {
        bestFrac = Math.min(bestFrac, 0.5);
        hitPos = {
          x: Math.max(-ext, Math.min(ext, nextPos.x)),
          y: Math.max(0.05, nextPos.y),
          z: Math.max(-ext, Math.min(ext, nextPos.z)),
        };
        hitType = 'world';
      }

      // World & Tactical Wall AABBs
      for (const box of colliders) {
        const hit = segmentRaycastAABB(prevPos, nextPos, box);
        if (hit && hit.tFrac < bestFrac) {
          bestFrac = hit.tFrac;
          hitPos = hit.point;
          hitType = box.wallId ? 'wall' : 'world';
          hitWallId = box.wallId ?? null;
        }
      }

      // Enemy players (only kunai & impulse_grenade direct hit)
      if (proj.kind !== 'smoke_bomb') {
        for (const p of players.values()) {
          if (!p.alive || p.id === proj.shooterId) continue;
          if (isTeamMode && proj.team !== 'NONE' && p.team === proj.team) continue;

          const crouched = p.phys.crouching || p.phys.sliding;
          const hb = getPlayerCombatHitboxes(
            p.phys.x,
            p.phys.y,
            p.phys.z,
            crouched,
            modifiers.playerScale
          );

          const hHit = segmentRaycastAABB(prevPos, nextPos, hb.head);
          if (hHit && hHit.tFrac < bestFrac) {
            bestFrac = hHit.tFrac;
            hitPos = hHit.point;
            hitType = 'player';
            hitPlayer = p;
            hitHead = true;
          }

          const bHit = segmentRaycastAABB(prevPos, nextPos, hb.body);
          if (bHit && bHit.tFrac < bestFrac) {
            bestFrac = bHit.tFrac;
            hitPos = bHit.point;
            hitType = 'player';
            hitPlayer = p;
            hitHead = false;
          }
        }
      }

      if (hitType) {
        if (proj.kind === 'kunai') {
          if (hitType === 'player' && hitPlayer) {
            const base = hitHead ? WEAPON_DEFS[5].headDamage : WEAPON_DEFS[5].bodyDamage;
            const dmg = Math.round(base * proj.damageMult);
            this.events.onPlayerDamaged?.(hitPlayer, proj.shooterId, dmg, hitHead, prevPos, 5);
          } else if (hitType === 'wall' && hitWallId) {
            deployables.damageWall(hitWallId, WEAPON_DEFS[5].bodyDamage);
          }
        } else if (proj.kind === 'impulse_grenade') {
          this.detonateImpulseGrenade(proj, hitPos, players, deployables, isTeamMode);
        } else if (proj.kind === 'smoke_bomb') {
          deployables.spawnSmoke(proj.shooterId, hitPos, simTimeMs);
        }

        this.events.onHit?.(proj, hitPos, hitType);
        this.active.splice(i, 1);
      } else {
        proj.pos = nextPos;
        proj.vel = stepped.vel;
      }
    }
  }
}
