import {
  AIR_ACCEL,
  BASE_MOVE_SPEED,
  COYOTE_TIME,
  GRAVITY,
  GROUND_ACCEL,
  GROUND_FRICTION,
  JUMP_BUFFER_TIME,
  JUMP_VELOCITY,
  KEY_A,
  KEY_ABILITY_E,
  KEY_ADS,
  KEY_CROUCH,
  KEY_D,
  KEY_FIRE,
  KEY_JUMP,
  KEY_S,
  KEY_SLIDE,
  KEY_SPRINT,
  KEY_W,
  PLAYER_HALF_WIDTH,
  PLAYER_STAND_HEIGHT,
  SLIDE_COOLDOWN,
  SLIDE_DURATION,
  SLIDE_FRICTION,
  SLIDE_IMPULSE,
  SLIDE_JUMP_MAX_SPEED,
  SLIDE_MIN_SPEED,
  SPRINT_SPEED_MULT,
  STEP_HEIGHT,
} from './constants.js';
import type { ClassDef } from './classes.js';
import type { RoomModifiers } from './modifiers.js';
import {
  aabbIntersects,
  ensureUnstuck,
  getArenaHalfExtent,
  getPlayerAABB,
  type AABB,
} from './collision.js';

export interface PlayerPhysState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  sliding: boolean;
  slideTimer: number;
  slideCooldown: number;
  crouching: boolean;
  coyoteTimer: number;
  jumpBufferTimer: number;
  prevJumpHeld: boolean;
  airJumpsUsed: number;
  dashing: boolean;
  dashTimer: number;
  dashDirX: number;
  dashDirZ: number;
  dashCooldown: number;
  stimTimer: number;
  sprinting: boolean;
}

export interface MoveInput {
  keys: number;
  yaw: number;
}

export function createInitialPhysState(x = 0, y = 0, z = 0): PlayerPhysState {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true,
    sliding: false,
    slideTimer: 0,
    slideCooldown: 0,
    crouching: false,
    coyoteTimer: 0,
    jumpBufferTimer: 0,
    prevJumpHeld: false,
    airJumpsUsed: 0,
    dashing: false,
    dashTimer: 0,
    dashDirX: 0,
    dashDirZ: -1,
    dashCooldown: 0,
    stimTimer: 0,
    sprinting: false,
  };
}

function hasHeadroomToStand(
  x: number,
  y: number,
  z: number,
  playerScale: number,
  colliders: readonly AABB[]
): boolean {
  const standBox = getPlayerAABB(x, y, z, false, playerScale);
  for (const box of colliders) {
    if (box.kind === 'boundary') continue;
    if (aabbIntersects(standBox, box, 0.002)) {
      return false;
    }
  }
  return true;
}

function computeWishDir(keys: number, yaw: number): { wx: number; wz: number; hasDir: boolean } {
  let forward = 0;
  let strafe = 0;
  if (keys & KEY_W) forward += 1;
  if (keys & KEY_S) forward -= 1;
  if (keys & KEY_D) strafe += 1;
  if (keys & KEY_A) strafe -= 1;

  if (forward === 0 && strafe === 0) {
    return { wx: 0, wz: 0, hasDir: false };
  }

  const fwdX = -Math.sin(yaw);
  const fwdZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  let wx = fwdX * forward + rightX * strafe;
  let wz = fwdZ * forward + rightZ * strafe;
  const len = Math.hypot(wx, wz);
  if (len > 1e-6) {
    wx /= len;
    wz /= len;
  }
  return { wx, wz, hasDir: true };
}

/**
 * Deterministic 60Hz movement & collision controller shared identically by client prediction and server authority.
 */
