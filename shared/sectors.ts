import {
  GRID_MAX,
  GRID_MIN,
  SECTOR_EMERGE_MS,
  SECTOR_RETRACT_MS,
  SECTOR_SIZE,
} from './constants.js';
import type { AABB } from './collision.js';

export type SectorLevel = 0 | 1 | 2;
export type SectorPhase = 'STABLE' | 'WARNING' | 'TRANSITIONING';
export type SectorRotation = 0 | 1 | 2 | 3;

export type BlockKind =
  | 'wall_light'
  | 'wall_dark'
  | 'floor_slab'
  | 'roof_terracotta'
  | 'roof_slate'
  | 'trim'
  | 'stair'
  | 'container'
  | 'rock'
  | 'tree_trunk'
  | 'tree_canopy'
  | 'barricade';

export interface BlueprintBlock {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  kind: BlockKind;
  envelopeId?: number;
}

export interface SectorState {
  gx: number;
  gz: number;
  level: SectorLevel;
  variant: number;
  rotation: SectorRotation;
  phase: SectorPhase;
  targetLevel: SectorLevel;
  targetVariant: number;
  targetRotation: SectorRotation;
  warnStart: number;
  warnEnd: number;
  emergeStart: number;
  emergeEnd: number;
}

export interface WorldStructureAABB extends AABB {
  kind: BlockKind;
}

// ============================================================================
// Procedural Low-Poly Architectural Builders (Pure AABBs, Enterable & Climbable)
// ============================================================================

interface BuildingOptions {
  cx: number;
  cz: number;
  w: number;
  d: number;
  floorH: number;
  floors: number;
  roofType: 'gable' | 'rooftop';
  wallKind: 'wall_light' | 'wall_dark';
  doorSide: 'E' | 'S' | 'N';
  envelopeId: number;
}

function addWallWithOpening(
  out: BlueprintBlock[],
  fixedMin: number,
  fixedMax: number,
  spanMin: number,
  spanMax: number,
  axis: 'x' | 'z', // 'x' => wall runs along X (fixed Z); 'z' => wall runs along Z (fixed X)
  baseY: number,
  topY: number,
  openHalfW: number,
  openMinY: number,
  openMaxY: number,
  kind: BlockKind,
  envelopeId: number
): void {
  const mid = (spanMin + spanMax) * 0.5;
  const oMin = Math.max(spanMin + 0.6, mid - openHalfW);
  const oMax = Math.min(spanMax - 0.6, mid + openHalfW);

  const pushBox = (s0: number, s1: number, y0: number, y1: number) => {
    if (s1 - s0 < 0.05 || y1 - y0 < 0.05) return;
    if (axis === 'x') {
      out.push({
        minX: s0,
        maxX: s1,
        minY: y0,
        maxY: y1,
        minZ: fixedMin,
        maxZ: fixedMax,
        kind,
        envelopeId,
      });
    } else {
      out.push({
        minX: fixedMin,
        maxX: fixedMax,
        minY: y0,
        maxY: y1,
        minZ: s0,
        maxZ: s1,
        kind,
        envelopeId,
      });
    }
  };

  // Left & right full-height pillars
  pushBox(spanMin, oMin, baseY, topY);
  pushBox(oMax, spanMax, baseY, topY);
  // Sill below window (skipped if openMinY <= baseY for doors)
  if (openMinY > baseY + 0.05) {
    pushBox(oMin, oMax, baseY, openMinY);
  }
  // Lintel above opening
  if (topY > openMaxY + 0.05) {
    pushBox(oMin, oMax, openMaxY, topY);
  }
}

