import type { GameModeId, MatchConfig } from '../../../shared/gamemodes.js';
import type { RoomModifiers } from '../../../shared/modifiers.js';
import type {
  AdminRole,
  MapEvolutionSettings,
  TeamId,
  TempKeyInfo,
} from '../../../shared/protocol.js';
import { sectorKey, type SectorState } from '../../../shared/sectors.js';
import type { NetworkClient } from '../net/NetworkClient.js';

export class AdminPanel {
  private root = document.getElementById('admin-panel')!;
  private roleBadge = document.getElementById('admin-role-badge')!;
  private closeBtn = document.getElementById('admin-close-btn')!;
  private authBox = document.getElementById('admin-auth-box')!;
  private passInput = document.getElementById('admin-pass-input') as HTMLInputElement;
  private authBtn = document.getElementById('admin-auth-btn')!;
  private authErr = document.getElementById('admin-auth-error')!;
  private contentBox = document.getElementById('admin-content')!;
  private tabKeysBtn = document.getElementById('admin-tab-keys-btn')!;

  private modeSelect = document.getElementById('adm-mode-select') as HTMLSelectElement;
  private ggTeamsCheck = document.getElementById('adm-gg-teams') as HTMLInputElement;
  private randRotCheck = document.getElementById('adm-random-rot') as HTMLInputElement;
  private scoreInput = document.getElementById('adm-score-limit') as HTMLInputElement;
  private roundInput = document.getElementById('adm-round-limit') as HTMLInputElement;
  private durInput = document.getElementById('adm-duration-min') as HTMLInputElement;
  private applyCfgBtn = document.getElementById('adm-apply-cfg-btn')!;
  private startBtn = document.getElementById('adm-start-btn')!;
  private pauseBtn = document.getElementById('adm-pause-btn')!;
  private resetBtn = document.getElementById('adm-reset-btn')!;
  private mapAutoCheck = document.getElementById('adm-map-auto') as HTMLInputElement;
  private mapSpeedSelect = document.getElementById('adm-map-speed') as HTMLSelectElement;
  private sectorLvlSelect = document.getElementById('adm-sector-level') as HTMLSelectElement;
  private sectorGridEl = document.getElementById('adm-sector-grid')!;
  private playersListEl = document.getElementById('adm-players-list')!;

  private modSpeed = document.getElementById('adm-mod-speed') as HTMLInputElement;
  private modSpeedVal = document.getElementById('adm-mod-speed-val')!;
  private modScale = document.getElementById('adm-mod-scale') as HTMLInputElement;
  private modScaleVal = document.getElementById('adm-mod-scale-val')!;
  private modGrav = document.getElementById('adm-mod-grav') as HTMLInputElement;
  private modGravVal = document.getElementById('adm-mod-grav-val')!;
  private modJump = document.getElementById('adm-mod-jump') as HTMLInputElement;
  private modJumpVal = document.getElementById('adm-mod-jump-val')!;
  private modInfAmmo = document.getElementById('adm-mod-inf-ammo') as HTMLInputElement;
  private modResetBtn = document.getElementById('adm-mod-reset-btn')!;

  private keyModeSelect = document.getElementById('adm-key-mode') as HTMLSelectElement;
  private keyMinsInput = document.getElementById('adm-key-mins') as HTMLInputElement;
  private createKeyBtn = document.getElementById('adm-create-key-btn')!;
  private keysListEl = document.getElementById('adm-keys-list')!;

  public role: AdminRole = 'none';
  private pausedState = false;
  private net: NetworkClient;

