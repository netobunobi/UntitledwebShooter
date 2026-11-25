import { normalizeVec3, type Vec3 } from './projectiles.js';

export type WeaponId = 0 | 1 | 2 | 3 | 4 | 5;

export interface RecoilStep {
  dpitch: number;
  dyaw: number;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  shortName: string;
  magSize: number;
  rpm: number;
  reloadTimeSec: number;
  bodyDamage: number;
  headDamage: number;
  wallDamageMult: number;
  recoveryTimeSec: number;
  automatic: boolean;
  range: number;
  falloffStart: number;
  falloffEnd: number;
  minFalloffMult: number;
  pellets: number;
  pelletOffsets: readonly RecoilStep[];
  recoilPattern: readonly RecoilStep[];
  hasAds: boolean;
  hasScope: boolean;
  adsFov: number;
  adsSensMult: number;
  isProjectile: boolean;
  projectileSpeed: number;
  projectileGravity: number;
  silent: boolean;
}

const DEG2RAD = Math.PI / 180;

const AR_PATTERN: RecoilStep[] = Array.from({ length: 30 }, (_, i) => {
  if (i < 6) {
    return { dpitch: 0.015 + i * 0.001, dyaw: 0.001 * (i % 2 === 0 ? 1 : -1) };
  }
  if (i < 16) {
    return { dpitch: 0.014, dyaw: -0.010 };
  }
  if (i < 24) {
    return { dpitch: 0.011, dyaw: 0.012 };
  }
  return { dpitch: 0.009, dyaw: -0.007 };
});

const SMG_PATTERN: RecoilStep[] = Array.from({ length: 28 }, (_, i) => {
  const wave = Math.sin((i / 28) * Math.PI * 3);
  return {
    dpitch: 0.011 + (i < 8 ? 0.002 : 0),
    dyaw: wave * 0.011,
  };
});

const SG_PELLET_RING_RAD = 2.8 * DEG2RAD;
const SG_PELLET_OFFSETS: RecoilStep[] = [
  { dpitch: 0, dyaw: 0 },
  ...Array.from({ length: 7 }, (_, k) => {
    const angle = (k * 2 * Math.PI) / 7;
    return {
      dpitch: Math.sin(angle) * SG_PELLET_RING_RAD,
      dyaw: Math.cos(angle) * SG_PELLET_RING_RAD,
    };
  }),
];

const SG_PATTERN: RecoilStep[] = Array.from({ length: 6 }, (_, i) => ({
  dpitch: 0.042,
  dyaw: i % 2 === 0 ? -0.004 : 0.004,
}));

const MAGNUM_PATTERN: RecoilStep[] = Array.from({ length: 6 }, () => ({
  dpitch: 0.048,
  dyaw: 0.002,
}));

const SR_PATTERN: RecoilStep[] = Array.from({ length: 5 }, () => ({
  dpitch: 0.065,
  dyaw: 0,
}));

const KUNAI_PATTERN: RecoilStep[] = Array.from({ length: 8 }, () => ({
  dpitch: 0.008,
  dyaw: 0,
}));