function buildEnterableBuilding(opts: BuildingOptions): BlueprintBlock[] {
  const { cx, cz, w, d, floorH, floors, roofType, wallKind, doorSide, envelopeId } = opts;
  const out: BlueprintBlock[] = [];
  const T = 0.44;
  const x0 = cx - w * 0.5;
  const x1 = cx + w * 0.5;
  const z0 = cz - d * 0.5;
  const z1 = cz + d * 0.5;

  // Dual-lane interior stairwell along -X wall (unobstructed headroom on all floors 1..5)
  const bayWidth = 2.8;
  const laneW = bayWidth * 0.5;
  const landingD = 1.5;
  const stairX0 = x0 + T;
  const mainFloorX0 = stairX0 + bayWidth;
  const stairZ0 = z0 + T + landingD;
  const stairZ1 = z1 - T - landingD;
  const hasStairs = floors > 1 || roofType === 'rooftop';

  for (let f = 0; f < floors; f++) {
    const baseY = f * floorH;
    const topY = (f + 1) * floorH;

    // Ground floor slab / upper floor slab
    if (f > 0) {
      // Main floor slab right of stairwell
      out.push({
        minX: mainFloorX0,
        maxX: x1 - T,
        minY: baseY - 0.22,
        maxY: baseY,
        minZ: z0 + T,
        maxZ: z1 - T,
        kind: 'floor_slab',
        envelopeId,
      });
      // North & South stair landings
      out.push({
        minX: stairX0,
        maxX: mainFloorX0,
        minY: baseY - 0.22,
        maxY: baseY,
        minZ: z0 + T,
        maxZ: stairZ0,
        kind: 'floor_slab',
        envelopeId,
      });
      out.push({
        minX: stairX0,
        maxX: mainFloorX0,
        minY: baseY - 0.22,
        maxY: baseY,
        minZ: stairZ1,
        maxZ: z1 - T,
        kind: 'floor_slab',
        envelopeId,
      });
    }

    // 4 exterior walls with doors (floor 0) or wide firing windows
    // North wall (-Z)
    addWallWithOpening(
      out,
      z0,
      z0 + T,
      x0,
      x1,
      'x',
      baseY,
      topY,
      f === 0 && doorSide === 'N' ? 1.25 : 1.5,
      f === 0 && doorSide === 'N' ? baseY : baseY + 1.0,
      baseY + 2.45,
      wallKind,
      envelopeId
    );
    // South wall (+Z)
    addWallWithOpening(
      out,
      z1 - T,
      z1,
      x0,
      x1,
      'x',
      baseY,
      topY,
      f === 0 && doorSide === 'S' ? 1.25 : 1.5,
      f === 0 && doorSide === 'S' ? baseY : baseY + 1.0,
      baseY + 2.45,
      wallKind,
      envelopeId
    );
    // East wall (+X)
    addWallWithOpening(
      out,
      x1 - T,
      x1,
      z0 + T,
      z1 - T,
      'z',
      baseY,
      topY,
      f === 0 && doorSide === 'E' ? 1.25 : 1.5,
      f === 0 && doorSide === 'E' ? baseY : baseY + 1.0,
      baseY + 2.45,
      wallKind,
      envelopeId
    );
    // West wall (-X, behind stairwell -> firing windows on upper floors, solid/slit on ground)
    if (f === 0) {
      addWallWithOpening(
        out,
        x0,
        x0 + T,
        z0 + T,
        z1 - T,
        'z',
        baseY,
        topY,
        1.1,
        baseY + 1.1,
        baseY + 2.35,
        wallKind,
        envelopeId
      );
    } else {
      addWallWithOpening(
        out,
        x0,
        x0 + T,
        z0 + T,
        z1 - T,
        'z',
        baseY,
        topY,
        1.4,
        baseY + 1.0,
        baseY + 2.45,
        wallKind,
        envelopeId
      );
    }

    // Interior staircase up to next level (if multi-floor or rooftop access)
    if (hasStairs && (f < floors - 1 || roofType === 'rooftop')) {
      const steps = 9;
      const stepRise = floorH / steps;
      const runLen = stairZ1 - stairZ0;
      const stepD = runLen / steps;
      const useLane0 = f % 2 === 0;
      const sxMin = useLane0 ? stairX0 : stairX0 + laneW;
      const sxMax = useLane0 ? stairX0 + laneW : stairX0 + bayWidth;

      for (let i = 0; i < steps; i++) {
        const zStart = useLane0 ? stairZ0 + i * stepD : stairZ1 - (i + 1) * stepD;
        const zEnd = zStart + stepD;
        const stepTop = baseY + (i + 1) * stepRise;
        const stepBot = Math.max(baseY, baseY + i * stepRise - 0.2);
        out.push({
          minX: sxMin,
          maxX: sxMax,
          minY: Number(stepBot.toFixed(3)),
          maxY: Number(stepTop.toFixed(3)),
          minZ: Math.min(zStart, zEnd),
          maxZ: Math.max(zStart, zEnd),
          kind: 'stair',
          envelopeId,
        });
      }
    }
  }

  // Roof construction
  const topRoofY = floors * floorH;
  if (roofType === 'rooftop') {
    // Playable rooftop slab leaving stairwell opening clear
    out.push({
      minX: mainFloorX0,
      maxX: x1 - T,
      minY: topRoofY - 0.25,
      maxY: topRoofY,
      minZ: z0 + T,
      maxZ: z1 - T,
      kind: 'roof_slate',
      envelopeId,
    });
    out.push({
      minX: stairX0,
      maxX: mainFloorX0,
      minY: topRoofY - 0.25,
      maxY: topRoofY,
      minZ: z0 + T,
      maxZ: stairZ0,
      kind: 'roof_slate',
      envelopeId,
    });
    out.push({
      minX: stairX0,
      maxX: mainFloorX0,
      minY: topRoofY - 0.25,
      maxY: topRoofY,
      minZ: stairZ1,
      maxZ: z1 - T,
      kind: 'roof_slate',
      envelopeId,
    });

    // Rooftop perimeter parapet walls with low crenellations/gaps for sniper cover
    const pH = 1.0;
    out.push({ minX: x0, maxX: x1, minY: topRoofY, maxY: topRoofY + pH, minZ: z0, maxZ: z0 + 0.35, kind: 'trim', envelopeId });
    out.push({ minX: x0, maxX: x1, minY: topRoofY, maxY: topRoofY + pH, minZ: z1 - 0.35, maxZ: z1, kind: 'trim', envelopeId });
    out.push({ minX: x0, maxX: x0 + 0.35, minY: topRoofY, maxY: topRoofY + pH, minZ: z0 + 0.35, maxZ: z1 - 0.35, kind: 'trim', envelopeId });
    out.push({ minX: x1 - 0.35, maxX: x1, minY: topRoofY, maxY: topRoofY + pH, minZ: z0 + 0.35, maxZ: z1 - 0.35, kind: 'trim', envelopeId });

    // Small roof penthouse cap over stairwell
    out.push({
      minX: x0,
      maxX: mainFloorX0 + 0.4,
      minY: topRoofY + 2.3,
      maxY: topRoofY + 2.6,
      minZ: z0,
      maxZ: z1,
      kind: 'roof_slate',
      envelopeId,
    });
    out.push({
      minX: x0,
      maxX: x0 + 0.35,
      minY: topRoofY + pH,
      maxY: topRoofY + 2.3,
      minZ: z0,
      maxZ: z1,
      kind: 'trim',
      envelopeId,
    });
  } else {
    // Low Poly stepped gable/terracotta roof
    const layers = 3;
    for (let l = 0; l < layers; l++) {
      const inset = l * 1.15 - 0.35;
      const ly0 = topRoofY + l * 0.55;
      const ly1 = ly0 + 0.55;
      out.push({
        minX: x0 + inset,
        maxX: x1 - inset,
        minY: ly0,
        maxY: ly1,
        minZ: z0 + Math.max(-0.35, inset * 0.35),
        maxZ: z1 - Math.max(-0.35, inset * 0.35),
        kind: 'roof_terracotta',
        envelopeId,
      });
    }
  }

  return out;
}

