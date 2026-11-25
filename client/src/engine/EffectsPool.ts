import * as THREE from 'three';
import { evalProjectileAt, type ProjectileKind, type Vec3 } from '../../../shared/projectiles.js';
import type { SmokeState } from '../../../shared/protocol.js';

interface TracerItem {
  mesh: THREE.Mesh;
  expiresAt: number;
}

interface SparkItem {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  expiresAt: number;
}

interface ClientProjectile {
  id: string;
  kind: ProjectileKind;
  origin: Vec3;
  vel: Vec3;
  gravity: number;
  spawnedAt: number;
}

const MAX_TRACERS = 48;
const MAX_SPARKS = 96;
const MAX_PROJ = 32;
const MAX_SMOKE_PUFFS = 72;

// Fixed deterministic offsets for 6 Low Poly puffs per smoke cloud (1 draw call total)
const SMOKE_PUFF_OFFSETS: Array<{ ox: number; oy: number; oz: number; s: number }> = [
  { ox: 0, oy: 1.5, oz: 0, s: 3.3 },
  { ox: 2.2, oy: 1.1, oz: 1.2, s: 2.5 },
  { ox: -2.1, oy: 1.2, oz: 1.4, s: 2.5 },
  { ox: 1.3, oy: 1.1, oz: -2.2, s: 2.5 },
  { ox: -1.6, oy: 1.2, oz: -1.9, s: 2.4 },
  { ox: 0, oy: 3.1, oz: 0.3, s: 2.2 },
];

export class EffectsPool {
  private tracers: TracerItem[] = [];
  private sparks: SparkItem[] = [];
  private projectiles: Map<string, ClientProjectile> = new Map();

  private sparkMesh: THREE.InstancedMesh;
  private projMesh: THREE.InstancedMesh;
  private smokeMesh: THREE.InstancedMesh;
  private pulseRingMesh: THREE.Mesh;
  private pulseStart = 0;
  private pulseDur = 0;

  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    // Tracer pool
    const tracerGeo = new THREE.BoxGeometry(0.035, 0.035, 1);
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    for (let i = 0; i < MAX_TRACERS; i++) {
      const m = new THREE.Mesh(tracerGeo, tracerMat);
      m.visible = false;
      scene.add(m);
      this.tracers.push({ mesh: m, expiresAt: 0 });
    }