export const WEAPON_DEFS: Record<WeaponId, WeaponDef> = {
  0: {
    id: 0,
    name: 'Vanguard AR',
    shortName: 'AR',
    magSize: 30,
    rpm: 600,
    reloadTimeSec: 1.7,
    bodyDamage: 24,
    headDamage: 48,
    wallDamageMult: 1.0,
    recoveryTimeSec: 0.35,
    automatic: true,
    range: 140,
    falloffStart: 35,
    falloffEnd: 85,
    minFalloffMult: 0.65,
    pellets: 1,
    pelletOffsets: [{ dpitch: 0, dyaw: 0 }],
    recoilPattern: AR_PATTERN,
    hasAds: true,
    hasScope: false,
    adsFov: 68,
    adsSensMult: 0.80,
    isProjectile: false,
    projectileSpeed: 0,
    projectileGravity: 0,
    silent: false,
  },
  1: {
    id: 1,
    name: 'Vector-9 SMG',
    shortName: 'SMG',
    magSize: 28,
    rpm: 850,
    reloadTimeSec: 1.4,
    bodyDamage: 16,
    headDamage: 30,
    wallDamageMult: 0.9,
    recoveryTimeSec: 0.30,
    automatic: true,
    range: 95,
    falloffStart: 18,
    falloffEnd: 50,
    minFalloffMult: 0.55,
    pellets: 1,
    pelletOffsets: [{ dpitch: 0, dyaw: 0 }],
    recoilPattern: SMG_PATTERN,
    hasAds: true,
    hasScope: false,
    adsFov: 73,
    adsSensMult: 0.85,
    isProjectile: false,
    projectileSpeed: 0,
    projectileGravity: 0,
    silent: false,
  },
  2: {
    id: 2,
    name: 'Breacher SG',
    shortName: 'SG',
    magSize: 6,
    rpm: 85,
    reloadTimeSec: 2.0,
    bodyDamage: 14,
    headDamage: 22,
    wallDamageMult: 1.8,
    recoveryTimeSec: 0.45,
    automatic: false,
    range: 42,
    falloffStart: 12,
    falloffEnd: 30,
    minFalloffMult: 0.35,
    pellets: 8,
    pelletOffsets: SG_PELLET_OFFSETS,
    recoilPattern: SG_PATTERN,
    hasAds: true,
    hasScope: false,
    adsFov: 74,
    adsSensMult: 0.88,
    isProjectile: false,
    projectileSpeed: 0,
    projectileGravity: 0,
    silent: false,
  },
  3: {
    id: 3,
    name: 'Magnum-6',
    shortName: 'REV',
    magSize: 6,
    rpm: 150,
    reloadTimeSec: 1.6,
    bodyDamage: 52,
    headDamage: 110,
    wallDamageMult: 1.35,
    recoveryTimeSec: 0.38,
    automatic: false,
    range: 130,
    falloffStart: 28,
    falloffEnd: 75,
    minFalloffMult: 0.65,
    pellets: 1,
    pelletOffsets: [{ dpitch: 0, dyaw: 0 }],
    recoilPattern: MAGNUM_PATTERN,
    hasAds: true,
    hasScope: false,
    adsFov: 68,
    adsSensMult: 0.78,
    isProjectile: false,
    projectileSpeed: 0,
    projectileGravity: 0,
    silent: false,
  },
  4: {
    id: 4,
    name: 'Apex SR',
    shortName: 'SR',
    magSize: 5,
    rpm: 55,
    reloadTimeSec: 2.2,
    bodyDamage: 75,
    headDamage: 160,
    wallDamageMult: 1.5,
    recoveryTimeSec: 0.50,
    automatic: false,
    range: 240,
    falloffStart: 240,
    falloffEnd: 240,
    minFalloffMult: 1.0,
    pellets: 1,
    pelletOffsets: [{ dpitch: 0, dyaw: 0 }],
    recoilPattern: SR_PATTERN,
    hasAds: true,
    hasScope: true,
    adsFov: 28,
    adsSensMult: 0.45,
    isProjectile: false,
    projectileSpeed: 0,
    projectileGravity: 0,
    silent: false,
  },
  5: {
    id: 5,
    name: 'Shadow Kunai',
    shortName: 'KUNAI',
    magSize: 8,
    rpm: 140,
    reloadTimeSec: 1.1,
    bodyDamage: 50,
    headDamage: 120,
    wallDamageMult: 1.0,
    recoveryTimeSec: 0.25,
    automatic: false,
    range: 120,
    falloffStart: 120,
    falloffEnd: 120,
    minFalloffMult: 1.0,
    pellets: 1,
    pelletOffsets: [{ dpitch: 0, dyaw: 0 }],
    recoilPattern: KUNAI_PATTERN,
    hasAds: true,
    hasScope: false,
    adsFov: 74,
    adsSensMult: 0.90,
    isProjectile: true,
    projectileSpeed: 52.0,
    projectileGravity: -7.5,
    silent: true,
  },
};

export const WEAPON_LIST: readonly WeaponId[] = [0, 1, 2, 3, 4, 5] as const;

export function isValidWeaponId(id: unknown): id is WeaponId {
  return typeof id === 'number' && Number.isInteger(id) && id >= 0 && id <= 5;
}

export function getRecoilStep(
  weaponId: WeaponId,
  shotIdx: number,
  recoilMult = 1.0
): RecoilStep {
  const def = WEAPON_DEFS[weaponId];
  const pattern = def.recoilPattern;
  const idx = Math.max(0, Math.min(pattern.length - 1, Math.floor(shotIdx)));
  const step = pattern[idx];
  return {
    dpitch: step.dpitch * recoilMult,
    dyaw: step.dyaw * recoilMult,
  };
}

/**
 * Generates deterministic ray directions for a weapon shot given a normalized forward direction.
 */
export function getPelletDirections(forwardDir: Vec3, weaponId: WeaponId): Vec3[] {
  const def = WEAPON_DEFS[weaponId];
  const fwd = normalizeVec3(forwardDir);

  if (def.pellets === 1) {
    return [fwd];
  }

  // Orthonormal tangent basis (right, up) around forwardDir
  const worldUp: Vec3 = Math.abs(fwd.y) > 0.99 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  // right = normalize(cross(fwd, worldUp))
  const right = normalizeVec3({
    x: fwd.y * worldUp.z - fwd.z * worldUp.y,
    y: fwd.z * worldUp.x - fwd.x * worldUp.z,
    z: fwd.x * worldUp.y - fwd.y * worldUp.x,
  });
  // up = cross(right, fwd)
  const up = normalizeVec3({
    x: right.y * fwd.z - right.z * fwd.y,
    y: right.z * fwd.x - right.x * fwd.z,
    z: right.x * fwd.y - right.y * fwd.x,
  });

  return def.pelletOffsets.map((off) => {
    const tanYaw = Math.tan(off.dyaw);
    const tanPitch = Math.tan(off.dpitch);
    return normalizeVec3({
      x: fwd.x + right.x * tanYaw + up.x * tanPitch,
      y: fwd.y + right.y * tanYaw + up.y * tanPitch,
      z: fwd.z + right.z * tanYaw + up.z * tanPitch,
    });
  });
}

export function computeDamageFalloff(weaponId: WeaponId, distance: number): number {
  const def = WEAPON_DEFS[weaponId];
  if (distance <= def.falloffStart || def.falloffEnd <= def.falloffStart) {
    return 1.0;
  }
  if (distance >= def.falloffEnd) {
    return def.minFalloffMult;
  }
  const t = (distance - def.falloffStart) / (def.falloffEnd - def.falloffStart);
  return 1.0 - t * (1.0 - def.minFalloffMult);
}