function buildTree(x: number, z: number, height: number, envelopeId: number): BlueprintBlock[] {
  const trunkH = height * 0.45;
  return [
    { minX: x - 0.35, maxX: x + 0.35, minY: 0, maxY: trunkH, minZ: z - 0.35, maxZ: z + 0.35, kind: 'tree_trunk', envelopeId },
    { minX: x - 1.5, maxX: x + 1.5, minY: trunkH, maxY: trunkH + height * 0.32, minZ: z - 1.5, maxZ: z + 1.5, kind: 'tree_canopy', envelopeId },
    { minX: x - 1.0, maxX: x + 1.0, minY: trunkH + height * 0.32, maxY: height, minZ: z - 1.0, maxZ: z + 1.0, kind: 'tree_canopy', envelopeId },
  ];
}

// ============================================================================
// Sector Variants (32m x 32m: [-16, +16], open center [-2, +2], open borders)
// ============================================================================

const LEVEL_0_BLUEPRINTS: BlueprintBlock[][] = [
  // Variant 0: Open prairie with rocks, tactical barricades & trees
  [
    { minX: -11.5, maxX: -5.5, minY: 0, maxY: 1.25, minZ: -9.5, maxZ: -7.8, kind: 'barricade', envelopeId: 1 },
    { minX: 5.5, maxX: 11.5, minY: 0, maxY: 1.25, minZ: 7.8, maxZ: 9.5, kind: 'barricade', envelopeId: 2 },
    { minX: -9.5, maxX: -6.2, minY: 0, maxY: 1.8, minZ: 6.0, maxZ: 9.2, kind: 'rock', envelopeId: 3 },
    { minX: 6.2, maxX: 9.8, minY: 0, maxY: 2.0, minZ: -9.5, maxZ: -6.2, kind: 'rock', envelopeId: 4 },
    ...buildTree(-12.5, 11.5, 4.4, 5),
    ...buildTree(12.0, -12.0, 4.8, 6),
  ],
  // Variant 1: Rural outpost cabin (1 story) + long open fields
  [
    ...buildEnterableBuilding({
      cx: -8.5,
      cz: -8.5,
      w: 7.4,
      d: 7.4,
      floorH: 3.0,
      floors: 1,
      roofType: 'gable',
      wallKind: 'wall_light',
      doorSide: 'E',
      envelopeId: 1,
    }),
    { minX: 5.5, maxX: 10.5, minY: 0, maxY: 1.2, minZ: 5.5, maxZ: 7.0, kind: 'barricade', envelopeId: 2 },
    { minX: 7.0, maxX: 10.2, minY: 0, maxY: 1.6, minZ: -10.5, maxZ: -7.5, kind: 'rock', envelopeId: 3 },
    ...buildTree(-10.5, 9.5, 4.6, 4),
    ...buildTree(12.2, 11.8, 4.2, 5),
  ],
  // Variant 2: Open ridge line with boulders and low sandbags
  [
    { minX: -5.5, maxX: 5.5, minY: 0, maxY: 1.2, minZ: -7.5, maxZ: -6.1, kind: 'barricade', envelopeId: 1 },
    { minX: -5.5, maxX: 5.5, minY: 0, maxY: 1.2, minZ: 6.1, maxZ: 7.5, kind: 'barricade', envelopeId: 2 },
    { minX: -12.0, maxX: -8.5, minY: 0, maxY: 2.1, minZ: -4.2, maxZ: 4.2, kind: 'rock', envelopeId: 3 },
    ...buildTree(11.0, -9.5, 5.0, 4),
    ...buildTree(11.0, 9.5, 4.5, 5),
  ],
];