    // Impact sparks (1 draw call)
    const sparkGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xfdba74 });
    this.sparkMesh = new THREE.InstancedMesh(sparkGeo, sparkMat, MAX_SPARKS);
    this.sparkMesh.count = 0;
    this.sparkMesh.frustumCulled = false;
    scene.add(this.sparkMesh);

    // Projectiles (Kunai, Grenades, Smoke Bombs -> 1 draw call)
    const projGeo = new THREE.BoxGeometry(0.14, 0.14, 0.42);
    const projMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.projMesh = new THREE.InstancedMesh(projGeo, projMat, MAX_PROJ);
    this.projMesh.count = 0;
    this.projMesh.frustumCulled = false;
    scene.add(this.projMesh);

    // Ninja Smoke Clouds: single solid flatShading Icosahedron InstancedMesh (1 draw call)
    const smokeGeo = new THREE.IcosahedronGeometry(1, 0);
    const smokeMat = new THREE.MeshLambertMaterial({
      color: 0xcbd5e1,
      flatShading: true,
    });
    this.smokeMesh = new THREE.InstancedMesh(smokeGeo, smokeMat, MAX_SMOKE_PUFFS);
    this.smokeMesh.count = 0;
    this.smokeMesh.frustumCulled = false;
    scene.add(this.smokeMesh);

    // Recon / Impulse Ring FX (1 draw call)
    const ringGeo = new THREE.RingGeometry(0.85, 1.0, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.pulseRingMesh = new THREE.Mesh(ringGeo, ringMat);
    this.pulseRingMesh.visible = false;
    scene.add(this.pulseRingMesh);
  }

  public spawnTracer(start: Vec3, end: Vec3, nowMs: number): void {
    const item = this.tracers.find((t) => nowMs >= t.expiresAt) ?? this.tracers[0];
    const p0 = new THREE.Vector3(start.x, start.y, start.z);
    const p1 = new THREE.Vector3(end.x, end.y, end.z);
    const dist = p0.distanceTo(p1);
    if (dist < 0.1) return;

    item.mesh.position.copy(p0).lerp(p1, 0.5);
    item.mesh.scale.set(1, 1, dist);
    item.mesh.lookAt(p1);
    item.mesh.visible = true;
    item.expiresAt = nowMs + 75;
  }

  public spawnSparks(pos: Vec3, nowMs: number, count = 5): void {
    for (let i = 0; i < count; i++) {
      if (this.sparks.length >= MAX_SPARKS) this.sparks.shift();
      const angle = (i / count) * Math.PI * 2;
      this.sparks.push({
        pos: new THREE.Vector3(pos.x, pos.y, pos.z),
        vel: new THREE.Vector3(Math.cos(angle) * 3.5, 2.5, Math.sin(angle) * 3.5),
        expiresAt: nowMs + 280,
      });
    }
  }

  public spawnProjectile(
    id: string,
    kind: ProjectileKind,
    origin: Vec3,
    vel: Vec3,
    gravity: number,
    spawnedAt: number
  ): void {
    this.projectiles.set(id, { id, kind, origin, vel, gravity, spawnedAt });
  }

  public removeProjectile(id: string): void {
    this.projectiles.delete(id);
  }

  public triggerRingPulse(pos: Vec3, colorHex: number, durationMs: number, nowMs: number): void {
    this.pulseRingMesh.position.set(pos.x, Math.max(0.15, pos.y), pos.z);
    (this.pulseRingMesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
    this.pulseStart = nowMs;
    this.pulseDur = durationMs;
    this.pulseRingMesh.visible = true;
  }

  public update(nowMs: number, simTimeMs: number, smokes: SmokeState[], dt: number): void {
    // 1. Tracers
    for (const t of this.tracers) {
      if (t.mesh.visible && nowMs >= t.expiresAt) {
        t.mesh.visible = false;
      }
    }

    // 2. Sparks
    let sparkIdx = 0;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      if (nowMs >= s.expiresAt) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.vel.y -= 14 * dt;
      s.pos.addScaledVector(s.vel, dt);
      if (sparkIdx < MAX_SPARKS) {
        this.dummy.position.copy(s.pos);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        this.sparkMesh.setMatrixAt(sparkIdx++, this.dummy.matrix);
      }
    }
    this.sparkMesh.count = sparkIdx;
    if (sparkIdx > 0) this.sparkMesh.instanceMatrix.needsUpdate = true;

    // 3. Projectiles (eval deterministic trajectory)
    let projIdx = 0;
    for (const pr of this.projectiles.values()) {
      if (projIdx >= MAX_PROJ) break;
      const elapsedSec = Math.max(0, (simTimeMs - pr.spawnedAt) / 1000);
      const pos = evalProjectileAt(pr.origin, pr.vel, pr.gravity, elapsedSec);
      this.dummy.position.set(pos.x, pos.y, pos.z);
      this.dummy.lookAt(
        pos.x + pr.vel.x,
        pos.y + pr.vel.y + pr.gravity * elapsedSec,
        pos.z + pr.vel.z
      );
      if (pr.kind === 'kunai') {
        this.dummy.scale.set(0.5, 0.5, 1.3);
        this.tmpColor.setHex(0x38bdf8);
      } else if (pr.kind === 'impulse_grenade') {
        this.dummy.scale.set(1.4, 1.4, 0.7);
        this.tmpColor.setHex(0xf97316);
      } else {
        this.dummy.scale.set(1.3, 1.3, 0.65);
        this.tmpColor.setHex(0x94a3b8);
      }
      this.dummy.updateMatrix();
      this.projMesh.setMatrixAt(projIdx, this.dummy.matrix);
      this.projMesh.setColorAt(projIdx, this.tmpColor);
      projIdx++;
    }
    this.projMesh.count = projIdx;
    if (projIdx > 0) {
      this.projMesh.instanceMatrix.needsUpdate = true;
      if (this.projMesh.instanceColor) this.projMesh.instanceColor.needsUpdate = true;
    }

    // 4. Smoke Clouds (1 InstancedMesh total)
    let puffIdx = 0;
    for (const sm of smokes) {
      const ratio = Math.max(0.2, Math.min(1, (sm.expiresAt - simTimeMs) / 1500));
      for (const off of SMOKE_PUFF_OFFSETS) {
        if (puffIdx >= MAX_SMOKE_PUFFS) break;
        this.dummy.position.set(
          sm.pos.x + off.ox * (sm.radius / 6),
          Math.max(0.8, sm.pos.y + off.oy),
          sm.pos.z + off.oz * (sm.radius / 6)
        );
        this.dummy.rotation.set(0, (simTimeMs * 0.0005) + off.ox, 0);
        this.dummy.scale.setScalar(off.s * (sm.radius / 6) * ratio);
        this.dummy.updateMatrix();
        this.smokeMesh.setMatrixAt(puffIdx++, this.dummy.matrix);
      }
    }
    this.smokeMesh.count = puffIdx;
    if (puffIdx > 0) this.smokeMesh.instanceMatrix.needsUpdate = true;

    // 5. Ring Pulse
    if (this.pulseRingMesh.visible) {
      const u = (nowMs - this.pulseStart) / Math.max(1, this.pulseDur);
      if (u >= 1) {
        this.pulseRingMesh.visible = false;
      } else {
        const radius = 1 + u * 28;
        this.pulseRingMesh.scale.setScalar(radius);
        (this.pulseRingMesh.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - u);
      }
    }
  }
}
