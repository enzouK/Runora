import { useCallback, useState } from 'react';

/** Campo editável que pode sofrer undo/redo. */
export type HistoryField = 'qfmt' | 'afmt' | 'css';

export interface HistoryEntry {
  /** Qual campo foi alterado. */
  field: HistoryField;
  /** Índice do template (ignorado quando field === 'css'). */
  templateIndex: number;
  /** Conteúdo antes da alteração. */
  before: string;
  /** Conteúdo depois da alteração. */
  after: string;
  /** Timestamp da alteração (usado para agrupar digitação). */
  ts: number;
}

interface UseTemplateHistoryOptions {
  /** Quantidade máxima de entradas guardadas. */
  maxEntries?: number;
  /**
   * Janela (ms) dentro da qual alterações no mesmo campo são agrupadas
   * numa única entrada. É o que faz "digitar uma frase" virar 1 undo,
   * e não 1 por tecla.
   */
  coalesceMs?: number;
}

/**
 * Histórico de alterações do editor de templates (desfazer/refazer).
 *
 * Guarda até 20 alterações. Alterações feitas digitando são agrupadas
 * enquanto a digitação é contínua (pausa de 700 ms fecha a entrada);
 * ações por botão (inserir bloco, toolbar, limpar) sempre contam como
 * uma entrada nova.
 */
export const useTemplateHistory = (options: UseTemplateHistoryOptions = {}) => {
  const { maxEntries = 20, coalesceMs = 700 } = options;

  const [past, setPast] = useState<HistoryEntry[]>([]);
  const [future, setFuture] = useState<HistoryEntry[]>([]);

  /**
   * Registra uma alteração.
   * @param coalesce Quando true (digitação), a alteração pode ser fundida
   *                 com a última entrada do mesmo campo.
   */
  const push = useCallback(
    (
      field: HistoryField,
      templateIndex: number,
      before: string,
      after: string,
      coalesce = false
    ) => {
      // Sem mudança real: não entra no histórico
      if (before === after) return;

      const now = Date.now();
      const entry: HistoryEntry = { field, templateIndex, before, after, ts: now };

      setPast((prev) => {
        const last = prev[prev.length - 1];
        const canMerge =
          coalesce &&
          last &&
          last.field === field &&
          last.templateIndex === templateIndex &&
          now - last.ts < coalesceMs;

        const next = canMerge
          ? [...prev.slice(0, -1), { ...last, after, ts: now }]
          : [...prev, entry];

        // Mantém no máximo maxEntries (descarta a mais antiga)
        return next.length > maxEntries ? next.slice(next.length - maxEntries) : next;
      });

      // Uma alteração nova invalida o futuro (refazer)
      setFuture([]);
    },
    [coalesceMs, maxEntries]
  );

  /** Desfaz: devolve a entrada para ser aplicada (usar `before`). */
  const undo = useCallback((): HistoryEntry | null => {
    if (past.length === 0) return null;
    const entry = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture([...future, entry]);
    return entry;
  }, [future, past]);

  /** Refaz: devolve a entrada para ser aplicada (usar `after`). */
  const redo = useCallback((): HistoryEntry | null => {
    if (future.length === 0) return null;
    const entry = future[future.length - 1];
    setFuture(future.slice(0, -1));
    setPast([...past, entry]);
    return entry;
  }, [future, past]);

  /** Esvazia o histórico (ex.: ao trocar de tipo de nota). */
  const reset = useCallback(() => {
    setPast([]);
    setFuture([]);
  }, []);

  return {
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    pastCount: past.length,
    futureCount: future.length,
    push,
    undo,
    redo,
    reset,
  };
};