const LEVEL_1_BLUEPRINTS: BlueprintBlock[][] = [
  // Variant 0: Compact neighborhood (2 close 2-story gabled houses on -X, containers on +X)
  [
    ...buildEnterableBuilding({
      cx: -8.8,
      cz: -8.0,
      w: 8.6,
      d: 8.6,
      floorH: 3.1,
      floors: 2,
      roofType: 'gable',
      wallKind: 'wall_light',
      doorSide: 'E',
      envelopeId: 1,
    }),
    ...buildEnterableBuilding({
      cx: -8.8,
      cz: 8.0,
      w: 8.6,
      d: 8.6,
      floorH: 3.1,
      floors: 2,
      roofType: 'gable',
      wallKind: 'wall_dark',
      doorSide: 'E',
      envelopeId: 2,
    }),
    { minX: 5.0, maxX: 11.0, minY: 0, maxY: 2.5, minZ: -9.5, maxZ: -6.5, kind: 'container', envelopeId: 3 },
    { minX: 5.0, maxX: 11.0, minY: 0, maxY: 2.5, minZ: 6.5, maxZ: 9.5, kind: 'container', envelopeId: 4 },
    { minX: 6.5, maxX: 8.5, minY: 0, maxY: 1.25, minZ: -2.0, maxZ: 2.0, kind: 'barricade', envelopeId: 5 },
  ],
  // Variant 1: Spaced suburb (1 2-story house + watchtower + yard)
  [
    ...buildEnterableBuilding({
      cx: -8.5,
      cz: -8.2,
      w: 9.2,
      d: 9.0,
      floorH: 3.1,
      floors: 2,
      roofType: 'gable',
      wallKind: 'wall_light',
      doorSide: 'S',
      envelopeId: 1,
    }),
    ...buildEnterableBuilding({
      cx: 8.5,
      cz: 8.2,
      w: 8.8,
      d: 8.8,
      floorH: 3.1,
      floors: 3,
      roofType: 'rooftop',
      wallKind: 'wall_dark',
      doorSide: 'N',
      envelopeId: 2,
    }),
    { minX: 5.8, maxX: 11.5, minY: 0, maxY: 2.4, minZ: -10.5, maxZ: -7.5, kind: 'container', envelopeId: 3 },
    ...buildTree(-9.5, 9.5, 4.6, 4),
  ],
  // Variant 2: Tight alleys on one side, open courtyard on the other
  [
    ...buildEnterableBuilding({
      cx: -9.2,
      cz: -9.0,
      w: 8.2,
      d: 8.2,
      floorH: 3.0,
      floors: 2,
      roofType: 'gable',
      wallKind: 'wall_light',
      doorSide: 'S',
      envelopeId: 1,
    }),
    ...buildEnterableBuilding({
      cx: -9.2,
      cz: 2.0,
      w: 8.2,
      d: 8.2,
      floorH: 3.0,
      floors: 1,
      roofType: 'gable',
      wallKind: 'wall_dark',
      doorSide: 'E',
      envelopeId: 2,
    }),
    ...buildEnterableBuilding({
      cx: 1.8,
      cz: -9.0,
      w: 8.2,
      d: 8.2,
      floorH: 3.0,
      floors: 2,
      roofType: 'gable',
      wallKind: 'wall_dark',
      doorSide: 'S',
      envelopeId: 3,
    }),
    { minX: 5.5, maxX: 11.0, minY: 0, maxY: 1.3, minZ: 6.5, maxZ: 8.2, kind: 'barricade', envelopeId: 4 },
    ...buildTree(11.0, 11.0, 4.8, 5),
  ],
];

