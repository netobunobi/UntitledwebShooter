import { describe, expect, it } from 'vitest';
import { GameServer, type PlayerSessionBridge } from '../server/GameServer.js';
import { FIXED_DT, HARDPOINT_ROTATE_MS, KEY_INTERACT, SND_BOMB_TIMER_MS } from '../shared/constants.js';
import { GUN_GAME_LADDER, pickNextRandomMode } from '../shared/gamemodes.js';
import type { ServerMessage } from '../shared/protocol.js';

function createMockBridge(id: string): {
  bridge: PlayerSessionBridge;
  inbox: ServerMessage[];
} {
  const inbox: ServerMessage[] = [];
  return {
    inbox,
    bridge: {
      id,
      ip: '127.0.0.1',
      send: (msg) => inbox.push(msg),
      disconnect: () => {},
    },
  };
}

describe('6 Game Modes, Rotation & Objectives', () => {
  it('FFA skips teams and odd-player vote even with 3 players', () => {
    const srv = new GameServer();
    srv.match.config.gameMode = 'ffa';
    srv.match.config.scoreLimit = 2;

    const b1 = createMockBridge('p1');
    const b2 = createMockBridge('p2');
    const b3 = createMockBridge('p3');
    srv.addPlayer(b1.bridge, 'P1', 'assault');
    srv.addPlayer(b2.bridge, 'P2', 'ninja');
    srv.addPlayer(b3.bridge, 'P3', 'ghost');

    srv.match.startRound(srv.players, srv.getSimTimeMs());
    expect(srv.match.phase).toBe('COUNTDOWN');
    for (const p of srv.players.values()) {
      expect(p.team).toBe('NONE');
    }

    srv.dispose();
  });

  it('S&D enforces no-respawn, bomb plant (F) + 45s detonation, and best-of-N scoring', () => {
    const srv = new GameServer();
    srv.match.config.gameMode = 'snd';
    srv.match.config.roundLimit = 3;

    const p1 = srv.addPlayer(createMockBridge('p1').bridge, 'Atk', 'assault');
    const p2 = srv.addPlayer(createMockBridge('p2').bridge, 'Def', 'vanguard');

    // Clear 3s countdown
    for (let i = 0; i < 200; i++) srv.stepSimulation(FIXED_DT);
    expect(srv.match.phase).toBe('IN_PROGRESS');

    p1.team = 'A';
    p2.team = 'B';
    srv.objectives.sndAttackerTeam = 'A';

    // Move attacker p1 onto site A and hold interact (F) for 3.6s
    p1.phys.x = srv.objectives.sndSiteA.x;
    p1.phys.z = srv.objectives.sndSiteA.z;
    p1.interacting = true;
    p1.lastInputKeys = KEY_INTERACT;

    // Keep defender p2 alive far away
    p2.phys.x = 24;
    p2.phys.z = 24;

    for (let i = 0; i < 220; i++) srv.stepSimulation(FIXED_DT);
    expect(srv.objectives.sndPlantedSite).toBe('A');

    // Advance 45s bomb timer
    p1.interacting = false;
    p1.lastInputKeys = 0;
    const steps45s = Math.ceil((SND_BOMB_TIMER_MS / 1000) * 60) + 5;
    for (let i = 0; i < steps45s; i++) srv.stepSimulation(FIXED_DT);

    expect(srv.match.scoreA).toBe(1);
    srv.dispose();
  });

  it('Hardpoint awards points only when uncontested, detects CONTESTED, and rotates every 45s', () => {
    const srv = new GameServer();
    srv.match.config.gameMode = 'hardpoint';
    srv.match.config.scoreLimit = 250;

    const p1 = srv.addPlayer(createMockBridge('p1').bridge, 'A1', 'assault');
    const p2 = srv.addPlayer(createMockBridge('p2').bridge, 'B1', 'vanguard');
    for (let i = 0; i < 200; i++) srv.stepSimulation(FIXED_DT);

    p1.team = 'A';
    p2.team = 'B';
    const initialZone = { ...srv.objectives.hpZoneCenter };

    // Only p1 inside zone -> A scores
    p1.phys.x = initialZone.x;
    p1.phys.z = initialZone.z;
    p2.phys.x = 20;
    p2.phys.z = 20;
    for (let i = 0; i < 130; i++) srv.stepSimulation(FIXED_DT);
    expect(srv.objectives.hpOwner).toBe('A');
    expect(srv.match.scoreA).toBeGreaterThanOrEqual(2);

    // Both inside -> CONTESTED
    p2.phys.x = initialZone.x;
    p2.phys.z = initialZone.z;
    srv.stepSimulation(FIXED_DT);
    expect(srv.objectives.hpOwner).toBe('CONTESTED');

    // Advance past 45s rotation
    const steps45s = Math.ceil((HARDPOINT_ROTATE_MS / 1000) * 60) + 10;
    for (let i = 0; i < steps45s; i++) srv.stepSimulation(FIXED_DT);
    const moved =
      srv.objectives.hpZoneCenter.x !== initialZone.x ||
      srv.objectives.hpZoneCenter.z !== initialZone.z;
    expect(moved).toBe(true);

    srv.dispose();
  });

  it('Domination captures zones A/B/C and accrues continuous team points', () => {
    const srv = new GameServer();
    srv.match.config.gameMode = 'domination';
    srv.match.config.scoreLimit = 200;

    const p1 = srv.addPlayer(createMockBridge('p1').bridge, 'A1', 'assault');
    const p2 = srv.addPlayer(createMockBridge('p2').bridge, 'B1', 'vanguard');
    for (let i = 0; i < 200; i++) srv.stepSimulation(FIXED_DT);

    p1.team = 'A';
    p2.team = 'B';
    // Stand on Zone B (0, 0, 0) for 4.2s
    p1.phys.x = 0;
    p1.phys.z = 0;
    p2.phys.x = 30;
    p2.phys.z = 30;

    for (let i = 0; i < 320; i++) srv.stepSimulation(FIXED_DT);
    expect(srv.objectives.domZones[1].owner).toBe('A');
    expect(srv.match.scoreA).toBeGreaterThanOrEqual(1);

    srv.dispose();
  });

  it('Gun Game promotes weapon per kill, demotes on Kunai death, and wins on final Kunai kill', () => {
    const srv = new GameServer();
    srv.match.config.gameMode = 'gungame';
    srv.match.config.gunGameTeams = false;

    const p1 = srv.addPlayer(createMockBridge('p1').bridge, 'Runner', 'ninja');
    const p2 = srv.addPlayer(createMockBridge('p2').bridge, 'Target', 'assault');
    for (let i = 0; i < 200; i++) srv.stepSimulation(FIXED_DT);

    expect(p1.weapon).toBe(GUN_GAME_LADDER[0]);
    for (let step = 0; step < GUN_GAME_LADDER.length - 1; step++) {
      srv.objectives.onPlayerKill(p1, p2, p1.weapon, srv.match.config);
      expect(p1.gunGameLevel).toBe(step + 1);
      expect(p1.weapon).toBe(GUN_GAME_LADDER[step + 1]);
    }

    // Demote target if killed by Kunai when target had level > 0
    p2.gunGameLevel = 2;
    srv.objectives.onPlayerKill(p1, p2, 5, srv.match.config);
    expect(p2.gunGameLevel).toBe(1);
    expect(srv.match.phase).toBe('IN_PROGRESS');

    // Step simulation runs objective tick -> p1 reached final Kunai kill
    srv.stepSimulation(FIXED_DT);
    expect(srv.match.phase).toBe('ROUND_END');
    expect(srv.match.winner).toBe('p1');

    // Random rotation never picks the exact same mode consecutively
    for (let i = 0; i < 20; i++) {
      expect(pickNextRandomMode('snd')).not.toBe('snd');
    }

    srv.dispose();
  });
});
