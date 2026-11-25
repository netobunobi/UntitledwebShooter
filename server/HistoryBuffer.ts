import { HISTORY_BUFFER_MS, MAX_LAG_COMP_MS } from '../shared/constants.js';
import type { ServerPlayer } from './types.js';

export interface PlayerHistoryPose {
  x: number;
  y: number;
  z: number;
  crouched: boolean;
  alive: boolean;
}

export interface HistoryFrame {
  simTimeMs: number;
  poses: Map<string, PlayerHistoryPose>;
}

export class HistoryBuffer {
  private frames: HistoryFrame[] = [];

  public clear(): void {
    this.frames = [];
  }

  public record(simTimeMs: number, players: Iterable<ServerPlayer>): void {
    const poses = new Map<string, PlayerHistoryPose>();
    for (const p of players) {
      poses.set(p.id, {
        x: p.phys.x,
        y: p.phys.y,
        z: p.phys.z,
        crouched: p.phys.crouching || p.phys.sliding,
        alive: p.alive,
      });
    }
    this.frames.push({ simTimeMs, poses });

    const cutoff = simTimeMs - HISTORY_BUFFER_MS;
    while (this.frames.length > 2 && this.frames[0].simTimeMs < cutoff) {
      this.frames.shift();
    }
  }

  public sampleAt(
    requestedSimTimeMs: number,
    currentSimTimeMs: number
  ): { effectiveSimTimeMs: number; poses: Map<string, PlayerHistoryPose> } | null {
    if (this.frames.length === 0) return null;

    const minAllowed = currentSimTimeMs - MAX_LAG_COMP_MS;
    const targetTime = Math.max(minAllowed, Math.min(currentSimTimeMs, requestedSimTimeMs));

    let before: HistoryFrame | null = null;
    let after: HistoryFrame | null = null;
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      if (f.simTimeMs <= targetTime) {
        before = f;
        after = this.frames[i + 1] ?? null;
        break;
      }
    }

    if (!before) {
      const first = this.frames[0];
      return { effectiveSimTimeMs: first.simTimeMs, poses: first.poses };
    }
    if (!after || after.simTimeMs === before.simTimeMs) {
      return { effectiveSimTimeMs: before.simTimeMs, poses: before.poses };
    }

    const alpha = Math.max(
      0,
      Math.min(1, (targetTime - before.simTimeMs) / (after.simTimeMs - before.simTimeMs))
    );
    const interpolated = new Map<string, PlayerHistoryPose>();
    for (const [id, pA] of before.poses) {
      const pB = after.poses.get(id);
      if (!pB) {
        interpolated.set(id, pA);
        continue;
      }
      interpolated.set(id, {
        x: pA.x + (pB.x - pA.x) * alpha,
        y: pA.y + (pB.y - pA.y) * alpha,
        z: pA.z + (pB.z - pA.z) * alpha,
        crouched: alpha < 0.5 ? pA.crouched : pB.crouched,
        alive: pA.alive && pB.alive,
      });
    }

    return { effectiveSimTimeMs: targetTime, poses: interpolated };
  }
}
