/**
 * Fase 6 — a conta da virada do dia de estudo.
 *
 * O dia de estudo começa na hora configurada (o "rollover", padrão 4h da
 * manhã), não à meia-noite. Aqui are tested: quanto tempo falta até a
 * próxima virada e a qual dia um instante pertence (2h da manhã ainda é
 * "ontem" no estudo).
 *
 * Usam datas de 15 de julho: janelas sem horário de verão em nenhum tipo
 * de região, então a subtração de horas é estável.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { diaDeEstudo, msAteProximaVirada } from './dayRollover';

const HORA = 3_600_000;
const DIA = 24 * HORA;

/** 15/07 de 2026 às 23:00 no horário local. */
const vinteETres = new Date(2026, 6, 15, 23, 0, 0, 0).getTime();
/** 15/07 de 2026 em ponto da virada (04:00). */
const virandoDe = new Date(2026, 6, 15, 4, 0, 0, 0).getTime();

describe('Fase 6 — quanto falta para a virada do dia', () => {
  it('das 23h à virada às 4h faltam 5 horas (o dia novo é de manhã)', () => {
    assert.equal(msAteProximaVirada(vinteETres, 4), 5 * HORA);
  });

  it('das 5h do dia até a virada do dia seguinte (às 4h) faltam 23 horas', () => {
    const cinco = new Date(2026, 6, 15, 5, 0, 0, 0).getTime();
    assert.equal(msAteProximaVirada(cinco, 4), 23 * HORA);
  });

  it('instante em ponto da virada: a próxima é daqui a 24 horas', () => {
    assert.equal(msAteProximaVirada(virandoDe, 4), DIA);
  });

  it('meia-noite configurada: das 23h faltam 1 hora', () => {
    assert.equal(msAteProximaVirada(vinteETres, 0), 1 * HORA);
  });

  it('configuração mal formulada ou fora do intervalo cai na meia-noite', () => {
    assert.equal(msAteProximaVirada(vinteETres, 99), 1 * HORA);
    assert.equal(msAteProximaVirada(vinteETres, NaN), 1 * HORA);
  });
});

describe('Fase 6 — a qual dia de estudo um instante pertence', () => {
  it('às 23h e, 5 horas depois (4h da manhã), são dias de estudo diferentes', () => {
    const dia23 = diaDeEstudo(vinteETres, 4);
    // 5h depois é 04:00 do dia seguinte — virou o dia de estudo
    const diaDepois = diaDeEstudo(vinteETres + 5 * HORA, 4);
    assert.notEqual(dia23, diaDepois);
    assert.equal(diaDepois, dia23 + 1);
  });

  it('às 2h da manhã ainda é o dia de estudo de "ontem" (virada às 4h)', () => {
    const duasManha = new Date(2026, 6, 15, 2, 0, 0, 0).getTime();
    const meiaNoite = new Date(2026, 6, 15, 0, 30, 0, 0).getTime();
    assert.equal(diaDeEstudo(duasManha, 4), diaDeEstudo(meiaNoite, 4));
    // e quando se somam as 24h do dia, essa identidade muda
    assert.equal(diaDeEstudo(duasManha + DIA, 4), diaDeEstudo(duasManha, 4) + 1);
  });

  it('na virada em ponto a identidade do dia muda (1ms antes ≠ 1ms depois)', () => {
    assert.equal(diaDeEstudo(virandoDe - 1, 4), diaDeEstudo(virandoDe, 4) - 1);
  });

  it('meia-noite configurada: o dia muda exatamente à meia-noite', () => {
    const meiaNoite = new Date(2026, 6, 15, 0, 0, 0, 0).getTime();
    const onzeNoite = new Date(2026, 6, 14, 23, 59, 0, 0).getTime();
    assert.notEqual(diaDeEstudo(meiaNoite, 0), diaDeEstudo(onzeNoite, 0));
  });
});
