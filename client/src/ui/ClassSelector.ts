import { CLASS_DEFS, CLASS_LIST, type ClassId } from '../../../shared/classes.js';

export class ClassSelector {
  private container: HTMLElement;
  private selected: ClassId = 'assault';
  private onSelect: (classId: ClassId) => void;

  constructor(containerId: string, initial: ClassId, onSelect: (classId: ClassId) => void) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Missing container #${containerId}`);
    this.container = el;
    this.selected = initial;
    this.onSelect = onSelect;
    this.render();
  }

  public setSelected(classId: ClassId): void {
    this.selected = classId;
    this.render();
  }

  public getSelected(): ClassId {
    return this.selected;
  }

  private render(): void {
    this.container.innerHTML = '';
    for (const id of CLASS_LIST) {
      const def = CLASS_DEFS[id];
      const speedPct = Math.round(def.speedMult * 100);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `class-card${this.selected === id ? ' selected' : ''}`;
      card.innerHTML = `
        <div class="cc-top">
          <h4>${def.name}</h4>
          <div class="cc-badges">
            <span class="cc-pill hp">${def.maxHp} HP</span>
            <span class="cc-pill spd">${speedPct}% VEL</span>
          </div>
        </div>
        <div class="role">${def.role}</div>
        <div class="desc">
          <div class="cc-line"><span class="tag-p">PASIVA</span> ${def.passiveDescription}</div>
          <div class="cc-line"><span class="tag-k">E</span> <strong>${def.abilityE.name}:</strong> ${def.abilityE.description}</div>
          <div class="cc-line"><span class="tag-k">Q</span> <strong>${def.abilityQ.name}:</strong> ${def.abilityQ.description}</div>
        </div>
      `;
      card.addEventListener('click', () => {
        this.selected = id;
        this.render();
        this.onSelect(id);
      });
      this.container.appendChild(card);
    }
  }
}
