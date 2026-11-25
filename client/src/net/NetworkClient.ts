import type { ClassId } from '../../../shared/classes.js';
import type { ClientMessage, ServerMessage } from '../../../shared/protocol.js';

export type ServerMessageListener = (msg: ServerMessage) => void;

export interface TimedSnapshot {
  recvSimTime: number;
  data: Extract<ServerMessage, { t: 'S_SNAPSHOT' }>;
}

export class NetworkClient {
  private ws: WebSocket | null = null;
  private listeners: Set<ServerMessageListener> = new Set();
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  public simTimeOffset = 0;
  public rttMs = 0;
  private hasSynced = false;

  public snapshots: TimedSnapshot[] = [];

  public connect(name: string, classId: ClassId): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws`;
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this.send({ t: 'C_JOIN', name, classId });
        this.send({ t: 'C_PING', clientTime: performance.now() });
        this.pingTimer = setInterval(() => {
          this.send({ t: 'C_PING', clientTime: performance.now() });
        }, 1000);
        resolve();
      };

      ws.onerror = (err) => reject(err);

      ws.onclose = () => {
        if (this.pingTimer !== null) {
          clearInterval(this.pingTimer);
          this.pingTimer = null;
        }
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as ServerMessage;
          if (msg.t === 'S_WELCOME') {
            this.simTimeOffset = msg.serverTime - performance.now();
            this.hasSynced = true;
          } else if (msg.t === 'S_PONG') {
            const now = performance.now();
            this.rttMs = Math.max(0, now - msg.clientTime);
            const estServerTime = msg.serverTime + this.rttMs * 0.5;
            const newOffset = estServerTime - now;
            this.simTimeOffset = this.hasSynced
              ? this.simTimeOffset * 0.8 + newOffset * 0.2
              : newOffset;
            this.hasSynced = true;
          } else if (msg.t === 'S_SNAPSHOT') {
            this.snapshots.push({ recvSimTime: msg.st, data: msg });
            if (this.snapshots.length > 12) {
              this.snapshots.shift();
            }
          }
          for (const listener of this.listeners) {
            listener(msg);
          }
        } catch {
          // Ignore invalid JSON
        }
      };
    });
  }

  public getServerSimTime(): number {
    return performance.now() + this.simTimeOffset;
  }

  public onMessage(listener: ServerMessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
