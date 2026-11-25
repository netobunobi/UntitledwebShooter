import * as THREE from 'three';
import { getArenaHalfExtent } from '../../../shared/collision.js';
import { SECTOR_SIZE } from '../../../shared/constants.js';
import type { ObjectiveSnapshot, WallState } from '../../../shared/protocol.js';
import {
  getSectorVisualBlocks,
  getSectorWarningFootprints,
  sectorCenterWorld,
  sectorKey,
  type BlockKind,
  type SectorState,
} from '../../../shared/sectors.js';

const KIND_LIST: BlockKind[] = [
  'wall_light',
  'wall_dark',
  'floor_slab',
  'roof_terracotta',
  'roof_slate',
  'trim',
  'stair',
  'container',
  'rock',
  'tree_trunk',
  'tree_canopy',
  'barricade',
];

const KIND_COLORS: Record<BlockKind, number> = {
  wall_light: 0xe6dfd3,
  wall_dark: 0x475569,
  floor_slab: 0x94a3b8,
  roof_terracotta: 0xb85c44,
  roof_slate: 0x334155,
  trim: 0xcbd5e1,
  stair: 0x64748b,
  container: 0x1e6b8c,
  rock: 0x6e737b,
  tree_trunk: 0x6b4423,
  tree_canopy: 0x2d6a4f,
  barricade: 0xb47b44,
};

const MAX_INSTANCES_PER_KIND = 4096;
const MAX_SECTORS = 49;
const MAX_WARNINGS = 320;
const MAX_WALLS = 40;

export class SectorRenderer {
  private kindMeshes: Map<BlockKind, THREE.InstancedMesh> = new Map();
  private sectorFloorMesh: THREE.InstancedMesh;
  private warnCarpetMesh: THREE.InstancedMesh;
  private warnCarpetMat: THREE.MeshBasicMaterial;
  private warnPillarsMesh: THREE.InstancedMesh;
  private warnPillarsMat: THREE.MeshBasicMaterial;
  private warnHolosMesh: THREE.InstancedMesh;
  private wallsMesh: THREE.InstancedMesh;
  private boundaryGroup: THREE.Group;
  private objectiveMesh: THREE.InstancedMesh;

  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();

  private geometryDirty = true;
  private lastWarnStateKey = '';
  private lastWallsKey = '';
  private lastObjKey = '';

