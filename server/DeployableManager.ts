import { CLASS_DEFS } from '../shared/classes.js';
import { getArenaHalfExtent, raycastColliders, type AABB } from '../shared/collision.js';
import { distSqVec3, type Vec3 } from '../shared/projectiles.js';
import type { SmokeState, TeamId, WallState } from '../shared/protocol.js';
import type { SectorState } from '../shared/sectors.js';
import { collectAllActiveColliders as collectWorldColliders } from '../shared/collision.js';

export interface DeployableEvents {
  onWallSpawn?: (wall: WallState) => void;
  onWallDamage?: (id: string, hp: number) => void;
  onWallDestroy?: (id: string, reason: 'damage' | 'expired' | 'replaced' | 'impulse') => void;
  onSmokeSpawn?: (smoke: SmokeState) => void;
  onSmokeExpire?: (id: string) => void;
}

export class DeployableManager {
  public walls: WallState[] = [];
  public smokes: SmokeState[] = [];
  private nextWallSeq = 1;
  private nextSmokeSeq = 1;
  private events: DeployableEvents;

  constructor(events: DeployableEvents = {}) {
    this.events = events;
  }

  public setEvents(events: DeployableEvents): void {
    this.events = events;
  }

  public clearAll(): void {
    for (const w of this.walls) {
      this.events.onWallDestroy?.(w.id, 'expired');
    }
    for (const s of this.smokes) {
      this.events.onSmokeExpire?.(s.id);
    }
    this.walls = [];
    this.smokes = [];
  }

  /**
   * Spawns a Vanguard Tactical Wall snapped to nearest cardinal axis (1 pure AABB)
   * resting cleanly on the ground or structure beneath the target position.
   */
  public spawnTacticalWall(
    ownerId: string,
    team: TeamId,
    playerPos: Vec3,
    yaw: number,
    sectors: Map<string, SectorState>,
    activeRing: number,
    simTimeMs: number
  ): WallState {
    // Enforce max 1 active wall per player
    const existingIdx = this.walls.findIndex((w) => w.ownerId === ownerId);
    if (existingIdx !== -1) {
      const removed = this.walls.splice(existingIdx, 1)[0];
      this.events.onWallDestroy?.(removed.id, 'replaced');
    }

    const qSpec = CLASS_DEFS.vanguard.abilityQ;
    const width = qSpec.wallWidth ?? 3.6;
    const height = qSpec.wallHeight ?? 2.2;
    const thickness = qSpec.wallThickness ?? 0.45;
    const dist = qSpec.wallDistance ?? 2.5;
    const hp = qSpec.wallHp ?? 250;
    const durMs = qSpec.durationSec * 1000;

    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);

    // Snap facing to nearest cardinal axis (Z-aligned or X-aligned) so box is 1 pure AABB
    const zAligned = Math.abs(fwdZ) >= Math.abs(fwdX);
    const halfX = zAligned ? width * 0.5 : thickness * 0.5;
    const halfZ = zAligned ? thickness * 0.5 : width * 0.5;

    const ext = getArenaHalfExtent(activeRing);
    const cx = Math.max(-ext + halfX + 0.1, Math.min(ext - halfX - 0.1, playerPos.x + fwdX * dist));
    const cz = Math.max(-ext + halfZ + 0.1, Math.min(ext - halfZ - 0.1, playerPos.z + fwdZ * dist));

    // Find floor/structure surface beneath placement center
    const worldCols = collectWorldColliders(sectors, [], activeRing, simTimeMs);
    const floorHit = raycastColliders(
      { x: cx, y: playerPos.y + 1.5, z: cz },
      { x: 0, y: -1, z: 0 },
      10,
      worldCols
    );
    const baseY = floorHit ? Math.max(0, floorHit.point.y) : 0;

    const box: AABB = {
      minX: cx - halfX,
      minY: baseY,
      minZ: cz - halfZ,
      maxX: cx + halfX,
      maxY: baseY + height,
      maxZ: cz + halfZ,
      kind: 'tactical_wall',
    };

