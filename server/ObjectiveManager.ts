import {
  DOMINATION_CAPTURE_MS,
  HARDPOINT_ROTATE_MS,
  HARDPOINT_WARN_MS,
  SECTOR_SIZE,
  SND_BOMB_TIMER_MS,
  SND_DEFUSE_MS,
  SND_PLANT_MS,
} from '../shared/constants.js';
import {
  GUN_GAME_LADDER,
  type GameModeId,
  type MatchConfig,
} from '../shared/gamemodes.js';
import { distSqVec3, type Vec3 } from '../shared/projectiles.js';
import type { ObjectiveSnapshot, TeamId } from '../shared/protocol.js';
import type { WeaponId } from '../shared/weapons.js';
import type { ServerPlayer } from './types.js';

export interface ObjectiveTickResult {
  roundWinner?: 'A' | 'B' | string | 'DRAW';
  subRoundWinner?: 'A' | 'B';
  dirtySnapshot: boolean;
}

export class ObjectiveManager {
  public mode: GameModeId = 'tdm';

  // S&D state
  public sndSubRound = 1;
  public sndMaxRounds = 7;
  public sndAttackerTeam: 'A' | 'B' = 'A';
  public sndSiteA: Vec3 = { x: -24, y: 0, z: 0 };
  public sndSiteB: Vec3 = { x: 24, y: 0, z: 0 };
  public sndPlantedSite: 'A' | 'B' | null = null;
  public sndBombExplodesAt = 0;
  public sndPlantProgress = 0;
  public sndDefuseProgress = 0;

  // Hardpoint state
  public hpZoneCenter: Vec3 = { x: 0, y: 0, z: 0 };
  public hpNextCenter: Vec3 | null = null;
  public hpRotatesAt = 0;
  public hpOwner: 'A' | 'B' | 'CONTESTED' | 'NONE' = 'NONE';
  private hpScoreAccA = 0;
  private hpScoreAccB = 0;

  // Domination state
  public domZones: Array<{
    label: 'A' | 'B' | 'C';
    pos: Vec3;
    owner: 'A' | 'B' | 'NONE';
    captureProgress: number;
    capturingTeam: 'A' | 'B' | 'NONE';
  }> = [];
  private domScoreAccA = 0;
  private domScoreAccB = 0;

  // GunGame winner tracking
  private gunGameWinnerId: string | null = null;

  private rng: () => number;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  public resetForMatch(
    config: MatchConfig,
    activeRing: number,
    simTimeMs: number,
    players: Iterable<ServerPlayer>
  ): void {
    this.mode = config.gameMode;
    this.gunGameWinnerId = null;
    this.hpScoreAccA = 0;
    this.hpScoreAccB = 0;
    this.domScoreAccA = 0;
    this.domScoreAccB = 0;

    for (const p of players) {
      p.gunGameLevel = 0;
      if (this.mode === 'gungame') {
        p.weapon = GUN_GAME_LADDER[0];
      }
    }

    if (this.mode === 'snd') {
      this.sndMaxRounds = Math.max(1, config.roundLimit);
      this.setupSndSubRound(1, 'A', activeRing);
    } else if (this.mode === 'hardpoint') {
      this.hpZoneCenter = { x: 0, y: 0, z: 0 };
      this.hpNextCenter = this.pickRandomSectorCenter(activeRing, this.hpZoneCenter);
      this.hpRotatesAt = simTimeMs + HARDPOINT_ROTATE_MS;
      this.hpOwner = 'NONE';
    } else if (this.mode === 'domination') {
      const span = Math.max(1, activeRing) * SECTOR_SIZE;
      this.domZones = [
        { label: 'A', pos: { x: -span, y: 0, z: 0 }, owner: 'NONE', captureProgress: 0, capturingTeam: 'NONE' },
        { label: 'B', pos: { x: 0, y: 0, z: 0 }, owner: 'NONE', captureProgress: 0, capturingTeam: 'NONE' },
        { label: 'C', pos: { x: span, y: 0, z: 0 }, owner: 'NONE', captureProgress: 0, capturingTeam: 'NONE' },
      ];
    }
  }

  public setupSndSubRound(
    subRound: number,
    attackerTeam: 'A' | 'B',
    activeRing: number
  ): void {
    this.sndSubRound = subRound;
    this.sndAttackerTeam = attackerTeam;
    const span = Math.max(1, activeRing) * SECTOR_SIZE;
    this.sndSiteA = { x: -span, y: 0, z: 0 };
    this.sndSiteB = { x: span, y: 0, z: 0 };
    this.sndPlantedSite = null;
    this.sndBombExplodesAt = 0;
    this.sndPlantProgress = 0;
    this.sndDefuseProgress = 0;
  }

