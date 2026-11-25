import {
  GRID_MAX,
  GRID_MIN,
  SECTOR_TRANSITION_MS,
  SECTOR_WARNING_MS,
} from '../shared/constants.js';
import type { MapEvolutionSettings } from '../shared/protocol.js';
import {
  canTransitionSector,
  getBlueprintCount,
  getNeighbors8,
  sectorKey,
  type SectorLevel,
  type SectorRotation,
  type SectorState,
} from '../shared/sectors.js';

interface ForceIntent {
  gx: number;
  gz: number;
  desiredLevel: SectorLevel;
}

export interface SectorDirectorEvents {
  onSectorWarning?: (sector: SectorState) => void;
  onSectorUpdate?: (sector: SectorState) => void;
}

export class SectorDirector {
  public readonly grid: Map<string, SectorState> = new Map();
  public settings: MapEvolutionSettings = {
    autoEvolutionEnabled: true,
    speedMultiplier: 1,
  };

  private nextAutoTickAt = 12_000;
  private forceQueue: ForceIntent[] = [];
  private rng: () => number;
  private events: SectorDirectorEvents;

  constructor(rng: () => number = Math.random, events: SectorDirectorEvents = {}) {
    this.rng = rng;
    this.events = events;
    this.initGrid();
  }

  public initGrid(): void {
    this.grid.clear();
    this.forceQueue = [];
    this.nextAutoTickAt = 12_000;

    for (let gx = GRID_MIN; gx <= GRID_MAX; gx++) {
      for (let gz = GRID_MIN; gz <= GRID_MAX; gz++) {
        // Varied starting arena honoring strict 8-neighbor cohesion:
        // (-1, -1) is Closed City (Level 2, 4-5 story buildings),
        // its 8 neighbors (gx in [-2..0], gz in [-2..0]) are Suburb (Level 1),
        // and the opposite side/rest of the map is Open Field (Level 0).
        let level: SectorLevel = 0;
        if (gx === -1 && gz === -1) {
          level = 2;
        } else if (gx >= -2 && gx <= 0 && gz >= -2 && gz <= 0) {
          level = 1;
        }
        const variant = Math.abs(gx * 3 + gz * 5) % getBlueprintCount(level);
        const rotation = (Math.abs(gx + gz + 6) % 4) as SectorRotation;
        this.grid.set(sectorKey(gx, gz), {
          gx,
          gz,
          level,
          variant,
          rotation,
          phase: 'STABLE',
          targetLevel: level,
          targetVariant: variant,
          targetRotation: rotation,
          warnStart: 0,
          warnEnd: 0,
          emergeStart: 0,
          emergeEnd: 0,
        });
      }
    }
  }

  public getAllSectors(): SectorState[] {
    return Array.from(this.grid.values());
  }

  public setEvents(events: SectorDirectorEvents): void {
    this.events = events;
  }

  public setEvolutionSettings(partial: Partial<MapEvolutionSettings>): MapEvolutionSettings {
    if (partial.autoEvolutionEnabled !== undefined) {
      this.settings.autoEvolutionEnabled = Boolean(partial.autoEvolutionEnabled);
    }
    if (
      partial.speedMultiplier === 1 ||
      partial.speedMultiplier === 2 ||
      partial.speedMultiplier === 4
    ) {
      this.settings.speedMultiplier = partial.speedMultiplier;
    }
    return { ...this.settings };
  }

  private getAutoIntervalMs(): number {
    if (this.settings.speedMultiplier === 4) return 7_500;
    if (this.settings.speedMultiplier === 2) return 15_000;
    return 30_000;
  }

  private getMaxConcurrentChanges(): number {
    if (this.settings.speedMultiplier === 4) return 4;
    if (this.settings.speedMultiplier === 2) return 2;
    return 1;
  }

  private startTransition(
    sector: SectorState,
    targetLevel: SectorLevel,
    simTimeMs: number
  ): void {
    const targetVariant = Math.floor(this.rng() * getBlueprintCount(targetLevel));
    const targetRotation = (Math.floor(this.rng() * 4) % 4) as SectorRotation;
    sector.phase = 'WARNING';
    sector.targetLevel = targetLevel;
    sector.targetVariant = targetVariant;
    sector.targetRotation = targetRotation;
    sector.warnStart = simTimeMs;
    sector.warnEnd = simTimeMs + SECTOR_WARNING_MS;
    sector.emergeStart = sector.warnEnd;
    sector.emergeEnd = sector.emergeStart + SECTOR_TRANSITION_MS;
    this.events.onSectorWarning?.({ ...sector });
  }

