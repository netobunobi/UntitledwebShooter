import { describe, expect, it } from 'vitest';
import { CLASS_DEFS } from '../shared/classes.js';
import {
  aabbIntersects,
  computeBlinkDestination,
  ensureUnstuck,
  getArenaHalfExtent,
  getPlayerAABB,
  getPlayerCombatHitboxes,
  raycastAABB,
  type AABB,
} from '../shared/collision.js';
import { FIXED_DT, KEY_W } from '../shared/constants.js';
import { DEFAULT_MODIFIERS } from '../shared/modifiers.js';
import { createInitialPhysState, stepPlayerPhysics } from '../shared/physics.js';

describe('AABB Collision, Scaling, Step-Up, Blink & Anti-Trap', () => {
  it('scales player AABB and combat hitboxes uniformly with playerScale', () => {
    const normalBox = getPlayerAABB(0, 0, 0, false, 1.0);
    const giantBox = getPlayerAABB(0, 0, 0, false, 2.0);
    const miniBox = getPlayerAABB(0, 0, 0, false, 0.5);

    expect(giantBox.maxY).toBeCloseTo(normalBox.maxY * 2.0, 5);
    expect(giantBox.maxX - giantBox.minX).toBeCloseTo((normalBox.maxX - normalBox.minX) * 2.0, 5);
    expect(miniBox.maxY).toBeCloseTo(normalBox.maxY * 0.5, 5);

    const hb = getPlayerCombatHitboxes(0, 0, 0, false, 2.0);
    expect(hb.head.maxY).toBeCloseTo(3.6, 5);
    expect(hb.head.minY).toBeCloseTo(2.9, 5);
  });

  it('pushes a standing player smoothly upward when an emerging structure rises beneath them', () => {
    const state = createInitialPhysState(0, 0, 0);
    const emergingBox: AABB = {
      minX: -2,
      minY: 0,
      minZ: -2,
      maxX: 2,
      maxY: 0.4,
      maxZ: 2,
      vy: 2.5,
      kind: 'building',
    };

    for (let tick = 0; tick < 30; tick++) {
      emergingBox.maxY += emergingBox.vy! * FIXED_DT;
      stepPlayerPhysics(
        state,
        { keys: 0, yaw: 0 },
        [emergingBox],
        1,
        DEFAULT_MODIFIERS,
        CLASS_DEFS.assault,
        FIXED_DT
      );
      expect(state.y).toBeGreaterThanOrEqual(emergingBox.maxY - 0.01);
      expect(state.grounded).toBe(true);
    }

    const pBox = getPlayerAABB(state.x, state.y, state.z, false, 1.0);
    expect(aabbIntersects(pBox, emergingBox, 0.01)).toBe(false);
  });

  it('climbs low steps automatically via step-up without stalling', () => {
    const state = createInitialPhysState(0, 0, 2);
    const stepBlock: AABB = {
      minX: -2,
      minY: 0,
      minZ: -2,
      maxX: 2,
      maxY: 0.38,
      maxZ: 0.5,
      kind: 'step',
    };

    for (let i = 0; i < 45; i++) {
      stepPlayerPhysics(
        state,
        { keys: KEY_W, yaw: 0 },
        [stepBlock],
        1,
        DEFAULT_MODIFIERS,
        CLASS_DEFS.assault,
        FIXED_DT
      );
    }

    expect(state.z).toBeLessThan(0.5);
    expect(state.y).toBeGreaterThanOrEqual(0.37);
  });

  it('validates Ninja Shadow Blink against solid walls and arena boundary', () => {
    const wall: AABB = {
      minX: -5,
      minY: 0,
      minZ: -4,
      maxX: 5,
      maxY: 3,
      maxZ: -3,
      kind: 'wall',
    };
    const dest = computeBlinkDestination({ x: 0, y: 0, z: 0 }, 0, -1, 10, false, 1.0, [wall], 1);
    // Must stop cleanly in front of wall (-3) without teleporting through it
    expect(dest.z).toBeGreaterThan(-3.0);

    const ext = getArenaHalfExtent(1);
    const edgeDest = computeBlinkDestination(
      { x: 0, y: 0, z: -(ext - 2) },
      0,
      -1,
      10,
      false,
      1.0,
      [],
      1
    );
    expect(edgeDest.z).toBeGreaterThan(-ext);
  });

  it('ensureUnstuck pops trapped player above solid when playerScale grows', () => {
    const roofBox: AABB = {
      minX: -3,
      minY: 0,
      minZ: -3,
      maxX: 3,
      maxY: 2.2,
      maxZ: 3,
      kind: 'building',
    };
    const rescued = ensureUnstuck({ x: 0, y: 0.1, z: 0 }, false, 2.0, [roofBox], 1);
    expect(rescued.y).toBeGreaterThanOrEqual(2.2);
  });

  it('computes accurate slab raycast hit distance and surface normal', () => {
    const box: AABB = { minX: -1, minY: 0, minZ: -6, maxX: 1, maxY: 2, maxZ: -4 };
    const hit = raycastAABB({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 20, box);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(4, 5);
    expect(hit!.normal).toEqual({ x: 0, y: 0, z: 1 });
  });
});
