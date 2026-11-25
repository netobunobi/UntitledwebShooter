import {
  KEY_A,
  KEY_ABILITY_E,
  KEY_ADS,
  KEY_CROUCH,
  KEY_D,
  KEY_FIRE,
  KEY_INTERACT,
  KEY_JUMP,
  KEY_RELOAD,
  KEY_S,
  KEY_SLIDE,
  KEY_SPRINT,
  KEY_W,
} from '../../../shared/constants.js';
import type { WeaponId } from '../../../shared/weapons.js';
import type { QualityProfile } from '../engine/Renderer.js';

export interface UserSettings {
  sensitivity: number;
  fov: number;
  invertY: boolean;
  volume: number;
  quality: QualityProfile;
}

const STORAGE_KEY = 'polyarena_settings_v1';

export class InputManager {
  public yaw = 0;
  public pitch = 0;
  public keysDown: Set<string> = new Set();
  public mouseLeftDown = false;
  public mouseRightDown = false;
  public pointerLocked = false;
  public activeWeapon: WeaponId = 0;
  public settings: UserSettings;

  public onEscToggle?: (menuOpen: boolean) => void;
  public onWeaponChange?: (weapon: WeaponId) => void;
  public onAbilityTrigger?: (slot: 'E' | 'Q') => void;
  public onStreakTrigger?: () => void;
  public onReloadTrigger?: () => void;
  public onVoteKey?: (team: 'A' | 'B') => void;
  public onSettingsChanged?: (settings: UserSettings) => void;

  private adsSensMult = 1.0;
  private menuOpen = false;
  private voteOpen = false;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.settings = this.loadSettings();

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked && !this.menuOpen) {
        this.setMenuOpen(true);
      }
    });

    window.addEventListener('mousemove', (ev) => {
      if (!this.pointerLocked || this.menuOpen) return;
      const baseScale = 0.0022 * this.settings.sensitivity * this.adsSensMult;
      this.yaw -= ev.movementX * baseScale;
      const ySign = this.settings.invertY ? 1 : -1;
      this.pitch += ev.movementY * baseScale * ySign;
      const maxPitch = Math.PI * 0.485;
      this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
    });

    window.addEventListener('mousedown', (ev) => {
      if (this.menuOpen) return;
      if (!this.pointerLocked && ev.target === this.canvas) {
        this.requestLock();
        return;
      }
      if (!this.pointerLocked) return;
      if (ev.button === 0) this.mouseLeftDown = true;
      if (ev.button === 2) this.mouseRightDown = true;
    });

    window.addEventListener('mouseup', (ev) => {
      if (ev.button === 0) this.mouseLeftDown = false;
      if (ev.button === 2) this.mouseRightDown = false;
    });

    window.addEventListener('contextmenu', (ev) => {
      if (this.pointerLocked) ev.preventDefault();
    });

    window.addEventListener('wheel', (ev) => {
      if (!this.pointerLocked || this.menuOpen) return;
      const delta = ev.deltaY > 0 ? 1 : -1;
      const next = (((this.activeWeapon + delta) % 6) + 6) % 6;
      this.setWeapon(next as WeaponId);
    });

    window.addEventListener('keydown', (ev) => {
      if (ev.code === 'Escape') {
        this.setMenuOpen(!this.menuOpen);
        return;
      }

      if (this.voteOpen && !this.menuOpen) {
        if (ev.code === 'Digit1') {
          this.onVoteKey?.('A');
          return;
        }
        if (ev.code === 'Digit2') {
          this.onVoteKey?.('B');
          return;
        }
      }

      if (this.menuOpen) return;
      if (!this.keysDown.has(ev.code)) {
        this.keysDown.add(ev.code);
        if (ev.code === 'KeyE') this.onAbilityTrigger?.('E');
        else if (ev.code === 'KeyQ') this.onAbilityTrigger?.('Q');
        else if (ev.code === 'KeyX') this.onStreakTrigger?.();
        else if (ev.code === 'KeyR') this.onReloadTrigger?.();
        else if (ev.code.startsWith('Digit')) {
          const num = Number(ev.code.slice(5));
          if (num >= 1 && num <= 6) {
            this.setWeapon((num - 1) as WeaponId);
          }
        }
      }
    });

    window.addEventListener('keyup', (ev) => {
      this.keysDown.delete(ev.code);
    });
  }

  private loadSettings(): UserSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<UserSettings>;
        return {
          sensitivity: Number(parsed.sensitivity ?? 1.0),
          fov: Number(parsed.fov ?? 85),
          invertY: Boolean(parsed.invertY ?? false),
          volume: Number(parsed.volume ?? 70),
          quality: parsed.quality ?? 'balanced',
        };
      }
    } catch {
      // ignore storage errors
    }
    return { sensitivity: 1.0, fov: 85, invertY: false, volume: 70, quality: 'balanced' };
  }

  public updateSettings(partial: Partial<UserSettings>): void {
    this.settings = { ...this.settings, ...partial };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // ignore
    }
    this.onSettingsChanged?.(this.settings);
  }

  public setAdsSensMultiplier(mult: number): void {
    this.adsSensMult = mult;
  }

  public setVoteOpen(open: boolean): void {
    this.voteOpen = open;
  }

  public setMenuOpen(open: boolean): void {
    this.menuOpen = open;
    if (open && document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
    if (open) {
      this.keysDown.clear();
      this.mouseLeftDown = false;
      this.mouseRightDown = false;
    }
    this.onEscToggle?.(open);
  }

  public isMenuOpen(): boolean {
    return this.menuOpen;
  }

  public requestLock(): void {
    if (document.pointerLockElement !== this.canvas) {
      this.canvas.requestPointerLock?.();
    }
  }

  public setWeapon(w: WeaponId): void {
    if (this.activeWeapon === w) return;
    this.activeWeapon = w;
    this.onWeaponChange?.(w);
  }

  public getKeyBitmask(): number {
    if (this.menuOpen) return 0;
    let mask = 0;
    if (this.keysDown.has('KeyW')) mask |= KEY_W;
    if (this.keysDown.has('KeyS')) mask |= KEY_S;
    if (this.keysDown.has('KeyA')) mask |= KEY_A;
    if (this.keysDown.has('KeyD')) mask |= KEY_D;
    if (this.keysDown.has('Space')) mask |= KEY_JUMP;
    if (this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight')) mask |= KEY_SPRINT;
    if (this.keysDown.has('KeyC') || this.keysDown.has('ControlLeft')) {
      mask |= KEY_SLIDE | KEY_CROUCH;
    }
    if (this.keysDown.has('KeyE')) mask |= KEY_ABILITY_E;
    if (this.keysDown.has('KeyF')) mask |= KEY_INTERACT;
    if (this.keysDown.has('KeyR')) mask |= KEY_RELOAD;
    if (this.mouseLeftDown) mask |= KEY_FIRE;
    if (this.mouseRightDown) mask |= KEY_ADS;
    return mask;
  }
}
