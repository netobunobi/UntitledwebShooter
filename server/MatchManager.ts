import {
  COUNTDOWN_MS,
  ODD_VOTE_MS,
  RING_2_CONTRACT,
  RING_2_EXPAND,
  RING_3_CONTRACT,
  RING_3_EXPAND,
  ROUND_END_MS,
} from '../shared/constants.js';
import {
  DEFAULT_MATCH_CONFIG,
  isTeamMode,
  pickNextRandomMode,
  type MatchConfig,
} from '../shared/gamemodes.js';
import type { MatchPhase, TeamId } from '../shared/protocol.js';
import type { ServerPlayer } from './types.js';

export interface MatchEvents {
  onMatchState?: () => void;
  onVoteStart?: (extraId: string, extraName: string, endsAt: number) => void;
  onVoteUpdate?: (votesA: number, votesB: number) => void;
  onVoteResult?: (winnerTeam: 'A' | 'B', extraId: string, coinFlip: boolean) => void;
  onRoundResetPlayers?: () => void;
}

export class MatchManager {
  public phase: MatchPhase = 'WAITING_WARMUP';
  public phaseEndsAt = 0;
  public activeRing = 1;
  public scoreA = 0;
  public scoreB = 0;
  public config: MatchConfig = { ...DEFAULT_MATCH_CONFIG };
  public winner: string | undefined;

  public oddExtraId: string | null = null;
  public oddVotes: Map<string, 'A' | 'B'> = new Map();

  private pausedRemainingMs = 0;
  private rng: () => number;
  private events: MatchEvents;

  constructor(rng: () => number = Math.random, events: MatchEvents = {}) {
    this.rng = rng;
    this.events = events;
  }

  public setEvents(events: MatchEvents): void {
    this.events = events;
  }

  public recalculateActiveRing(playerCount: number): boolean {
    const prev = this.activeRing;
    if (this.activeRing === 1) {
      if (playerCount >= RING_3_EXPAND) this.activeRing = 3;
      else if (playerCount >= RING_2_EXPAND) this.activeRing = 2;
    } else if (this.activeRing === 2) {
      if (playerCount >= RING_3_EXPAND) this.activeRing = 3;
      else if (playerCount <= RING_2_CONTRACT) this.activeRing = 1;
    } else if (this.activeRing === 3) {
      if (playerCount <= RING_2_CONTRACT) this.activeRing = 1;
      else if (playerCount <= RING_3_CONTRACT) this.activeRing = 2;
    }
    return this.activeRing !== prev;
  }

