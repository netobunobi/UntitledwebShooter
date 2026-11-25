import * as THREE from 'three';
import type { WeaponId } from '../../../shared/weapons.js';

export class ViewModel {
  public readonly root: THREE.Group;
  private models: Map<WeaponId, THREE.Group> = new Map();
  private kickZ = 0;
  private kickPitch = 0;
  private walkPhase = 0;
  private adsBlend = 0;
  private currentWeapon: WeaponId = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.root = new THREE.Group();
    camera.add(this.root);

    const darkMetal = new THREE.MeshLambertMaterial({ color: 0x1e293b, flatShading: true });
    const midMetal = new THREE.MeshLambertMaterial({ color: 0x475569, flatShading: true });
    const lightMetal = new THREE.MeshLambertMaterial({ color: 0x94a3b8, flatShading: true });
    const accent = new THREE.MeshLambertMaterial({ color: 0x38bdf8, flatShading: true });
    const sightGlow = new THREE.MeshBasicMaterial({ color: 0x22c55e });
    const gold = new THREE.MeshLambertMaterial({ color: 0xd97706, flatShading: true });
    const wood = new THREE.MeshLambertMaterial({ color: 0x7c4a2d, flatShading: true });
    const glove = new THREE.MeshLambertMaterial({ color: 0x27272a, flatShading: true });

    const box = new THREE.BoxGeometry(1, 1, 1);

    const makePart = (
      sx: number,
      sy: number,
      sz: number,
      px: number,
      py: number,
      pz: number,
      mat: THREE.Material,
      rx = 0
    ): THREE.Mesh => {
      const m = new THREE.Mesh(box, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(px, py, pz);
      m.rotation.x = rx;
      return m;
    };

    const addHands = (g: THREE.Group, offX = 0, offZ = 0) => {
      // Right trigger hand
      g.add(makePart(0.065, 0.085, 0.09, 0.0 + offX, -0.09, 0.08 + offZ, glove, 0.25));
      // Left support hand
      g.add(makePart(0.065, 0.07, 0.10, -0.02 + offX, -0.055, -0.18 + offZ, glove, 0));
    };

    // 0: Vanguard AR (Assault Rifle with iron sights & mag)
    const ar = new THREE.Group();
    ar.add(makePart(0.062, 0.085, 0.42, 0, 0, -0.08, darkMetal)); // receiver
    ar.add(makePart(0.055, 0.065, 0.28, 0, 0.01, -0.34, midMetal)); // handguard
    ar.add(makePart(0.026, 0.026, 0.26, 0, 0.015, -0.56, lightMetal)); // barrel
    ar.add(makePart(0.042, 0.16, 0.075, 0, -0.11, -0.14, darkMetal, -0.18)); // mag
    ar.add(makePart(0.048, 0.075, 0.20, 0, -0.015, 0.20, midMetal)); // stock
    ar.add(makePart(0.012, 0.025, 0.015, -0.015, 0.055, 0.04, midMetal)); // rear sight L
    ar.add(makePart(0.012, 0.025, 0.015, 0.015, 0.055, 0.04, midMetal)); // rear sight R
    ar.add(makePart(0.008, 0.028, 0.012, 0, 0.055, -0.44, sightGlow)); // front green sight
    addHands(ar);
    this.models.set(0, ar);

    // 1: Vector-9 SMG (Compact PDW with forward grip & iron sights)
    const smg = new THREE.Group();
    smg.add(makePart(0.058, 0.078, 0.32, 0, 0, -0.05, midMetal)); // body
    smg.add(makePart(0.032, 0.032, 0.16, 0, 0.01, -0.27, darkMetal)); // suppressor/barrel
    smg.add(makePart(0.036, 0.18, 0.048, 0, -0.11, -0.11, accent, 0.12)); // extended mag
    smg.add(makePart(0.01, 0.022, 0.012, -0.014, 0.05, 0.03, darkMetal));
    smg.add(makePart(0.01, 0.022, 0.012, 0.014, 0.05, 0.03, darkMetal));
    smg.add(makePart(0.008, 0.024, 0.012, 0, 0.05, -0.20, sightGlow));
    addHands(smg, 0, 0.04);
    this.models.set(1, smg);

    // 2: Breacher SG (Pump-action Tactical Shotgun)
    const sg = new THREE.Group();
    sg.add(makePart(0.07, 0.085, 0.36, 0, 0, -0.06, darkMetal)); // receiver
    sg.add(makePart(0.034, 0.034, 0.38, 0, 0.022, -0.40, lightMetal)); // top barrel
    sg.add(makePart(0.028, 0.028, 0.34, 0, -0.015, -0.38, midMetal)); // tube mag
    sg.add(makePart(0.058, 0.055, 0.18, 0, -0.018, -0.28, wood)); // pump grip
    sg.add(makePart(0.055, 0.075, 0.22, 0, -0.02, 0.18, wood)); // stock
    sg.add(makePart(0.01, 0.024, 0.01, 0, 0.05, -0.56, sightGlow)); // bead sight
    addHands(sg);
    this.models.set(2, sg);

    // 3: Magnum-6 (Heavy Revolver)
    const rev = new THREE.Group();
    rev.add(makePart(0.045, 0.058, 0.18, 0, 0.01, -0.04, midMetal)); // frame
    rev.add(makePart(0.062, 0.062, 0.08, 0, 0.015, -0.06, gold)); // cylinder
    rev.add(makePart(0.035, 0.042, 0.22, 0, 0.026, -0.22, lightMetal)); // heavy barrel
    rev.add(makePart(0.04, 0.11, 0.055, 0, -0.065, 0.04, wood, 0.22)); // grip
    rev.add(makePart(0.008, 0.022, 0.01, 0, 0.056, -0.31, sightGlow)); // front sight
    rev.add(makePart(0.062, 0.085, 0.085, 0, -0.075, 0.06, glove, 0.22));
    this.models.set(3, rev);

    // 4: Apex SR (Long-range Bolt Sniper with Top Scope)
    const sr = new THREE.Group();
    sr.add(makePart(0.06, 0.082, 0.48, 0, -0.005, -0.10, darkMetal)); // chassis
    sr.add(makePart(0.028, 0.028, 0.42, 0, 0.015, -0.52, lightMetal)); // long barrel
    sr.add(makePart(0.048, 0.055, 0.24, 0, 0.075, -0.14, midMetal)); // scope tube
    sr.add(makePart(0.058, 0.065, 0.06, 0, 0.075, -0.25, accent)); // objective lens rim
    sr.add(makePart(0.048, 0.075, 0.24, 0, -0.02, 0.22, darkMetal)); // stock
    addHands(sr);
    this.models.set(4, sr);

    // 5: Shadow Kunai (Twin-prong throwing blade + wrapped handle)
    const kunai = new THREE.Group();
    kunai.add(makePart(0.022, 0.022, 0.14, 0, 0, 0.02, wood)); // wrapped grip
    kunai.add(makePart(0.048, 0.048, 0.018, 0, 0, 0.10, gold)); // pommel ring
    kunai.add(makePart(0.065, 0.012, 0.18, 0, 0, -0.13, lightMetal)); // main blade
    kunai.add(makePart(0.032, 0.014, 0.08, 0, 0, -0.23, accent)); // tip
    kunai.add(makePart(0.065, 0.07, 0.09, 0.01, -0.03, 0.04, glove, 0.15));
    this.models.set(5, kunai);

    for (const [id, g] of this.models) {
      g.visible = id === 0;
      this.root.add(g);
    }
    this.root.position.set(0.24, -0.21, -0.36);
  }