  private pickRandomSectorCenter(activeRing: number, avoid: Vec3): Vec3 {
    const candidates: Vec3[] = [];
    for (let gx = -activeRing; gx <= activeRing; gx++) {
      for (let gz = -activeRing; gz <= activeRing; gz++) {
        const x = gx * SECTOR_SIZE;
        const z = gz * SECTOR_SIZE;
        if (Math.abs(x - avoid.x) > 1 || Math.abs(z - avoid.z) > 1) {
          candidates.push({ x, y: 0, z });
        }
      }
    }
    if (candidates.length === 0) return { x: 0, y: 0, z: 0 };
    return candidates[Math.floor(this.rng() * candidates.length) % candidates.length];
  }

  public onPlayerKill(
    attacker: ServerPlayer | undefined,
    victim: ServerPlayer,
    weapon: WeaponId | 'impulse',
    config: MatchConfig
  ): { upgradedWeapon?: WeaponId; demotedWeapon?: WeaponId } {
    if (this.mode !== 'gungame') return {};

    const out: { upgradedWeapon?: WeaponId; demotedWeapon?: WeaponId } = {};
    if (attacker && attacker.id !== victim.id) {
      if (attacker.gunGameLevel >= GUN_GAME_LADDER.length - 1) {
        // Final kill with Shadow Kunai wins Gun Game
        if (weapon === GUN_GAME_LADDER[GUN_GAME_LADDER.length - 1]) {
          attacker.gunGameLevel = GUN_GAME_LADDER.length;
          this.gunGameWinnerId = attacker.id;
        }
      } else {
        attacker.gunGameLevel += 1;
        attacker.weapon = GUN_GAME_LADDER[attacker.gunGameLevel];
        attacker.ammo[attacker.weapon] = 999;
        out.upgradedWeapon = attacker.weapon;
      }
    }

    if (weapon === 5 && victim.gunGameLevel > 0) {
      victim.gunGameLevel -= 1;
      victim.weapon = GUN_GAME_LADDER[victim.gunGameLevel];
      out.demotedWeapon = victim.weapon;
    }

    // In team gungame, team score reflects highest/sum progress if desired; handled in tick
    void config;
    return out;
  }

