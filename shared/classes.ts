export type ClassId = 'ghost' | 'assault' | 'ninja' | 'vanguard';

export const CLASS_LIST: readonly ClassId[] = ['ghost', 'assault', 'ninja', 'vanguard'] as const;

export const CLASS_TO_INDEX: Record<ClassId, number> = {
  ghost: 0,
  assault: 1,
  ninja: 2,
  vanguard: 3,
};

export const INDEX_TO_CLASS: readonly ClassId[] = CLASS_LIST;

export interface AbilitySpec {
  id: string;
  name: string;
  cooldownSec: number;
  durationSec: number;
  description: string;
}

export interface ClassDef {
  id: ClassId;
  name: string;
  role: string;
  maxHp: number;
  speedMult: number;
  fireRateMult: number;
  reloadSpeedMult: number;
  adsSpeedMult: number;
  crouchSoundMult: number;
  silentMovement: boolean;
  maxAirJumps: number;
  kunaiDamageMult: number;
  recoilMult: number;
  passiveDescription: string;
  abilityE: AbilitySpec & {
    cloakOpacity?: number;
    dashSpeed?: number;
    dashDurationSec?: number;
    blinkMaxDist?: number;
    grenadeSpeed?: number;
    grenadeGravity?: number;
    grenadeRadius?: number;
    impulseHoriz?: number;
    impulseVert?: number;
    wallDamage?: number;
    playerDamage?: number;
  };
  abilityQ: AbilitySpec & {
    reconRadius?: number;
    stimHeal?: number;
    stimSpeedMult?: number;
    smokeRadius?: number;
    smokeThrowSpeed?: number;
    smokeGravity?: number;
    wallHp?: number;
    wallWidth?: number;
    wallHeight?: number;
    wallThickness?: number;
    wallDistance?: number;
  };
}

export const CLASS_DEFS: Record<ClassId, ClassDef> = {
  ghost: {
    id: 'ghost',
    name: 'Fantasma',
    role: 'Francotirador / Recon',
    maxHp: 100,
    speedMult: 1.0,
    fireRateMult: 1.0,
    reloadSpeedMult: 1.0,
    adsSpeedMult: 1.35,
    crouchSoundMult: 0.25,
    silentMovement: false,
    maxAirJumps: 0,
    kunaiDamageMult: 1.0,
    recoilMult: 1.0,
    passiveDescription: 'Mira ADS +35% mas rapida y pasos agachado -75% sonoros.',
    abilityE: {
      id: 'optical_cloak',
      name: 'Camuflaje Optico',
      cooldownSec: 14.0,
      durationSec: 6.0,
      cloakOpacity: 0.12,
      description: 'Vuelve el avatar semi-transparente (12% opacidad) por 6s; se rompe al disparar o recibir dano.',
    },
    abilityQ: {
      id: 'recon_pulse',
      name: 'Pulso Recon',
      cooldownSec: 16.0,
      durationSec: 3.5,
      reconRadius: 30.0,
      description: 'Escanea 30m alrededor y revela marcadores de enemigos por 3.5s.',
    },
  },
  assault: {
    id: 'assault',
    name: 'Asalto Ligero',
    role: 'Rusher',
    maxHp: 100,
    speedMult: 1.08,
    fireRateMult: 1.10,
    reloadSpeedMult: 1.10,
    adsSpeedMult: 1.0,
    crouchSoundMult: 1.0,
    silentMovement: false,
    maxAirJumps: 0,
    kunaiDamageMult: 1.0,
    recoilMult: 1.0,
    passiveDescription: '+8% velocidad de movimiento y +10% cadencia/velocidad de recarga.',
    abilityE: {
      id: 'dash',
      name: 'Dash Direccional',
      cooldownSec: 5.0,
      durationSec: 0.18,
      dashSpeed: 20.0,
      dashDurationSec: 0.18,
      description: 'Impulso direccional rapido de 20 m/s usable en suelo y aire.',
    },
    abilityQ: {
      id: 'stim',
      name: 'Sobrecarga / Stim',
      cooldownSec: 14.0,
      durationSec: 4.0,
      stimHeal: 40,
      stimSpeedMult: 1.25,
      description: 'Regenera 40 HP al instante y otorga +25% de velocidad durante 4s.',
    },
  },
  ninja: {
    id: 'ninja',
    name: 'Ninja',
    role: 'Sigilo / Movilidad',
    maxHp: 100,
    speedMult: 1.20,
    fireRateMult: 1.0,
    reloadSpeedMult: 1.0,
    adsSpeedMult: 1.0,
    crouchSoundMult: 0.0,
    silentMovement: true,
    maxAirJumps: 1,
    kunaiDamageMult: 1.25,
    recoilMult: 1.0,
    passiveDescription: '+20% velocidad (el mas rapido), sigilo total, doble salto y +25% dano Kunai.',
    abilityE: {
      id: 'shadow_blink',
      name: 'Paso Sombrio',
      cooldownSec: 8.0,
      durationSec: 0.1,
      blinkMaxDist: 10.0,
      description: 'Teletransporte corto instantaneo hacia adelante hasta 10m validado contra AABB.',
    },
    abilityQ: {
      id: 'smoke_bomb',
      name: 'Bomba de Humo',
      cooldownSec: 15.0,
      durationSec: 10.0,
      smokeRadius: 6.0,
      smokeThrowSpeed: 24.0,
      smokeGravity: -18.0,
      description: 'Despliega una nube Low Poly opaca de radio 6m durante 10s.',
    },
  },
  vanguard: {
    id: 'vanguard',
    name: 'Vanguardia',
    role: 'Tanque / Control',
    maxHp: 125,
    speedMult: 0.94,
    fireRateMult: 1.0,
    reloadSpeedMult: 1.0,
    adsSpeedMult: 1.0,
    crouchSoundMult: 1.0,
    silentMovement: false,
    maxAirJumps: 0,
    kunaiDamageMult: 1.0,
    recoilMult: 0.80,
    passiveDescription: '125 HP maximos, -20% retroceso determinista (-6% velocidad).',
    abilityE: {
      id: 'impulse_grenade',
      name: 'Granada de Impulso',
      cooldownSec: 10.0,
      durationSec: 0.25,
      grenadeSpeed: 26.0,
      grenadeGravity: -18.0,
      grenadeRadius: 5.5,
      impulseHoriz: 12.5,
      impulseVert: 6.5,
      wallDamage: 300,
      playerDamage: 20,
      description: 'Proyectil explosivo que empuja jugadores y destruye muros cercanos.',
    },
    abilityQ: {
      id: 'tactical_wall',
      name: 'Muro Tactico',
      cooldownSec: 14.0,
      durationSec: 12.0,
      wallHp: 250,
      wallWidth: 3.6,
      wallHeight: 2.2,
      wallThickness: 0.45,
      wallDistance: 2.5,
      description: 'Despliega cobertura Low Poly temporal de 250 HP / 12s frente al jugador.',
    },
  },
};

export function isValidClassId(value: unknown): value is ClassId {
  return typeof value === 'string' && (CLASS_LIST as readonly string[]).includes(value);
}
