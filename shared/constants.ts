export const TICK_RATE = 60;
export const FIXED_DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 20;
export const SNAPSHOT_INTERVAL_MS = 1000 / SNAPSHOT_RATE;

export const SECTOR_SIZE = 32;
export const MAX_RING = 3;
export const GRID_MIN = -3;
export const GRID_MAX = 3;

export const RING_2_EXPAND = 9;
export const RING_2_CONTRACT = 6;
export const RING_3_EXPAND = 19;
export const RING_3_CONTRACT = 16;

export const BASE_MOVE_SPEED = 7.2;
export const SPRINT_SPEED_MULT = 1.36;
export const GROUND_ACCEL = 55;
export const GROUND_FRICTION = 10;
export const AIR_ACCEL = 16;
export const GRAVITY = -22;
export const JUMP_VELOCITY = 8.2;
export const COYOTE_TIME = 0.10;
export const JUMP_BUFFER_TIME = 0.10;

export const SLIDE_MIN_SPEED = 4.0;
export const SLIDE_IMPULSE = 13.5;
export const SLIDE_DURATION = 0.65;
export const SLIDE_FRICTION = 2.6;
export const SLIDE_COOLDOWN = 1.8;
export const SLIDE_JUMP_MAX_SPEED = 11.5;

export const PLAYER_HALF_WIDTH = 0.38;
export const PLAYER_STAND_HEIGHT = 1.80;
export const PLAYER_CROUCH_HEIGHT = 1.00;
export const PLAYER_STAND_EYE = 1.62;
export const PLAYER_CROUCH_EYE = 0.85;
export const PLAYER_HEAD_HEIGHT = 0.35;
export const STEP_HEIGHT = 0.45;

export const SECTOR_WARNING_MS = 10_000;
export const SECTOR_RETRACT_MS = 1_500;
export const SECTOR_EMERGE_MS = 2_500;
export const SECTOR_TRANSITION_MS = SECTOR_RETRACT_MS + SECTOR_EMERGE_MS;

export const ODD_VOTE_MS = 10_000;
export const COUNTDOWN_MS = 3_000;
export const ROUND_END_MS = 8_000;
export const SND_BOMB_TIMER_MS = 45_000;
export const SND_PLANT_MS = 3_500;
export const SND_DEFUSE_MS = 4_500;
export const HARDPOINT_ROTATE_MS = 45_000;
export const HARDPOINT_WARN_MS = 10_000;
export const DOMINATION_CAPTURE_MS = 4_000;

export const MAX_LAG_COMP_MS = 200;
export const HISTORY_BUFFER_MS = 750;
export const RESPAWN_DELAY_MS = 3_000;
export const FFA_RESPAWN_DELAY_MS = 1_500;

export const KEY_W = 1 << 0;
export const KEY_S = 1 << 1;
export const KEY_A = 1 << 2;
export const KEY_D = 1 << 3;
export const KEY_JUMP = 1 << 4;
export const KEY_SLIDE = 1 << 5;
export const KEY_ABILITY_E = 1 << 6;
export const KEY_FIRE = 1 << 7;
export const KEY_ADS = 1 << 8;
export const KEY_INTERACT = 1 << 9;
export const KEY_RELOAD = 1 << 10;
export const KEY_CROUCH = 1 << 11;
export const KEY_SPRINT = 1 << 12;

export const FLAG_GROUNDED = 1 << 0;
export const FLAG_SLIDING = 1 << 1;
export const FLAG_CROUCHING = 1 << 2;
export const FLAG_ALIVE = 1 << 3;
export const FLAG_CLOAKED = 1 << 4;
export const FLAG_STIM = 1 << 5;
export const FLAG_SPECTATING = 1 << 6;
export const FLAG_PLANT_DEFUSE = 1 << 7;
export const FLAG_ADS = 1 << 8;
export const FLAG_DASHING = 1 << 9;
export const FLAG_CLASS_SHIFT = 10;
export const FLAG_CLASS_MASK = 0b11 << FLAG_CLASS_SHIFT;
export const FLAG_SPRINTING = 1 << 12;