const LEVEL_2_BLUEPRINTS: BlueprintBlock[][] = [
  // Variant 0: Twin Skyscraper Blocks (5-story tower ~16.5m + 4-story building ~13.4m) + street shop
  [
    ...buildEnterableBuilding({
      cx: -8.6,
      cz: -8.6,
      w: 10.6,
      d: 10.6,
      floorH: 3.1,
      floors: 5,
      roofType: 'rooftop',
      wallKind: 'wall_light',
      doorSide: 'E',
      envelopeId: 1,
    }),
    ...buildEnterableBuilding({
      cx: 8.6,
      cz: 8.6,
      w: 10.4,
      d: 10.4,
      floorH: 3.1,
      floors: 4,
      roofType: 'rooftop',
      wallKind: 'wall_dark',
      doorSide: 'N',
      envelopeId: 2,
    }),
    ...buildEnterableBuilding({
      cx: 8.6,
      cz: -8.6,
      w: 9.2,
      d: 9.2,
      floorH: 3.1,
      floors: 2,
      roofType: 'rooftop',
      wallKind: 'wall_light',
      doorSide: 'S',
      envelopeId: 3,
    }),
    { minX: -10.5, maxX: -5.5, minY: 0, maxY: 2.5, minZ: 7.0, maxZ: 10.0, kind: 'container', envelopeId: 4 },
  ],
  // Variant 1: Tight Urban Maze (Three 3–4 story buildings with narrow alleys)
  [
    ...buildEnterableBuilding({
      cx: -8.5,
      cz: -8.5,
      w: 10.4,
      d: 10.4,
      floorH: 3.1,
      floors: 4,
      roofType: 'rooftop',
      wallKind: 'wall_dark',
      doorSide: 'S',
      envelopeId: 1,
    }),
    ...buildEnterableBuilding({
      cx: 8.5,
      cz: -8.5,
      w: 10.2,
      d: 10.2,
      floorH: 3.1,
      floors: 3,
      roofType: 'rooftop',
      wallKind: 'wall_light',
      doorSide: 'S',
      envelopeId: 2,
    }),
    ...buildEnterableBuilding({
      cx: -8.5,
      cz: 8.5,
      w: 10.2,
      d: 10.2,
      floorH: 3.1,
      floors: 4,
      roofType: 'rooftop',
      wallKind: 'wall_light',
      doorSide: 'E',
      envelopeId: 3,
    }),
    ...buildEnterableBuilding({
      cx: 8.5,
      cz: 8.5,
      w: 9.6,
      d: 9.6,
      floorH: 3.1,
      floors: 2,
      roofType: 'gable',
      wallKind: 'wall_dark',
      doorSide: 'N',
      envelopeId: 4,
    }),
  ],
  // Variant 2: High-Rise Avenue (5-story & 4-story towers facing street barricades)
  [
    ...buildEnterableBuilding({
      cx: -9.0,
      cz: -8.2,
      w: 10.2,
      d: 11.0,
      floorH: 3.1,
      floors: 5,
      roofType: 'rooftop',
      wallKind: 'wall_dark',
      doorSide: 'E',
      envelopeId: 1,
    }),
    ...buildEnterableBuilding({
      cx: 9.0,
      cz: 8.2,
      w: 10.2,
      d: 11.0,
      floorH: 3.1,
      floors: 4,
      roofType: 'rooftop',
      wallKind: 'wall_light',
      doorSide: 'N',
      envelopeId: 2,
    }),
    { minX: -11.5, maxX: -6.0, minY: 0, maxY: 1.35, minZ: 6.5, maxZ: 8.0, kind: 'barricade', envelopeId: 3 },
    { minX: 6.0, maxX: 11.5, minY: 0, maxY: 1.35, minZ: -8.0, maxZ: -6.5, kind: 'barricade', envelopeId: 4 },
  ],
];

