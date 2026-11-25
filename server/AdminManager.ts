import crypto from 'node:crypto';
import {
  getDefaultScoreLimit,
  isValidGameMode,
  type MatchConfig,
} from '../shared/gamemodes.js';
import {
  DEFAULT_MODIFIERS,
  clampModifiers,
  type RoomModifiers,
} from '../shared/modifiers.js';
import type { AdminRole, TempKeyInfo } from '../shared/protocol.js';
import type { SectorLevel } from '../shared/sectors.js';
import type { ServerPlayer } from './types.js';

interface TempKeyRecord extends TempKeyInfo {
  boundSecret?: string;
}

interface FailureRecord {
  count: number;
  resetAtWallMs: number;
}

export interface AdminHostHooks {
  getPlayers: () => Map<string, ServerPlayer>;
  getSimTimeMs: () => number;
  getActiveRing: () => number;
  startRound: () => void;
  pauseRound: () => void;
  resumeRound: () => void;
  resetRound: () => void;
  applyMatchConfig: (partial: Partial<MatchConfig>) => void;
  setMapEvolution: (enabled?: boolean, speed?: 1 | 2 | 4) => void;
  forceSector: (gx: number, gz: number, level: SectorLevel) => void;
  movePlayerTeam: (playerId: string, team: 'A' | 'B') => void;
  kickPlayer: (playerId: string, reason: string) => void;
  applyModifiers: (next: RoomModifiers, changedBy: string) => void;
}

function sha256Buffer(text: string): Buffer {
  return crypto.createHash('sha256').update(text, 'utf8').digest();
}

export class AdminManager {
  private readonly masterHash: Buffer;
  private tempKeys: Map<string, TempKeyRecord> = new Map();
  private playerKeyMap: Map<string, string> = new Map();
  private authFailures: Map<string, FailureRecord> = new Map();
  public modifiers: RoomModifiers = { ...DEFAULT_MODIFIERS };

  constructor(masterPassword?: string) {
    const pass =
      masterPassword && masterPassword.length > 0
        ? masterPassword
        : crypto.randomBytes(9).toString('base64url');
    this.masterHash = sha256Buffer(pass);
  }

  private pruneExpiredKeys(wallNowMs: number): void {
    for (const [code, rec] of this.tempKeys) {
      if (rec.revoked) continue;
      if (rec.mode === 'duration' && rec.expiresAtMs !== null && wallNowMs >= rec.expiresAtMs) {
        rec.revoked = true;
      }
    }
  }

  public authenticate(
    player: ServerPlayer,
    password: string,
    wallNowMs: number = Date.now()
  ): { role: AdminRole; error?: string } {
    const rateKey = player.ip || player.id;
    const fail = this.authFailures.get(rateKey);
    if (fail && wallNowMs < fail.resetAtWallMs && fail.count >= 5) {
      return { role: player.adminRole, error: 'Demasiados intentos. Espera 60 segundos.' };
    }

    const inputHash = sha256Buffer(password);
    if (crypto.timingSafeEqual(inputHash, this.masterHash)) {
      this.authFailures.delete(rateKey);
      this.playerKeyMap.delete(player.id);
      player.adminRole = 'master';
      player.send({ t: 'S_ADMIN_STATUS', role: 'master' });
      player.send({ t: 'S_ADMIN_KEYS', keys: this.listKeys(wallNowMs) });
      return { role: 'master' };
    }

    this.pruneExpiredKeys(wallNowMs);
    const key = this.tempKeys.get(password.trim());
    if (key && !key.revoked) {
      if (key.mode === 'single_session' && key.boundPlayerId && key.boundPlayerId !== player.id) {
        return { role: player.adminRole, error: 'Llave de sesion unica ya utilizada.' };
      }
      if (key.mode === 'single_session') {
        key.boundPlayerId = player.id;
      }
      this.authFailures.delete(rateKey);
      this.playerKeyMap.set(player.id, key.code);
      player.adminRole = 'temp';
      player.send({ t: 'S_ADMIN_STATUS', role: 'temp' });
      return { role: 'temp' };
    }

    // Record failure
    if (!fail || wallNowMs >= fail.resetAtWallMs) {
      this.authFailures.set(rateKey, { count: 1, resetAtWallMs: wallNowMs + 60_000 });
    } else {
      fail.count += 1;
    }

    player.send({
      t: 'S_ADMIN_STATUS',
      role: player.adminRole,
      error: 'Contrasena o llave invalida.',
    });
    return { role: player.adminRole, error: 'Contrasena o llave invalida.' };
  }

