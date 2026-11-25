export type ProjectileKind = 'kunai' | 'impulse_grenade' | 'smoke_bomb';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scaleVec3(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function dotVec3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function lengthSqVec3(v: Vec3): number {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

export function distSqVec3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function normalizeVec3(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len <= 1e-8) {
    return { x: 0, y: 0, z: -1 };
  }
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function yawPitchToForward(yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch);
  return normalizeVec3({
    x: -Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch,
  });
}

/**
 * Deterministic Euler step matching server 60Hz integration.
 */
export function stepProjectile(
  pos: Vec3,
  vel: Vec3,
  gravity: number,
  dt: number
): { pos: Vec3; vel: Vec3 } {
  const nextVel: Vec3 = {
    x: vel.x,
    y: vel.y + gravity * dt,
    z: vel.z,
  };
  const nextPos: Vec3 = {
    x: pos.x + nextVel.x * dt,
    y: pos.y + nextVel.y * dt,
    z: pos.z + nextVel.z * dt,
  };
  return { pos: nextPos, vel: nextVel };
}

/**
 * Closed-form evaluation for lightweight client rendering between spawn and impact.
 */
export function evalProjectileAt(
  origin: Vec3,
  initVel: Vec3,
  gravity: number,
  elapsedSec: number
): Vec3 {
  const t = Math.max(0, elapsedSec);
  return {
    x: origin.x + initVel.x * t,
    y: origin.y + initVel.y * t + 0.5 * gravity * t * t,
    z: origin.z + initVel.z * t,
  };
}
