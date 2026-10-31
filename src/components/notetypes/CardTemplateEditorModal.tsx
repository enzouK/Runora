import React, { useState, useRef, useMemo } from 'react';
import {
  X,
  Code2,
  Eye,
  Plus,
  Trash2,
  Check,
  Sparkles,
  FileCode,
  Paintbrush,
  Columns,
  RotateCcw,
} from 'lucide-react';
import { CardTemplate, NoteType } from '../../types/anki';
import { ClozeService } from '../../services/clozeService';
import { StorageService } from '../../services/storage';
import { CardContentRenderer } from '../study/CardContentRenderer';
import { ConfirmationModal } from '../common/ConfirmationModal';

interface CardTemplateEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  noteType: NoteType;
  onSaved: () => void;
}

export const CardTemplateEditorModal: React.FC<CardTemplateEditorModalProps> = ({
  isOpen,
  onClose,
  noteType,
  onSaved,
}) => {
  const [templates, setTemplates] = useState<CardTemplate[]>(() =>
    noteType.templates.length > 0
      ? JSON.parse(JSON.stringify(noteType.templates))
      : [
          {
            id: `tmpl-${Date.now()}`,
            name: 'Card 1',
            ord: 0,
            qfmt: '{{Frente}}',
            afmt: '{{FrontSide}}\n<hr id="answer">\n{{Verso}}',
          },
        ]
  );
  const [activeTemplateIndex, setActiveTemplateIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'front' | 'back' | 'css'>('front');
  const [cssCode, setCssCode] = useState(noteType.css || '');
  const [previewMode, setPreviewMode] = useState<'front' | 'back'>('front');

  // Sample values for real-time live preview
  const [sampleValues, setSampleValues] = useState<Record<string, string>>(() => {
    const vals: Record<string, string> = {};
    noteType.fields.forEach((f) => {
      const lower = f.name.toLowerCase();
      if (lower.includes('reading') || lower.includes('leitura')) {
        vals[f.name] = '日本[にほん]へ 行[い]きます';
      } else if (lower.includes('sentence') || lower.includes('frase')) {
        vals[f.name] = '彼女は毎日図書館で勉強しています。';
      } else if (lower.includes('image') || lower.includes('imagem')) {
        vals[f.name] = 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?w=300&auto=format&fit=crop&q=60';
      } else if (lower.includes('audio') || lower.includes('áudio')) {
        vals[f.name] = 'https://actions.google.com/sounds/v1/water/air_woosh_underwater.ogg';
      } else if (lower.includes('hint') || lower.includes('dica')) {
        vals[f.name] = 'Dica de contexto para memorizar o card';
      } else if (lower.includes('definition') || lower.includes('significado') || lower.includes('verso')) {
        vals[f.name] = 'Ir ao Japão. Definição contextual e exemplos gramaticais.';
      } else {
        vals[f.name] = `Exemplo de [${f.name}]`;
      }
    });
    if (!vals['Hint']) {
      vals['Hint'] = 'Dica de contexto para memorizar o card';
    }
    return vals;
  });

  const frontTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const backTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const cssTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  if (!isOpen) return null;

  const currentTemplate = templates[activeTemplateIndex] || templates[0];

  const updateCurrentTemplate = (field: 'qfmt' | 'afmt' | 'name', value: string) => {
    setTemplates((prev) =>
      prev.map((t, idx) => (idx === activeTemplateIndex ? { ...t, [field]: value } : t))
    );
  };

  const handleAddTemplate = () => {
    const nextOrd = templates.length;
    const newTmpl: CardTemplate = {
      id: `tmpl-${Date.now()}-${nextOrd}`,
      name: `Card ${nextOrd + 1}`,
      ord: nextOrd,
      qfmt: `<div style="text-align: center; font-size: 24px;">\n  {{${noteType.fields[0]?.name || 'Frente'}}}\n</div>`,
      afmt: `{{FrontSide}}\n\n<hr id="answer">\n\n<div style="text-align: center; font-size: 20px;">\n  {{${noteType.fields[1]?.name || 'Verso'}}}\n</div>`,
    };
    setTemplates([...templates, newTmpl]);
    setActiveTemplateIndex(templates.length);
  };

  const [templateToDeleteIdx, setTemplateToDeleteIdx] = useState<number | null>(null);

  const handleDeleteTemplate = (idxToDelete: number) => {
    setTemplateToDeleteIdx(idxToDelete);
  };

  const confirmDeleteTemplate = () => {
    if (templateToDeleteIdx === null) return;
    const updated = templates.filter((_, idx) => idx !== templateToDeleteIdx);
    setTemplates(updated);
    setActiveTemplateIndex(Math.max(0, activeTemplateIndex - 1));
    setTemplateToDeleteIdx(null);
  };

  /**
   * Insert snippet at cursor in the currently active textarea
   */
  const insertSnippet = (snippet: string) => {
    let textarea: HTMLTextAreaElement | null = null;
    let fieldKey: 'qfmt' | 'afmt' | null = null;

    if (activeTab === 'front') {
      textarea = frontTextareaRef.current;
      fieldKey = 'qfmt';
    } else if (activeTab === 'back') {
      textarea = backTextareaRef.current;
      fieldKey = 'afmt';
    }

    if (!textarea || !fieldKey) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentVal = currentTemplate[fieldKey];
    const newVal = currentVal.substring(0, start) + snippet + currentVal.substring(end);

    updateCurrentTemplate(fieldKey, newVal);

    // Restore focus and cursor position after insertion
    setTimeout(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + snippet.length, start + snippet.length);
    }, 0);
  };

  // Live rendered preview HTML
  const renderedFront = useMemo(() => {
    return ClozeService.renderTemplate(currentTemplate.qfmt, sampleValues, false);
  }, [currentTemplate.qfmt, sampleValues]);

  const renderedBack = useMemo(() => {
    return ClozeService.renderTemplate(currentTemplate.afmt, sampleValues, true, renderedFront);
  }, [currentTemplate.afmt, sampleValues, renderedFront]);

  const handleSave = () => {
    const allNoteTypes = StorageService.getNoteTypes();
    const updatedNoteType: NoteType = {
      ...noteType,
      templates,
      css: cssCode,
      updatedAt: Date.now(),
    };

    const updatedList = allNoteTypes.map((nt) =>
      nt.id === noteType.id ? updatedNoteType : nt
    );

    StorageService.saveNoteTypes(updatedList);

    // Resync cards for all notes using this note type
    const allNotes = StorageService.getNotes();
    allNotes
      .filter((n) => n.noteTypeId === noteType.id)
      .forEach((n) => StorageService.syncCardsForNote(n));

    onSaved();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-md animate-in fade-in duration-200"
      // close on backdrop press (mousedown, so text-selection drags don't close)
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-6xl bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col h-[94vh] overflow-hidden">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <FileCode className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                  Editar Templates dos Cards (HTML & CSS)
                </h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 font-semibold border border-purple-500/20">
                  {noteType.name}
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Configure exatamente quais campos e tags HTML aparecem na frente e no verso.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Card Template selector bar */}
        <div className="flex items-center justify-between px-6 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100/50 dark:bg-zinc-900/40 text-xs">
          <div className="flex items-center gap-1.5 overflow-x-auto py-1">
            <span className="font-semibold text-zinc-400 uppercase tracking-wider mr-2 text-[10px]">
              Templates de Card:
            </span>
            {templates.map((tmpl, idx) => (
              <div key={tmpl.id || idx} className="flex items-center">
                <button
                  type="button"
                  onClick={() => setActiveTemplateIndex(idx)}
                  className={`px-3 py-1.5 rounded-xl font-medium transition-all ${
                    idx === activeTemplateIndex
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                  }`}
                >
                  {tmpl.name || `Card ${idx + 1}`}
                </button>
                {templates.length > 1 && idx === activeTemplateIndex && (
                  <button
                    type="button"
                    onClick={() => handleDeleteTemplate(idx)}
                    className="p-1 text-zinc-400 hover:text-red-500 ml-0.5"
                    title="Excluir este template"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={handleAddTemplate}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-zinc-200 dark:bg-zinc-800 hover:bg-blue-50 hover:text-blue-600 text-zinc-600 dark:text-zinc-300 font-medium transition-colors"
              title="Adicionar mais um Card Template (ex: Card 2 invertido)"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Novo Card</span>
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-1">
            <span className="text-[11px] text-zinc-400">Nome:</span>
            <input
              type="text"
              value={currentTemplate.name}
              onChange={(e) => updateCurrentTemplate('name', e.target.value)}
              className="px-2 py-0.5 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs w-32 font-medium"
            />
          </div>
        </div>

        {/* Main Workspace (Editor on Left, Live Preview on Right) */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
          {/* LEFT: Code & HTML Editor */}
          <div className="flex flex-col h-full overflow-hidden bg-zinc-50/50 dark:bg-zinc-950/30">
            {/* Editor Tabs (Front, Back, CSS) */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-zinc-200/80 dark:border-zinc-800">
              <div className="flex p-0.5 rounded-xl bg-zinc-200/80 dark:bg-zinc-800 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setActiveTab('front')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                    activeTab === 'front'
                      ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <Code2 className="w-3.5 h-3.5" />
                  <span>Modelo da Frente (Front)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('back')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                    activeTab === 'back'
                      ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <Code2 className="w-3.5 h-3.5" />
                  <span>Modelo do Verso (Back)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('css')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                    activeTab === 'css'
                      ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <Paintbrush className="w-3.5 h-3.5" />
                  <span>Estilo (CSS)</span>
                </button>
              </div>

              <span className="text-[11px] font-mono text-zinc-400 hidden sm:inline">
                HTML + tags Anki
              </span>
            </div>

            {/* Field insertion helper buttons */}
            <div className="px-4 py-2 border-b border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-[10px] uppercase font-bold text-zinc-400 mr-1">Inserir:</span>

              {/* Note Type fields (excluding Hint which has dedicated +hint button) */}
              {noteType.fields
                .filter((f) => f.name.toLowerCase() !== 'hint')
                .map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => insertSnippet(`{{${f.name}}}`)}
                    className="px-2 py-0.5 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/60 font-mono text-[11px] transition-colors"
                    title={`Inserir {{${f.name}}}`}
                  >
                    +{f.name}
                  </button>
                ))}

              {/* Single dedicated Hint tag insertion button */}
              <button
                type="button"
                onClick={() => insertSnippet('{{hint}}')}
                className="px-2 py-0.5 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/60 font-mono text-[11px] font-semibold transition-colors"
                title="Inserir tag de dica {{hint}}"
              >
                +hint
              </button>

              {/* Common special tags */}
              {activeTab === 'back' && (
                <button
                  type="button"
                  onClick={() => insertSnippet('{{FrontSide}}\n<hr id="answer">\n')}
                  className="px-2 py-0.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60 font-mono text-[11px] transition-colors"
                  title="Inserir {{FrontSide}} e divisor de resposta"
                >
                  +FrontSide
                </button>
              )}

              {/* Japanese Furigana Helper */}
              {noteType.fields.some((f) => f.name.toLowerCase().includes('read') || f.name.toLowerCase().includes('leit')) && (
                <button
                  type="button"
                  onClick={() => {
                    const readField = noteType.fields.find(
                      (f) => f.name.toLowerCase().includes('read') || f.name.toLowerCase().includes('leit')
                    );
                    insertSnippet(`{{furigana:${readField?.name || 'Reading'}}}`);
                  }}
                  className="px-2 py-0.5 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/60 font-mono text-[11px] transition-colors"
                  title="Furigana Anki: converte 漢字[かんじ] em ruby tags"
                >
                  +furigana
                </button>
              )}

              <button
                type="button"
                onClick={() => insertSnippet('{{voice:record}}')}
                className="px-2 py-0.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 border border-rose-200/60 dark:border-rose-800/60 font-mono text-[11px] transition-colors"
                title="Inserir botão de gravação de voz {{voice:record}}"
              >
                +voice:record
              </button>

              <button
                type="button"
                onClick={() => insertSnippet('{{voice:reproduce}}')}
                className="px-2 py-0.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 border border-indigo-200/60 dark:border-indigo-800/60 font-mono text-[11px] transition-colors"
                title="Inserir player de reprodução da sua voz gravada {{voice:reproduce}}"
              >
                +voice:reproduce
              </button>

              <button
                type="button"
                onClick={() => insertSnippet('<table align="center"><tr><td align="center">\n  \n</td></tr></table>')}
                className="px-1.5 py-0.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-mono text-[11px] transition-colors"
                title="Inserir estrutura de tabela centralizada"
              >
                +table
              </button>
            </div>

            {/* Code Textarea Area */}
            <div className="flex-1 p-3 overflow-hidden flex flex-col">
              {activeTab === 'front' && (
                <textarea
                  ref={frontTextareaRef}
                  value={currentTemplate.qfmt}
                  onChange={(e) => updateCurrentTemplate('qfmt', e.target.value)}
                  placeholder="Insira o HTML completo da Frente do card (ex: <table>...{{Sentence}}...</table>)"
                  spellCheck={false}
                  className="w-full h-full p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-mono text-zinc-900 dark:text-zinc-100 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
                />
              )}

              {activeTab === 'back' && (
                <textarea
                  ref={backTextareaRef}
                  value={currentTemplate.afmt}
                  onChange={(e) => updateCurrentTemplate('afmt', e.target.value)}
                  placeholder="Insira o HTML completo do Verso do card (ex: {{FrontSide}}<hr id=answer>{{furigana:Reading}}...)"
                  spellCheck={false}
                  className="w-full h-full p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-mono text-zinc-900 dark:text-zinc-100 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
                />
              )}

              {activeTab === 'css' && (
                <textarea
                  ref={cssTextareaRef}
                  value={cssCode}
                  onChange={(e) => setCssCode(e.target.value)}
                  placeholder="/* CSS aplicado aos cards */&#10;.card { text-align: center; font-family: sans-serif; font-size: 20px; }"
                  spellCheck={false}
                  className="w-full h-full p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-mono text-zinc-900 dark:text-zinc-100 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
                />
              )}
            </div>
          </div>

          {/* RIGHT: Real-time Live Preview */}
          <div className="flex flex-col h-full overflow-hidden bg-zinc-100/40 dark:bg-zinc-950/40">
            {/* Preview Controls */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-200/80 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                  Pré-visualização em Tempo Real (Preview)
                </span>
              </div>

              <div className="flex p-0.5 rounded-xl bg-zinc-200 dark:bg-zinc-800 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setPreviewMode('front')}
                  className={`px-3 py-1 rounded-lg transition-all ${
                    previewMode === 'front'
                      ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-zinc-500'
                  }`}
                >
                  Frente
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('back')}
                  className={`px-3 py-1 rounded-lg transition-all ${
                    previewMode === 'back'
                      ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-zinc-500'
                  }`}
                >
                  Verso
                </button>
              </div>
            </div>

            {/* Injected CSS and Rendered Card Container */}
            <div className="flex-1 p-6 overflow-y-auto">
              <div className="w-full min-h-[300px] p-6 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 shadow-lg text-zinc-900 dark:text-zinc-100 relative">
                {/* User CSS injection */}
                <style dangerouslySetInnerHTML={{ __html: cssCode }} />

                <div className="anki-rendered-preview leading-relaxed">
                  <CardContentRenderer
                    html={previewMode === 'front' ? renderedFront : renderedBack}
                    isPreview={true}
                  />
                </div>
              </div>

              {/* Sample values editor (collapsible) */}
              <div className="mt-4 p-3 rounded-2xl bg-zinc-200/60 dark:bg-zinc-900/60 text-xs">
                <div className="font-semibold text-zinc-600 dark:text-zinc-300 mb-2 text-[11px] uppercase tracking-wider">
                  Valores de Exemplo para o Preview:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {noteType.fields.map((f) => (
                    <div key={f.id} className="space-y-0.5">
                      <span className="text-[10px] text-zinc-400 font-mono">{f.name}:</span>
                      <input
                        type="text"
                        value={sampleValues[f.name] || ''}
                        onChange={(e) =>
                          setSampleValues((prev) => ({ ...prev, [f.name]: e.target.value }))
                        }
                        className="w-full px-2 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-800 dark:text-zinc-100 font-sans"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Actions Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/80">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-full text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-md transition-all active:scale-95"
          >
            <Check className="w-4 h-4" />
            <span>Salvar Templates HTML do Note Type</span>
          </button>
        </div>
      </div>

      <ConfirmationModal
        isOpen={templateToDeleteIdx !== null}
        onClose={() => setTemplateToDeleteIdx(null)}
        onConfirm={confirmDeleteTemplate}
        title="Excluir Template de Card?"
        description="Esta ação removerá este modelo gerador de cartões deste tipo de nota."
        highlightItem={
          templateToDeleteIdx !== null
            ? templates[templateToDeleteIdx]?.name || `Card ${templateToDeleteIdx + 1}`
            : undefined
        }
        confirmText="Excluir Template"
        cancelText="Cancelar"
        variant="danger"
      />
    </div>
  );
};
