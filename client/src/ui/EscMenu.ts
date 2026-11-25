import type { ClassId } from '../../../shared/classes.js';
import type { QualityProfile } from '../engine/Renderer.js';
import type { InputManager } from '../gameplay/InputManager.js';
import { ClassSelector } from './ClassSelector.js';

export class EscMenu {
  private root = document.getElementById('esc-menu')!;
  private sensInput = document.getElementById('esc-sens') as HTMLInputElement;
  private sensVal = document.getElementById('esc-sens-val')!;
  private fovInput = document.getElementById('esc-fov') as HTMLInputElement;
  private fovVal = document.getElementById('esc-fov-val')!;
  private volInput = document.getElementById('esc-vol') as HTMLInputElement;
  private volVal = document.getElementById('esc-vol-val')!;
  private invertYInput = document.getElementById('esc-inverty') as HTMLInputElement;
  private qualitySelect = document.getElementById('esc-quality') as HTMLSelectElement;
  private resumeBtn = document.getElementById('esc-resume-btn')!;
  private adminBtn = document.getElementById('esc-admin-btn')!;

  public readonly classSelector: ClassSelector;

  constructor(
    input: InputManager,
    initialClass: ClassId,
    onClassSwitch: (classId: ClassId) => void,
    onOpenAdmin: () => void
  ) {
    this.syncFromSettings(input);

    this.sensInput.addEventListener('input', () => {
      const val = Number(this.sensInput.value);
      this.sensVal.textContent = val.toFixed(2);
      input.updateSettings({ sensitivity: val });
    });

    this.fovInput.addEventListener('input', () => {
      const val = Number(this.fovInput.value);
      this.fovVal.textContent = String(val);
      input.updateSettings({ fov: val });
    });

    this.volInput.addEventListener('input', () => {
      const val = Number(this.volInput.value);
      this.volVal.textContent = String(val);
      input.updateSettings({ volume: val });
    });

    this.invertYInput.addEventListener('change', () => {
      input.updateSettings({ invertY: this.invertYInput.checked });
    });

    this.qualitySelect.addEventListener('change', () => {
      input.updateSettings({ quality: this.qualitySelect.value as QualityProfile });
    });

    this.resumeBtn.addEventListener('click', () => {
      input.setMenuOpen(false);
      input.requestLock();
    });

    this.adminBtn.addEventListener('click', () => {
      onOpenAdmin();
    });

    this.classSelector = new ClassSelector('esc-class-grid', initialClass, onClassSwitch);
  }

  public syncFromSettings(input: InputManager): void {
    this.sensInput.value = String(input.settings.sensitivity);
    this.sensVal.textContent = input.settings.sensitivity.toFixed(2);
    this.fovInput.value = String(input.settings.fov);
    this.fovVal.textContent = String(input.settings.fov);
    this.volInput.value = String(input.settings.volume);
    this.volVal.textContent = String(input.settings.volume);
    this.invertYInput.checked = input.settings.invertY;
    this.qualitySelect.value = input.settings.quality;
  }

  public setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }
}