  /**
   * Forces a sector toward desiredLevel using safe cohesive cascades if neighbors block it.
   */
  public forceSectorLevel(
    gx: number,
    gz: number,
    desiredLevel: SectorLevel,
    simTimeMs: number,
    activeRing: number
  ): boolean {
    const sector = this.grid.get(sectorKey(gx, gz));
    if (!sector) return false;

    // Replace existing queue intent for this coordinate
    this.forceQueue = this.forceQueue.filter((q) => !(q.gx === gx && q.gz === gz));
    if (sector.level === desiredLevel && sector.phase === 'STABLE') {
      return true;
    }

    this.forceQueue.push({ gx, gz, desiredLevel });
    this.processForceQueue(simTimeMs, activeRing);
    return true;
  }

  private processForceQueue(simTimeMs: number, activeRing: number): void {
    const remaining: ForceIntent[] = [];

    for (const intent of this.forceQueue) {
      const sector = this.grid.get(sectorKey(intent.gx, intent.gz));
      if (!sector) continue;
      if (sector.phase === 'STABLE' && sector.level === intent.desiredLevel) {
        continue; // Completed
      }

      if (sector.phase === 'STABLE') {
        const stepLevel = (
          intent.desiredLevel > sector.level ? sector.level + 1 : sector.level - 1
        ) as SectorLevel;

        if (canTransitionSector(this.grid, sector.gx, sector.gz, stepLevel, activeRing)) {
          this.startTransition(sector, stepLevel, simTimeMs);
        } else {
          // Trigger safe cohesive cascade on blocking neighbors first (always moving toward 1)
          const neighbors = getNeighbors8(sector.gx, sector.gz, activeRing);
          for (const nbCoord of neighbors) {
            const nb = this.grid.get(sectorKey(nbCoord.gx, nbCoord.gz));
            if (!nb || nb.phase !== 'STABLE') continue;
            if (Math.abs(stepLevel - nb.level) > 1) {
              const nbTarget: SectorLevel = 1;
              if (canTransitionSector(this.grid, nb.gx, nb.gz, nbTarget, activeRing)) {
                this.startTransition(nb, nbTarget, simTimeMs);
              }
            }
          }
        }
      }

      if (!(sector.phase === 'STABLE' && sector.level === intent.desiredLevel)) {
        remaining.push(intent);
      }
    }

    this.forceQueue = remaining;
  }

  public update(simTimeMs: number, activeRing: number): void {
    // 1. Advance active sector state machines
    for (const sector of this.grid.values()) {
      if (sector.phase === 'WARNING' && simTimeMs >= sector.warnEnd) {
        sector.phase = 'TRANSITIONING';
        this.events.onSectorUpdate?.({ ...sector });
      } else if (sector.phase === 'TRANSITIONING' && simTimeMs >= sector.emergeEnd) {
        sector.level = sector.targetLevel;
        sector.variant = sector.targetVariant;
        sector.rotation = sector.targetRotation;
        sector.phase = 'STABLE';
        this.events.onSectorUpdate?.({ ...sector });
      }
    }

    // 2. Advance admin cohesive cascades
    if (this.forceQueue.length > 0) {
      this.processForceQueue(simTimeMs, activeRing);
    }

    // 3. Automatic evolution scheduler
    if (!this.settings.autoEvolutionEnabled) {
      return;
    }

    if (simTimeMs < this.nextAutoTickAt) {
      return;
    }
    this.nextAutoTickAt = simTimeMs + this.getAutoIntervalMs();

    const activeTransitions = Array.from(this.grid.values()).filter(
      (s) =>
        s.phase !== 'STABLE' &&
        Math.abs(s.gx) <= activeRing &&
        Math.abs(s.gz) <= activeRing
    ).length;

    const slots = Math.max(0, this.getMaxConcurrentChanges() - activeTransitions);
    if (slots <= 0) return;

    const candidates: Array<{ sector: SectorState; targetLevel: SectorLevel }> = [];
    for (let gx = -activeRing; gx <= activeRing; gx++) {
      for (let gz = -activeRing; gz <= activeRing; gz++) {
        const s = this.grid.get(sectorKey(gx, gz));
        if (!s || s.phase !== 'STABLE') continue;
        const possibleTargets: SectorLevel[] =
          s.level === 0 ? [1] : s.level === 2 ? [1] : [0, 2];
        for (const t of possibleTargets) {
          if (canTransitionSector(this.grid, gx, gz, t, activeRing)) {
            candidates.push({ sector: s, targetLevel: t });
          }
        }
      }
    }

    // Shuffle candidates via Fisher-Yates
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }

    let started = 0;
    const touched = new Set<string>();
    for (const cand of candidates) {
      if (started >= slots) break;
      const key = sectorKey(cand.sector.gx, cand.sector.gz);
      if (touched.has(key)) continue;
      // Re-verify cohesion in case an earlier choice in this batch affected a neighbor
      if (
        canTransitionSector(
          this.grid,
          cand.sector.gx,
          cand.sector.gz,
          cand.targetLevel,
          activeRing
        )
      ) {
        this.startTransition(cand.sector, cand.targetLevel, simTimeMs);
        touched.add(key);
        started += 1;
      }
    }
  }
}
