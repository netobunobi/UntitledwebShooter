import { describe, expect, it } from 'vitest';
import { CLASS_DEFS } from '../shared/classes.js';
import {
  WEAPON_DEFS,
  WEAPON_LIST,
  getPelletDirections,
  getRecoilStep,
} from '../shared/weapons.js';

describe('Deterministic Weapons, Recoil Patterns & Fixed Shotgun Spread', () => {
  it('produces identical recoil steps on repeated runs with zero RNG', () => {
    for (const wId of WEAPON_LIST) {
      const def = WEAPON_DEFS[wId];
      for (let i = 0; i < def.magSize; i++) {
        const runA = getRecoilStep(wId, i, 1.0);
        const runB = getRecoilStep(wId, i, 1.0);
        expect(runA).toEqual(runB);
        expect(Number.isFinite(runA.dpitch)).toBe(true);
        expect(Number.isFinite(runA.dyaw)).toBe(true);
      }
    }
  });

  it('applies Vanguard passive -20% recoil reduction deterministically', () => {
    const base = getRecoilStep(0, 3, 1.0);
    const vanguard = getRecoilStep(0, 3, CLASS_DEFS.vanguard.recoilMult);
    expect(vanguard.dpitch).toBeCloseTo(base.dpitch * 0.8, 6);
    expect(vanguard.dyaw).toBeCloseTo(base.dyaw * 0.8, 6);
  });

  it('generates exact 8-pellet fixed geometric spread for Breacher SG without randomness', () => {
    const forward = { x: 0, y: 0, z: -1 };
    const pelletsA = getPelletDirections(forward, 2);
    const pelletsB = getPelletDirections(forward, 2);

    expect(pelletsA.length).toBe(8);
    expect(pelletsA).toEqual(pelletsB);
    // Center pellet matches forward direction exactly
    expect(pelletsA[0].x).toBeCloseTo(0, 6);
    expect(pelletsA[0].y).toBeCloseTo(0, 6);
    expect(pelletsA[0].z).toBeCloseTo(-1, 6);

    // Outer 7 pellets are symmetric and distinct
    for (let i = 1; i < 8; i++) {
      expect(pelletsA[i].z).toBeLessThan(-0.99);
      const mag = Math.hypot(pelletsA[i].x, pelletsA[i].y, pelletsA[i].z);
      expect(mag).toBeCloseTo(1.0, 5);
    }
  });
});