export function stepPlayerPhysics(
  state: PlayerPhysState,
  input: MoveInput,
  colliders: readonly AABB[],
  activeRing: number,
  modifiers: RoomModifiers,
  classDef: ClassDef,
  dt: number
): void {
  const scale = modifiers.playerScale;
  const speedMult =
    modifiers.speedMultiplier *
    classDef.speedMult *
    (state.stimTimer > 0 ? classDef.abilityQ.stimSpeedMult ?? 1.25 : 1.0);
  const grav = GRAVITY * modifiers.gravityMultiplier;
  const jumpVel = JUMP_VELOCITY * modifiers.jumpMultiplier;
  const stepUpHeight = STEP_HEIGHT * scale;

  // Timers
  if (state.slideCooldown > 0) state.slideCooldown = Math.max(0, state.slideCooldown - dt);
  if (state.dashCooldown > 0) state.dashCooldown = Math.max(0, state.dashCooldown - dt);
  if (state.stimTimer > 0) state.stimTimer = Math.max(0, state.stimTimer - dt);

  // =========================================================================
  // STEP 1: Vertical Push by Emerging Sector Structures (vy_struct > 0)
  // =========================================================================
  let ridingRisingBox: AABB | null = null;
  const curBox = getPlayerAABB(state.x, state.y, state.z, state.crouching || state.sliding, scale);
  for (const box of colliders) {
    if (box.vy && box.vy > 0) {
      const overlapXZ =
        curBox.maxX > box.minX + 0.002 &&
        curBox.minX < box.maxX - 0.002 &&
        curBox.maxZ > box.minZ + 0.002 &&
        curBox.minZ < box.maxZ - 0.002;
      if (
        overlapXZ &&
        state.y <= box.maxY + 0.15 * scale &&
        curBox.maxY > box.minY &&
        state.vy <= box.vy + 0.5
      ) {
        state.y = box.maxY;
        state.vy = box.vy;
        state.grounded = true;
        state.airJumpsUsed = 0;
        ridingRisingBox = box;
      }
    }
  }

  // Ground coyote & jump buffering
  if (state.grounded) {
    state.coyoteTimer = COYOTE_TIME;
    state.airJumpsUsed = 0;
  } else if (state.coyoteTimer > 0) {
    state.coyoteTimer = Math.max(0, state.coyoteTimer - dt);
  }

  const jumpHeld = Boolean(input.keys & KEY_JUMP);
  const jumpJustPressed = jumpHeld && !state.prevJumpHeld;
  state.prevJumpHeld = jumpHeld;

  if (jumpJustPressed) {
    state.jumpBufferTimer = JUMP_BUFFER_TIME;
  } else if (state.jumpBufferTimer > 0) {
    state.jumpBufferTimer = Math.max(0, state.jumpBufferTimer - dt);
  }

  const { wx, wz, hasDir } = computeWishDir(input.keys, input.yaw);
  const horizSpeed = Math.hypot(state.vx, state.vz);
  const wantSlide = Boolean(input.keys & KEY_SLIDE);
  const wantCrouch = Boolean(input.keys & KEY_CROUCH);

  // Trigger Assault Dash (E) deterministically if equipped
  if (
    Boolean(input.keys & KEY_ABILITY_E) &&
    classDef.abilityE.id === 'dash' &&
    state.dashCooldown <= 0 &&
    !state.dashing
  ) {
    const dashDirX = hasDir ? wx : -Math.sin(input.yaw);
    const dashDirZ = hasDir ? wz : -Math.cos(input.yaw);
    state.dashing = true;
    state.dashTimer = classDef.abilityE.dashDurationSec ?? 0.18;
    state.dashCooldown = classDef.abilityE.cooldownSec;
    state.dashDirX = dashDirX;
    state.dashDirZ = dashDirZ;
    state.sliding = false;
    state.slideTimer = 0;
    if (!state.grounded && state.vy < 1.5) {
      state.vy = 1.5;
    }
  }

  // Trigger Slide
  if (
    wantSlide &&
    !state.sliding &&
    !state.dashing &&
    state.grounded &&
    state.slideCooldown <= 0 &&
    horizSpeed >= SLIDE_MIN_SPEED * modifiers.speedMultiplier
  ) {
    state.sliding = true;
    state.crouching = true;
    state.slideTimer = SLIDE_DURATION;
    const dirX = hasDir ? wx : state.vx / Math.max(0.001, horizSpeed);
    const dirZ = hasDir ? wz : state.vz / Math.max(0.001, horizSpeed);
    const impulse = SLIDE_IMPULSE * speedMult;
    state.vx = dirX * impulse;
    state.vz = dirZ * impulse;
  }

  // Update Slide / Crouch state
  if (state.sliding) {
    state.slideTimer -= dt;
    if (state.slideTimer <= 0 || !state.grounded) {
      state.sliding = false;
      state.slideTimer = 0;
      state.slideCooldown = SLIDE_COOLDOWN;
    }
  }

  if (!state.sliding) {
    if (wantCrouch || wantSlide) {
      state.crouching = true;
    } else if (state.crouching) {
      if (hasHeadroomToStand(state.x, state.y, state.z, scale, colliders)) {
        state.crouching = false;
      }
    }
  }

  // Handle Jump (grounded / coyote OR Ninja air double-jump)
  if (state.jumpBufferTimer > 0 && state.coyoteTimer > 0) {
    state.vy = Math.max(jumpVel, (ridingRisingBox?.vy ?? 0) + jumpVel);
    ridingRisingBox = null;
    state.grounded = false;
    state.coyoteTimer = 0;
    state.jumpBufferTimer = 0;

    if (state.sliding) {
      state.sliding = false;
      state.slideTimer = 0;
      state.slideCooldown = SLIDE_COOLDOWN;
      const cap = SLIDE_JUMP_MAX_SPEED * speedMult;
      const sp = Math.hypot(state.vx, state.vz);
      if (sp > cap && sp > 0) {
        state.vx = (state.vx / sp) * cap;
        state.vz = (state.vz / sp) * cap;
      }
    }
  } else if (
    jumpJustPressed &&
    !state.grounded &&
    state.coyoteTimer <= 0 &&
    state.airJumpsUsed < classDef.maxAirJumps
  ) {
    state.vy = jumpVel * 0.95;
    state.airJumpsUsed += 1;
    state.jumpBufferTimer = 0;
  }

  // Horizontal Velocity Update
  if (state.dashing) {
    const dashSpeed = (classDef.abilityE.dashSpeed ?? 20.0) * modifiers.speedMultiplier;
    state.vx = state.dashDirX * dashSpeed;
    state.vz = state.dashDirZ * dashSpeed;
    state.dashTimer -= dt;
    if (state.dashTimer <= 0) {
      state.dashing = false;
      state.dashTimer = 0;
      const postCap = BASE_MOVE_SPEED * speedMult * 1.15;
      const sp = Math.hypot(state.vx, state.vz);
      if (sp > postCap && sp > 0) {
        state.vx = (state.vx / sp) * postCap;
        state.vz = (state.vz / sp) * postCap;
      }
    }
  } else if (state.sliding) {
    state.sprinting = false;
    const drop = Math.max(0, 1 - SLIDE_FRICTION * dt);
    state.vx *= drop;
    state.vz *= drop;
  } else {
    state.sprinting =
      !state.crouching &&
      Boolean(input.keys & KEY_SPRINT) &&
      Boolean(input.keys & KEY_W) &&
      !(input.keys & (KEY_ADS | KEY_FIRE));
    const targetSpeed =
      BASE_MOVE_SPEED *
      speedMult *
      (state.crouching ? 0.55 : state.sprinting ? SPRINT_SPEED_MULT : 1.0);
    if (state.grounded) {
      const fric = Math.max(0, 1 - GROUND_FRICTION * dt);
      state.vx *= fric;
      state.vz *= fric;
      if (hasDir) {
        const curProj = state.vx * wx + state.vz * wz;
        const add = Math.max(0, Math.min(targetSpeed - curProj, GROUND_ACCEL * dt * speedMult * (state.sprinting ? SPRINT_SPEED_MULT : 1.0)));
        state.vx += wx * add;
        state.vz += wz * add;
      }
    } else if (hasDir) {
      const curProj = state.vx * wx + state.vz * wz;
      const add = Math.max(0, Math.min(targetSpeed - curProj, AIR_ACCEL * dt * speedMult));
      state.vx += wx * add;
      state.vz += wz * add;
    }
  }

  const crouchBoxFlag = state.crouching || state.sliding;

  // =========================================================================
  // STEP 2: Axis X Resolution + Step-Up (0.45 * playerScale)
  // =========================================================================
  const prevX = state.x;
  state.x += state.vx * dt;
  let boxX = getPlayerAABB(state.x, state.y, state.z, crouchBoxFlag, scale);

  for (const c of colliders) {
    if (!aabbIntersects(boxX, c, 0.0005)) continue;
    // Check Step-Up on non-boundary solids
    if (c.kind !== 'boundary' && (state.grounded || state.vy <= 0.5)) {
      const stepDelta = c.maxY - state.y;
      if (stepDelta > 0 && stepDelta <= stepUpHeight) {
        const steppedBox = getPlayerAABB(state.x, c.maxY + 0.001, state.z, crouchBoxFlag, scale);
        const blockedAbove = colliders.some(
          (other) => other.kind !== 'boundary' && aabbIntersects(steppedBox, other, 0.001)
        );
        if (!blockedAbove) {
          state.y = c.maxY + 0.001;
          boxX = steppedBox;
          continue;
        }
      }
    }
    if (state.x > prevX) {
      state.x = c.minX - PLAYER_HALF_WIDTH * scale - 0.0005;
    } else if (state.x < prevX) {
      state.x = c.maxX + PLAYER_HALF_WIDTH * scale + 0.0005;
    }
    state.vx = 0;
    boxX = getPlayerAABB(state.x, state.y, state.z, crouchBoxFlag, scale);
  }

  // =========================================================================
  // STEP 3: Axis Z Resolution + Step-Up (0.45 * playerScale)
  // =========================================================================
  const prevZ = state.z;
  state.z += state.vz * dt;
  let boxZ = getPlayerAABB(state.x, state.y, state.z, crouchBoxFlag, scale);

  for (const c of colliders) {
    if (!aabbIntersects(boxZ, c, 0.0005)) continue;
    if (c.kind !== 'boundary' && (state.grounded || state.vy <= 0.5)) {
      const stepDelta = c.maxY - state.y;
      if (stepDelta > 0 && stepDelta <= stepUpHeight) {
        const steppedBox = getPlayerAABB(state.x, c.maxY + 0.001, state.z, crouchBoxFlag, scale);
        const blockedAbove = colliders.some(
          (other) => other.kind !== 'boundary' && aabbIntersects(steppedBox, other, 0.001)
        );
        if (!blockedAbove) {
          state.y = c.maxY + 0.001;
          boxZ = steppedBox;
          continue;
        }
      }
    }
    if (state.z > prevZ) {
      state.z = c.minZ - PLAYER_HALF_WIDTH * scale - 0.0005;
    } else if (state.z < prevZ) {
      state.z = c.maxZ + PLAYER_HALF_WIDTH * scale + 0.0005;
    }
    state.vz = 0;
    boxZ = getPlayerAABB(state.x, state.y, state.z, crouchBoxFlag, scale);
  }

  // =========================================================================
  // STEP 4: Axis Y Resolution (Gravity, Ground & Ceiling)
  // =========================================================================
  const height = (crouchBoxFlag ? 1.0 : PLAYER_STAND_HEIGHT) * scale;
  const halfW = PLAYER_HALF_WIDTH * scale;
  const stillOnRisingBox =
    ridingRisingBox !== null &&
    state.x + halfW > ridingRisingBox.minX + 0.002 &&
    state.x - halfW < ridingRisingBox.maxX - 0.002 &&
    state.z + halfW > ridingRisingBox.minZ + 0.002 &&
    state.z - halfW < ridingRisingBox.maxZ - 0.002;

  if (stillOnRisingBox && ridingRisingBox) {
    state.y = ridingRisingBox.maxY;
    state.vy = ridingRisingBox.vy ?? 0;
    state.grounded = true;
  } else {
    const effGrav = state.dashing ? grav * 0.2 : grav;
    state.vy += effGrav * dt;
    const prevY = state.y;
    state.y += state.vy * dt;
    state.grounded = false;

    if (state.y <= 0) {
      state.y = 0;
      if (state.vy < 0) state.vy = 0;
      state.grounded = true;
    }

    let boxY = getPlayerAABB(state.x, state.y, state.z, crouchBoxFlag, scale);

    for (const c of colliders) {
      if (c.kind === 'boundary') continue;
      if (!aabbIntersects(boxY, c, 0.0005)) continue;

      if (state.vy <= 0 && prevY >= c.maxY - 0.15 * scale - (c.vy ?? 0) * dt) {
        state.y = c.maxY;
        state.vy = Math.max(0, c.vy ?? 0);
        state.grounded = true;
      } else if (state.vy > 0 && prevY + height <= c.minY + 0.15 * scale) {
        state.y = c.minY - height - 0.0005;
        state.vy = 0;
      }
      boxY = getPlayerAABB(state.x, state.y, state.z, crouchBoxFlag, scale);
    }
  }

  // =========================================================================
  // STEP 5: Anti-Trap Emergency Rescue & Arena Ring Clamp
  // =========================================================================
  const ext = getArenaHalfExtent(activeRing);
  if (state.x < -ext + halfW) {
    state.x = -ext + halfW + 0.001;
    state.vx = Math.max(0, state.vx);
  } else if (state.x > ext - halfW) {
    state.x = ext - halfW - 0.001;
    state.vx = Math.min(0, state.vx);
  }
  if (state.z < -ext + halfW) {
    state.z = -ext + halfW + 0.001;
    state.vz = Math.max(0, state.vz);
  } else if (state.z > ext - halfW) {
    state.z = ext - halfW - 0.001;
    state.vz = Math.min(0, state.vz);
  }

  const rescued = ensureUnstuck(
    { x: state.x, y: state.y, z: state.z },
    crouchBoxFlag,
    scale,
    colliders,
    activeRing
  );
  if (rescued.y > state.y + 0.001) {
    state.y = rescued.y;
    if (state.vy < 0) state.vy = 0;
    state.grounded = true;
  }
}
