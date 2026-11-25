import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMessage, ServerMessage } from '../shared/protocol.js';
import { GameServer } from './GameServer.js';

export interface PolyArenaServerHandle {
  app: express.Express;
  httpServer: http.Server;
  wss: WebSocketServer;
  gameServer: GameServer;
  listen: () => Promise<number>;
  close: () => Promise<void>;
}

export function createPolyArenaServer(options?: {
  port?: number;
  adminPassword?: string;
}): PolyArenaServerHandle {
  const port = options?.port ?? Number(process.env.PORT || 8080);
  const adminPassword = options?.adminPassword ?? process.env.ADMIN_PASSWORD;

  const app = express();
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const gameServer = new GameServer({ adminPassword });

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      mode: gameServer.isSleeping() ? 'idle_sleep' : 'active',
      players: gameServer.players.size,
      simTimeMs: Math.round(gameServer.getSimTimeMs()),
      activeRing: gameServer.match.activeRing,
      gameMode: gameServer.match.config.gameMode,
    });
  });

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const clientDistDir = path.resolve(currentDir, '../client');
  if (fs.existsSync(clientDistDir)) {
    app.use(express.static(clientDistDir));
  } else {
    app.get('/', (_req, res) => {
      res.status(200).send('<h1>PolyArena Server Running</h1><p>WebSocket ready at /ws</p>');
    });
  }

  let nextPlayerNum = 1;
  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const id = `p${nextPlayerNum++}`;
    const ip = req.socket.remoteAddress ?? 'unknown';
    let joined = false;

    const send = (msg: ServerMessage): void => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    };

    const disconnect = (reason?: string): void => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, reason ?? 'Closed');
      }
    };

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientMessage;
        if (!msg || typeof msg.t !== 'string') return;
        if (msg.t === 'C_JOIN') {
          if (!joined) {
            joined = true;
            gameServer.addPlayer({ id, ip, send, disconnect }, msg.name ?? 'Player', msg.classId);
          }
          return;
        }
        if (joined) {
          gameServer.handleMessage(id, msg);
        }
      } catch {
        // Ignore malformed packets silently
      }
    });

    ws.on('close', () => {
      if (joined) {
        gameServer.removePlayer(id);
      }
    });
  });

  const listen = (): Promise<number> =>
    new Promise((resolve) => {
      httpServer.listen(port, () => {
        const addr = httpServer.address();
        resolve(typeof addr === 'object' && addr ? addr.port : port);
      });
    });

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      gameServer.dispose();
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close(() => {
        httpServer.close(() => resolve());
      });
    });

  return { app, httpServer, wss, gameServer, listen, close };
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isEntrypoint) {
  const srv = createPolyArenaServer();
  srv.listen().then((boundPort) => {
    console.log(`[PolyArena] Listening on single port ${boundPort} (Idle Sleep active)`);
  });
}
