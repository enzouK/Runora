/**
 * Cronômetro de etapas do sync + contador de chamadas ao Drive.
 * Só faz algo em modo dev (Vite define `import.meta.env.DEV`).
 * Sem side effects: apenas acumula dados; `getReport()` devolve string legível.
 */

export interface SyncTimingEntry {
  stage: string;
  ms: number;
  calls: number;
}

// Flag interna para testes (força modo dev mesmo sem import.meta.env.DEV)
let _forceDev = false;
export function __setForceDev(v: boolean): void {
  _forceDev = v;
}
function isDev(): boolean {
  return _forceDev || (typeof import.meta !== 'undefined' && import.meta.env?.DEV === true);
}

let _driveCalls = 0;
let _activeTiming: SyncTiming | null = null;

/** Incrementa o contador de chamadas ao Drive (chamado por fetchWithTimeout). */
export function countDriveCall(): void {
  if (isDev()) _driveCalls++;
}

/** Reseta o contador (no início do sync). */
export function resetDriveCallCount(): number {
  const n = _driveCalls;
  _driveCalls = 0;
  return n;
}

/**
 * A classe principal — acumula tempo e chamadas por etapa.
 * Uso: `const t = new SyncTiming(); await t.track('etapa', async () => { ... }); t.report()`
 */
export class SyncTiming {
  private t0 = performance.now();
  private entries: SyncTimingEntry[] = [];
  private currentStage = 'início';
  private stageStart = this.t0;
  private callsAtStageStart = 0;

  /** Inicia uma nova etapa (encerra a anterior). */
  mark(stage: string): void {
    if (!isDev()) return;
    const now = performance.now();
    this.entries.push({
      stage: this.currentStage,
      ms: Math.round(now - this.stageStart),
      calls: _driveCalls - this.callsAtStageStart,
    });
    this.currentStage = stage;
    this.stageStart = now;
    this.callsAtStageStart = _driveCalls;
  }

  /**
   * Envolve uma promise, medindo tempo e chamadas só dessa etapa.
   * Retorna o resultado da promise. Em não-dev, mark() é no-op.
   */
  async track<T>(stage: string, fn: () => Promise<T>): Promise<T> {
    this.mark(stage);
    try {
      return await fn();
    } finally {
      // a próxima mark() vai fechar esta etapa
    }
  }

  /** Finaliza e devolve o relatório formatado. */
  getReport(): string {
    if (!isDev()) return 'timing desativado (não-dev)';
    // fecha a etapa atual
    const now = performance.now();
    this.entries.push({
      stage: this.currentStage,
      ms: Math.round(now - this.stageStart),
      calls: _driveCalls - this.callsAtStageStart,
    });
    const totalMs = Math.round(now - this.t0);
    const totalCalls = _driveCalls;
    const lines = this.entries.map(
      (e) => `${e.ms.toString().padStart(5)} ms  ${e.calls.toString().padStart(2)} calls  ${e.stage}`
    );
    lines.push(
      `${totalMs.toString().padStart(5)} ms  ${totalCalls.toString().padStart(2)} calls  TOTAL`
    );
    return lines.join('\n');
  }

  /** Entradas brutas (para testes / integração). */
  getEntries(): ReadonlyArray<SyncTimingEntry> {
    return this.entries;
  }

  /** Total de ms acumulados. */
  getTotalMs(): number {
    return Math.round(performance.now() - this.t0);
  }

  /** Total de chamadas ao Drive. */
  getTotalCalls(): number {
    return _driveCalls;
  }
}

/**
 * Instância ativa durante um syncNow().
 * Acessada por `DriveSyncService.getLastTimingReport()`.
 */
export function getActiveTiming(): SyncTiming | null {
  return _activeTiming;
}

export function setActiveTiming(t: SyncTiming | null): void {
  _activeTiming = t;
}