  public tick(
    dt: number,
    simTimeMs: number,
    players: Map<string, ServerPlayer>,
    config: MatchConfig,
    activeRing: number,
    scores: { scoreA: number; scoreB: number }
  ): ObjectiveTickResult {
    let dirtySnapshot = false;

    // 1. TDM
    if (this.mode === 'tdm') {
      if (scores.scoreA >= config.scoreLimit) return { roundWinner: 'A', dirtySnapshot };
      if (scores.scoreB >= config.scoreLimit) return { roundWinner: 'B', dirtySnapshot };
      return { dirtySnapshot };
    }

    // 2. FFA
    if (this.mode === 'ffa') {
      for (const p of players.values()) {
        if (p.kills >= config.scoreLimit) {
          return { roundWinner: p.id, dirtySnapshot };
        }
      }
      return { dirtySnapshot };
    }

    // 3. Gun Game
    if (this.mode === 'gungame') {
      if (this.gunGameWinnerId) {
        const winner = players.get(this.gunGameWinnerId);
        if (config.gunGameTeams && winner && winner.team !== 'NONE') {
          return { roundWinner: winner.team, dirtySnapshot };
        }
        return { roundWinner: this.gunGameWinnerId, dirtySnapshot };
      }
      return { dirtySnapshot };
    }

    // 4. Search & Destroy
    if (this.mode === 'snd') {
      const defenderTeam: 'A' | 'B' = this.sndAttackerTeam === 'A' ? 'B' : 'A';
      let aliveA = 0;
      let aliveB = 0;
      let planting = false;
      let defusing = false;

      for (const p of players.values()) {
        if (!p.alive) continue;
        if (p.team === 'A') aliveA++;
        if (p.team === 'B') aliveB++;

        if (p.interacting) {
          const pPos: Vec3 = { x: p.phys.x, y: 0, z: p.phys.z };
          if (!this.sndPlantedSite && p.team === this.sndAttackerTeam) {
            if (distSqVec3(pPos, this.sndSiteA) <= 12.25) {
              planting = true;
              this.sndPlantProgress = Math.min(1, this.sndPlantProgress + (dt * 1000) / SND_PLANT_MS);
              if (this.sndPlantProgress >= 1) {
                this.sndPlantedSite = 'A';
                this.sndBombExplodesAt = simTimeMs + SND_BOMB_TIMER_MS;
                this.sndPlantProgress = 0;
                dirtySnapshot = true;
              }
            } else if (distSqVec3(pPos, this.sndSiteB) <= 12.25) {
              planting = true;
              this.sndPlantProgress = Math.min(1, this.sndPlantProgress + (dt * 1000) / SND_PLANT_MS);
              if (this.sndPlantProgress >= 1) {
                this.sndPlantedSite = 'B';
                this.sndBombExplodesAt = simTimeMs + SND_BOMB_TIMER_MS;
                this.sndPlantProgress = 0;
                dirtySnapshot = true;
              }
            }
          } else if (this.sndPlantedSite && p.team === defenderTeam) {
            const sitePos = this.sndPlantedSite === 'A' ? this.sndSiteA : this.sndSiteB;
            if (distSqVec3(pPos, sitePos) <= 12.25) {
              defusing = true;
              this.sndDefuseProgress = Math.min(
                1,
                this.sndDefuseProgress + (dt * 1000) / SND_DEFUSE_MS
              );
              if (this.sndDefuseProgress >= 1) {
                return { subRoundWinner: defenderTeam, dirtySnapshot: true };
              }
            }
          }
        }
      }

      if (!planting && this.sndPlantProgress > 0) this.sndPlantProgress = 0;
      if (!defusing && this.sndDefuseProgress > 0) this.sndDefuseProgress = 0;

      if (this.sndPlantedSite && simTimeMs >= this.sndBombExplodesAt) {
        return { subRoundWinner: this.sndAttackerTeam, dirtySnapshot: true };
      }

      // Elimination checks (only if both teams had players in match)
      const totalA = Array.from(players.values()).filter((p) => p.team === 'A').length;
      const totalB = Array.from(players.values()).filter((p) => p.team === 'B').length;
      if (totalA > 0 && totalB > 0) {
        const aliveAttackers = this.sndAttackerTeam === 'A' ? aliveA : aliveB;
        const aliveDefenders = defenderTeam === 'A' ? aliveA : aliveB;

        if (aliveDefenders === 0) {
          return { subRoundWinner: this.sndAttackerTeam, dirtySnapshot: true };
        }
        if (!this.sndPlantedSite && aliveAttackers === 0) {
          return { subRoundWinner: defenderTeam, dirtySnapshot: true };
        }
      }

      return { dirtySnapshot };
    }

    // 5. Hardpoint
    if (this.mode === 'hardpoint') {
      if (simTimeMs >= this.hpRotatesAt) {
        this.hpZoneCenter =
          this.hpNextCenter ?? this.pickRandomSectorCenter(activeRing, this.hpZoneCenter);
        this.hpNextCenter = this.pickRandomSectorCenter(activeRing, this.hpZoneCenter);
        this.hpRotatesAt = simTimeMs + HARDPOINT_ROTATE_MS;
        dirtySnapshot = true;
      } else if (!this.hpNextCenter && this.hpRotatesAt - simTimeMs <= HARDPOINT_WARN_MS) {
        this.hpNextCenter = this.pickRandomSectorCenter(activeRing, this.hpZoneCenter);
        dirtySnapshot = true;
      }

      let countA = 0;
      let countB = 0;
      for (const p of players.values()) {
        if (!p.alive) continue;
        if (
          Math.abs(p.phys.x - this.hpZoneCenter.x) <= 4.0 &&
          Math.abs(p.phys.z - this.hpZoneCenter.z) <= 4.0
        ) {
          if (p.team === 'A') countA++;
          else if (p.team === 'B') countB++;
        }
      }

      const prevOwner = this.hpOwner;
      if (countA > 0 && countB > 0) {
        this.hpOwner = 'CONTESTED';
      } else if (countA > 0) {
        this.hpOwner = 'A';
        this.hpScoreAccA += dt;
        if (this.hpScoreAccA >= 1.0) {
          const pts = Math.floor(this.hpScoreAccA);
          scores.scoreA += pts;
          this.hpScoreAccA -= pts;
        }
      } else if (countB > 0) {
        this.hpOwner = 'B';
        this.hpScoreAccB += dt;
        if (this.hpScoreAccB >= 1.0) {
          const pts = Math.floor(this.hpScoreAccB);
          scores.scoreB += pts;
          this.hpScoreAccB -= pts;
        }
      } else {
        this.hpOwner = 'NONE';
      }

      if (prevOwner !== this.hpOwner) dirtySnapshot = true;
      if (scores.scoreA >= config.scoreLimit) return { roundWinner: 'A', dirtySnapshot };
      if (scores.scoreB >= config.scoreLimit) return { roundWinner: 'B', dirtySnapshot };
      return { dirtySnapshot };
    }

    // 6. Domination
    if (this.mode === 'domination') {
      const rSq = 4.5 * 4.5;
      let ownedA = 0;
      let ownedB = 0;

      for (const z of this.domZones) {
        let countA = 0;
        let countB = 0;
        for (const p of players.values()) {
          if (!p.alive) continue;
          const pPos: Vec3 = { x: p.phys.x, y: 0, z: p.phys.z };
          if (distSqVec3(pPos, z.pos) <= rSq) {
            if (p.team === 'A') countA++;
            else if (p.team === 'B') countB++;
          }
        }

        if (countA > countB) {
          const diff = countA - countB;
          if (z.owner !== 'A') {
            z.capturingTeam = 'A';
            z.captureProgress = Math.min(
              1,
              z.captureProgress + (diff * dt * 1000) / DOMINATION_CAPTURE_MS
            );
            if (z.captureProgress >= 1) {
              z.owner = 'A';
              z.captureProgress = 0;
              z.capturingTeam = 'NONE';
              dirtySnapshot = true;
            }
          }
        } else if (countB > countA) {
          const diff = countB - countA;
          if (z.owner !== 'B') {
            z.capturingTeam = 'B';
            z.captureProgress = Math.min(
              1,
              z.captureProgress + (diff * dt * 1000) / DOMINATION_CAPTURE_MS
            );
            if (z.captureProgress >= 1) {
              z.owner = 'B';
              z.captureProgress = 0;
              z.capturingTeam = 'NONE';
              dirtySnapshot = true;
            }
          }
        } else if (countA === 0 && countB === 0 && z.captureProgress > 0) {
          z.captureProgress = Math.max(0, z.captureProgress - dt * 0.15);
          if (z.captureProgress === 0) z.capturingTeam = 'NONE';
        }

        if (z.owner === 'A') ownedA++;
        else if (z.owner === 'B') ownedB++;
      }

      if (ownedA > 0) {
        this.domScoreAccA += ownedA * dt;
        if (this.domScoreAccA >= 1.0) {
          const pts = Math.floor(this.domScoreAccA);
          scores.scoreA += pts;
          this.domScoreAccA -= pts;
        }
      }
      if (ownedB > 0) {
        this.domScoreAccB += ownedB * dt;
        if (this.domScoreAccB >= 1.0) {
          const pts = Math.floor(this.domScoreAccB);
          scores.scoreB += pts;
          this.domScoreAccB -= pts;
        }
      }

      if (scores.scoreA >= config.scoreLimit) return { roundWinner: 'A', dirtySnapshot };
      if (scores.scoreB >= config.scoreLimit) return { roundWinner: 'B', dirtySnapshot };
    }

    return { dirtySnapshot };
  }

