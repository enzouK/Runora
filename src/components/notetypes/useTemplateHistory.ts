import { useCallback, useRef, useState } from 'react';

/** Campo editável que pode sofrer undo/redo. */
export type HistoryField = 'qfmt' | 'afmt' | 'css';

/** Uma alteração feita em um campo. */
export interface HistoryChange {
  /** Qual campo foi alterado. */
  field: HistoryField;
  /** Índice do template (ignorado quando field === 'css'). */
  templateIndex: number;
  /** Conteúdo antes da alteração. */
  before: string;
  /** Conteúdo depois da alteração. */
  after: string;
}

export interface HistoryEntry {
  /**
   * Alterações feitas na ação. normally é UMA (digitar, clicar num botão),
   * mas pode ter várias (inserir um bloco cria o HTML e a regra do CSS).
   */
  changes: HistoryChange[];
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
 * uma entrada nova — mesmo quando mexeem em mais de um lugar (HTML + CSS).
 *
 * As pilhas ficam em refs (e o estado só guarda o tamanho), assim vários
 * "desfazer" seguidos — ou segurar Ctrl+Z — nunca pegam uma lista velha.
 */
export const useTemplateHistory = (options: UseTemplateHistoryOptions = {}) => {
  const { maxEntries = 20, coalesceMs = 700 } = options;

  const pastRef = useRef<HistoryEntry[]>([]);
  const futureRef = useRef<HistoryEntry[]>([]);
  const [pastCount, setPastCount] = useState(0);
  const [futureCount, setFutureCount] = useState(0);

  /**
   * Registra uma alteração.
   * @param coalesce Quando true (digitação), a alteração pode ser fundida
   *                 com a última entrada do mesmo campo.
   */
  const push = useCallback(
    (changes: HistoryChange | HistoryChange[], coalesce = false) => {
      const list = (Array.isArray(changes) ? changes : [changes]).filter(
        (c) => c.before !== c.after
      );
      // Sem mudança real: não entra no histórico
      if (list.length === 0) return;

      const now = Date.now();
      const prev = pastRef.current;
      const last = prev[prev.length - 1];
      const lastChange = last?.changes.length === 1 ? last.changes[0] : null;
      const canMerge =
        coalesce &&
        list.length === 1 &&
        lastChange &&
        lastChange.field === list[0].field &&
        lastChange.templateIndex === list[0].templateIndex &&
        now - last.ts < coalesceMs;

      const next = canMerge
        ? [
            ...prev.slice(0, -1),
            { changes: [{ ...lastChange, after: list[0].after }], ts: now },
          ]
        : [...prev, { changes: list, ts: now }];

      // Mantém no máximo maxEntries (descarta a mais antiga)
      pastRef.current =
        next.length > maxEntries ? next.slice(next.length - maxEntries) : next;

      // Uma alteração nova invalida o futuro (refazer)
      futureRef.current = [];

      setPastCount(pastRef.current.length);
      setFutureCount(0);
    },
    [coalesceMs, maxEntries]
  );

  /** Desfaz: devolve a entrada para ser aplicada (usar `before`). */
  const undo = useCallback((): HistoryEntry | null => {
    const prev = pastRef.current;
    if (prev.length === 0) return null;

    const entry = prev[prev.length - 1];
    pastRef.current = prev.slice(0, -1);
    futureRef.current = [...futureRef.current, entry];

    setPastCount(pastRef.current.length);
    setFutureCount(futureRef.current.length);
    return entry;
  }, []);

  /** Refaz: devolve a entrada para ser aplicada (usar `after`). */
  const redo = useCallback((): HistoryEntry | null => {
    const fut = futureRef.current;
    if (fut.length === 0) return null;

    const entry = fut[fut.length - 1];
    futureRef.current = fut.slice(0, -1);
    pastRef.current = [...pastRef.current, entry];

    setPastCount(pastRef.current.length);
    setFutureCount(futureRef.current.length);
    return entry;
  }, []);

  /** Esvazia o histórico (ex.: ao trocar de tipo de nota). */
  const reset = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    setPastCount(0);
    setFutureCount(0);
  }, []);

  return {
    canUndo: pastCount > 0,
    canRedo: futureCount > 0,
    pastCount,
    futureCount,
    push,
    undo,
    redo,
    reset,
  };
};
