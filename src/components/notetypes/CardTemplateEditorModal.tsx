import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  X,
  Code2,
  Eye,
  Plus,
  Trash2,
  Check,
  FileCode,
  Paintbrush,
  Maximize2,
  PanelRightClose,
  PanelRightOpen,
  Image as ImageIcon,
  Volume2,
  ChevronDown,
  ChevronUp,
  Search,
  Database,
} from 'lucide-react';
import { CardTemplate, NoteType, Note } from '../../types/runora';
import { ClozeService } from '../../services/clozeService';
import { StorageService } from '../../services/storage';
import { CardContentRenderer } from '../study/CardContentRenderer';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { useBodyScrollLock } from '../common/useBodyScrollLock';
import { CardListItem } from '../cards/CardListItem';
import {
  SAMPLE_AUDIO_DATA_URI,
  SAMPLE_IMAGE_DATA_URI,
  SampleFieldState,
  SampleMediaKind,
  clearSampleFields,
  emptySampleField,
  loadSampleFields,
  saveSampleFields,
} from '../../services/sampleMedia';

interface CardTemplateEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  noteType: NoteType;
  onSaved: () => void;
}

/** Largura do mini card: tamanho de celular (como o card real no estudo). */
const MINI_CARD_WIDTH = 'max-w-[360px]';
/** Largura do card na pré-visualização ampliada (overlay). */
const LARGE_CARD_WIDTH = 'max-w-[440px]';

