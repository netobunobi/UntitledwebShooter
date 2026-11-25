export type KillstreakId = 'uav' | 'overdrive' | 'emp_strike';

export interface KillstreakDef {
  id: KillstreakId;
  killsRequired: number;
  name: string;
  description: string;
  durationSec: number;
}

export const KILLSTREAK_DEFS: Record<KillstreakId, KillstreakDef> = {
  uav: {
    id: 'uav',
    killsRequired: 3,
    name: 'Radar Tactico',
    description: 'Marca a todos los enemigos a traves de paredes durante 8s.',
    durationSec: 8.0,
  },
  overdrive: {
    id: 'overdrive',
    killsRequired: 5,
    name: 'Sobrecarga Total',
    description: 'Cura al maximo, recarga al instante y otorga +20% velocidad por 10s.',
    durationSec: 10.0,
  },
  emp_strike: {
    id: 'emp_strike',
    killsRequired: 7,
    name: 'Pulso PEM',
    description: 'Destruye muros enemigos, quita camuflajes, marca 6s y lanza onda de choque.',
    durationSec: 6.0,
  },
};

export function getStreakForKills(streak: number): KillstreakId | null {
  if (streak >= 7) return 'emp_strike';
  if (streak >= 5) return 'overdrive';
  if (streak >= 3) return 'uav';
  return null;
}

export function isValidKillstreakId(id: unknown): id is KillstreakId {
  return id === 'uav' || id === 'overdrive' || id === 'emp_strike';
}
