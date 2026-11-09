import { useCallback, useState } from 'react';
import {
  ConflictChoice,
  DriveSyncService,
  DriveToken,
  LastSync,
  SyncItemsChoice,
  SyncItemsConflict,
  SyncMeta,
  SyncProgressState,
  SyncResult,
} from '../../services/gdriveSync';

export interface SyncConflictState {
  meta: SyncMeta;
  resolve: (choice: ConflictChoice) => void;
}

export interface SyncItemsConflictState {
  conflict: SyncItemsConflict;
  resolve: (choice: SyncItemsChoice) => void;
}

export interface RemoteInfo {
  meta: SyncMeta;
  size: number;
}

export type SyncStatus = { type: 'info' | 'success' | 'error'; text: string } | null;

/**
 * Single instance shared by App (auto-sync on start + conflict modal) and the
 * Sync tab (manual button + status), so a conflict raised by the auto-sync is
 * answered from the same modal no matter which tab is visible.
 */
export function useDriveSync(onDataChanged: () => void) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<SyncStatus>(null);
  const [conflict, setConflict] = useState<SyncConflictState | null>(null);
  const [itemsConflict, setItemsConflict] = useState<SyncItemsConflictState | null>(null);
  const [pending, setPending] = useState<number>(() => DriveSyncService.getPendingConflict()?.count ?? 0);
  const [dirty, setDirty] = useState<boolean>(() => DriveSyncService.hasPendingLocalChanges());
  const [lastSync, setLastSync] = useState<LastSync | null>(() => DriveSyncService.getLastSync());
  const [account, setAccount] = useState<DriveToken | null>(() => DriveSyncService.getAccount());
  const [remote, setRemote] = useState<RemoteInfo | null>(null);

  const refreshRemote = useCallback(async () => {
    if (!DriveSyncService.getAccount()) {
      setRemote(null);
      return;
    }
    try {
      setRemote(await DriveSyncService.getRemoteInfo());
    } catch {
      setRemote(null);
    }
  }, []);

  const refreshPending = useCallback(() => {
    setPending(DriveSyncService.getPendingConflict()?.count ?? 0);
  }, []);

  /**
   * Há mudanças aqui que ainda não foram para o Drive? (acende o botão
   * Sync em amarelo). Sem conta conectada não faz sentido mostrar.
   */
  const refreshDirty = useCallback(() => {
    setDirty(!!DriveSyncService.getAccount() && DriveSyncService.hasPendingLocalChanges());
  }, []);

  /**
   * Roda a sincronização.
   * `manual: true` (botão Sync) pode abrir a pergunta de disputa;
   * automático (abertura/timer) nunca abre popup — vira badge pendente.
   */
  const runSync = useCallback(
    async (opts?: {
      manual?: boolean;
      /** Painel de progresso ao vivo (o header mostra durante o sync manual). */
      onItemProgress?: (p: SyncProgressState | null) => void;
    }): Promise<SyncResult | null> => {
      if (DriveSyncService.isRunning()) {
        // já tem um sync rodando — avisa (antes o clique ficava sem resposta)
        const message = 'Já existe uma sincronização em andamento. Aguarde ela terminar.';
        setStatus({ type: 'info', text: message });
        return { action: 'cancelled', message };
      }
      setRunning(true);
      setStatus(null);
      try {
        const res = await DriveSyncService.syncNow({
          manual: opts?.manual ?? false,
          onProgress: (m) => setStatus({ type: 'info', text: m }),
          onItemProgress: opts?.onItemProgress,
          onConflict: (meta) =>
            new Promise<ConflictChoice>((resolve) => setConflict({ meta, resolve })),
          onItemsConflict: (c) =>
            new Promise<SyncItemsChoice>((resolve) => setItemsConflict({ conflict: c, resolve })),
        });
        setStatus({
          type: res.action === 'cancelled' ? 'info' : 'success',
          text: res.message,
        });
        setLastSync(DriveSyncService.getLastSync());
        refreshPending();
        refreshDirty();
        await refreshRemote();
        if (res.action === 'download') onDataChanged();
        return res;
      } catch (e) {
        const message = (e as Error).message;
        setStatus({ type: 'error', text: message });
        refreshRemote().catch(() => {});
        // a sessão pode ter expirado (o token é apagado) → volta ao estado normal
        setAccount(DriveSyncService.getAccount());
        refreshDirty();
        // o erro volta para a UI — sem isso o clique no Sync parece não fazer nada
        return { action: 'cancelled', message, error: true };
      } finally {
        setRunning(false);
        setConflict(null);
        setItemsConflict(null);
      }
    },
    [onDataChanged, refreshRemote, refreshPending, refreshDirty]
  );

  const connect = useCallback(async () => {
    setRunning(true);
    setStatus(null);
    try {
      const email = await DriveSyncService.connect();
      setAccount(DriveSyncService.getAccount());
      setStatus({ type: 'success', text: `Conta Google conectada: ${email}` });
      refreshDirty();
      await refreshRemote();
    } catch (e) {
      setStatus({ type: 'error', text: (e as Error).message });
    } finally {
      setRunning(false);
    }
  }, [refreshRemote, refreshDirty]);

  const disconnect = useCallback(() => {
    DriveSyncService.disconnect();
    setAccount(null);
    setRemote(null);
    setDirty(false);
    setStatus({ type: 'info', text: 'Conta desconectada. O último backup continua no seu Drive.' });
  }, []);

  return {
    running,
    status,
    conflict,
    itemsConflict,
    pending,
    dirty,
    lastSync,
    account,
    remote,
    runSync,
    connect,
    disconnect,
    refreshRemote,
    refreshPending,
    refreshDirty,
  };
}

export type DriveSyncController = ReturnType<typeof useDriveSync>;