  public getSnapshot(players: Iterable<ServerPlayer>): ObjectiveSnapshot {
    const snap: ObjectiveSnapshot = { mode: this.mode };
    if (this.mode === 'snd') {
      snap.snd = {
        subRound: this.sndSubRound,
        maxRounds: this.sndMaxRounds,
        attackerTeam: this.sndAttackerTeam,
        siteA: this.sndSiteA,
        siteB: this.sndSiteB,
        plantedSite: this.sndPlantedSite,
        bombExplodesAt: this.sndBombExplodesAt,
        plantProgress: Number(this.sndPlantProgress.toFixed(2)),
        defuseProgress: Number(this.sndDefuseProgress.toFixed(2)),
      };
    } else if (this.mode === 'hardpoint') {
      snap.hardpoint = {
        zoneCenter: this.hpZoneCenter,
        nextCenter: this.hpNextCenter,
        rotatesAt: this.hpRotatesAt,
        owner: this.hpOwner,
      };
    } else if (this.mode === 'domination') {
      snap.domination = {
        zones: this.domZones.map((z) => ({
          ...z,
          captureProgress: Number(z.captureProgress.toFixed(2)),
        })),
      };
    } else if (this.mode === 'gungame') {
      const levels: Record<string, number> = {};
      for (const p of players) levels[p.id] = p.gunGameLevel;
      snap.gungame = { levels };
    }
    return snap;
  }
}
