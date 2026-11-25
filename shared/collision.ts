import {
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HALF_WIDTH,
  PLAYER_HEAD_HEIGHT,
  PLAYER_STAND_HEIGHT,
  SECTOR_SIZE,
} from './constants.js';
import type { Vec3 } from './projectiles.js';
import { getSectorStructureAABBs, sectorKey, type SectorState } from './sectors.js';

export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  vy?: number;
  wallId?: string;
  kind?: string;
}

export interface TacticalWallLike {
  id: string;
  box: AABB;
}

export function getPlayerAABB(
  x: number,
  y: number,
  z: number,
  crouched: boolean,
  playerScale = 1.0
): AABB {
  const halfW = PLAYER_HALF_WIDTH * playerScale;
  const height = (crouched ? PLAYER_CROUCH_HEIGHT : PLAYER_STAND_HEIGHT) * playerScale;
  return {
    minX: x - halfW,
    minY: y,
    minZ: z - halfW,
    maxX: x + halfW,
    maxY: y + height,
    maxZ: z + halfW,
  };
}

export function getPlayerCombatHitboxes(
  x: number,
  y: number,
  z: number,
  crouched: boolean,
  playerScale = 1.0
): { body: AABB; head: AABB } {
  const halfW = PLAYER_HALF_WIDTH * playerScale;
  const height = (crouched ? PLAYER_CROUCH_HEIGHT : PLAYER_STAND_HEIGHT) * playerScale;
  const headH = PLAYER_HEAD_HEIGHT * playerScale;
  const splitY = y + Math.max(0.2 * playerScale, height - headH);
  const headHalfW = halfW * 0.9;

  return {
    body: {
      minX: x - halfW,
      minY: y,
      minZ: z - halfW,
      maxX: x + halfW,
      maxY: splitY,
      maxZ: z + halfW,
    },
    head: {
      minX: x - headHalfW,
      minY: splitY,
      minZ: z - headHalfW,
      maxX: x + headHalfW,
      maxY: y + height,
      maxZ: z + headHalfW,
    },
  };
}

export function aabbIntersects(a: AABB, b: AABB, eps = 0): boolean {
  return (
    a.maxX > b.minX + eps &&
    a.minX < b.maxX - eps &&
    a.maxY > b.minY + eps &&
    a.minY < b.maxY - eps &&
    a.maxZ > b.minZ + eps &&
    a.minZ < b.maxZ - eps
  );
}

export function aabbOverlapDepth(a: AABB, b: AABB): number {
  const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const oy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  if (ox <= 0 || oy <= 0 || oz <= 0) return 0;
  return Math.min(ox, oy, oz);
}

export function getArenaHalfExtent(activeRing: number): number {
  return (activeRing + 0.5) * SECTOR_SIZE;
}

export function buildArenaBoundaryAABBs(activeRing: number): AABB[] {
  const ext = getArenaHalfExtent(activeRing);
  const t = 4;
  const h = 40;
  return [
    { minX: -ext - t, minY: -2, minZ: -ext - t, maxX: -ext, maxY: h, maxZ: ext + t, kind: 'boundary' },
    { minX: ext, minY: -2, minZ: -ext - t, maxX: ext + t, maxY: h, maxZ: ext + t, kind: 'boundary' },
    { minX: -ext - t, minY: -2, minZ: -ext - t, maxX: ext + t, maxY: h, maxZ: -ext, kind: 'boundary' },
    { minX: -ext - t, minY: -2, minZ: ext, maxX: ext + t, maxY: h, maxZ: ext + t, kind: 'boundary' },
  ];
}

