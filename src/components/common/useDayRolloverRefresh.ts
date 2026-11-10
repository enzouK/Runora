import { useEffect, useRef, useState } from 'react';

import { StorageService } from '../../services/storage';
import { diaDeEstudo, msAteProximaVirada } from './dayRollover';

/**
 * Fase 6 — re-ler a tela na virada do dia de estudo (a hora configurada
 * nas Configurações gerais, padrão 4h da manhã).
 *
 * - Agenda 1 aviso para a próxima virada; dispara, agenda a próxima.
 * - Se o app estava com a tela apagada exatamente na hora da virada,
 *   confere ao acordar se o dia já mudou e re-lê se mudou.
 * - Se a hora configurada mudar (inclusive chegando pela sincronização
 *   do Drive), o agendamento é refeito sozinho.
 *
 * Não sincroniza nada — só atualiza a tela com o que já está no aparelho.
 */
export function useDayRolloverRefresh(onRefresh: () => void): void {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  // re-agenda quando a configuração muda (o padrão do app é avisar
  // 'runora:settings-changed' — inclusive quando chega pelo sync)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const confere = () => setTick((t) => t + 1);
    window.addEventListener('runora:settings-changed', confere);
    return () => window.removeEventListener('runora:settings-changed', confere);
  }, []);

  useEffect(() => {
    let timer: number | null = null;
    const agendar = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        onRefreshRef.current();
        agendar();
      }, msAteProximaVirada(Date.now(), StorageService.getRolloverHour()));
    };
    agendar();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [tick]);

  // o app pode "acordar" depois da virada (tela apagada): confere ao focar
  useEffect(() => {
    let ultimoDia: number | null = null;
    const acordou = () => {
      const hoje = diaDeEstudo(Date.now(), StorageService.getRolloverHour());
      if (ultimoDia !== null && hoje !== ultimoDia) onRefreshRef.current();
      ultimoDia = hoje;
    };
    acordou();
    window.addEventListener('visibilitychange', acordou);
    window.addEventListener('focus', acordou);
    return () => {
      window.removeEventListener('visibilitychange', acordou);
      window.removeEventListener('focus', acordou);
    };
  }, []);
}
