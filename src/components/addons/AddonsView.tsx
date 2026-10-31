import React from 'react';
import { Download, Puzzle, Settings, Trash2, Upload } from 'lucide-react';
import { AddonSystem } from '../../services/addonSystem';
import { importAddonFile, removeAddon } from '../../services/addonStorage';
import { IOSSwitch } from '../common/IOSSwitch';

/**
 * Addons JS — full-page view (accessible from the main nav, next to Note Types).
 * Lists installed addons and lets the user enable/disable them.
 */
export const AddonsView: React.FC = () => {
  const [addons, setAddons] = React.useState(() => AddonSystem.getAddons());
  const [importMsg, setImportMsg] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [addonsRootPath, setAddonsRootPath] = React.useState<string | null>(null);
  const importFileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    let alive = true;
    AddonSystem.init().then((root) => {
      if (!alive) return;
      setAddonsRootPath(root);
      setAddons(AddonSystem.getAddons());
    });
    return () => {
      alive = false;
    };
  }, []);

  const handleToggle = (id: string) => {
    AddonSystem.toggleAddon(id);
    setAddons(AddonSystem.getAddons());
  };

  const handleAddonSettings = (id: string) => {
    // TODO: abrir configurações específicas do addon (id)
    setImportMsg(`Configurações do addon "${id}" ainda não implementadas.`);
  };

  const handleDeleteAddon = async (id: string) => {
    const addon = addons.find((a) => a.id === id);
    const label = addon?.name || id;
    if (!window.confirm(`Excluir o addon "${label}"? Isso remove a pasta dele de Addons.`)) return;
    try {
      await removeAddon(id);
      await AddonSystem.refresh();
      setAddons(AddonSystem.getAddons());
      setImportMsg(`Addon "${label}" excluído.`);
    } catch (err) {
      setImportMsg(`Erro ao excluir: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleImport = () => {
    importFileRef.current?.click();
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // permite selecionar o mesmo arquivo de novo na próxima vez
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    setImportMsg(null);
    try {
      let result = await importAddonFile(file, false);
      if (!result.ok && result.code === 'exists') {
        if (window.confirm(result.message)) {
          result = await importAddonFile(file, true);
        } else {
          setImportMsg('Importação cancelada.');
          return;
        }
      }
      if (result.ok) {
        await AddonSystem.refresh();
        setAddons(AddonSystem.getAddons());
      }
      setImportMsg(result.message);
    } catch (err) {
      setImportMsg(`Erro ao importar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  const handleExport = () => {
    // TODO: abrir fluxo de exportação de addons
  };

  return (
    <div className="space-y-6 ios-fade-in">
      {/* Large Title header */}
      <div className="flex items-end justify-between gap-4 px-1 pt-1">
        <div>
          <h2 className="text-[32px] leading-none font-bold tracking-tight text-zinc-900 dark:text-white">
            Addons
          </h2>
        </div>

        <button
          type="button"
          title="Instalar Addon (em breve)"
          disabled
          className="w-9 h-9 rounded-full flex items-center justify-center bg-ios-blue/30 text-white cursor-not-allowed"
        >
          <Puzzle className="w-[18px] h-[18px]" strokeWidth={2.5} />
        </button>
      </div>

      {/* Addon list (iOS inset grouped) */}
      <div className="rounded-[20px] bg-ios-card dark:bg-ios-card-dark border border-black/[0.04] dark:border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.05)] overflow-hidden divide-y divide-black/[0.05] dark:divide-white/[0.06]">
        {addons.length === 0 ? (
          <div className="p-8 text-center">
            <Puzzle className="w-8 h-8 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
            <p className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">
              Nenhum addon instalado
            </p>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">
              Os addons aparecerão aqui quando instalados.
            </p>
          </div>
        ) : (
          addons.map((addon) => (
            <div key={addon.id} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-zinc-900 dark:text-zinc-100">
                    {addon.name}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/[0.05] dark:bg-white/[0.1] text-zinc-500 dark:text-zinc-400">
                    v{addon.version}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {addon.description}
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <IOSSwitch checked={addon.enabled} onChange={() => handleToggle(addon.id)} />
                <button
                  type="button"
                  title={`Configurações de ${addon.name}`}
                  onClick={() => handleAddonSettings(addon.id)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors active:scale-90"
                >
                  <Settings className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  title={`Excluir ${addon.name}`}
                  onClick={() => void handleDeleteAddon(addon.id)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-ios-red/10 hover:text-ios-red transition-colors active:scale-90"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Importar / Exportar — rodapé da página de Addons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={handleImport}
          disabled={importing}
          title="Importar Addon"
          className="flex items-center justify-center gap-2 py-3 rounded-[16px] bg-ios-card dark:bg-ios-card-dark border border-black/[0.04] dark:border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.05)] text-[13px] font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-all active:scale-[0.98] disabled:opacity-60"
        >
          <Download className="w-4 h-4 text-ios-blue" />
          <span>Importar</span>
        </button>
        <button
          type="button"
          onClick={handleExport}
          title="Exportar Addons (em breve)"
          className="flex items-center justify-center gap-2 py-3 rounded-[16px] bg-ios-card dark:bg-ios-card-dark border border-black/[0.04] dark:border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.05)] text-[13px] font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-all active:scale-[0.98]"
        >
          <Upload className="w-4 h-4 text-ios-blue" />
          <span>Exportar</span>
        </button>
      </div>

      {/* Seletor de arquivo escondido usado pelo botão Importar */}
      <input
        ref={importFileRef}
        type="file"
        accept=".json,.anki2addon,.zip"
        className="hidden"
        onChange={(event) => void handleImportFile(event)}
      />

      {importMsg && (
        <p className="px-1 text-[12px] text-zinc-500 dark:text-zinc-400">{importMsg}</p>
      )}

      {addonsRootPath && (
        <p className="px-1 text-[11px] font-mono text-zinc-400 dark:text-zinc-500 break-all">
          Pasta: {addonsRootPath}
        </p>
      )}
    </div>
  );
};
