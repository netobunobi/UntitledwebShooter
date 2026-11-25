export class VoteOverlay {
  private root = document.getElementById('vote-overlay')!;
  private subtitle = document.getElementById('vote-subtitle')!;
  private timerEl = document.getElementById('vote-timer')!;
  private btnA = document.getElementById('vote-btn-a')!;
  private btnB = document.getElementById('vote-btn-b')!;
  private barA = document.getElementById('vote-bar-a')!;
  private barB = document.getElementById('vote-bar-b')!;
  private countA = document.getElementById('vote-count-a')!;
  private countB = document.getElementById('vote-count-b')!;
  private resultEl = document.getElementById('vote-result')!;

  private endsAtSimMs = 0;
  private active = false;

  constructor(onVote: (team: 'A' | 'B') => void) {
    this.btnA.addEventListener('click', () => onVote('A'));
    this.btnB.addEventListener('click', () => onVote('B'));
  }

  public start(extraName: string, endsAt: number): void {
    this.active = true;
    this.endsAtSimMs = endsAt;
    this.subtitle.textContent = `Jugador extra: ${extraName} — ¿A que equipo va?`;
    this.resultEl.classList.add('hidden');
    this.updateCounts(0, 0);
    this.root.classList.remove('hidden');
  }

  public updateCounts(votesA: number, votesB: number): void {
    this.countA.textContent = String(votesA);
    this.countB.textContent = String(votesB);
    const total = Math.max(1, votesA + votesB);
    this.barA.style.width = `${(votesA / total) * 100}%`;
    this.barB.style.width = `${(votesB / total) * 100}%`;
  }

  public showResult(winnerTeam: 'A' | 'B', coinFlip: boolean): void {
    this.active = false;
    const teamName = winnerTeam === 'A' ? 'ALPHA' : 'BRAVO';
    this.resultEl.textContent = coinFlip
      ? `Empate — Moneda al aire: ${teamName}`
      : `Votacion cerrada: ${teamName}`;
    this.resultEl.classList.remove('hidden');
    setTimeout(() => {
      if (!this.active) this.root.classList.add('hidden');
    }, 2200);
  }

  public hide(): void {
    this.active = false;
    this.root.classList.add('hidden');
  }

  public tick(simTimeMs: number): void {
    if (!this.active) return;
    const rem = Math.max(0, Math.ceil((this.endsAtSimMs - simTimeMs) / 1000));
    this.timerEl.textContent = `${rem}s`;
  }
}