export function querySectorColliders(
  x: number,
  z: number,
  halfExtent: number,
  sectors: Map<string, SectorState>,
  walls: readonly TacticalWallLike[],
  activeRing: number,
  simTimeMs: number
): AABB[] {
  const minGx = Math.max(-activeRing, Math.floor((x - halfExtent + SECTOR_SIZE * 0.5) / SECTOR_SIZE));
  const maxGx = Math.min(activeRing, Math.floor((x + halfExtent + SECTOR_SIZE * 0.5) / SECTOR_SIZE));
  const minGz = Math.max(-activeRing, Math.floor((z - halfExtent + SECTOR_SIZE * 0.5) / SECTOR_SIZE));
  const maxGz = Math.min(activeRing, Math.floor((z + halfExtent + SECTOR_SIZE * 0.5) / SECTOR_SIZE));

  const out: AABB[] = [];
  for (let gx = minGx; gx <= maxGx; gx++) {
    for (let gz = minGz; gz <= maxGz; gz++) {
      const s = sectors.get(sectorKey(gx, gz));
      if (!s) continue;
      const list = getSectorStructureAABBs(s, simTimeMs);
      for (const box of list) out.push(box);
    }
  }

  for (const w of walls) {
    if (
      w.box.maxX >= x - halfExtent &&
      w.box.minX <= x + halfExtent &&
      w.box.maxZ >= z - halfExtent &&
      w.box.minZ <= z + halfExtent
    ) {
      out.push({ ...w.box, wallId: w.id, kind: 'tactical_wall' });
    }
  }

  return out;
}

export function collectAllActiveColliders(
  sectors: Map<string, SectorState>,
  walls: readonly TacticalWallLike[],
  activeRing: number,
  simTimeMs: number
): AABB[] {
  const out: AABB[] = [];
  for (let gx = -activeRing; gx <= activeRing; gx++) {
    for (let gz = -activeRing; gz <= activeRing; gz++) {
      const s = sectors.get(sectorKey(gx, gz));
      if (!s) continue;
      for (const box of getSectorStructureAABBs(s, simTimeMs)) {
        out.push(box);
      }
    }
  }
  for (const w of walls) {
    out.push({ ...w.box, wallId: w.id, kind: 'tactical_wall' });
  }
  return out;
}

export interface RaycastHit {
  t: number;
  point: Vec3;
  normal: Vec3;
  box: AABB;
}

/**
 * Slab method ray-AABB intersection for t in [0, maxDist].
 */