    const wall: WallState = {
      id: `w${this.nextWallSeq++}`,
      ownerId,
      team,
      box,
      hp,
      maxHp: hp,
      expiresAt: simTimeMs + durMs,
    };
    box.wallId = wall.id;
    this.walls.push(wall);
    this.events.onWallSpawn?.(wall);
    return wall;
  }

  public damageWall(
    wallId: string,
    damage: number,
    reason: 'damage' | 'impulse' = 'damage'
  ): boolean {
    const idx = this.walls.findIndex((w) => w.id === wallId);
    if (idx === -1) return false;
    const wall = this.walls[idx];
    wall.hp = Math.max(0, wall.hp - damage);
    if (wall.hp <= 0) {
      this.walls.splice(idx, 1);
      this.events.onWallDestroy?.(wall.id, reason);
      return true;
    }
    this.events.onWallDamage?.(wall.id, wall.hp);
    return false;
  }

  public damageWallsInRadius(center: Vec3, radius: number, damage: number): void {
    const rSq = radius * radius;
    const toDamage: string[] = [];
    for (const w of this.walls) {
      const clX = Math.max(w.box.minX, Math.min(center.x, w.box.maxX));
      const clY = Math.max(w.box.minY, Math.min(center.y, w.box.maxY));
      const clZ = Math.max(w.box.minZ, Math.min(center.z, w.box.maxZ));
      if (distSqVec3(center, { x: clX, y: clY, z: clZ }) <= rSq) {
        toDamage.push(w.id);
      }
    }
    for (const id of toDamage) {
      this.damageWall(id, damage, 'impulse');
    }
  }

  public spawnSmoke(ownerId: string, pos: Vec3, simTimeMs: number): SmokeState {
    const qSpec = CLASS_DEFS.ninja.abilityQ;
    const smoke: SmokeState = {
      id: `sm${this.nextSmokeSeq++}`,
      ownerId,
      pos: { x: pos.x, y: Math.max(0.5, pos.y), z: pos.z },
      radius: qSpec.smokeRadius ?? 6.0,
      expiresAt: simTimeMs + qSpec.durationSec * 1000,
    };
    this.smokes.push(smoke);
    this.events.onSmokeSpawn?.(smoke);
    return smoke;
  }

  public isPointInSmoke(p: Vec3): boolean {
    for (const s of this.smokes) {
      if (distSqVec3(p, s.pos) <= s.radius * s.radius) {
        return true;
      }
    }
    return false;
  }

  public isSegmentBlockedBySmoke(p0: Vec3, p1: Vec3): boolean {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const dz = p1.z - p0.z;
    const lenSq = dx * dx + dy * dy + dz * dz;
    for (const s of this.smokes) {
      if (lenSq <= 1e-8) {
        if (distSqVec3(p0, s.pos) <= s.radius * s.radius) return true;
        continue;
      }
      const t = Math.max(
        0,
        Math.min(
          1,
          ((s.pos.x - p0.x) * dx + (s.pos.y - p0.y) * dy + (s.pos.z - p0.z) * dz) / lenSq
        )
      );
      const closest = { x: p0.x + dx * t, y: p0.y + dy * t, z: p0.z + dz * t };
      if (distSqVec3(closest, s.pos) <= s.radius * s.radius) {
        return true;
      }
    }
    return false;
  }

  public update(simTimeMs: number): void {
    for (let i = this.walls.length - 1; i >= 0; i--) {
      if (simTimeMs >= this.walls[i].expiresAt) {
        const w = this.walls.splice(i, 1)[0];
        this.events.onWallDestroy?.(w.id, 'expired');
      }
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      if (simTimeMs >= this.smokes[i].expiresAt) {
        const s = this.smokes.splice(i, 1)[0];
        this.events.onSmokeExpire?.(s.id);
      }
    }
  }
}