  public triggerKick(strength = 1.0): void {
    this.kickZ = Math.min(0.14, this.kickZ + 0.06 * strength);
    this.kickPitch = Math.min(0.22, this.kickPitch + 0.08 * strength);
  }

  public update(
    weapon: WeaponId,
    horizSpeed: number,
    sliding: boolean,
    sprinting: boolean,
    reloading: boolean,
    adsBlend: number,
    isSniperScope: boolean,
    visible: boolean,
    dt: number
  ): void {
    this.root.visible = visible && !isSniperScope;
    if (!this.root.visible) return;

    if (weapon !== this.currentWeapon) {
      this.models.get(this.currentWeapon)!.visible = false;
      this.models.get(weapon)!.visible = true;
      this.currentWeapon = weapon;
    }

    this.adsBlend = adsBlend;
    this.kickZ *= Math.max(0, 1 - dt * 14);
    this.kickPitch *= Math.max(0, 1 - dt * 14);
    this.walkPhase += dt * Math.min(14, horizSpeed * (sprinting ? 1.7 : 1.3));

    const bobMult = (1 - this.adsBlend * 0.78) * Math.min(1, horizSpeed / 7);
    const bobX = Math.cos(this.walkPhase) * 0.012 * bobMult;
    const bobY = Math.abs(Math.sin(this.walkPhase)) * 0.014 * bobMult;

    // Hipfire -> Centered ADS eye alignment
    const hipX = sprinting ? 0.16 : 0.24;
    const hipY = sprinting ? -0.25 : -0.21;
    const hipZ = sprinting ? -0.32 : -0.36;

    const adsX = 0.0;
    const adsY = weapon === 5 ? -0.10 : -0.135;
    const adsZ = -0.26;

    const baseX = hipX + (adsX - hipX) * this.adsBlend;
    const baseY = hipY + (adsY - hipY) * this.adsBlend;
    const baseZ = hipZ + (adsZ - hipZ) * this.adsBlend;

    const reloadDip = reloading ? -0.18 : 0;
    const slideRoll = sliding ? -0.28 : sprinting ? 0.22 : 0;
    const sprintYaw = sprinting ? 0.35 * (1 - this.adsBlend) : 0;

    this.root.position.set(baseX + bobX, baseY - bobY + reloadDip, baseZ + this.kickZ);
    this.root.rotation.set(
      this.kickPitch - (reloading ? 0.55 : 0) - (sprinting ? 0.15 : 0),
      sprintYaw,
      slideRoll
    );
  }
}