export function raycastAABB(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  box: AABB
): RaycastHit | null {
  let tmin = 0;
  let tmax = maxDist;
  let hitNx = 0;
  let hitNy = 0;
  let hitNz = 0;

  // X slab
  if (Math.abs(dir.x) < 1e-8) {
    if (origin.x < box.minX || origin.x > box.maxX) return null;
  } else {
    const inv = 1 / dir.x;
    let t1 = (box.minX - origin.x) * inv;
    let t2 = (box.maxX - origin.x) * inv;
    let nx = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      nx = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      hitNx = nx;
      hitNy = 0;
      hitNz = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  // Y slab
  if (Math.abs(dir.y) < 1e-8) {
    if (origin.y < box.minY || origin.y > box.maxY) return null;
  } else {
    const inv = 1 / dir.y;
    let t1 = (box.minY - origin.y) * inv;
    let t2 = (box.maxY - origin.y) * inv;
    let ny = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      ny = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      hitNx = 0;
      hitNy = ny;
      hitNz = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  // Z slab
  if (Math.abs(dir.z) < 1e-8) {
    if (origin.z < box.minZ || origin.z > box.maxZ) return null;
  } else {
    const inv = 1 / dir.z;
    let t1 = (box.minZ - origin.z) * inv;
    let t2 = (box.maxZ - origin.z) * inv;
    let nz = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      nz = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      hitNx = 0;
      hitNy = 0;
      hitNz = nz;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  if (tmin < 0 || tmin > maxDist) return null;

  return {
    t: tmin,
    point: {
      x: origin.x + dir.x * tmin,
      y: origin.y + dir.y * tmin,
      z: origin.z + dir.z * tmin,
    },
    normal: { x: hitNx, y: hitNy, z: hitNz },
    box,
  };
}

export function segmentRaycastAABB(
  p0: Vec3,
  p1: Vec3,
  box: AABB
): { tFrac: number; point: Vec3; normal: Vec3; box: AABB } | null {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const dz = p1.z - p0.z;
  const len = Math.hypot(dx, dy, dz);
  if (len <= 1e-8) {
    if (
      p0.x >= box.minX &&
      p0.x <= box.maxX &&
      p0.y >= box.minY &&
      p0.y <= box.maxY &&
      p0.z >= box.minZ &&
      p0.z <= box.maxZ
    ) {
      return { tFrac: 0, point: { ...p0 }, normal: { x: 0, y: 1, z: 0 }, box };
    }
    return null;
  }
  const hit = raycastAABB(p0, { x: dx / len, y: dy / len, z: dz / len }, len, box);
  if (!hit) return null;
  return {
    tFrac: hit.t / len,
    point: hit.point,
    normal: hit.normal,
    box,
  };
}

export function raycastColliders(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  colliders: readonly AABB[]
): RaycastHit | null {
  let closest: RaycastHit | null = null;
  for (const box of colliders) {
    const hit = raycastAABB(origin, dir, closest ? closest.t : maxDist, box);
    if (hit && (!closest || hit.t < closest.t)) {
      closest = hit;
    }
  }
  return closest;
}

/**
 * Guarantees a player never remains trapped inside solid structures,
 * clamping XZ inside activeRing boundaries and popping Y cleanly above penetrating solids.
 */
export function ensureUnstuck(
  pos: Vec3,
  crouched: boolean,
  playerScale: number,
  colliders: readonly AABB[],
  activeRing: number
): Vec3 {
  const halfW = PLAYER_HALF_WIDTH * playerScale;
  const ext = getArenaHalfExtent(activeRing);
  let x = Math.max(-ext + halfW + 0.01, Math.min(ext - halfW - 0.01, pos.x));
  let y = Math.max(0, pos.y);
  let z = Math.max(-ext + halfW + 0.01, Math.min(ext - halfW - 0.01, pos.z));

  for (let pass = 0; pass < 4; pass++) {
    const pBox = getPlayerAABB(x, y, z, crouched, playerScale);
    let maxLiftY = y;
    let trapped = false;

    for (const box of colliders) {
      if (box.kind === 'boundary') continue;
      if (aabbOverlapDepth(pBox, box) > 0.015) {
        trapped = true;
        if (box.maxY + 0.001 > maxLiftY) {
          maxLiftY = box.maxY + 0.001;
        }
      }
    }

    if (!trapped) break;
    y = maxLiftY;
  }

  return { x, y, z };
}

/**
 * Validates Ninja Shadow Blink (up to maxDist = 10m) via swept AABB steps,
 * ensuring the player cannot teleport through walls, outside activeRing, or into low ceilings.
 */
export function computeBlinkDestination(
  origin: Vec3,
  dirX: number,
  dirZ: number,
  maxDist: number,
  crouched: boolean,
  playerScale: number,
  colliders: readonly AABB[],
  activeRing: number
): Vec3 {
  const len = Math.hypot(dirX, dirZ);
  const nx = len > 1e-5 ? dirX / len : 0;
  const nz = len > 1e-5 ? dirZ / len : -1;

  const halfW = PLAYER_HALF_WIDTH * playerScale;
  const ext = getArenaHalfExtent(activeRing) - halfW - 0.15;
  const stepSize = 0.25;
  const stepCount = Math.floor(maxDist / stepSize);
  const maxStepUp = 0.45 * playerScale;

  let bestX = origin.x;
  let bestY = origin.y;
  let bestZ = origin.z;

  for (let i = 1; i <= stepCount; i++) {
    const d = Math.min(maxDist, i * stepSize);
    const candX = origin.x + nx * d;
    const candZ = origin.z + nz * d;

    if (Math.abs(candX) > ext || Math.abs(candZ) > ext) {
      break;
    }

    const box = getPlayerAABB(candX, bestY, candZ, crouched, playerScale);
    let blocked = false;
    let highestObstacle = bestY;

    for (const c of colliders) {
      if (aabbIntersects(box, c, 0.002)) {
        if (c.maxY <= bestY + maxStepUp) {
          if (c.maxY > highestObstacle) highestObstacle = c.maxY;
        } else {
          blocked = true;
          break;
        }
      }
    }

    if (blocked) {
      break;
    }

    if (highestObstacle > bestY) {
      const liftedBox = getPlayerAABB(candX, highestObstacle + 0.001, candZ, crouched, playerScale);
      const liftBlocked = colliders.some(
        (c) => c.kind !== 'boundary' && aabbIntersects(liftedBox, c, 0.002)
      );
      if (liftBlocked) break;
      bestY = highestObstacle + 0.001;
    }

    bestX = candX;
    bestZ = candZ;
  }

  return ensureUnstuck(
    { x: bestX, y: bestY, z: bestZ },
    crouched,
    playerScale,
    colliders,
    activeRing
  );
}
