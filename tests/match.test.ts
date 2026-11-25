import { describe, expect, it } from 'vitest';
import { MatchManager } from '../server/MatchManager.js';
import type { ServerPlayer } from '../server/types.js';
import { createInitialPhysState } from '../shared/physics.js';

function makeDummyPlayer(id: string): ServerPlayer {
  return {
    id,
    name: id,
    team: 'NONE',
    classId: 'assault',
    pendingClassId: null,
    adminRole: 'none',
    phys: createInitialPhysState(),
    yaw: 0,
    pitch: 0,
    hp: 100,
    maxHp: 100,
    alive: true,
    respawnAt: 0,
    spectatingId: null,
    weapon: 0,
    ammo: { 0: 30, 1: 28, 2: 6, 3: 6, 4: 5, 5: 8 },
    reloadingUntil: 0,
    nextFireAt: 0,
    lastShotIdx: 0,
    lastShotTime: 0,
    cdE: 0,
    cdQ: 0,
    cloakTimer: 0,
    adsActive: false,
    interacting: false,
    lastAckSeq: 0,
    gunGameLevel: 0,
    kills: 0,
    deaths: 0,
    lastInputKeys: 0,
    ip: '127.0.0.1',
    send: () => {},
    disconnect: () => {},
  };
}

describe('Single Scalable Lobby, 50/50 Split & 10s Odd Vote', () => {
  it('scales active rings dynamically with +-2 hysteresis thresholds', () => {
    const m = new MatchManager();
    expect(m.activeRing).toBe(1);

    m.recalculateActiveRing(8);
    expect(m.activeRing).toBe(1);

    m.recalculateActiveRing(9);
    expect(m.activeRing).toBe(2);

    // Hysteresis: stays at Ring 2 down to 7 players
    m.recalculateActiveRing(7);
    expect(m.activeRing).toBe(2);

    m.recalculateActiveRing(6);
    expect(m.activeRing).toBe(1);

    m.recalculateActiveRing(19);
    expect(m.activeRing).toBe(3);

    m.recalculateActiveRing(17);
    expect(m.activeRing).toBe(3);

    m.recalculateActiveRing(16);
    expect(m.activeRing).toBe(2);
  });

  it('splits even players 50/50 without triggering vote', () => {
    const m = new MatchManager();
    const players = new Map<string, ServerPlayer>([
      ['p1', makeDummyPlayer('p1')],
      ['p2', makeDummyPlayer('p2')],
      ['p3', makeDummyPlayer('p3')],
      ['p4', makeDummyPlayer('p4')],
    ]);

    m.startRound(players, 1000);
    expect(m.phase).toBe('COUNTDOWN');

    const countA = Array.from(players.values()).filter((p) => p.team === 'A').length;
    const countB = Array.from(players.values()).filter((p) => p.team === 'B').length;
    expect(countA).toBe(2);
    expect(countB).toBe(2);
  });

  it('triggers 10s odd vote, closes early at 100%, resolves ties via coin flip, and recovers on disconnect', () => {
    let voteResult: { winnerTeam: 'A' | 'B'; coinFlip: boolean } | null = null;
    const m = new MatchManager(() => 0.25, {
      onVoteResult: (winnerTeam, _extra, coinFlip) => {
        voteResult = { winnerTeam, coinFlip };
      },
    });

    const players = new Map<string, ServerPlayer>([
      ['p1', makeDummyPlayer('p1')],
      ['p2', makeDummyPlayer('p2')],
      ['p3', makeDummyPlayer('p3')],
    ]);

    m.startRound(players, 1000);
    expect(m.phase).toBe('ODD_VOTE');
    expect(m.oddExtraId).not.toBeNull();
    expect(m.phaseEndsAt).toBe(11_000);

    // Early close on 100% votes favoring B
    m.castVote('p1', 'B', players, 2000);
    m.castVote('p2', 'B', players, 2500);
    m.castVote('p3', 'A', players, 3000);

    expect(m.phase).toBe('COUNTDOWN');
    expect(voteResult).toEqual({ winnerTeam: 'B', coinFlip: false });

    // Tie / 0-0 resolves by coin flip at 10s
    voteResult = null;
    m.startRound(players, 20_000);
    expect(m.phase).toBe('ODD_VOTE');
    m.update(30_000, players);
    expect(m.phase).toBe('COUNTDOWN');
    expect(voteResult).toEqual({ winnerTeam: 'A', coinFlip: true });

    // Disconnect making count even cancels vote cleanly
    m.startRound(players, 40_000);
    expect(m.phase).toBe('ODD_VOTE');
    const nonExtra = Array.from(players.keys()).find((id) => id !== m.oddExtraId)!;
    players.delete(nonExtra);
    m.handlePlayerLeave(nonExtra, players, 42_000);
    expect(m.phase).toBe('COUNTDOWN');
    const a = Array.from(players.values()).filter((p) => p.team === 'A').length;
    const b = Array.from(players.values()).filter((p) => p.team === 'B').length;
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
});
