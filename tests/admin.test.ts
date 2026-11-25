import { describe, expect, it } from 'vitest';
import { GameServer, type PlayerSessionBridge } from '../server/GameServer.js';
import { FIXED_DT } from '../shared/constants.js';
import type { ServerMessage } from '../shared/protocol.js';

function createMockBridge(id: string): {
  bridge: PlayerSessionBridge;
  inbox: ServerMessage[];
  wasDisconnected: () => boolean;
} {
  const inbox: ServerMessage[] = [];
  let disconnected = false;
  return {
    inbox,
    wasDisconnected: () => disconnected,
    bridge: {
      id,
      ip: '10.0.0.1',
      send: (msg) => inbox.push(msg),
      disconnect: () => {
        disconnected = true;
      },
    },
  };
}

describe('Idle Sleep (0% CPU), Master/Temp Admin Auth, Keys & Troll Modifiers', () => {
  it('sleeps with 0 active timers and frozen simTimeMs when empty, wakes on join, sleeps on last leave', () => {
    const srv = new GameServer({ adminPassword: 'secret-master-password' });

    // Initially sleeping
    expect(srv.isSleeping()).toBe(true);
    expect(srv.hasActiveTimers()).toBe(false);
    const t0 = srv.getSimTimeMs();
    srv.stepSimulation(FIXED_DT);
    expect(srv.getSimTimeMs()).toBe(t0);

    // Join wakes server immediately
    const b1 = createMockBridge('p1');
    srv.addPlayer(b1.bridge, 'Solo', 'assault');
    expect(srv.isSleeping()).toBe(false);
    expect(srv.hasActiveTimers()).toBe(true);

    srv.stepSimulation(FIXED_DT);
    const t1 = srv.getSimTimeMs();
    expect(t1).toBeGreaterThan(t0);

    // Leave returns to Idle Sleep with 0 timers & frozen clock
    srv.removePlayer('p1');
    expect(srv.isSleeping()).toBe(true);
    expect(srv.hasActiveTimers()).toBe(false);
    srv.stepSimulation(FIXED_DT);
    expect(srv.getSimTimeMs()).toBe(t1);

    srv.dispose();
  });

  it('authenticates master password, enforces rate-limit, delegates temp keys and revokes live', () => {
    const srv = new GameServer({ adminPassword: 'master-123' });
    const masterBridge = createMockBridge('p1');
    const helperBridge = createMockBridge('p2');
    const attackerBridge = createMockBridge('p3');
    attackerBridge.bridge.ip = '10.0.0.99';

    const master = srv.addPlayer(masterBridge.bridge, 'Master', 'assault');
    const helper = srv.addPlayer(helperBridge.bridge, 'Helper', 'ghost');
    const attacker = srv.addPlayer(attackerBridge.bridge, 'Bad', 'ninja');

    // Rate-limit after 5 failed attempts
    for (let i = 0; i < 5; i++) {
      const res = srv.admin.authenticate(attacker, 'wrong', 1000 + i * 100);
      expect(res.role).toBe('none');
    }
    const blocked = srv.admin.authenticate(attacker, 'master-123', 2000);
    expect(blocked.role).toBe('none');
    expect(blocked.error).toContain('Demasiados intentos');

    // Master authenticates cleanly
    const authRes = srv.admin.authenticate(master, 'master-123', 2000);
    expect(authRes.role).toBe('master');

    // Master creates a single_session temp key
    const keyInfo = srv.admin.createTempKey('master', 'single_session', 60, 2000);
    expect(keyInfo).not.toBeNull();

    // Helper uses temp key -> cannot create new keys, can change modifiers
    const helperAuth = srv.admin.authenticate(helper, keyInfo!.code, 3000);
    expect(helperAuth.role).toBe('temp');

    const failCreate = srv.admin.createTempKey(helper.adminRole, 'duration', 30, 4000);
    expect(failCreate).toBeNull();

    helperBridge.inbox.length = 0;
    srv.handleMessage('p2', {
      t: 'C_ADMIN_ACTION',
      action: 'set_modifiers',
      payload: { speedMultiplier: 2.5, playerScale: 99, infiniteAmmo: true },
    });
    // Clamped playerScale to max 2.5
    expect(srv.admin.modifiers.speedMultiplier).toBe(2.5);
    expect(srv.admin.modifiers.playerScale).toBe(2.5);
    expect(srv.admin.modifiers.infiniteAmmo).toBe(true);

    // Master revokes temp key -> helper immediately downgraded to 'none'
    srv.handleMessage('p1', {
      t: 'C_ADMIN_ACTION',
      action: 'revoke_key',
      payload: { code: keyInfo!.code },
    });
    expect(helper.adminRole).toBe('none');
    expect(
      helperBridge.inbox.some((m) => m.t === 'S_ADMIN_STATUS' && m.role === 'none')
    ).toBe(true);

    // Admin can configure map speed 4x, pause auto-evolution, gamemode & kick
    srv.handleMessage('p1', {
      t: 'C_ADMIN_ACTION',
      action: 'set_map_evolution',
      payload: { enabled: false, speed: 4 },
    });
    expect(srv.sectors.settings.autoEvolutionEnabled).toBe(false);
    expect(srv.sectors.settings.speedMultiplier).toBe(4);

    srv.handleMessage('p1', {
      t: 'C_ADMIN_ACTION',
      action: 'kick',
      payload: { playerId: 'p3', reason: 'Test kick' },
    });
    expect(attackerBridge.wasDisconnected()).toBe(true);
    expect(srv.players.has('p3')).toBe(false);

    srv.dispose();
  });
});
