import type { WeaponId } from './weapons.js';

export type GameModeId = 'tdm' | 'ffa' | 'snd' | 'hardpoint' | 'domination' | 'gungame';

export const ALL_GAME_MODES: readonly GameModeId[] = [
  'tdm',
  'ffa',
  'snd',
  'hardpoint',
  'domination',
  'gungame',
] as const;

export const GUN_GAME_LADDER: readonly WeaponId[] = [0, 1, 2, 3, 4, 5] as const;

export interface GameModeDef {
  id: GameModeId;
  name: string;
  shortName: string;
  teamBasedDefault: boolean;
  allowRespawn: boolean;
  defaultScoreLimit: number;
  defaultRoundLimit: number;
  defaultDurationMin: number;
  description: string;
}

export const GAME_MODE_DEFS: Record<GameModeId, GameModeDef> = {
  tdm: {
    id: 'tdm',
    name: 'Duelo por Equipos',
    shortName: 'TDM',
    teamBasedDefault: true,
    allowRespawn: true,
    defaultScoreLimit: 50,
    defaultRoundLimit: 1,
    defaultDurationMin: 5,
    description: 'Alpha vs Bravo con respawn activo. Gana el equipo con mas bajas.',
  },
  ffa: {
    id: 'ffa',
    name: 'Todos contra Todos',
    shortName: 'FFA',
    teamBasedDefault: false,
    allowRespawn: true,
    defaultScoreLimit: 25,
    defaultRoundLimit: 1,
    defaultDurationMin: 5,
    description: 'Sin equipos ni votacion impar. Respawn rapido para todos.',
  },
  snd: {
    id: 'snd',
    name: 'Buscar y Destruir',
    shortName: 'S&D',
    teamBasedDefault: true,
    allowRespawn: false,
    defaultScoreLimit: 4,
    defaultRoundLimit: 7,
    defaultDurationMin: 2,
    description: 'Sin respawns. Planta la bomba en A/B (45s) o elimina al rival. Mejor de N rondas.',
  },
  hardpoint: {
    id: 'hardpoint',
    name: 'Punto Caliente',
    shortName: 'HARDPOINT',
    teamBasedDefault: true,
    allowRespawn: true,
    defaultScoreLimit: 250,
    defaultRoundLimit: 1,
    defaultDurationMin: 6,
    description: 'Zona luminosa que rota cada 45s y suma puntos cuando un equipo la controla.',
  },
  domination: {
    id: 'domination',
    name: 'Dominacion',
    shortName: 'DOM',
    teamBasedDefault: true,
    allowRespawn: true,
    defaultScoreLimit: 200,
    defaultRoundLimit: 1,
    defaultDurationMin: 6,
    description: '3 zonas fijas (A, B, C) que suman puntos continuos por segundo al capturarlas.',
  },
  gungame: {
    id: 'gungame',
    name: 'Juego de Armas',
    shortName: 'GUNGAME',
    teamBasedDefault: false,
    allowRespawn: true,
    defaultScoreLimit: GUN_GAME_LADDER.length,
    defaultRoundLimit: 1,
    defaultDurationMin: 6,
    description: 'Asciende de arma con cada baja hasta ganar con baja final de Shadow Kunai.',
  },
};

export interface MatchConfig {
  gameMode: GameModeId;
  gunGameTeams: boolean;
  scoreLimit: number;
  roundLimit: number;
  roundDurationMin: number;
  randomModeRotation: boolean;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  gameMode: 'tdm',
  gunGameTeams: false,
  scoreLimit: 50,
  roundLimit: 7,
  roundDurationMin: 5,
  randomModeRotation: false,
};

export function isValidGameMode(mode: unknown): mode is GameModeId {
  return typeof mode === 'string' && (ALL_GAME_MODES as readonly string[]).includes(mode);
}

export function isTeamMode(config: MatchConfig): boolean {
  if (config.gameMode === 'ffa') return false;
  if (config.gameMode === 'gungame') return config.gunGameTeams;
  return true;
}

export function getDefaultScoreLimit(mode: GameModeId): number {
  return GAME_MODE_DEFS[mode].defaultScoreLimit;
}

export function pickNextRandomMode(
  currentMode: GameModeId,
  rng: () => number = Math.random
): GameModeId {
  const candidates = ALL_GAME_MODES.filter((m) => m !== currentMode);
  const idx = Math.floor(rng() * candidates.length) % candidates.length;
  return candidates[idx];
}
