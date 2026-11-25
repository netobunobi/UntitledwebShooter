import * as THREE from 'three';
import {
  FLAG_ALIVE,
  FLAG_CLOAKED,
  FLAG_CROUCHING,
  FLAG_SLIDING,
} from '../../../shared/constants.js';
import type { PlayerSnapshotTuple, TeamId } from '../../../shared/protocol.js';
import type { TimedSnapshot } from '../net/NetworkClient.js';

export interface RemotePlayerMeta {
  id: string;
  name: string;
  team: TeamId;
}

export interface InterpolatedRemotePose {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
  hp: number;
  team: TeamId;
}

const MAX_PLAYERS = 48;

export class PlayerRenderer {
  private readonly scene: THREE.Scene;
  private bodiesMesh: THREE.InstancedMesh;
  private headsMesh: THREE.InstancedMesh;
  private gunsMesh: THREE.InstancedMesh;
  private cloakedMesh: THREE.InstancedMesh;
  private cloakEdgeMesh: THREE.InstancedMesh;

  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();
  private lastPoses: Map<string, InterpolatedRemotePose> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const headMat = new THREE.MeshLambertMaterial({ color: 0xf1f5f9, flatShading: true });
    const gunMat = new THREE.MeshLambertMaterial({ color: 0x1e293b, flatShading: true });
    const cloakMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      flatShading: true,
    });
    const edgeMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
    });

    this.bodiesMesh = new THREE.InstancedMesh(unitBox, bodyMat, MAX_PLAYERS);
    this.headsMesh = new THREE.InstancedMesh(unitBox, headMat, MAX_PLAYERS);
    this.gunsMesh = new THREE.InstancedMesh(unitBox, gunMat, MAX_PLAYERS);
    this.cloakedMesh = new THREE.InstancedMesh(unitBox, cloakMat, MAX_PLAYERS);
    this.cloakEdgeMesh = new THREE.InstancedMesh(unitBox, edgeMat, MAX_PLAYERS);

    for (const m of [
      this.bodiesMesh,
      this.headsMesh,
      this.gunsMesh,
      this.cloakedMesh,
      this.cloakEdgeMesh,
    ]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      scene.add(m);
    }
    this.bodiesMesh.castShadow = true;
    this.headsMesh.castShadow = true;
  }

  private getTeamColorHex(team: TeamId): number {
    if (team === 'A') return 0x00d1ff;
    if (team === 'B') return 0xff5a36;
    return 0xf59e0b;
  }

  public getInterpolatedPose(id: string): InterpolatedRemotePose | undefined {
    return this.lastPoses.get(id);
  }

  public update(
    snapshots: TimedSnapshot[],
    renderSimTime: number,
    localPlayerId: string,
    localTeam: TeamId,
    localPos: { x: number; y: number; z: number },
    playerMeta: Map<string, RemotePlayerMeta>,
    playerScale: number
  ): void {
    this.lastPoses.clear();
    if (snapshots.length === 0) {
      this.bodiesMesh.count = 0;
      this.headsMesh.count = 0;
      this.gunsMesh.count = 0;
      this.cloakedMesh.count = 0;
      this.cloakEdgeMesh.count = 0;
      return;
    }

    let snapA = snapshots[snapshots.length - 1];
    let snapB = snapA;
    for (let i = snapshots.length - 1; i >= 0; i--) {
      if (snapshots[i].recvSimTime <= renderSimTime) {
        snapA = snapshots[i];
        snapB = snapshots[i + 1] ?? snapA;
        break;
      }
    }

    const span = snapB.recvSimTime - snapA.recvSimTime;
    const alpha = span > 0 ? Math.max(0, Math.min(1, (renderSimTime - snapA.recvSimTime) / span)) : 0;

    const mapB = new Map<string, PlayerSnapshotTuple>();
    for (const t of snapB.data.players) mapB.set(t[0], t);

    let solidIdx = 0;
    let cloakIdx = 0;
    let edgeIdx = 0;

    for (const tA of snapA.data.players) {
      const id = tA[0];
      const tB = mapB.get(id) ?? tA;

      const x = tA[1] + (tB[1] - tA[1]) * alpha;
      const y = tA[2] + (tB[2] - tA[2]) * alpha;
      const z = tA[3] + (tB[3] - tA[3]) * alpha;
      const yaw = tB[7];
      const pitch = tB[8];
      const flags = tB[9];
      const hp = tB[10];
      const meta = playerMeta.get(id);
      const team: TeamId = meta?.team ?? 'NONE';

      this.lastPoses.set(id, { id, x, y, z, yaw, pitch, flags, hp, team });

      if (id === localPlayerId) continue;
      if ((flags & FLAG_ALIVE) === 0) continue;

      const crouched = Boolean(flags & (FLAG_CROUCHING | FLAG_SLIDING));
      const cloaked = Boolean(flags & FLAG_CLOAKED);
      const totalH = (crouched ? 1.0 : 1.8) * playerScale;
      const bodyH = totalH * 0.72;
      const headSize = 0.42 * playerScale;
      const bodyW = 0.68 * playerScale;
      const bodyD = 0.48 * playerScale;

      const distSq =
        (x - localPos.x) * (x - localPos.x) +
        (y - localPos.y) * (y - localPos.y) +
        (z - localPos.z) * (z - localPos.z);

      if (cloaked) {
        if (cloakIdx < MAX_PLAYERS) {
          this.dummy.position.set(x, y + totalH * 0.5, z);
          this.dummy.rotation.set(0, yaw, 0);
          this.dummy.scale.set(bodyW, totalH, bodyD);
          this.dummy.updateMatrix();
          this.cloakedMesh.setMatrixAt(cloakIdx, this.dummy.matrix);
          const isAlly = localTeam !== 'NONE' && team === localTeam;
          this.tmpColor.setHex(isAlly ? this.getTeamColorHex(team) : 0xcbd5e1);
          this.cloakedMesh.setColorAt(cloakIdx, this.tmpColor);
          cloakIdx++;
        }

        // Subtle silhouette edge at close range (< 5m)
        if (distSq <= 25 && edgeIdx < MAX_PLAYERS) {
          this.dummy.position.set(x, y + totalH * 0.5, z);
          this.dummy.rotation.set(0, yaw, 0);
          this.dummy.scale.set(bodyW * 1.04, totalH * 1.02, bodyD * 1.04);
          this.dummy.updateMatrix();
          this.cloakEdgeMesh.setMatrixAt(edgeIdx++, this.dummy.matrix);
        }
        continue;
      }

      if (solidIdx >= MAX_PLAYERS) continue;

      // Body
      this.dummy.position.set(x, y + bodyH * 0.5, z);
      this.dummy.rotation.set(Boolean(flags & FLAG_SLIDING) ? 0.35 : 0, yaw, 0);
      this.dummy.scale.set(bodyW, bodyH, bodyD);
      this.dummy.updateMatrix();
      this.bodiesMesh.setMatrixAt(solidIdx, this.dummy.matrix);
      this.tmpColor.setHex(this.getTeamColorHex(team));
      this.bodiesMesh.setColorAt(solidIdx, this.tmpColor);

      // Head
      this.dummy.position.set(x, y + bodyH + headSize * 0.55, z);
      this.dummy.rotation.set(pitch * 0.5, yaw, 0);
      this.dummy.scale.set(headSize, headSize, headSize);
      this.dummy.updateMatrix();
      this.headsMesh.setMatrixAt(solidIdx, this.dummy.matrix);

      // Weapon block
      const fwdX = -Math.sin(yaw);
      const fwdZ = -Math.cos(yaw);
      const rightX = Math.cos(yaw);
      const rightZ = -Math.sin(yaw);
      this.dummy.position.set(
        x + fwdX * 0.45 * playerScale + rightX * 0.25 * playerScale,
        y + bodyH * 0.85,
        z + fwdZ * 0.45 * playerScale + rightZ * 0.25 * playerScale
      );
      this.dummy.rotation.set(pitch, yaw, 0);
      this.dummy.scale.set(0.12 * playerScale, 0.14 * playerScale, 0.65 * playerScale);
      this.dummy.updateMatrix();
      this.gunsMesh.setMatrixAt(solidIdx, this.dummy.matrix);

      solidIdx++;
    }

    this.bodiesMesh.count = solidIdx;
    this.headsMesh.count = solidIdx;
    this.gunsMesh.count = solidIdx;
    if (solidIdx > 0) {
      this.bodiesMesh.instanceMatrix.needsUpdate = true;
      this.headsMesh.instanceMatrix.needsUpdate = true;
      this.gunsMesh.instanceMatrix.needsUpdate = true;
      if (this.bodiesMesh.instanceColor) this.bodiesMesh.instanceColor.needsUpdate = true;
    }

    this.cloakedMesh.count = cloakIdx;
    if (cloakIdx > 0) {
      this.cloakedMesh.instanceMatrix.needsUpdate = true;
      if (this.cloakedMesh.instanceColor) this.cloakedMesh.instanceColor.needsUpdate = true;
    }

    this.cloakEdgeMesh.count = edgeIdx;
    if (edgeIdx > 0) {
      this.cloakEdgeMesh.instanceMatrix.needsUpdate = true;
    }
  }

  public projectTargetsToScreen(
    camera: THREE.Camera,
    targetIds: string[],
    width: number,
    height: number
  ): Array<{ id: string; sx: number; sy: number }> {
    const out: Array<{ id: string; sx: number; sy: number }> = [];
    const v = new THREE.Vector3();
    for (const id of targetIds) {
      const pose = this.lastPoses.get(id);
      if (!pose || (pose.flags & FLAG_ALIVE) === 0) continue;
      v.set(pose.x, pose.y + 1.1, pose.z);
      v.project(camera);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * width;
      const sy = (-v.y * 0.5 + 0.5) * height;
      out.push({ id, sx, sy });
    }
    return out;
  }
}
