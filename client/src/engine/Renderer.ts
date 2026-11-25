import * as THREE from 'three';

export type QualityProfile = 'ultra' | 'balanced' | 'high';

export class Renderer {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly webgl: THREE.WebGLRenderer;
  private dirLight: THREE.DirectionalLight;

  constructor(canvas: HTMLCanvasElement, initialQuality: QualityProfile = 'balanced') {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9bc4e2);
    this.scene.fog = new THREE.Fog(0xc4ddf0, 95, 270);

    this.camera = new THREE.PerspectiveCamera(
      85,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.08,
      360
    );
    this.scene.add(this.camera);

    this.webgl = new THREE.WebGLRenderer({
      canvas,
      antialias: initialQuality !== 'ultra',
      powerPreference: 'high-performance',
    });
    this.webgl.setSize(window.innerWidth, window.innerHeight);

    const hemi = new THREE.HemisphereLight(0xeef6ff, 0x3b4d3e, 0.85);
    this.scene.add(hemi);

    this.dirLight = new THREE.DirectionalLight(0xfff7e6, 0.85);
    this.dirLight.position.set(45, 80, 35);
    this.dirLight.shadow.mapSize.set(1024, 1024);
    this.dirLight.shadow.camera.near = 10;
    this.dirLight.shadow.camera.far = 220;
    const d = 90;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.scene.add(this.dirLight);

    this.applyQuality(initialQuality);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
      this.camera.updateProjectionMatrix();
      this.webgl.setSize(window.innerWidth, window.innerHeight);
    });
  }

  public applyQuality(profile: QualityProfile): void {
    const dpr = window.devicePixelRatio || 1;
    if (profile === 'ultra') {
      this.webgl.setPixelRatio(1.0);
      this.webgl.shadowMap.enabled = false;
      this.dirLight.castShadow = false;
    } else if (profile === 'balanced') {
      this.webgl.setPixelRatio(Math.min(dpr, 1.5));
      this.webgl.shadowMap.enabled = false;
      this.dirLight.castShadow = false;
    } else {
      this.webgl.setPixelRatio(Math.min(dpr, 2.0));
      this.webgl.shadowMap.enabled = true;
      this.webgl.shadowMap.type = THREE.BasicShadowMap;
      this.dirLight.castShadow = true;
    }
  }

  public render(): void {
    this.webgl.render(this.scene, this.camera);
  }

  public getDrawCalls(): number {
    return this.webgl.info.render.calls;
  }
}