  constructor(scene: THREE.Scene) {
    // Base distant ground skirt (1 draw call)
    const groundGeo = new THREE.PlaneGeometry(340, 340);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x526b48, flatShading: true });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = -0.05;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    // Grid overlay across 7x7 32m sectors (1 draw call)
    const grid = new THREE.GridHelper(SECTOR_SIZE * 7, 7, 0x1e293b, 0x334155);
    grid.position.y = 0.02;
    scene.add(grid);

    const unitBox = new THREE.BoxGeometry(1, 1, 1);

    // Per-quadrant floor slab colored by phase (1 draw call)
    const floorMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.sectorFloorMesh = new THREE.InstancedMesh(unitBox, floorMat, MAX_SECTORS);
    this.sectorFloorMesh.count = 0;
    this.sectorFloorMesh.receiveShadow = true;
    this.sectorFloorMesh.frustumCulled = false;
    scene.add(this.sectorFloorMesh);

    // 12 Architectural structure buckets (<=12 draw calls)
    for (const kind of KIND_LIST) {
      const mat = new THREE.MeshLambertMaterial({
        color: KIND_COLORS[kind],
        flatShading: true,
      });
      const mesh = new THREE.InstancedMesh(unitBox, mat, MAX_INSTANCES_PER_KIND);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.kindMeshes.set(kind, mesh);
    }

    // Full-quadrant 32x32m warning carpet (1 draw call)
    this.warnCarpetMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    this.warnCarpetMesh = new THREE.InstancedMesh(unitBox, this.warnCarpetMat, MAX_SECTORS);
    this.warnCarpetMesh.count = 0;
    this.warnCarpetMesh.frustumCulled = false;
    scene.add(this.warnCarpetMesh);

    // Warning 16m corner beacon pillars + quadrant border bars (1 draw call)
    this.warnPillarsMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    this.warnPillarsMesh = new THREE.InstancedMesh(unitBox, this.warnPillarsMat, MAX_SECTORS * 8);
    this.warnPillarsMesh.count = 0;
    this.warnPillarsMesh.frustumCulled = false;
    scene.add(this.warnPillarsMesh);

    // Holographic wireframe silhouettes of upcoming buildings (1 draw call)
    const holoMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      wireframe: true,
      transparent: true,
      opacity: 0.55,
    });
    this.warnHolosMesh = new THREE.InstancedMesh(unitBox, holoMat, MAX_WARNINGS);
    this.warnHolosMesh.count = 0;
    this.warnHolosMesh.frustumCulled = false;
    scene.add(this.warnHolosMesh);

    // Tactical Walls Q (1 draw call)
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.wallsMesh = new THREE.InstancedMesh(unitBox, wallMat, MAX_WALLS);
    this.wallsMesh.count = 0;
    this.wallsMesh.frustumCulled = false;
    scene.add(this.wallsMesh);

    // Objectives (1 draw call)
    const objMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    this.objectiveMesh = new THREE.InstancedMesh(unitBox, objMat, 8);
    this.objectiveMesh.count = 0;
    this.objectiveMesh.frustumCulled = false;
    scene.add(this.objectiveMesh);

    // Perimeter barrier for activeRing
    this.boundaryGroup = new THREE.Group();
    const boundMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const wallGeo = new THREE.PlaneGeometry(1, 18);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(wallGeo, boundMat);
      m.position.y = 9;
      this.boundaryGroup.add(m);
    }
    scene.add(this.boundaryGroup);
    this.updateActiveRing(1);
  }

  public markDirty(): void {
    this.geometryDirty = true;
  }

  public updateActiveRing(activeRing: number): void {
    this.geometryDirty = true;
    const ext = getArenaHalfExtent(activeRing);
    const len = ext * 2;
    const children = this.boundaryGroup.children as THREE.Mesh[];

    children[0].position.set(0, 9, -ext);
    children[0].rotation.set(0, 0, 0);
    children[0].scale.set(len, 1, 1);

    children[1].position.set(0, 9, ext);
    children[1].rotation.set(0, Math.PI, 0);
    children[1].scale.set(len, 1, 1);

    children[2].position.set(-ext, 9, 0);
    children[2].rotation.set(0, Math.PI / 2, 0);
    children[2].scale.set(len, 1, 1);

    children[3].position.set(ext, 9, 0);
    children[3].rotation.set(0, -Math.PI / 2, 0);
    children[3].scale.set(len, 1, 1);
  }

  public update(
    sectors: Map<string, SectorState>,
    walls: WallState[],
    objective: ObjectiveSnapshot | null,
    activeRing: number,
    simTimeMs: number
  ): void {
    let hasTransitioning = false;
    let fastestWarnPulse = 0;
    let urgentColor = false;
    const warnKeys: string[] = [];

    for (let gx = -activeRing; gx <= activeRing; gx++) {
      for (let gz = -activeRing; gz <= activeRing; gz++) {
        const s = sectors.get(sectorKey(gx, gz));
        if (!s) continue;
        if (s.phase === 'TRANSITIONING') {
          hasTransitioning = true;
        }
        if (s.phase === 'WARNING' || s.phase === 'TRANSITIONING') {
          warnKeys.push(`${gx},${gz},${s.phase},${s.targetLevel},${s.targetVariant}`);
          if (s.phase === 'WARNING') {
            const rem = Math.max(0, s.warnEnd - simTimeMs);
            if (rem <= 3000) {
              fastestWarnPulse = 14;
              urgentColor = true;
            } else {
              fastestWarnPulse = Math.max(fastestWarnPulse, 4.5);
            }
          }
        }
      }
    }

    // 1. Rebuild static/emerging buildings ONLY when dirty or mid-transition
    if (this.geometryDirty || hasTransitioning) {
      this.geometryDirty = false;
      const counts: Record<BlockKind, number> = {
        wall_light: 0,
        wall_dark: 0,
        floor_slab: 0,
        roof_terracotta: 0,
        roof_slate: 0,
        trim: 0,
        stair: 0,
        container: 0,
        rock: 0,
        tree_trunk: 0,
        tree_canopy: 0,
        barricade: 0,
      };
      let floorCount = 0;

      for (let gx = -activeRing; gx <= activeRing; gx++) {
        for (let gz = -activeRing; gz <= activeRing; gz++) {
          const sector = sectors.get(sectorKey(gx, gz));
          if (!sector) continue;

          // Quadrant floor slab colored by phase
          if (floorCount < MAX_SECTORS) {
            const c = sectorCenterWorld(gx, gz);
            this.dummy.position.set(c.x, -0.02, c.z);
            this.dummy.rotation.set(0, 0, 0);
            this.dummy.scale.set(SECTOR_SIZE - 0.15, 0.04, SECTOR_SIZE - 0.15);
            this.dummy.updateMatrix();
            this.sectorFloorMesh.setMatrixAt(floorCount, this.dummy.matrix);
            const floorCol =
              sector.level === 0 ? 0x628053 : sector.level === 1 ? 0x7d848d : 0x3b4252;
            this.tmpColor.setHex(floorCol);
            this.sectorFloorMesh.setColorAt(floorCount, this.tmpColor);
            floorCount++;
          }

          const blocks = getSectorVisualBlocks(sector, simTimeMs);
          for (const b of blocks) {
            const idx = counts[b.kind];
            if (idx >= MAX_INSTANCES_PER_KIND) continue;
            this.dummy.position.set(
              (b.minX + b.maxX) * 0.5,
              (b.minY + b.maxY) * 0.5,
              (b.minZ + b.maxZ) * 0.5
            );
            this.dummy.rotation.set(0, 0, 0);
            this.dummy.scale.set(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);
            this.dummy.updateMatrix();
            this.kindMeshes.get(b.kind)!.setMatrixAt(idx, this.dummy.matrix);
            counts[b.kind] = idx + 1;
          }
        }
      }

      this.sectorFloorMesh.count = floorCount;
      this.sectorFloorMesh.instanceMatrix.needsUpdate = true;
      if (this.sectorFloorMesh.instanceColor) this.sectorFloorMesh.instanceColor.needsUpdate = true;

      for (const kind of KIND_LIST) {
        const mesh = this.kindMeshes.get(kind)!;
        mesh.count = counts[kind];
        mesh.instanceMatrix.needsUpdate = true;
      }
    }

    // 2. Full-quadrant 32x32m warning carpet + 4 tall corner pillars + border frame + holographic footprints
    const warnStateKey = warnKeys.join('|');
    if (warnStateKey !== this.lastWarnStateKey) {
      this.lastWarnStateKey = warnStateKey;
      let carpetCount = 0;
      let pillarCount = 0;
      let holoCount = 0;

      for (let gx = -activeRing; gx <= activeRing; gx++) {
        for (let gz = -activeRing; gz <= activeRing; gz++) {
          const s = sectors.get(sectorKey(gx, gz));
          if (!s || s.phase === 'STABLE') continue;

          const c = sectorCenterWorld(gx, gz);
          const half = SECTOR_SIZE * 0.5 - 0.25;

          // Whole quadrant floor tint
          if (carpetCount < MAX_SECTORS) {
            this.dummy.position.set(c.x, 0.035, c.z);
            this.dummy.rotation.set(0, 0, 0);
            this.dummy.scale.set(SECTOR_SIZE - 0.4, 0.03, SECTOR_SIZE - 0.4);
            this.dummy.updateMatrix();
            this.warnCarpetMesh.setMatrixAt(carpetCount++, this.dummy.matrix);
          }

          // 4 tall corner beacon pillars (16m) + 4 bright perimeter strips around quadrant
          const corners = [
            [c.x - half, c.z - half],
            [c.x + half, c.z - half],
            [c.x - half, c.z + half],
            [c.x + half, c.z + half],
          ];
          for (const [px, pz] of corners) {
            if (pillarCount >= MAX_SECTORS * 8) break;
            this.dummy.position.set(px, 8, pz);
            this.dummy.scale.set(0.42, 16, 0.42);
            this.dummy.updateMatrix();
            this.warnPillarsMesh.setMatrixAt(pillarCount++, this.dummy.matrix);
          }

          const edges = [
            { x: c.x, z: c.z - half, sx: SECTOR_SIZE - 0.4, sz: 0.45 },
            { x: c.x, z: c.z + half, sx: SECTOR_SIZE - 0.4, sz: 0.45 },
            { x: c.x - half, z: c.z, sx: 0.45, sz: SECTOR_SIZE - 0.4 },
            { x: c.x + half, z: c.z, sx: 0.45, sz: SECTOR_SIZE - 0.4 },
          ];
          for (const e of edges) {
            if (pillarCount >= MAX_SECTORS * 8) break;
            this.dummy.position.set(e.x, 0.14, e.z);
            this.dummy.scale.set(e.sx, 0.24, e.sz);
            this.dummy.updateMatrix();
            this.warnPillarsMesh.setMatrixAt(pillarCount++, this.dummy.matrix);
          }

          // Holographic wireframe silhouettes for incoming buildings
          for (const f of getSectorWarningFootprints(s)) {
            if (holoCount >= MAX_WARNINGS) break;
            const h = Math.max(1.0, f.maxY);
            this.dummy.position.set((f.minX + f.maxX) * 0.5, h * 0.5, (f.minZ + f.maxZ) * 0.5);
            this.dummy.scale.set(f.maxX - f.minX, h, f.maxZ - f.minZ);
            this.dummy.updateMatrix();
            this.warnHolosMesh.setMatrixAt(holoCount++, this.dummy.matrix);
          }
        }
      }

      this.warnCarpetMesh.count = carpetCount;
      this.warnCarpetMesh.instanceMatrix.needsUpdate = true;
      this.warnPillarsMesh.count = pillarCount;
      this.warnPillarsMesh.instanceMatrix.needsUpdate = true;
      this.warnHolosMesh.count = holoCount;
      this.warnHolosMesh.instanceMatrix.needsUpdate = true;
    }

    // Cheap pulse opacity/color animation without touching matrices
    if (this.warnCarpetMesh.count > 0) {
      const freq = fastestWarnPulse || 4.5;
      const pulse = 0.5 + 0.5 * Math.sin((simTimeMs / 1000) * freq);
      this.warnCarpetMat.color.setHex(urgentColor ? 0xef4444 : 0xf59e0b);
      this.warnCarpetMat.opacity = 0.16 + 0.28 * pulse;
      this.warnPillarsMat.color.setHex(urgentColor ? 0xf87171 : 0xfacc15);
      this.warnPillarsMat.opacity = 0.45 + 0.45 * pulse;
    }

    // 3. Tactical Walls Q (dirty-checked)
    const wallsKey = walls.map((w) => `${w.id}:${w.hp}`).join(',');
    if (wallsKey !== this.lastWallsKey) {
      this.lastWallsKey = wallsKey;
      let wallCount = 0;
      for (const w of walls) {
        if (wallCount >= MAX_WALLS) break;
        this.dummy.position.set(
          (w.box.minX + w.box.maxX) * 0.5,
          (w.box.minY + w.box.maxY) * 0.5,
          (w.box.minZ + w.box.maxZ) * 0.5
        );
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(
          w.box.maxX - w.box.minX,
          w.box.maxY - w.box.minY,
          w.box.maxZ - w.box.minZ
        );
        this.dummy.updateMatrix();
        this.wallsMesh.setMatrixAt(wallCount, this.dummy.matrix);

        const hpRatio = w.hp / Math.max(1, w.maxHp);
        const baseHex = w.team === 'A' ? 0x00d1ff : w.team === 'B' ? 0xff5a36 : 0xfacc15;
        this.tmpColor.setHex(baseHex).multiplyScalar(0.45 + 0.55 * hpRatio);
        this.wallsMesh.setColorAt(wallCount, this.tmpColor);
        wallCount++;
      }
      this.wallsMesh.count = wallCount;
      this.wallsMesh.instanceMatrix.needsUpdate = true;
      if (this.wallsMesh.instanceColor) this.wallsMesh.instanceColor.needsUpdate = true;
    }

    // 4. Objectives (dirty-checked)
    const objKey = JSON.stringify(objective);
    if (objKey !== this.lastObjKey) {
      this.lastObjKey = objKey;
      let objCount = 0;
      if (objective) {
        if (objective.mode === 'snd' && objective.snd) {
          const sites = [
            { pos: objective.snd.siteA, planted: objective.snd.plantedSite === 'A' },
            { pos: objective.snd.siteB, planted: objective.snd.plantedSite === 'B' },
          ];
          for (const s of sites) {
            this.dummy.position.set(s.pos.x, 0.15, s.pos.z);
            this.dummy.scale.set(7.0, 0.25, 7.0);
            this.dummy.updateMatrix();
            this.objectiveMesh.setMatrixAt(objCount, this.dummy.matrix);
            this.tmpColor.setHex(s.planted ? 0xef4444 : 0xfacc15);
            this.objectiveMesh.setColorAt(objCount, this.tmpColor);
            objCount++;
          }
        } else if (objective.mode === 'hardpoint' && objective.hardpoint) {
          const hp = objective.hardpoint;
          this.dummy.position.set(hp.zoneCenter.x, 0.15, hp.zoneCenter.z);
          this.dummy.scale.set(8.0, 0.25, 8.0);
          this.dummy.updateMatrix();
          this.objectiveMesh.setMatrixAt(objCount, this.dummy.matrix);
          const col =
            hp.owner === 'A'
              ? 0x00d1ff
              : hp.owner === 'B'
                ? 0xff5a36
                : hp.owner === 'CONTESTED'
                  ? 0xef4444
                  : 0xfacc15;
          this.tmpColor.setHex(col);
          this.objectiveMesh.setColorAt(objCount, this.tmpColor);
          objCount++;

          if (hp.nextCenter && hp.rotatesAt - simTimeMs <= 10_000) {
            this.dummy.position.set(hp.nextCenter.x, 0.08, hp.nextCenter.z);
            this.dummy.scale.set(8.0, 0.1, 8.0);
            this.dummy.updateMatrix();
            this.objectiveMesh.setMatrixAt(objCount, this.dummy.matrix);
            this.tmpColor.setHex(0xffffff);
            this.objectiveMesh.setColorAt(objCount, this.tmpColor);
            objCount++;
          }
        } else if (objective.mode === 'domination' && objective.domination) {
          for (const z of objective.domination.zones) {
            this.dummy.position.set(z.pos.x, 0.15, z.pos.z);
            this.dummy.scale.set(9.0, 0.25, 9.0);
            this.dummy.updateMatrix();
            this.objectiveMesh.setMatrixAt(objCount, this.dummy.matrix);
            const col = z.owner === 'A' ? 0x00d1ff : z.owner === 'B' ? 0xff5a36 : 0xe2e8f0;
            this.tmpColor.setHex(col);
            this.objectiveMesh.setColorAt(objCount, this.tmpColor);
            objCount++;
          }
        }
      }
      this.objectiveMesh.count = objCount;
      this.objectiveMesh.instanceMatrix.needsUpdate = true;
      if (this.objectiveMesh.instanceColor) this.objectiveMesh.instanceColor.needsUpdate = true;
    }
  }
}