const BLUEPRINTS_BY_LEVEL: Record<SectorLevel, BlueprintBlock[][]> = {
  0: LEVEL_0_BLUEPRINTS,
  1: LEVEL_1_BLUEPRINTS,
  2: LEVEL_2_BLUEPRINTS,
};

export function getBlueprintCount(level: SectorLevel): number {
  return BLUEPRINTS_BY_LEVEL[level].length;
}

export function rotateLocalBlock(block: BlueprintBlock, rotation: SectorRotation): BlueprintBlock {
  const { minX, maxX, minZ, maxZ } = block;
  let rMinX = minX;
  let rMaxX = maxX;
  let rMinZ = minZ;
  let rMaxZ = maxZ;

  if (rotation === 1) {
    rMinX = -maxZ;
    rMaxX = -minZ;
    rMinZ = minX;
    rMaxZ = maxX;
  } else if (rotation === 2) {
    rMinX = -maxX;
    rMaxX = -minX;
    rMinZ = -maxZ;
    rMaxZ = -minZ;
  } else if (rotation === 3) {
    rMinX = minZ;
    rMaxX = maxZ;
    rMinZ = -maxX;
    rMaxZ = -minX;
  }

  return {
    ...block,
    minX: rMinX,
    maxX: rMaxX,
    minZ: rMinZ,
    maxZ: rMaxZ,
  };
}

export function getBlueprintBlocks(
  level: SectorLevel,
  variant: number,
  rotation: SectorRotation
): BlueprintBlock[] {
  const list = BLUEPRINTS_BY_LEVEL[level];
  const idx = Math.abs(variant) % list.length;
  return list[idx].map((b) => rotateLocalBlock(b, rotation));
}

interface EnvelopeGroup {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
  kind: BlockKind;
}

function getBlueprintEnvelopes(
  level: SectorLevel,
  variant: number,
  rotation: SectorRotation
): EnvelopeGroup[] {
  const blocks = getBlueprintBlocks(level, variant, rotation);
  const byId = new Map<number, EnvelopeGroup>();
  let fallbackId = 1000;

  for (const b of blocks) {
    const id = b.envelopeId ?? fallbackId++;
    const cur = byId.get(id);
    if (!cur) {
      byId.set(id, {
        minX: b.minX,
        maxX: b.maxX,
        minZ: b.minZ,
        maxZ: b.maxZ,
        maxY: b.maxY,
        kind: b.kind,
      });
    } else {
      cur.minX = Math.min(cur.minX, b.minX);
      cur.maxX = Math.max(cur.maxX, b.maxX);
      cur.minZ = Math.min(cur.minZ, b.minZ);
      cur.maxZ = Math.max(cur.maxZ, b.maxZ);
      cur.maxY = Math.max(cur.maxY, b.maxY);
    }
  }
  return Array.from(byId.values());
}

export function sectorKey(gx: number, gz: number): string {
  return `${gx},${gz}`;
}

export function worldToSectorCoord(x: number, z: number): { gx: number; gz: number } {
  return {
    gx: Math.round(x / SECTOR_SIZE),
    gz: Math.round(z / SECTOR_SIZE),
  };
}

export function sectorCenterWorld(gx: number, gz: number): { x: number; z: number } {
  return {
    x: gx * SECTOR_SIZE,
    z: gz * SECTOR_SIZE,
  };
}

function easeInOutQuad(u: number): number {
  return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
}

function easeInOutQuadDeriv(u: number): number {
  return u < 0.5 ? 4 * u : 4 * (1 - u);
}

function easeOutCubic(u: number): number {
  return 1 - Math.pow(1 - u, 3);
}

function easeOutCubicDeriv(u: number): number {
  const inv = 1 - u;
  return 3 * inv * inv;
}