  public createTempKey(
    actorRole: AdminRole,
    mode: 'duration' | 'single_session',
    durationMinutes = 60,
    wallNowMs: number = Date.now()
  ): TempKeyInfo | null {
    if (actorRole !== 'master') return null;
    this.pruneExpiredKeys(wallNowMs);

    const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
    const code = `POLY-${rand.slice(0, 4)}-${rand.slice(4, 8)}`;
    const mins = Math.max(1, Math.min(1440, durationMinutes));
    const rec: TempKeyRecord = {
      code,
      mode,
      expiresAtMs: mode === 'duration' ? wallNowMs + mins * 60_000 : null,
      boundPlayerId: null,
      revoked: false,
    };
    this.tempKeys.set(code, rec);
    return { ...rec };
  }

  public revokeTempKey(
    actorRole: AdminRole,
    code: string,
    players: Map<string, ServerPlayer>
  ): boolean {
    if (actorRole !== 'master') return false;
    const rec = this.tempKeys.get(code);
    if (!rec) return false;
    rec.revoked = true;

    for (const [playerId, boundCode] of this.playerKeyMap) {
      if (boundCode === code) {
        this.playerKeyMap.delete(playerId);
        const p = players.get(playerId);
        if (p && p.adminRole === 'temp') {
          p.adminRole = 'none';
          p.send({
            t: 'S_ADMIN_STATUS',
            role: 'none',
            error: 'Tu llave temporal ha sido revocada.',
          });
        }
      }
    }
    return true;
  }

  public listKeys(wallNowMs: number = Date.now()): TempKeyInfo[] {
    this.pruneExpiredKeys(wallNowMs);
    return Array.from(this.tempKeys.values()).map((k) => ({
      code: k.code,
      mode: k.mode,
      expiresAtMs: k.expiresAtMs,
      boundPlayerId: k.boundPlayerId,
      revoked: k.revoked,
    }));
  }

  public onPlayerDisconnect(playerId: string): void {
    const code = this.playerKeyMap.get(playerId);
    if (code) {
      this.playerKeyMap.delete(playerId);
      const rec = this.tempKeys.get(code);
      if (rec && rec.mode === 'single_session') {
        rec.revoked = true;
      }
    }
  }

