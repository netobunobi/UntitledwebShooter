import { describe, expect, it } from 'vitest';
import { GameServer, type PlayerSessionBridge } from '../server/GameServer.js';
import { CLASS_DEFS } from '../shared/classes.js';
import { FIXED_DT, KEY_JUMP, KEY_SPRINT, KEY_W } from '../shared/constants.js';
import { getStreakForKills } from '../shared/killstreaks.js';
import { DEFAULT_MODIFIERS } from '../shared/modifiers.js';
import { createInitialPhysState, stepPlayerPhysics } from '../shared/physics.js';
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

describe('4 Unique Classes & Unconventional Weapons', () => {
  it('supports Ninja passive double air-jump while restricting other classes to single jump', () => {
    const ninjaState = createInitialPhysState(0, 0, 0);
    const assaultState = createInitialPhysState(0, 0, 0);

    // Tick 1: first jump
    stepPlayerPhysics(ninjaState, { keys: KEY_JUMP, yaw: 0 }, [], 1, DEFAULT_MODIFIERS, CLASS_DEFS.ninja, FIXED_DT);
    stepPlayerPhysics(assaultState, { keys: KEY_JUMP, yaw: 0 }, [], 1, DEFAULT_MODIFIERS, CLASS_DEFS.assault, FIXED_DT);

    // Release jump and descend past coyote time
    for (let i = 0; i < 15; i++) {
      stepPlayerPhysics(ninjaState, { keys: 0, yaw: 0 }, [], 1, DEFAULT_MODIFIERS, CLASS_DEFS.ninja, FIXED_DT);
      stepPlayerPhysics(assaultState, { keys: 0, yaw: 0 }, [], 1, DEFAULT_MODIFIERS, CLASS_DEFS.assault, FIXED_DT);
    }

    const vyNinjaBefore = ninjaState.vy;
    const vyAssaultBefore = assaultState.vy;

    // Press jump in mid-air -> only Ninja gets upward boost
    stepPlayerPhysics(ninjaState, { keys: KEY_JUMP, yaw: 0 }, [], 1, DEFAULT_MODIFIERS, CLASS_DEFS.ninja, FIXED_DT);
    stepPlayerPhysics(assaultState, { keys: KEY_JUMP, yaw: 0 }, [], 1, DEFAULT_MODIFIERS, CLASS_DEFS.assault, FIXED_DT);

    expect(ninjaState.vy).toBeGreaterThan(vyNinjaBefore + 3);
    expect(assaultState.vy).toBeLessThan(vyAssaultBefore);
  });

  it('Ghost optical cloak breaks immediately on firing and Recon Pulse is blocked by Ninja smoke', () => {
    const srv = new GameServer();
    const b1 = createMockBridge('p1');
    const b2 = createMockBridge('p2');
    const p1 = srv.addPlayer(b1.bridge, 'Fantasma', 'ghost');
    const p2 = srv.addPlayer(b2.bridge, 'Ninja', 'ninja');

    // Start match and clear countdown
    for (let i = 0; i < 200; i++) srv.stepSimulation(FIXED_DT);

    p1.team = 'A';
    p2.team = 'B';
    p1.phys.x = 0;
    p1.phys.y = 0;
    p1.phys.z = 0;
    p2.phys.x = 0;
    p2.phys.y = 0;
    p2.phys.z = -10;

    // Activate Ghost cloak (E)
    srv.activateAbility(p1, 'E', 0, 0);
    expect(p1.cloakTimer).toBeGreaterThan(5);

    // Firing breaks cloak
    srv.handleMessage('p1', {
      t: 'C_FIRE',
      seq: 1,
      weapon: 0,
      shotIdx: 0,
      origin: { x: 0, y: 1.6, z: 0 },
      dir: { x: 0, y: 0, z: 1 },
      clientTime: srv.getSimTimeMs(),
    });
    expect(p1.cloakTimer).toBe(0);

    // Recon Pulse detects p2 within 30m
    b1.inbox.length = 0;
    srv.activateAbility(p1, 'Q', 0, 0);
    const recon1 = b1.inbox.find((m) => m.t === 'S_RECON_PING');
    expect(recon1?.t === 'S_RECON_PING' && recon1.targetIds).toContain('p2');

    // Spawn Ninja smoke right on p2 -> Recon Pulse is blocked
    srv.deployables.spawnSmoke('p2', { x: 0, y: 1, z: -10 }, srv.getSimTimeMs());
    p1.cdQ = 0;
    b1.inbox.length = 0;
    srv.activateAbility(p1, 'Q', 0, 0);
    const recon2 = b1.inbox.find((m) => m.t === 'S_RECON_PING');
    expect(recon2?.t === 'S_RECON_PING' && recon2.targetIds.length).toBe(0);

    srv.dispose();
  });

  it('Assault Stim heals +40 HP and Vanguard starts at 125 HP & deploys 250 HP wall', () => {
    const srv = new GameServer();
    const b1 = createMockBridge('p1');
    const b2 = createMockBridge('p2');
    const p1 = srv.addPlayer(b1.bridge, 'Rusher', 'assault');
    const p2 = srv.addPlayer(b2.bridge, 'Tank', 'vanguard');

    expect(p2.maxHp).toBe(125);
    expect(p2.hp).toBe(125);

    p1.hp = 50;
    srv.activateAbility(p1, 'Q', 0, 0);
    expect(p1.hp).toBe(90);
    expect(p1.phys.stimTimer).toBeCloseTo(4.0, 2);

    srv.activateAbility(p2, 'Q', 0, 0);
    expect(srv.deployables.walls.length).toBe(1);
    expect(srv.deployables.walls[0].hp).toBe(250);

    // Impulse grenade destroys tactical wall
    p2.phys.x = 0;
    p2.phys.y = 0;
    p2.phys.z = 0;
    const wall = srv.deployables.walls[0];
    const wx = (wall.box.minX + wall.box.maxX) * 0.5;
    const wz = (wall.box.minZ + wall.box.maxZ) * 0.5;
    srv.projectiles.spawn(
      'impulse_grenade',
      p2,
      { x: wx, y: 1.5, z: wz },
      { x: 0, y: -1, z: 0 },
      DEFAULT_MODIFIERS,
      srv.getSimTimeMs()
    );
    for (let i = 0; i < 30; i++) srv.stepSimulation(FIXED_DT);
    expect(srv.deployables.walls.length).toBe(0);

    srv.dispose();
  });

  it('Shadow Kunai follows parabolic drop and deals lethal headshot damage (150 for Ninja)', () => {
    const srv = new GameServer();
    const b1 = createMockBridge('p1');
    const b2 = createMockBridge('p2');
    const ninja = srv.addPlayer(b1.bridge, 'Ninja', 'ninja');
    const target = srv.addPlayer(b2.bridge, 'Target', 'vanguard');

    for (let i = 0; i < 200; i++) srv.stepSimulation(FIXED_DT);

    ninja.team = 'A';
    target.team = 'B';
    ninja.weapon = 5;
    ninja.phys.x = 0;
    ninja.phys.y = 0;
    ninja.phys.z = 0;
    target.phys.x = 0;
    target.phys.y = 0;
    target.phys.z = -12;
    target.hp = 125;

    // Aim directly at target's head (~1.62m height, slight compensation for 12m arc)
    srv.handleMessage('p1', {
      t: 'C_FIRE',
      seq: 1,
      weapon: 5,
      shotIdx: 0,
      origin: { x: 0, y: 1.62, z: 0 },
      dir: { x: 0, y: 0.025, z: -1 },
      clientTime: srv.getSimTimeMs(),
    });

    for (let i = 0; i < 30; i++) srv.stepSimulation(FIXED_DT);
    // 120 * 1.25 = 150 dmg > 125 Vanguard maxHp -> lethal 1-shot headshot!
    expect(target.alive).toBe(false);
    expect(target.hp).toBe(0);

    srv.dispose();
  });

  it('enforces class speed hierarchy (Ninja > Assault > Ghost > Vanguard) and Sprint boost', () => {
    expect(CLASS_DEFS.ninja.speedMult).toBeGreaterThan(CLASS_DEFS.assault.speedMult);
    expect(CLASS_DEFS.assault.speedMult).toBeGreaterThan(CLASS_DEFS.ghost.speedMult);
    expect(CLASS_DEFS.ghost.speedMult).toBeGreaterThan(CLASS_DEFS.vanguard.speedMult);

    const walk = createInitialPhysState(0, 0, 0);
    const sprint = createInitialPhysState(0, 0, 0);
    for (let i = 0; i < 30; i++) {
      stepPlayerPhysics(walk, { keys: KEY_W, yaw: 0 }, [], 1, DEFAULT_MODIFIERS, CLASS_DEFS.ninja, FIXED_DT);
      stepPlayerPhysics(sprint, { keys: KEY_W | KEY_SPRINT, yaw: 0 }, [], 1, DEFAULT_MODIFIERS, CLASS_DEFS.ninja, FIXED_DT);
    }
    expect(Math.abs(sprint.vz)).toBeGreaterThan(Math.abs(walk.vz) * 1.25);
  });

  it('unlocks and activates 3-kill UAV Radar killstreak revealing enemies through walls', () => {
    expect(getStreakForKills(2)).toBeNull();
    expect(getStreakForKills(3)).toBe('uav');
    expect(getStreakForKills(5)).toBe('overdrive');
    expect(getStreakForKills(7)).toBe('emp_strike');

    const srv = new GameServer();
    const b1 = createMockBridge('p1');
    const b2 = createMockBridge('p2');
    const p1 = srv.addPlayer(b1.bridge, 'Ace', 'assault');
    const p2 = srv.addPlayer(b2.bridge, 'Target', 'vanguard');
    for (let i = 0; i < 200; i++) srv.stepSimulation(FIXED_DT);

    p1.team = 'A';
    p2.team = 'B';
    p1.killStreak = 3;
    p1.readyStreak = 'uav';

    b1.inbox.length = 0;
    srv.handleMessage('p1', { t: 'C_ACTIVATE_STREAK', yaw: 0, pitch: 0 });
    expect(p1.readyStreak).toBeNull();
    const ping = b1.inbox.find((m) => m.t === 'S_RECON_PING');
    expect(ping?.t === 'S_RECON_PING' && ping.targetIds).toContain('p2');
    const banner = b1.inbox.find((m) => m.t === 'S_STREAK_BANNER');
    expect(banner?.t === 'S_STREAK_BANNER' && banner.streakId === 'uav').toBe(true);

    srv.dispose();
  });
});
