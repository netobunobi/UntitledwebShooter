import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createPolyArenaServer, type PolyArenaServerHandle } from '../server/index.js';
import type { ClientMessage, ServerMessage } from '../shared/protocol.js';
import { validateGridCohesion } from '../shared/sectors.js';

interface TestWsClient {
  ws: WebSocket;
  inbox: ServerMessage[];
  send: (msg: ClientMessage) => void;
  waitFor: <T extends ServerMessage['t']>(
    type: T,
    predicate?: (msg: Extract<ServerMessage, { t: T }>) => boolean,
    timeoutMs?: number
  ) => Promise<Extract<ServerMessage, { t: T }>>;
  close: () => Promise<void>;
}

function connectClient(url: string): Promise<TestWsClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const inbox: ServerMessage[] = [];
    const waiters: Array<{
      check: (msg: ServerMessage) => boolean;
      resolve: (msg: ServerMessage) => void;
    }> = [];

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      inbox.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].check(msg)) {
          const w = waiters.splice(i, 1)[0];
          w.resolve(msg);
        }
      }
    });

    ws.on('open', () => {
      resolve({
        ws,
        inbox,
        send: (msg) => ws.send(JSON.stringify(msg)),
        waitFor: <T extends ServerMessage['t']>(
          type: T,
          predicate?: (m: Extract<ServerMessage, { t: T }>) => boolean,
          timeoutMs = 3000
        ) => {
          for (const existing of inbox) {
            if (
              existing.t === type &&
              (!predicate || predicate(existing as Extract<ServerMessage, { t: T }>))
            ) {
              return Promise.resolve(existing as Extract<ServerMessage, { t: T }>);
            }
          }
          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              rej(new Error(`Timeout waiting for ${type}`));
            }, timeoutMs);
            waiters.push({
              check: (m) =>
                m.t === type &&
                (!predicate || predicate(m as Extract<ServerMessage, { t: T }>)),
              resolve: (m) => {
                clearTimeout(timer);
                res(m as Extract<ServerMessage, { t: T }>);
              },
            });
          });
        },
        close: () =>
          new Promise((res) => {
            if (ws.readyState === WebSocket.CLOSED) return res();
            ws.once('close', () => res());
            ws.close();
          }),
      });
    });

    ws.on('error', reject);
  });
}