/**
 * Physics/Collision AABBs:
 * - When STABLE or WARNING: exact enterable building walls, slabs, stairs, windows & doors.
 * - When TRANSITIONING: solid rising/retracting envelope prisms per building so players standing
 *   on top or inside are smoothly carried upward to the roof with ZERO possibility of trapping.
 */
export function getSectorStructureAABBs(
  sector: SectorState,
  simTimeMs: number
): WorldStructureAABB[] {
  const cx = sector.gx * SECTOR_SIZE;
  const cz = sector.gz * SECTOR_SIZE;

  if (sector.phase === 'STABLE' || sector.phase === 'WARNING') {
    const blocks = getBlueprintBlocks(sector.level, sector.variant, sector.rotation);
    return blocks.map((b) => ({
      minX: cx + b.minX,
      minY: b.minY,
      minZ: cz + b.minZ,
      maxX: cx + b.maxX,
      maxY: b.maxY,
      maxZ: cz + b.maxZ,
      vy: 0,
      kind: b.kind,
    }));
  }

  const elapsed = Math.max(0, simTimeMs - sector.emergeStart);
  if (elapsed < SECTOR_RETRACT_MS) {
    const u = Math.min(1, elapsed / SECTOR_RETRACT_MS);
    const scaleY = 1 - easeInOutQuad(u);
    const vyFactor = -easeInOutQuadDeriv(u) / (SECTOR_RETRACT_MS / 1000);
    const envelopes = getBlueprintEnvelopes(sector.level, sector.variant, sector.rotation);
    const out: WorldStructureAABB[] = [];
    for (const e of envelopes) {
      const topY = e.maxY * scaleY;
      if (topY > 0.02) {
        out.push({
          minX: cx + e.minX,
          minY: 0,
          minZ: cz + e.minZ,
          maxX: cx + e.maxX,
          maxY: topY,
          maxZ: cz + e.maxZ,
          vy: e.maxY * vyFactor,
          kind: e.kind,
        });
      }
    }
    return out;
  }

  const emergeElapsed = Math.min(SECTOR_EMERGE_MS, elapsed - SECTOR_RETRACT_MS);
  const u = Math.min(1, Math.max(0, emergeElapsed / SECTOR_EMERGE_MS));
  const scaleY = easeOutCubic(u);
  const vyFactor = easeOutCubicDeriv(u) / (SECTOR_EMERGE_MS / 1000);
  const envelopes = getBlueprintEnvelopes(
    sector.targetLevel,
    sector.targetVariant,
    sector.targetRotation
  );

  const out: WorldStructureAABB[] = [];
  for (const e of envelopes) {
    const topY = e.maxY * scaleY;
    if (topY > 0.01) {
      out.push({
        minX: cx + e.minX,
        minY: 0,
        minZ: cz + e.minZ,
        maxX: cx + e.maxX,
        maxY: topY,
        maxZ: cz + e.maxZ,
        vy: e.maxY * vyFactor,
        kind: e.kind,
      });
    }
  }
  return out;
}

/**
 * Detailed Visual Blocks for Three.js rendering (slides detailed buildings smoothly from underground).
 */
export function getSectorVisualBlocks(
  sector: SectorState,
  simTimeMs: number
): WorldStructureAABB[] {
  const cx = sector.gx * SECTOR_SIZE;
  const cz = sector.gz * SECTOR_SIZE;

  if (sector.phase === 'STABLE' || sector.phase === 'WARNING') {
    const blocks = getBlueprintBlocks(sector.level, sector.variant, sector.rotation);
    return blocks.map((b) => ({
      minX: cx + b.minX,
      minY: b.minY,
      minZ: cz + b.minZ,
      maxX: cx + b.maxX,
      maxY: b.maxY,
      maxZ: cz + b.maxZ,
      kind: b.kind,
    }));
  }

  const elapsed = Math.max(0, simTimeMs - sector.emergeStart);
  const isRetract = elapsed < SECTOR_RETRACT_MS;
  const lvl = isRetract ? sector.level : sector.targetLevel;
  const variant = isRetract ? sector.variant : sector.targetVariant;
  const rot = isRetract ? sector.rotation : sector.targetRotation;
  const blocks = getBlueprintBlocks(lvl, variant, rot);

  let maxBlockH = 1;
  for (const b of blocks) {
    if (b.maxY > maxBlockH) maxBlockH = b.maxY;
  }

  const ratio = isRetract
    ? 1 - easeInOutQuad(Math.min(1, elapsed / SECTOR_RETRACT_MS))
    : easeOutCubic(Math.min(1, Math.max(0, (elapsed - SECTOR_RETRACT_MS) / SECTOR_EMERGE_MS)));
  const yShift = -(1 - ratio) * maxBlockH;

  const out: WorldStructureAABB[] = [];
  for (const b of blocks) {
    const visMaxY = b.maxY + yShift;
    if (visMaxY <= 0.02) continue;
    const visMinY = Math.max(0, b.minY + yShift);
    if (visMaxY - visMinY <= 0.01) continue;
    out.push({
      minX: cx + b.minX,
      minY: visMinY,
      minZ: cz + b.minZ,
      maxX: cx + b.maxX,
      maxY: visMaxY,
      maxZ: cz + b.maxZ,
      kind: b.kind,
    });
  }
  return out;
}

