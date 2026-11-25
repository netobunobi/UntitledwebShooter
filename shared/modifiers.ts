export interface RoomModifiers {
  speedMultiplier: number;
  playerScale: number;
  gravityMultiplier: number;
  jumpMultiplier: number;
  infiniteAmmo: boolean;
}

export const DEFAULT_MODIFIERS: RoomModifiers = {
  speedMultiplier: 1.0,
  playerScale: 1.0,
  gravityMultiplier: 1.0,
  jumpMultiplier: 1.0,
  infiniteAmmo: false,
};

export const MODIFIER_LIMITS = {
  speedMultiplier: { min: 0.3, max: 3.0 },
  playerScale: { min: 0.4, max: 2.5 },
  gravityMultiplier: { min: 0.2, max: 2.5 },
  jumpMultiplier: { min: 0.5, max: 3.0 },
} as const;

function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

export function clampModifiers(
  partial: Partial<RoomModifiers>,
  base: RoomModifiers = DEFAULT_MODIFIERS
): RoomModifiers {
  return {
    speedMultiplier:
      partial.speedMultiplier !== undefined
        ? clamp(
            partial.speedMultiplier,
            MODIFIER_LIMITS.speedMultiplier.min,
            MODIFIER_LIMITS.speedMultiplier.max
          )
        : base.speedMultiplier,
    playerScale:
      partial.playerScale !== undefined
        ? clamp(
            partial.playerScale,
            MODIFIER_LIMITS.playerScale.min,
            MODIFIER_LIMITS.playerScale.max
          )
        : base.playerScale,
    gravityMultiplier:
      partial.gravityMultiplier !== undefined
        ? clamp(
            partial.gravityMultiplier,
            MODIFIER_LIMITS.gravityMultiplier.min,
            MODIFIER_LIMITS.gravityMultiplier.max
          )
        : base.gravityMultiplier,
    jumpMultiplier:
      partial.jumpMultiplier !== undefined
        ? clamp(
            partial.jumpMultiplier,
            MODIFIER_LIMITS.jumpMultiplier.min,
            MODIFIER_LIMITS.jumpMultiplier.max
          )
        : base.jumpMultiplier,
    infiniteAmmo:
      partial.infiniteAmmo !== undefined ? Boolean(partial.infiniteAmmo) : base.infiniteAmmo,
  };
}