  private shuffleIds(ids: string[]): string[] {
    const arr = [...ids];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  public startRound(players: Map<string, ServerPlayer>, simTimeMs: number): void {
    this.scoreA = 0;
    this.scoreB = 0;
    this.winner = undefined;
    this.oddExtraId = null;
    this.oddVotes.clear();

    if (players.size < 2) {
      this.phase = 'WAITING_WARMUP';
      this.phaseEndsAt = 0;
      for (const p of players.values()) {
        p.team = isTeamMode(this.config) ? 'A' : 'NONE';
      }
      this.events.onRoundResetPlayers?.();
      this.events.onMatchState?.();
      return;
    }

    this.phase = 'TEAM_ASSIGNMENT';
    const ids = this.shuffleIds(Array.from(players.keys()));

    if (!isTeamMode(this.config)) {
      for (const p of players.values()) {
        p.team = 'NONE';
      }
      this.phase = 'COUNTDOWN';
      this.phaseEndsAt = simTimeMs + COUNTDOWN_MS;
      this.events.onRoundResetPlayers?.();
      this.events.onMatchState?.();
      return;
    }

    // Team-based 50/50 split
    const n = ids.length;
    const half = Math.floor(n / 2);
    for (let i = 0; i < half; i++) {
      const p = players.get(ids[i]);
      if (p) p.team = 'A';
    }
    for (let i = half; i < half * 2; i++) {
      const p = players.get(ids[i]);
      if (p) p.team = 'B';
    }

    if (n % 2 === 0) {
      this.phase = 'COUNTDOWN';
      this.phaseEndsAt = simTimeMs + COUNTDOWN_MS;
      this.events.onRoundResetPlayers?.();
      this.events.onMatchState?.();
      return;
    }

    // Odd count -> designate EXTRA_PLAYER and run 10s quick vote
    const extraPlayer = players.get(ids[n - 1]);
    if (extraPlayer) {
      extraPlayer.team = 'NONE';
      this.oddExtraId = extraPlayer.id;
      this.phase = 'ODD_VOTE';
      this.phaseEndsAt = simTimeMs + ODD_VOTE_MS;
      this.events.onRoundResetPlayers?.();
      this.events.onMatchState?.();
      this.events.onVoteStart?.(extraPlayer.id, extraPlayer.name, this.phaseEndsAt);
    }
  }

  public castVote(
    voterId: string,
    team: 'A' | 'B',
    players: Map<string, ServerPlayer>,
    simTimeMs: number
  ): boolean {
    if (this.phase !== 'ODD_VOTE') return false;
    if (!players.has(voterId)) return false;

    this.oddVotes.set(voterId, team);
    const { votesA, votesB } = this.countVotes();
    this.events.onVoteUpdate?.(votesA, votesB);

    if (this.oddVotes.size >= players.size) {
      this.resolveOddVote(players, simTimeMs);
    }
    return true;
  }

  public countVotes(): { votesA: number; votesB: number } {
    let votesA = 0;
    let votesB = 0;
    for (const v of this.oddVotes.values()) {
      if (v === 'A') votesA++;
      else votesB++;
    }
    return { votesA, votesB };
  }

  public resolveOddVote(players: Map<string, ServerPlayer>, simTimeMs: number): void {
    if (this.phase !== 'ODD_VOTE') return;

    const { votesA, votesB } = this.countVotes();
    let winnerTeam: 'A' | 'B';
    let coinFlip = false;

    if (votesA > votesB) {
      winnerTeam = 'A';
    } else if (votesB > votesA) {
      winnerTeam = 'B';
    } else {
      coinFlip = true;
      winnerTeam = this.rng() < 0.5 ? 'A' : 'B';
    }

    const extraId = this.oddExtraId ?? '';
    const extraPlayer = extraId ? players.get(extraId) : undefined;
    if (extraPlayer) {
      extraPlayer.team = winnerTeam;
    }

    this.oddExtraId = null;
    this.oddVotes.clear();
    this.phase = 'COUNTDOWN';
    this.phaseEndsAt = simTimeMs + COUNTDOWN_MS;
    this.events.onVoteResult?.(winnerTeam, extraId, coinFlip);
    this.events.onMatchState?.();
  }

  public handlePlayerJoin(
    player: ServerPlayer,
    players: Map<string, ServerPlayer>,
    simTimeMs: number
  ): void {
    this.recalculateActiveRing(players.size);

    if (!isTeamMode(this.config)) {
      player.team = 'NONE';
    } else {
      let cA = 0;
      let cB = 0;
      for (const p of players.values()) {
        if (p.id === player.id) continue;
        if (p.team === 'A') cA++;
        else if (p.team === 'B') cB++;
      }
      if (cA < cB) player.team = 'A';
      else if (cB < cA) player.team = 'B';
      else player.team = this.rng() < 0.5 ? 'A' : 'B';
    }

    if (this.phase === 'WAITING_WARMUP' && players.size >= 2) {
      this.startRound(players, simTimeMs);
    } else {
      this.events.onMatchState?.();
    }
  }

  public handlePlayerLeave(
    leftId: string,
    players: Map<string, ServerPlayer>,
    simTimeMs: number
  ): void {
    this.recalculateActiveRing(players.size);
    this.oddVotes.delete(leftId);

    if (players.size < 2 && this.phase !== 'WAITING_WARMUP') {
      this.oddExtraId = null;
      this.oddVotes.clear();
      this.phase = 'WAITING_WARMUP';
      this.phaseEndsAt = 0;
      this.events.onMatchState?.();
      return;
    }

    if (this.phase === 'ODD_VOTE') {
      if (leftId === this.oddExtraId) {
        // Extra player left -> remaining players are even 50/50
        this.oddExtraId = null;
        this.oddVotes.clear();
        this.phase = 'COUNTDOWN';
        this.phaseEndsAt = simTimeMs + COUNTDOWN_MS;
        this.events.onMatchState?.();
        return;
      }

      if (players.size % 2 === 0 && this.oddExtraId) {
        // Another player left, making total even -> assign extraId to smaller team and skip vote
        let cA = 0;
        let cB = 0;
        for (const p of players.values()) {
          if (p.id === this.oddExtraId) continue;
          if (p.team === 'A') cA++;
          else if (p.team === 'B') cB++;
        }
        const extra = players.get(this.oddExtraId);
        if (extra) {
          extra.team = cA <= cB ? 'A' : 'B';
        }
        this.oddExtraId = null;
        this.oddVotes.clear();
        this.phase = 'COUNTDOWN';
        this.phaseEndsAt = simTimeMs + COUNTDOWN_MS;
        this.events.onMatchState?.();
        return;
      }

      if (this.oddVotes.size >= players.size) {
        this.resolveOddVote(players, simTimeMs);
      }
    }
  }

  public pause(simTimeMs: number): void {
    if (this.phase === 'PAUSED' || this.phase === 'WAITING_WARMUP') return;
    this.pausedRemainingMs = Math.max(0, this.phaseEndsAt - simTimeMs);
    this.phase = 'PAUSED';
    this.events.onMatchState?.();
  }

  public resume(simTimeMs: number): void {
    if (this.phase !== 'PAUSED') return;
    this.phase = 'IN_PROGRESS';
    this.phaseEndsAt = simTimeMs + this.pausedRemainingMs;
    this.events.onMatchState?.();
  }

  public endRound(winner: string | undefined, simTimeMs: number): void {
    if (this.phase === 'ROUND_END') return;
    this.winner = winner;
    this.phase = 'ROUND_END';
    this.phaseEndsAt = simTimeMs + ROUND_END_MS;
    this.events.onMatchState?.();
  }

  public update(simTimeMs: number, players: Map<string, ServerPlayer>): boolean {
    if (this.phase === 'WAITING_WARMUP' || this.phase === 'PAUSED') {
      return false;
    }

    if (this.phase === 'ODD_VOTE' && simTimeMs >= this.phaseEndsAt) {
      this.resolveOddVote(players, simTimeMs);
      return false;
    }

    if (this.phase === 'COUNTDOWN' && simTimeMs >= this.phaseEndsAt) {
      this.phase = 'IN_PROGRESS';
      this.phaseEndsAt = simTimeMs + Math.max(1, this.config.roundDurationMin) * 60_000;
      this.events.onMatchState?.();
      return true;
    }

    if (this.phase === 'IN_PROGRESS' && simTimeMs >= this.phaseEndsAt) {
      let winner: string | undefined = 'DRAW';
      if (isTeamMode(this.config)) {
        if (this.scoreA > this.scoreB) winner = 'A';
        else if (this.scoreB > this.scoreA) winner = 'B';
      } else {
        let best: ServerPlayer | null = null;
        for (const p of players.values()) {
          if (!best || p.kills > best.kills) best = p;
        }
        winner = best?.id;
      }
      this.endRound(winner, simTimeMs);
      return false;
    }

    if (this.phase === 'ROUND_END' && simTimeMs >= this.phaseEndsAt) {
      if (this.config.randomModeRotation) {
        this.config.gameMode = pickNextRandomMode(this.config.gameMode, this.rng);
      }
      this.startRound(players, simTimeMs);
      return true;
    }

    return false;
  }

  public getTeamMap(players: Map<string, ServerPlayer>): Record<string, TeamId> {
    const out: Record<string, TeamId> = {};
    for (const p of players.values()) {
      out[p.id] = p.team;
    }
    return out;
  }
}