export const CardTemplateEditorModal: React.FC<CardTemplateEditorModalProps> = ({
  isOpen,
  onClose,
  noteType,
  onSaved,
}) => {
  useBodyScrollLock(isOpen);
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

  /* ---------- Valores de exemplo ----------
   * Todos os campos começam EM BRANCO (sem heurística por nome de campo).
   * Os botões Image/Audio preenchem o campo com a mídia local embutida.
   * Ficam salvos por tipo de nota para não perder o trabalho do usuário.
   */
  const [sampleFields, setSampleFields] = useState<Record<string, SampleFieldState>>(() =>
    loadSampleFields(noteType.id)
  );
  const [samplesOpen, setSamplesOpen] = useState(true);

  /* ---------- Card Selector Modal ---------- */
  const [cardSelectorOpen, setCardSelectorOpen] = useState(false);
  const [cardSearch, setCardSearch] = useState('');

  /* ---------- Aviso (popup do app, no lugar do alert do navegador) ---------- */
  const [notice, setNotice] = useState<{ title: string; description: string } | null>(null);

  /* ---------- Layout do workspace ----------
   * - divisória arrastável entre editor e preview (30% .. 85% do editor)
   * - botão para recolher a coluna do preview (editor volta a 100%)
   * - botão "ampliar": abre a pré-visualização grande por cima (overlay)
   */
  const [editorPercent, setEditorPercent] = useState(62);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  // Persistir os valores de exemplo (o modal é desmontado ao fechar)
  useEffect(() => {
    saveSampleFields(noteType.id, sampleFields);
  }, [sampleFields, noteType.id]);

  // Sincronizar previewMode com a aba ativa do editor
  // Front tab -> preview frente; Back tab -> preview verso; CSS tab -> preview frente
  useEffect(() => {
    if (activeTab === 'front') setPreviewMode('front');
    else if (activeTab === 'back') setPreviewMode('back');
    else setPreviewMode('front');
  }, [activeTab]);

  // Divisória arrastável (pointer events — funciona com mouse e toque)
  useEffect(() => {
    if (!isResizing) return;
    const onMove = (ev: PointerEvent) => {
      const container = workspaceRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setEditorPercent(Math.min(85, Math.max(30, Math.round(pct))));
    };
    const onUp = () => setIsResizing(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = prevUserSelect;
    };
  }, [isResizing]);

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

  /* ---------- Valores de exemplo: helpers ---------- */

  const sampleValues = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [name, state] of Object.entries(sampleFields)) out[name] = state.value;
    return out;
  }, [sampleFields]);

  /** Preenche o campo com a mídia embutida (ou volta a texto vazio ao clicar de novo). */
  const toggleSampleMedia = (fieldName: string, kind: Exclude<SampleMediaKind, 'text'>) => {
    setSampleFields((prev) => {
      const current = prev[fieldName] ?? emptySampleField();
      const next = { ...prev };
      if (current.kind === kind) {
        next[fieldName] = emptySampleField();
      } else {
        next[fieldName] = {
          value: kind === 'image' ? SAMPLE_IMAGE_DATA_URI : SAMPLE_AUDIO_DATA_URI,
          kind,
        };
      }
      return next;
    });
  };

  const clearSampleField = (fieldName: string) => {
    setSampleFields((prev) => ({ ...prev, [fieldName]: emptySampleField() }));
  };

  const clearAllSamples = () => {
    setSampleFields({});
    clearSampleFields(noteType.id);
  };

  /** Abre o seletor de cards existentes. */
  const openCardSelector = () => {
    const allNotes = StorageService.getNotes();
    const notesOfType = allNotes.filter((n) => n.noteTypeId === noteType.id);
    if (notesOfType.length === 0) {
      setNotice({
        title: 'Nenhum card encontrado',
        description: 'Nenhum card criado para este tipo de nota.',
      });
      return;
    }
    setCardSearch('');
    setCardSelectorOpen(true);
  };

  /** Aplica os campos da nota selecionada como valores de exemplo. */
  const applyCardAsSample = (note: Note) => {
    const newFields: Record<string, SampleFieldState> = {};
    for (const f of noteType.fields) {
      const val = note.fields[f.name] ?? '';
      if (val && val.trim().length > 0) {
        newFields[f.name] = { value: val, kind: 'text' };
      }
    }
    if (Object.keys(newFields).length === 0) {
      setNotice({
        title: 'Nota sem conteúdo',
        description: 'A nota selecionada não tem campos preenchidos.',
      });
      return;
    }
    setSampleFields(newFields);
    setCardSelectorOpen(false);
  };

  /* ---------- Preview renderizado (ao vivo) ---------- */

  const renderedFront = useMemo(() => {
    return ClozeService.renderTemplate(currentTemplate.qfmt, sampleValues, false);
  }, [currentTemplate.qfmt, sampleValues]);

  const renderedBack = useMemo(() => {
    return ClozeService.renderTemplate(currentTemplate.afmt, sampleValues, true, renderedFront);
  }, [currentTemplate.afmt, sampleValues, renderedFront]);

  /**
   * Classes do wrapper do preview — EXATAMENTE as mesmas do card real
   * (StudyView). Assim, um CSS que mira .runora-front-wrapper se comporta
   * igual no editor e no estudo.
   */
  const previewWrapperClass =
    previewMode === 'front'
      ? 'runora-front-wrapper prose prose-zinc dark:prose-invert max-w-none text-zinc-900 dark:text-zinc-100 font-sans leading-relaxed'
      : 'runora-back-wrapper prose prose-zinc dark:prose-invert max-w-none text-zinc-900 dark:text-zinc-100 font-sans leading-relaxed ios-fade-in';

  const previewHtml = previewMode === 'front' ? renderedFront : renderedBack;

  /** Card de pré-visualização (mesma peça no mini e no ampli). */
  const renderPreviewCard = (maxWidth: string, isMini = false) => (
    <div
      className={`mx-auto w-full ${maxWidth} min-h-[160px] ${
        isMini ? 'px-3 py-4 rounded-2xl' : 'p-5 rounded-3xl'
      } bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 ${
        isMini ? 'shadow-sm' : 'shadow-lg'
      } text-zinc-900 dark:text-zinc-100`}
    >
      <div className={previewWrapperClass}>
        {/* disableAutoplay: no preview o áudio NÃO toca sozinho
            (hoje ele reiniciava a cada tecla digitada) */}
        <CardContentRenderer
          html={previewHtml}
          isPreview={true}
          disableAutoplay={true}
        />
      </div>
    </div>
  );

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
        {/* CSS do tipo de nota — injetado UMA vez, vale para o mini e o ampli */}
        {cssCode && <style dangerouslySetInnerHTML={{ __html: cssCode }} />}

        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <FileCode className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                  Editar Templates dos Cards (HTML &amp; CSS)
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

          <div className="hidden sm:flex items-center gap-1.5">
            <span className="text-[11px] text-zinc-400">Nome:</span>
            <input
              type="text"
              value={currentTemplate.name}
              onChange={(e) => updateCurrentTemplate('name', e.target.value)}
              className="px-2 py-0.5 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs w-32 font-medium"
            />
            {!previewCollapsed && (
              <button
                type="button"
                onClick={() => setPreviewCollapsed(true)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 transition-colors"
                title="Recolher a pré-visualização (o editor ocupa a largura toda)"
              >
                <PanelRightClose className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Main Workspace: Editor (esquerda) | divisória | Pré-visualização (direita) */}
        <div ref={workspaceRef} className="flex-1 flex overflow-hidden select-none">
          {/* ---------- ESQUERDA: Code & HTML Editor ---------- */}
          <div
            className="flex flex-col h-full overflow-hidden bg-zinc-50/50 dark:bg-zinc-950/30 min-w-0"
            style={{ width: previewCollapsed ? '100%' : `${editorPercent}%` }}
          >
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

              {/* Reabrir preview quando a coluna está recolhida */}
              {previewCollapsed && (
                <button
                  type="button"
                  onClick={() => setPreviewCollapsed(false)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/60 text-xs font-semibold transition-colors"
                  title="Mostrar a pré-visualização novamente"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Preview</span>
                </button>
              )}
            </div>

            {/* Field insertion helper buttons (não fazem sentido no CSS) */}
            {activeTab !== 'css' && (
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
                    title="Furigana: converte 漢字[かんじ] em ruby tags"
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
            )}

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

          {/* ---------- Divisória arrastável ---------- */}
          {!previewCollapsed && (
            <div
              role="separator"
              aria-orientation="vertical"
              onPointerDown={(e) => {
                e.preventDefault();
                setIsResizing(true);
              }}
              className={`w-1 shrink-0 cursor-col-resize transition-colors ${
                isResizing
                  ? 'bg-blue-500'
                  : 'bg-zinc-200 dark:bg-zinc-800 hover:bg-blue-400 dark:hover:bg-blue-500'
              }`}
              title="Arraste para redimensionar o editor e a pré-visualização"
            />
          )}

          {/* ---------- DIREITA: Pré-visualização ao vivo ---------- */}
          {!previewCollapsed && (
            <div className="flex-1 flex flex-col h-full overflow-hidden bg-zinc-100/40 dark:bg-zinc-950/40 min-w-0">
              {/* Preview Controls */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-200/80 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-blue-500" />
                  <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                    Pré-visualização
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setIsPreviewExpanded(true)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-white dark:hover:bg-zinc-800 transition-colors"
                  title="Ampliar a pré-visualização"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>

              {/* Mini card (tamanho de celular, como o card real no estudo) */}
              <div className="flex-1 overflow-y-auto p-4">
                {renderPreviewCard(MINI_CARD_WIDTH, true)}
              </div>

              {/* Gaveta: Valores de Exemplo */}
              <div className="border-t border-zinc-200/80 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60">
                <button
                  type="button"
                  onClick={() => setSamplesOpen((open) => !open)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                  title="Valores usados na pré-visualização"
                >
                  <span>Valores de Exemplo do Preview</span>
                  {samplesOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                </button>

                {samplesOpen && (
                  <div className="px-4 pb-3">
                    <div className="max-h-[190px] overflow-y-auto pr-1 space-y-2.5">
                      {noteType.fields.map((f) => {
                        const state = sampleFields[f.name] ?? emptySampleField();
                        const isActiveImage = state.kind === 'image';
                        const isActiveAudio = state.kind === 'audio';
                        return (
                          <div key={f.id} className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] text-zinc-400 font-mono truncate">
                                {f.name}
                              </span>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => toggleSampleMedia(f.name, 'image')}
                                  className={`p-1.5 rounded-lg border transition-colors ${
                                    isActiveImage
                                      ? 'bg-violet-500/15 border-violet-400/40 text-violet-600 dark:text-violet-300'
                                      : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-violet-600 dark:hover:text-violet-300'
                                  }`}
                                  title={isActiveImage ? 'Remover a imagem de exemplo' : 'Usar imagem de exemplo (embutida no app)'}
                                >
                                  <ImageIcon className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleSampleMedia(f.name, 'audio')}
                                  className={`p-1.5 rounded-lg border transition-colors ${
                                    isActiveAudio
                                      ? 'bg-sky-500/15 border-sky-400/40 text-sky-600 dark:text-sky-300'
                                      : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-sky-600 dark:hover:text-sky-300'
                                  }`}
                                  title={isActiveAudio ? 'Remover o áudio de exemplo' : 'Usar áudio de exemplo (embutido no app)'}
                                >
                                  <Volume2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>

                            {/* Campo: texto livre, ou chip de mídia de exemplo */}
                            {isActiveImage ? (
                              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-violet-50 dark:bg-violet-950/30 border border-violet-200/70 dark:border-violet-800/50 text-[11px] text-violet-700 dark:text-violet-300">
                                <ImageIcon className="w-3.5 h-3.5 shrink-0" />
                                <span className="flex-1 truncate">Imagem de exemplo (embutida)</span>
                                <button
                                  type="button"
                                  onClick={() => clearSampleField(f.name)}
                                  className="p-0.5 rounded hover:bg-violet-500/20 transition-colors"
                                  title="Voltar para texto vazio"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ) : isActiveAudio ? (
                              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200/70 dark:border-sky-800/50 text-[11px] text-sky-700 dark:text-sky-300">
                                <Volume2 className="w-3.5 h-3.5 shrink-0" />
                                <span className="flex-1 truncate">Áudio de exemplo (embutido)</span>
                                <button
                                  type="button"
                                  onClick={() => clearSampleField(f.name)}
                                  className="p-0.5 rounded hover:bg-sky-500/20 transition-colors"
                                  title="Voltar para texto vazio"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <input
                                type="text"
                                value={state.value}
                                onChange={(e) =>
                                  setSampleFields((prev) => ({
                                    ...prev,
                                    [f.name]: { value: e.target.value, kind: 'text' },
                                  }))
                                }
                                placeholder="(vazio)"
                                className="w-full px-2 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-800 dark:text-zinc-100 font-sans focus:outline-none focus:ring-1 focus:ring-blue-400"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex justify-end gap-2 mt-2">
                      <button
                        type="button"
                        onClick={openCardSelector}
                        className="px-2 py-1 rounded-lg text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                        title="Escolher um card existente deste tipo de nota para usar como exemplo"
                      >
                        Usar card existente
                      </button>
                      <button
                        type="button"
                        onClick={clearAllSamples}
                        className="px-2 py-1 rounded-lg text-[10px] font-semibold text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                        title="Zerar todos os valores de exemplo"
                      >
                        Limpar todos
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
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

      {/* Pré-visualização ampliada (overlay por cima do editor) */}
      {isPreviewExpanded && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-md p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setIsPreviewExpanded(false);
          }}
        >
          <div className="w-full max-w-2xl max-h-[92vh] flex flex-col bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-blue-500" />
                <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Pré-visualização ampliada
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-semibold">
                  ao vivo
                </span>
              </div>
              <div className="flex items-center gap-1.5">
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
                <button
                  type="button"
                  onClick={() => setIsPreviewExpanded(false)}
                  className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  title="Fechar a pré-visualização ampliada"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-zinc-100/40 dark:bg-zinc-950/40">
              {renderPreviewCard(LARGE_CARD_WIDTH)}
            </div>
          </div>
        </div>
      )}

      {/* Card Selector Modal */}
      {cardSelectorOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-md animate-in fade-in duration-150">
          <div className="w-full max-w-2xl max-h-[85vh] bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-blue-500" />
                <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Escolher card como exemplo
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-semibold">
                  {noteType.name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCardSelectorOpen(false)}
                className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search */}
            <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-950/30">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <input
                  type="text"
                  value={cardSearch}
                  onChange={(e) => setCardSearch(e.target.value)}
                  placeholder="Filtrar por qualquer campo..."
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Cards List */}
            <div className="flex-1 overflow-y-auto p-3">
              {(() => {
                const allNotes = StorageService.getNotes();
                const notesOfType = allNotes.filter((n) => n.noteTypeId === noteType.id);
                const filtered = notesOfType.filter((note) => {
                  if (!cardSearch.trim()) return true;
                  const q = cardSearch.toLowerCase();
                  return Object.values(note.fields).some((v) =>
                    String(v).toLowerCase().includes(q)
                  );
                });

                if (filtered.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-400">
                      <Database className="w-12 h-12 mb-3 opacity-50" />
                      <p className="text-sm">
                        {cardSearch.trim()
                          ? 'Nenhum card encontrado com esse filtro'
                          : 'Nenhum card disponível'}
                      </p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-1 divide-y divide-black/[0.05] dark:divide-white/[0.07]">
                    {filtered.map((note) => (
                      <CardListItem
                        key={note.id}
                        note={note}
                        noteType={noteType}
                        card={null}
                        onSelect={applyCardAsSample}
                        chosenFields={noteType.fields.map((f) => f.name)}
                        className="px-1"
                      />
                    ))}
                  </div>
                );
              })()}
            </div>

            <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
              <button
                type="button"
                onClick={() => setCardSelectorOpen(false)}
                className="w-full px-4 py-2 rounded-xl text-sm font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Aviso informativo (no lugar do alert do navegador) */}
      <ConfirmationModal
        isOpen={notice !== null}
        onClose={() => setNotice(null)}
        onConfirm={() => setNotice(null)}
        title={notice?.title ?? ''}
        description={notice?.description ?? ''}
        confirmText="Entendi"
        showCancelButton={false}
        variant="info"
      />
    </div>
  );
};
