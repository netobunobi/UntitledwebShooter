import { describe, expect, it } from 'vitest';
import { SectorDirector } from '../server/SectorDirector.js';
import { SECTOR_SIZE, SECTOR_TRANSITION_MS, SECTOR_WARNING_MS } from '../shared/constants.js';
import {
  getBlueprintBlocks,
  getSectorStructureAABBs,
  sectorKey,
  validateGridCohesion,
} from '../shared/sectors.js';

function createSeededRng(seed = 123456): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

describe('Modular Cohesive Sectors (Strict 8-Neighbor Invariant)', () => {
  it('maintains strict 8-neighbor cohesion across 10,000 evolution cycles (1x, 2x, 4x)', () => {
    const director = new SectorDirector(createSeededRng(42));
    expect(validateGridCohesion(director.grid, 3).valid).toBe(true);

    let simTime = 0;
    const speeds: Array<1 | 2 | 4> = [1, 2, 4];

    for (let cycle = 0; cycle < 10_000; cycle++) {
      if (cycle % 2500 === 0) {
        director.setEvolutionSettings({ speedMultiplier: speeds[(cycle / 2500) % 3] });
      }
      simTime += 1000;
      director.update(simTime, 3);
      const check = validateGridCohesion(director.grid, 3);
      if (!check.valid) {
        throw new Error(`Cycle ${cycle}: ${check.violation}`);
      }
      expect(check.valid).toBe(true);
    }
  });

  it('forces sector (0,0) to City (2) and (1,1) to Open Field (0) safely via cohesive cascades', () => {
    const director = new SectorDirector(createSeededRng(99));
    director.setEvolutionSettings({ autoEvolutionEnabled: false });

    // Initial state: (0,0) is 1, (2,2) is 0. Try forcing (2,2) straight to 2 (requires 0->1 then 1->2 + neighbor cascade)
    director.forceSectorLevel(2, 2, 2, 0, 3);

    let simTime = 0;
    for (let i = 0; i < 60; i++) {
      simTime += 1000;
      director.update(simTime, 3);
      expect(validateGridCohesion(director.grid, 3).valid).toBe(true);
    }

    expect(director.grid.get(sectorKey(2, 2))?.level).toBe(2);

    // Now force (2,2) all the way back to 0 while neighboring sectors might be 1 or 2
    director.forceSectorLevel(2, 2, 0, simTime, 3);
    for (let i = 0; i < 60; i++) {
      simTime += 1000;
      director.update(simTime, 3);
      expect(validateGridCohesion(director.grid, 3).valid).toBe(true);
    }
    expect(director.grid.get(sectorKey(2, 2))?.level).toBe(0);
  });

  it('produces positive upward vy during emergence sub-phase after 10s warning', () => {
    const director = new SectorDirector(createSeededRng(7));
    director.setEvolutionSettings({ autoEvolutionEnabled: false });
    director.forceSectorLevel(1, 1, 1, 0, 1);

    const s = director.grid.get(sectorKey(1, 1))!;
    expect(s.phase).toBe('WARNING');
    expect(s.warnEnd).toBe(SECTOR_WARNING_MS);
    expect(s.emergeEnd).toBe(SECTOR_WARNING_MS + SECTOR_TRANSITION_MS);

    director.update(SECTOR_WARNING_MS + 100, 1);
    expect(s.phase).toBe('TRANSITIONING');

    // During sub-phase B (after 1.5s retract), structures emerge upward with vy > 0
    const emergeSampleMs = SECTOR_WARNING_MS + 2000;
    const boxes = getSectorStructureAABBs(s, emergeSampleMs);
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.some((b) => (b.vy ?? 0) > 0)).toBe(true);
  });

  it('provides 32m varied starting districts and enterable 4-5 story city buildings with stairs and roofs', () => {
    expect(SECTOR_SIZE).toBe(32);
    const director = new SectorDirector(createSeededRng(11));
    expect(validateGridCohesion(director.grid, 3).valid).toBe(true);

    // Varied initial ring 1: includes City (2), Suburb (1), and Open Field (0)
    expect(director.grid.get(sectorKey(-1, -1))?.level).toBe(2);
    expect(director.grid.get(sectorKey(0, 0))?.level).toBe(1);
    expect(director.grid.get(sectorKey(1, 1))?.level).toBe(0);

    // Level 2 variant 0 has 5-story tower (>= 15m), interior stairs & floor slabs
    const cityBlocks = getBlueprintBlocks(2, 0, 0);
    const maxY = Math.max(...cityBlocks.map((b) => b.maxY));
    expect(maxY).toBeGreaterThanOrEqual(15);
    expect(cityBlocks.some((b) => b.kind === 'stair')).toBe(true);
    expect(cityBlocks.some((b) => b.kind === 'floor_slab')).toBe(true);
    expect(cityBlocks.some((b) => b.kind === 'roof_slate')).toBe(true);
  });
});