export function getSectorWarningFootprints(sector: SectorState): WorldStructureAABB[] {
  if (sector.phase === 'STABLE') return [];
  const cx = sector.gx * SECTOR_SIZE;
  const cz = sector.gz * SECTOR_SIZE;
  const envelopes = getBlueprintEnvelopes(
    sector.targetLevel,
    sector.targetVariant,
    sector.targetRotation
  );
  return envelopes.map((e) => ({
    minX: cx + e.minX,
    minY: 0,
    minZ: cz + e.minZ,
    maxX: cx + e.maxX,
    maxY: e.maxY,
    maxZ: cz + e.maxZ,
    vy: 0,
    kind: e.kind,
  }));
}

export function getNeighbors8(
  gx: number,
  gz: number,
  activeRing = 3
): Array<{ gx: number; gz: number }> {
  const minC = Math.max(GRID_MIN, -activeRing);
  const maxC = Math.min(GRID_MAX, activeRing);
  const out: Array<{ gx: number; gz: number }> = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      const nx = gx + dx;
      const nz = gz + dz;
      if (nx >= minC && nx <= maxC && nz >= minC && nz <= maxC) {
        out.push({ gx: nx, gz: nz });
      }
    }
  }
  return out;
}

function getEffectiveLevels(s: SectorState): SectorLevel[] {
  if (s.phase === 'STABLE') return [s.level];
  return s.level === s.targetLevel ? [s.level] : [s.level, s.targetLevel];
}

export function canTransitionSector(
  grid: Map<string, SectorState>,
  gx: number,
  gz: number,
  targetLevel: SectorLevel,
  activeRing = 3
): boolean {
  const sector = grid.get(sectorKey(gx, gz));
  if (!sector) return false;
  if (sector.phase !== 'STABLE') return false;
  if (Math.abs(targetLevel - sector.level) !== 1) return false;

  const neighbors = getNeighbors8(gx, gz, activeRing);
  for (const nbCoord of neighbors) {
    const nb = grid.get(sectorKey(nbCoord.gx, nbCoord.gz));
    if (!nb) continue;
    for (const nbLevel of getEffectiveLevels(nb)) {
      if (Math.abs(targetLevel - nbLevel) > 1) {
        return false;
      }
    }
  }
  return true;
}

export function validateGridCohesion(
  grid: Map<string, SectorState>,
  activeRing = 3
): { valid: boolean; violation?: string } {
  const minC = Math.max(GRID_MIN, -activeRing);
  const maxC = Math.min(GRID_MAX, activeRing);

  for (let gx = minC; gx <= maxC; gx++) {
    for (let gz = minC; gz <= maxC; gz++) {
      const s = grid.get(sectorKey(gx, gz));
      if (!s) continue;
      if (s.phase !== 'STABLE' && Math.abs(s.level - s.targetLevel) > 1) {
        return {
          valid: false,
          violation: `Sector (${gx},${gz}) jumps >1 level (${s.level} -> ${s.targetLevel})`,
        };
      }
      const sLevels = getEffectiveLevels(s);
      for (const nbCoord of getNeighbors8(gx, gz, activeRing)) {
        const nb = grid.get(sectorKey(nbCoord.gx, nbCoord.gz));
        if (!nb) continue;
        for (const ls of sLevels) {
          for (const ln of getEffectiveLevels(nb)) {
            if (Math.abs(ls - ln) > 1) {
              return {
                valid: false,
                violation: `Cohesion broken between (${gx},${gz})[L=${ls}] and (${nbCoord.gx},${nbCoord.gz})[L=${ln}]`,
              };
            }
          }
        }
      }
    }
  }

  return { valid: true };
}