describe('Multi-Client WS End-to-End Integration', () => {
  let srv: PolyArenaServerHandle;
  let port = 0;

  beforeAll(async () => {
    srv = createPolyArenaServer({ port: 0, adminPassword: 'int-master-password' });
    port = await srv.listen();
  });

  afterAll(async () => {
    await srv.close();
  });

  it('verifies Idle Sleep -> 3-client odd vote -> class & abilities -> master/temp keys -> modifiers -> map 4x -> sleep again', async () => {
    const baseHttp = `http://127.0.0.1:${port}`;
    const wsUrl = `ws://127.0.0.1:${port}/ws`;

    // 1. Starts in Idle Sleep
    const h0 = await fetch(`${baseHttp}/health`).then((r) => r.json());
    expect(h0.mode).toBe('idle_sleep');
    expect(h0.players).toBe(0);
    expect(srv.gameServer.hasActiveTimers()).toBe(false);

    // 2. Connect 3 real WS clients -> wakes up & triggers odd vote
    const c1 = await connectClient(wsUrl);
    const c2 = await connectClient(wsUrl);
    const c3 = await connectClient(wsUrl);

    c1.send({ t: 'C_JOIN', name: 'MasterUser', classId: 'ghost' });
    await c1.waitFor('S_WELCOME');
    const h1 = await fetch(`${baseHttp}/health`).then((r) => r.json());
    expect(h1.mode).toBe('active');
    expect(h1.players).toBe(1);

    c2.send({ t: 'C_JOIN', name: 'HelperUser', classId: 'ninja' });
    await c2.waitFor('S_WELCOME');

    c3.send({ t: 'C_JOIN', name: 'ThirdUser', classId: 'vanguard' });
    await c3.waitFor('S_WELCOME');

    // Force start round with 3 players -> ODD_VOTE
    c1.send({ t: 'C_ADMIN_AUTH', password: 'int-master-password' });
    await c1.waitFor('S_ADMIN_STATUS', (m) => m.role === 'master');

    c1.send({ t: 'C_ADMIN_ACTION', action: 'start_round' });
    await c1.waitFor('S_VOTE_START');
    await c2.waitFor('S_VOTE_START');

    c1.send({ t: 'C_VOTE', team: 'A' });
    c2.send({ t: 'C_VOTE', team: 'A' });
    c3.send({ t: 'C_VOTE', team: 'B' });

    const voteRes = await c1.waitFor('S_VOTE_RESULT');
    expect(voteRes.winnerTeam).toBe('A');

    // 3. Create temp key -> c2 authenticates -> sets troll modifiers -> master revokes
    c1.send({
      t: 'C_ADMIN_ACTION',
      action: 'create_key',
      payload: { mode: 'duration', durationMinutes: 30 },
    });
    const keyListMsg = await c1.waitFor('S_ADMIN_KEYS', (m) => m.keys.length > 0);
    const tempCode = keyListMsg.keys[0].code;

    c2.send({ t: 'C_ADMIN_AUTH', password: tempCode });
    await c2.waitFor('S_ADMIN_STATUS', (m) => m.role === 'temp');

    c2.send({
      t: 'C_ADMIN_ACTION',
      action: 'set_modifiers',
      payload: { speedMultiplier: 1.8, playerScale: 1.6, infiniteAmmo: true },
    });
    const modMsg = await c3.waitFor(
      'S_MODIFIERS_UPDATE',
      (m) => m.modifiers.playerScale === 1.6
    );
    expect(modMsg.modifiers.speedMultiplier).toBe(1.8);
    expect(modMsg.modifiers.infiniteAmmo).toBe(true);

    // Revoke temp key -> c2 downgraded immediately
    c1.send({ t: 'C_ADMIN_ACTION', action: 'revoke_key', payload: { code: tempCode } });
    const downgraded = await c2.waitFor('S_ADMIN_STATUS', (m) => m.role === 'none');
    expect(downgraded.role).toBe('none');

    // 4. Master sets map speed 4x, forces sector level 2, changes gamemode to hardpoint
    c1.send({
      t: 'C_ADMIN_ACTION',
      action: 'set_map_evolution',
      payload: { enabled: true, speed: 4 },
    });
    const mapCfg = await c3.waitFor(
      'S_MAP_SETTINGS_UPDATE',
      (m) => m.settings.speedMultiplier === 4
    );
    expect(mapCfg.settings.speedMultiplier).toBe(4);

    c1.send({
      t: 'C_ADMIN_ACTION',
      action: 'sector_force',
      payload: { gx: 1, gz: 1, level: 1 },
    });
    const secWarn = await c3.waitFor(
      'S_SECTOR_WARNING',
      (m) => m.sector.gx === 1 && m.sector.gz === 1
    );
    expect(secWarn.sector.targetLevel).toBe(1);
    expect(validateGridCohesion(srv.gameServer.sectors.grid, 3).valid).toBe(true);

    c1.send({
      t: 'C_ADMIN_ACTION',
      action: 'set_gamemode',
      payload: { gameMode: 'hardpoint', randomModeRotation: true },
    });
    const hpState = await c3.waitFor(
      'S_MATCH_STATE',
      (m) => m.gameMode === 'hardpoint'
    );
    expect(hpState.matchConfig.randomModeRotation).toBe(true);

    // 5. Disconnect all 3 clients -> returns cleanly to Idle Sleep (0 timers)
    await c1.close();
    await c2.close();
    await c3.close();

    // Give ws close handlers a micro-tick to fire on server
    await new Promise((r) => setTimeout(r, 80));
    const hEnd = await fetch(`${baseHttp}/health`).then((r) => r.json());
    expect(hEnd.mode).toBe('idle_sleep');
    expect(hEnd.players).toBe(0);
    expect(srv.gameServer.hasActiveTimers()).toBe(false);
  });
});
