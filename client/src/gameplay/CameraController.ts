import * as THREE from 'three';
import { CLASS_DEFS } from '../../../shared/classes.js';
import { PLAYER_CROUCH_EYE, PLAYER_STAND_EYE } from '../../../shared/constants.js';
import type { RoomModifiers } from '../../../shared/modifiers.js';
import { WEAPON_DEFS } from '../../../shared/weapons.js';
import type { PlayerRenderer } from '../engine/PlayerRenderer.js';
import type { LocalPlayer } from './LocalPlayer.js';

export class CameraController {
  private currentEyeHeight = PLAYER_STAND_EYE;
  private currentFov = 85;
  private adsBlend = 0;
  private shakeTimer = 0;
  private shakeStrength = 0;

  public addShake(strength: number, durationSec = 0.25): void {
    this.shakeStrength = Math.max(this.shakeStrength, strength);
    this.shakeTimer = Math.max(this.shakeTimer, durationSec);
  }

  public update(
    camera: THREE.PerspectiveCamera,
    local: LocalPlayer,
    yaw: number,
    pitch: number,
    adsHeld: boolean,
    baseFov: number,
    modifiers: RoomModifiers,
    playerRenderer: PlayerRenderer,
    spectatingId: string | null,
    dt: number
  ): { isSniperScope: boolean; adsBlend: number; sensMult: number } {
    const classDef = CLASS_DEFS[local.classId];
    const weaponDef = WEAPON_DEFS[local.weapon];

    // Spectator camera in S&D if dead
    if (!local.alive && spectatingId) {
      const specPose = playerRenderer.getInterpolatedPose(spectatingId);
      if (specPose) {
        const s = modifiers.playerScale;
        camera.position.set(
          specPose.x + Math.sin(specPose.yaw) * 2.8 * s,
          specPose.y + 2.2 * s,
          specPose.z + Math.cos(specPose.yaw) * 2.8 * s
        );
        camera.lookAt(specPose.x, specPose.y + 1.2 * s, specPose.z);
        camera.fov = baseFov;
        camera.updateProjectionMatrix();
        return { isSniperScope: false, adsBlend: 0, sensMult: 1.0 };
      }
    }

    const crouched = local.phys.crouching || local.phys.sliding;
    const targetEye = (crouched ? PLAYER_CROUCH_EYE : PLAYER_STAND_EYE) * modifiers.playerScale;
    this.currentEyeHeight += (targetEye - this.currentEyeHeight) * Math.min(1, dt * 16);

    let sx = 0;
    let sy = 0;
    if (this.shakeTimer > 0) {
      this.shakeTimer = Math.max(0, this.shakeTimer - dt);
      const decay = this.shakeStrength * (this.shakeTimer > 0 ? 1 : 0);
      sx = (Math.random() - 0.5) * 0.08 * decay;
      sy = (Math.random() - 0.5) * 0.08 * decay;
      if (this.shakeTimer <= 0) this.shakeStrength = 0;
    }

    camera.position.set(local.phys.x + sx, local.phys.y + this.currentEyeHeight + sy, local.phys.z);

    // Apply yaw + pitch + deterministic recoil offset
    const effPitch = Math.max(-Math.PI * 0.49, Math.min(Math.PI * 0.49, pitch + local.recoilPitchOffset));
    const effYaw = yaw + local.recoilYawOffset;
    const euler = new THREE.Euler(effPitch, effYaw, local.phys.sliding ? 0.06 : 0, 'YXZ');
    camera.quaternion.setFromEuler(euler);

    // ADS Zoom (works on ALL weapons; Ghost gets +35% speed)
    const wantAds = adsHeld && local.alive && weaponDef.hasAds && !local.phys.sprinting;
    const adsRate = 11 * classDef.adsSpeedMult;
    this.adsBlend = wantAds
      ? Math.min(1, this.adsBlend + dt * adsRate)
      : Math.max(0, this.adsBlend - dt * adsRate);

    let targetFov = baseFov;
    if (this.adsBlend > 0.01) {
      const adsTarget = weaponDef.hasScope ? weaponDef.adsFov : Math.min(baseFov - 6, weaponDef.adsFov);
      targetFov = baseFov + (adsTarget - baseFov) * this.adsBlend;
    } else if (local.phys.dashing || local.phys.stimTimer > 0 || local.phys.sprinting) {
      targetFov = Math.min(118, baseFov + (local.phys.dashing ? 9 : 5));
    }

    this.currentFov += (targetFov - this.currentFov) * Math.min(1, dt * 16);
    if (Math.abs(camera.fov - this.currentFov) > 0.05) {
      camera.fov = this.currentFov;
      camera.updateProjectionMatrix();
    }

    const isSniperScope = weaponDef.hasScope && this.adsBlend > 0.72;
    const sensMult = 1.0 + (weaponDef.adsSensMult - 1.0) * this.adsBlend;

    return { isSniperScope, adsBlend: this.adsBlend, sensMult };
  }
}