  public handleAction(
    actor: ServerPlayer,
    action: string,
    payload: Record<string, unknown> = {},
    hooks: AdminHostHooks,
    wallNowMs: number = Date.now()
  ): boolean {
    if (actor.adminRole === 'none') return false;

    // Re-validate temp key expiration lazily on action
    if (actor.adminRole === 'temp') {
      this.pruneExpiredKeys(wallNowMs);
      const code = this.playerKeyMap.get(actor.id);
      const rec = code ? this.tempKeys.get(code) : undefined;
      if (!rec || rec.revoked) {
        actor.adminRole = 'none';
        actor.send({
          t: 'S_ADMIN_STATUS',
          role: 'none',
          error: 'Tu llave temporal ha expirado.',
        });
        return false;
      }
    }

    switch (action) {
      case 'start_round':
        hooks.startRound();
        return true;

      case 'pause_round':
        if (payload.paused === false) hooks.resumeRound();
        else hooks.pauseRound();
        return true;

      case 'reset_round':
        hooks.resetRound();
        return true;

      case 'set_gamemode': {
        const mode = payload.gameMode;
        if (!isValidGameMode(mode)) return false;
        const partial: Partial<MatchConfig> = {
          gameMode: mode,
          scoreLimit: getDefaultScoreLimit(mode),
        };
        if (typeof payload.gunGameTeams === 'boolean') {
          partial.gunGameTeams = payload.gunGameTeams;
        }
        if (typeof payload.randomModeRotation === 'boolean') {
          partial.randomModeRotation = payload.randomModeRotation;
        }
        hooks.applyMatchConfig(partial);
        return true;
      }

      case 'set_match_config': {
        const partial: Partial<MatchConfig> = {};
        if (typeof payload.scoreLimit === 'number' && Number.isFinite(payload.scoreLimit)) {
          partial.scoreLimit = Math.max(1, Math.min(1000, Math.round(payload.scoreLimit)));
        }
        if (typeof payload.roundLimit === 'number' && Number.isFinite(payload.roundLimit)) {
          partial.roundLimit = Math.max(1, Math.min(25, Math.round(payload.roundLimit)));
        }
        if (
          typeof payload.roundDurationMin === 'number' &&
          Number.isFinite(payload.roundDurationMin)
        ) {
          partial.roundDurationMin = Math.max(1, Math.min(60, Math.round(payload.roundDurationMin)));
        }
        if (typeof payload.randomModeRotation === 'boolean') {
          partial.randomModeRotation = payload.randomModeRotation;
        }
        if (typeof payload.gunGameTeams === 'boolean') {
          partial.gunGameTeams = payload.gunGameTeams;
        }
        hooks.applyMatchConfig(partial);
        return true;
      }

      case 'set_map_evolution': {
        const enabled = typeof payload.enabled === 'boolean' ? payload.enabled : undefined;
        const speed =
          payload.speed === 1 || payload.speed === 2 || payload.speed === 4
            ? payload.speed
            : undefined;
        hooks.setMapEvolution(enabled, speed);
        return true;
      }

      case 'sector_force': {
        const gx = Number(payload.gx);
        const gz = Number(payload.gz);
        const level = Number(payload.level);
        if (
          !Number.isInteger(gx) ||
          !Number.isInteger(gz) ||
          (level !== 0 && level !== 1 && level !== 2)
        ) {
          return false;
        }
        hooks.forceSector(gx, gz, level as SectorLevel);
        return true;
      }

      case 'move_team': {
        const targetId = String(payload.playerId ?? '');
        const team = payload.team;
        if (!targetId || (team !== 'A' && team !== 'B')) return false;
        hooks.movePlayerTeam(targetId, team);
        return true;
      }

      case 'kick': {
        const targetId = String(payload.playerId ?? '');
        if (!targetId) return false;
        hooks.kickPlayer(targetId, String(payload.reason ?? 'Expulsado por administrador.'));
        return true;
      }

      case 'set_modifiers': {
        const next = clampModifiers(payload as Partial<RoomModifiers>, this.modifiers);
        this.modifiers = next;
        hooks.applyModifiers(next, actor.name);
        return true;
      }

      case 'reset_modifiers': {
        this.modifiers = { ...DEFAULT_MODIFIERS };
        hooks.applyModifiers(this.modifiers, actor.name);
        return true;
      }

      case 'create_key': {
        if (actor.adminRole !== 'master') return false;
        const mode = payload.mode === 'single_session' ? 'single_session' : 'duration';
        const mins = Number(payload.durationMinutes ?? 60);
        this.createTempKey(actor.adminRole, mode, mins, wallNowMs);
        actor.send({ t: 'S_ADMIN_KEYS', keys: this.listKeys(wallNowMs) });
        return true;
      }

      case 'revoke_key': {
        if (actor.adminRole !== 'master') return false;
        const code = String(payload.code ?? '');
        if (!code) return false;
        const ok = this.revokeTempKey(actor.adminRole, code, hooks.getPlayers());
        actor.send({ t: 'S_ADMIN_KEYS', keys: this.listKeys(wallNowMs) });
        return ok;
      }

      case 'list_keys': {
        if (actor.adminRole !== 'master') return false;
        actor.send({ t: 'S_ADMIN_KEYS', keys: this.listKeys(wallNowMs) });
        return true;
      }

      default:
        return false;
    }
  }
}