  constructor(net: NetworkClient) {
    this.net = net;

    this.closeBtn.addEventListener('click', () => this.hide());
    this.authBtn.addEventListener('click', () => {
      this.authErr.classList.add('hidden');
      this.net.send({ t: 'C_ADMIN_AUTH', password: this.passInput.value });
    });

    // Tabs
    this.root.querySelectorAll('.admin-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab')!;
        this.root.querySelectorAll('.admin-tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.root.querySelectorAll('.admin-tab-body').forEach((body) => body.classList.add('hidden'));
        document.getElementById(`admin-tab-${tab}`)?.classList.remove('hidden');
      });
    });

    // Match & Mode controls
    this.applyCfgBtn.addEventListener('click', () => {
      this.net.send({
        t: 'C_ADMIN_ACTION',
        action: 'set_gamemode',
        payload: {
          gameMode: this.modeSelect.value as GameModeId,
          gunGameTeams: this.ggTeamsCheck.checked,
          randomModeRotation: this.randRotCheck.checked,
        },
      });
      this.net.send({
        t: 'C_ADMIN_ACTION',
        action: 'set_match_config',
        payload: {
          scoreLimit: Number(this.scoreInput.value),
          roundLimit: Number(this.roundInput.value),
          roundDurationMin: Number(this.durInput.value),
          randomModeRotation: this.randRotCheck.checked,
          gunGameTeams: this.ggTeamsCheck.checked,
        },
      });
    });

    this.startBtn.addEventListener('click', () =>
      this.net.send({ t: 'C_ADMIN_ACTION', action: 'start_round' })
    );
    this.pauseBtn.addEventListener('click', () => {
      this.pausedState = !this.pausedState;
      this.net.send({
        t: 'C_ADMIN_ACTION',
        action: 'pause_round',
        payload: { paused: this.pausedState },
      });
    });
    this.resetBtn.addEventListener('click', () =>
      this.net.send({ t: 'C_ADMIN_ACTION', action: 'reset_round' })
    );

    const pushMapSettings = () => {
      this.net.send({
        t: 'C_ADMIN_ACTION',
        action: 'set_map_evolution',
        payload: {
          enabled: this.mapAutoCheck.checked,
          speed: Number(this.mapSpeedSelect.value),
        },
      });
    };
    this.mapAutoCheck.addEventListener('change', pushMapSettings);
    this.mapSpeedSelect.addEventListener('change', pushMapSettings);

    // Modifiers
    const pushModifiers = () => {
      this.modSpeedVal.textContent = Number(this.modSpeed.value).toFixed(2);
      this.modScaleVal.textContent = Number(this.modScale.value).toFixed(2);
      this.modGravVal.textContent = Number(this.modGrav.value).toFixed(2);
      this.modJumpVal.textContent = Number(this.modJump.value).toFixed(2);
      this.net.send({
        t: 'C_ADMIN_ACTION',
        action: 'set_modifiers',
        payload: {
          speedMultiplier: Number(this.modSpeed.value),
          playerScale: Number(this.modScale.value),
          gravityMultiplier: Number(this.modGrav.value),
          jumpMultiplier: Number(this.modJump.value),
          infiniteAmmo: this.modInfAmmo.checked,
        },
      });
    };
    [this.modSpeed, this.modScale, this.modGrav, this.modJump].forEach((el) =>
      el.addEventListener('change', pushModifiers)
    );
    [this.modSpeed, this.modScale, this.modGrav, this.modJump].forEach((el) =>
      el.addEventListener('input', () => {
        this.modSpeedVal.textContent = Number(this.modSpeed.value).toFixed(2);
        this.modScaleVal.textContent = Number(this.modScale.value).toFixed(2);
        this.modGravVal.textContent = Number(this.modGrav.value).toFixed(2);
        this.modJumpVal.textContent = Number(this.modJump.value).toFixed(2);
      })
    );
    this.modInfAmmo.addEventListener('change', pushModifiers);
    this.modResetBtn.addEventListener('click', () =>
      this.net.send({ t: 'C_ADMIN_ACTION', action: 'reset_modifiers' })
    );

    // Temp Keys
    this.createKeyBtn.addEventListener('click', () => {
      this.net.send({
        t: 'C_ADMIN_ACTION',
        action: 'create_key',
        payload: {
          mode: this.keyModeSelect.value,
          durationMinutes: Number(this.keyMinsInput.value),
        },
      });
    });
  }

  public show(): void {
    this.root.classList.remove('hidden');
  }

  public hide(): void {
    this.root.classList.add('hidden');
  }

  public setRole(role: AdminRole, error?: string): void {
    this.role = role;
    this.roleBadge.textContent =
      role === 'master' ? 'MAESTRO' : role === 'temp' ? 'LLAVE TEMPORAL' : 'SIN ACCESO';

    if (role === 'none') {
      this.authBox.classList.remove('hidden');
      this.contentBox.classList.add('hidden');
      if (error) {
        this.authErr.textContent = error;
        this.authErr.classList.remove('hidden');
      }
    } else {
      this.authBox.classList.add('hidden');
      this.contentBox.classList.remove('hidden');
      this.tabKeysBtn.classList.toggle('hidden', role !== 'master');
    }
  }

  public syncMatchConfig(cfg: MatchConfig, paused: boolean): void {
    this.pausedState = paused;
    this.modeSelect.value = cfg.gameMode;
    this.ggTeamsCheck.checked = cfg.gunGameTeams;
    this.randRotCheck.checked = cfg.randomModeRotation;
    this.scoreInput.value = String(cfg.scoreLimit);
    this.roundInput.value = String(cfg.roundLimit);
    this.durInput.value = String(cfg.roundDurationMin);
  }

  public syncMapSettings(settings: MapEvolutionSettings): void {
    this.mapAutoCheck.checked = settings.autoEvolutionEnabled;
    this.mapSpeedSelect.value = String(settings.speedMultiplier);
  }

  public syncModifiers(mod: RoomModifiers): void {
    this.modSpeed.value = String(mod.speedMultiplier);
    this.modSpeedVal.textContent = mod.speedMultiplier.toFixed(2);
    this.modScale.value = String(mod.playerScale);
    this.modScaleVal.textContent = mod.playerScale.toFixed(2);
    this.modGrav.value = String(mod.gravityMultiplier);
    this.modGravVal.textContent = mod.gravityMultiplier.toFixed(2);
    this.modJump.value = String(mod.jumpMultiplier);
    this.modJumpVal.textContent = mod.jumpMultiplier.toFixed(2);
    this.modInfAmmo.checked = mod.infiniteAmmo;
  }

  public renderSectorGrid(sectors: Map<string, SectorState>): void {
    this.sectorGridEl.innerHTML = '';
    for (let gz = -3; gz <= 3; gz++) {
      for (let gx = -3; gx <= 3; gx++) {
        const s = sectors.get(sectorKey(gx, gz));
        const btn = document.createElement('button');
        btn.type = 'button';
        const lvl = s ? s.level : 0;
        btn.className = `sec-cell lvl${lvl}${s && s.phase !== 'STABLE' ? ' warn' : ''}`;
        btn.textContent = `${gx},${gz}:L${lvl}`;
        btn.addEventListener('click', () => {
          this.net.send({
            t: 'C_ADMIN_ACTION',
            action: 'sector_force',
            payload: { gx, gz, level: Number(this.sectorLvlSelect.value) },
          });
        });
        this.sectorGridEl.appendChild(btn);
      }
    }
  }

  public renderPlayers(players: Map<string, { id: string; name: string; team: TeamId }>): void {
    this.playersListEl.innerHTML = '';
    for (const p of players.values()) {
      const row = document.createElement('div');
      row.className = 'admin-list-row';
      row.innerHTML = `<span>${p.name} (${p.team})</span>`;
      const actions = document.createElement('div');
      actions.className = 'inline-row';
      actions.style.marginBottom = '0';

      const mkBtn = (label: string, fn: () => void) => {
        const b = document.createElement('button');
        b.className = 'btn-secondary';
        b.style.padding = '3px 7px';
        b.style.fontSize = '0.72rem';
        b.textContent = label;
        b.addEventListener('click', fn);
        actions.appendChild(b);
      };

      mkBtn('A', () =>
        this.net.send({ t: 'C_ADMIN_ACTION', action: 'move_team', payload: { playerId: p.id, team: 'A' } })
      );
      mkBtn('B', () =>
        this.net.send({ t: 'C_ADMIN_ACTION', action: 'move_team', payload: { playerId: p.id, team: 'B' } })
      );
      mkBtn('Kick', () =>
        this.net.send({ t: 'C_ADMIN_ACTION', action: 'kick', payload: { playerId: p.id } })
      );

      row.appendChild(actions);
      this.playersListEl.appendChild(row);
    }
  }

  public renderKeys(keys: TempKeyInfo[]): void {
    this.keysListEl.innerHTML = '';
    for (const k of keys) {
      const row = document.createElement('div');
      row.className = 'admin-list-row';
      const status = k.revoked
        ? 'REVOCADA'
        : k.mode === 'single_session'
          ? k.boundPlayerId
            ? `1 sesion (${k.boundPlayerId})`
            : '1 sesion (libre)'
          : `Expira en ${Math.max(0, Math.round(((k.expiresAtMs ?? 0) - Date.now()) / 60000))}m`;
      row.innerHTML = `<span><strong>${k.code}</strong> · ${status}</span>`;

      if (!k.revoked) {
        const btns = document.createElement('div');
        btns.className = 'inline-row';
        btns.style.marginBottom = '0';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn-secondary';
        copyBtn.style.padding = '3px 8px';
        copyBtn.textContent = 'Copiar';
        copyBtn.addEventListener('click', () => navigator.clipboard?.writeText(k.code));

        const revBtn = document.createElement('button');
        revBtn.className = 'btn-secondary';
        revBtn.style.padding = '3px 8px';
        revBtn.textContent = 'Revocar';
        revBtn.addEventListener('click', () =>
          this.net.send({ t: 'C_ADMIN_ACTION', action: 'revoke_key', payload: { code: k.code } })
        );

        btns.appendChild(copyBtn);
        btns.appendChild(revBtn);
        row.appendChild(btns);
      }
      this.keysListEl.appendChild(row);
    }
  }
}
