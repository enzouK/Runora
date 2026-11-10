/**
 * Fase 6 — a conta da "virada do dia".
 *
 * O dia de estudo não começa à meia-noite: começa na hora configurada
 * nas Configurações gerais (o "rollover", padrão 4h da manhã). Nesse
 * instante os contadores passam para o dia novo — e é aí que a tela
 * precisa ser re-lida.
 *
 * A conta é função pura para poder ser testada fora do navegador.
 */

/** Quanto tempo (ms) falta até a próxima virada, dado o horário configurado. */
export function msAteProximaVirada(nowMs: number, rolloverHour: number): number {
  const hora = horaValida(rolloverHour);
  const agora = new Date(nowMs);
  const alvo = new Date(agora);
  alvo.setHours(hora, 0, 0, 0);
  if (alvo.getTime() <= agora.getTime()) {
    // a virada de hoje já passou → a próxima é amanhã
    alvo.setDate(alvo.getDate() + 1);
  }
  return alvo.getTime() - agora.getTime();
}

/** Identidade do dia de estudo ao qual um instante pertence. */
export function diaDeEstudo(nowMs: number, rolloverHour: number): number {
  const hora = horaValida(rolloverHour);
  const d = new Date(nowMs);
  const inicioDesteDia = new Date(d);
  inicioDesteDia.setHours(hora, 0, 0, 0);
  if (d.getTime() < inicioDesteDia.getTime()) {
    // antes da virada: o dia de estudo ainda é o de ontem
    inicioDesteDia.setDate(inicioDesteDia.getDate() - 1);
  }
  return Math.floor(inicioDesteDia.getTime() / 86400000);
}

/** Ajusta a hora configurada (0–23); valores estranhos viram meia-noite. */
function horaValida(rolloverHour: number): number {
  if (!Number.isFinite(rolloverHour)) return 0;
  const arredondada = Math.round(rolloverHour);
  if (arredondada < 0 || arredondada >= 24) return 0;
  return arredondada;
}
