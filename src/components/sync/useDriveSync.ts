import { useCallback, useState } from 'react';
import {
  ConflictChoice,
  DriveSyncService,
  DriveToken,
  LastSync,
  SyncMeta,
  SyncResult,
} from '../../services/gdriveSync';

export interface SyncConflictState {
  meta: SyncMeta;
  resolve: (choice: ConflictChoice) => void;
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

  const runSync = useCallback(async (): Promise<SyncResult | null> => {
    if (DriveSyncService.isRunning()) return null;
    setRunning(true);
    setStatus(null);
    try {
      const res = await DriveSyncService.syncNow({
        onProgress: (m) => setStatus({ type: 'info', text: m }),
        onConflict: (meta) =>
          new Promise<ConflictChoice>((resolve) => setConflict({ meta, resolve })),
      });
      setStatus({
        type: res.action === 'cancelled' ? 'info' : 'success',
        text: res.message,
      });
      setLastSync(DriveSyncService.getLastSync());
      await refreshRemote();
      if (res.action === 'download') onDataChanged();
      return res;
    } catch (e) {
      setStatus({ type: 'error', text: (e as Error).message });
      refreshRemote().catch(() => {});
      return null;
    } finally {
      setRunning(false);
      setConflict(null);
    }
  }, [onDataChanged, refreshRemote]);

  const connect = useCallback(async () => {
    setRunning(true);
    setStatus(null);
    try {
      const email = await DriveSyncService.connect();
      setAccount(DriveSyncService.getAccount());
      setStatus({ type: 'success', text: `Conta Google conectada: ${email}` });
      await refreshRemote();
    } catch (e) {
      setStatus({ type: 'error', text: (e as Error).message });
    } finally {
      setRunning(false);
    }
  }, [refreshRemote]);

  const disconnect = useCallback(() => {
    DriveSyncService.disconnect();
    setAccount(null);
    setRemote(null);
    setStatus({ type: 'info', text: 'Conta desconectada. O último backup continua no seu Drive.' });
  }, []);

  return {
    running,
    status,
    conflict,
    lastSync,
    account,
    remote,
    runSync,
    connect,
    disconnect,
    refreshRemote,
  };
}

export type DriveSyncController = ReturnType<typeof useDriveSync>;
