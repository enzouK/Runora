import React, { useState, useEffect } from 'react';
import {
  X,
  Check,
  CalendarClock,
  Sparkle,
  RotateCcw,
  GraduationCap,
  ListOrdered,
  ArrowDownUp,
  AlertTriangle,
  BellRing,
  Hand,
  ArrowUpDown,
  Layers,
  Blend,
  TimerReset,
  SortAsc,
  Volume2,
  Hourglass,
  HelpCircle,
  ChevronDown,
  Plus,
  Copy,
  Pencil,
  Trash2,
} from 'lucide-react';
import {
  Deck,
  DisplayOrderConfig,
  InsertionOrder,
  LeechAction,
  MixOrder,
  NewGatherOrder,
  NewSortOrder,
  Preset,
  ReviewSortOrder,
} from '../../types/anki';
import { StorageService } from '../../services/storage';
import { IOSSelect } from '../common/IOSSelect';
import { HelpPanel, HelpTopic } from '../common/HelpPanel';

type HelpSectionId =
  | 'name'
  | 'description'
  | 'preset'
  | 'fsrs'
  | 'interval'
  | 'limits'
  | 'newcards'
  | 'lapses'
  | 'audio'
  | 'displayorder';

/** Anki-style scope switcher: the values live on the preset sheet or on this deck only. */
const ScopeSwitch: React.FC<{
  value: 'preset' | 'deck';
  onChange: (v: 'preset' | 'deck') => void;
}> = ({ value, onChange }) => (
  <div className="flex shrink-0 rounded-full bg-black/[0.06] dark:bg-white/[0.09] p-0.5 ml-auto">
    {([['preset', 'Preset'], ['deck', 'Este deck']] as const).map(([id, label]) => (
      <button
        key={id}
        type="button"
        onClick={() => onChange(id)}
        className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide transition-colors ${
          value === id
            ? 'bg-white dark:bg-zinc-700 text-ios-blue shadow-sm'
            : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
        }`}
      >
        {label}
      </button>
    ))}
  </div>
);

const HELP_SECTIONS: Record<
  HelpSectionId,
  { label: string; topics: HelpTopic[]; showIndex?: boolean }
> = {
  name: {
    label: 'Nome do Deck',
    showIndex: false,
    topics: [
      {
        label: 'Nome do Deck',
        content: (
          <p>
            Use "::" entre os nomes para criar subdecks — ex.: "Biologia::Celular" cria o deck
            "Biologia" com "Celular" dentro dele.
          </p>
        ),
      },
    ],
  },
  description: {
    label: 'Descrição',
    showIndex: false,
    topics: [
      {
        label: 'Descrição',
        content: (
          <p>Um resumo do objetivo deste deck. Ele aparece na aba Decks, logo abaixo do nome.</p>
        ),
      },
    ],
  },
  preset: {
    label: 'Preset',
    showIndex: false,
    topics: [
      {
        label: 'Preset',
        content: (
          <>
            <p>
              Um preset é uma folha de configurações compartilhada: limites diários, Novos Cards,
              Lapses, Ordem de Exibição, Áudio e os parâmetros FSRS de deck (retenção desejada e
              intervalo máximo). Todos os decks ligados ao mesmo preset recebem as mesmas opções —
              alterar em um deck afeta todos os outros, em qualquer parte da árvore.
            </p>
            <p>
              O seletor no topo do Editar Deck escolhe o preset deste deck (a contagem entre
              parênteses mostra quantos decks o usam). No botão "Editar ▾" ao lado, o menu de
              gerenciamento tem: Adicionar Preset, que cria um preset novo com os valores padrão do
              app; Clonar Preset, que copia os valores atuais da tela para um preset novo; Renomear
              Preset, que muda apenas o nome; e Remover Preset, que exclui a folha e reúne seus decks
              no preset de fábrica "Padrão", que é permanente.
            </p>
          </>
        ),
      },
    ],
  },
  fsrs: {
    label: 'FSRS',
    topics: [
      {
        label: 'Retenção desejada',
        content: (
          <p>
            Por padrão, o Anki agenda os cards para que você tenha 90% de chance de lembrá-los
            quando voltarem à revisão. Se você aumentar esse valor, o Anki mostrará os cards com
            mais frequência para aumentar as chances de memorização. Se diminuir, os cards
            aparecerão com menos frequência e você esquecerá mais deles. Seja conservador ao
            ajustar — valores altos aumentarão muito sua carga de estudo, e valores baixos podem
            ser desanimadores quando você esquece muito material.
          </p>
        ),
      },
    ],
  },
  interval: {
    label: 'Intervalo Máximo',
    topics: [
      {
        label: 'Máx. dias por intervalo',
        content: (
          <p>
            O número máximo de dias que um card de revisão vai esperar antes de aparecer de
            novo. Quando as revisões atingem esse limite, Difícil, Bom e Fácil passam a dar o
            mesmo intervalo. Quanto menor o valor definido, maior será sua carga de estudo.
          </p>
        ),
      },
    ],
  },
  limits: {
    label: 'Limites Diários',
    topics: [
      {
        label: 'Novos cards/dia',
        content: (
          <>
            <p>
              O número máximo de cards novos a introduzir em um dia, se houver cards novos
              disponíveis. Como material novo aumentará sua carga de revisão de curto prazo,
              isso normalmente deve ser pelo menos 10x menor que o seu limite de revisões.
            </p>
            <p>
              Ao estudar um deck que tem subdecks, os limites definidos em cada subdeck controlam
              o número máximo de cards coletados daquele deck em particular. Os limites do deck
              selecionado controlam o total de cards que será mostrado.
            </p>
          </>
        ),
      },
      {
        label: 'Máx. revisões/dia',
        content: (
          <>
            <p>
              O número máximo de cards de revisão a mostrar em um dia, se houver cards prontos
              para revisão.
            </p>
            <p>
              O limite de revisão também afeta os cards de aprendizado que cruzam a virada do
              dia (interday). Ao aplicar o limite, os cards de aprendizado interday são
              coletados primeiro, depois os cards de revisão.
            </p>
            <p>
              Ao estudar um deck que tem subdecks, os limites definidos em cada subdeck controlam
              o número máximo de cards coletados daquele deck em particular. Os limites do deck
              selecionado controlam o total de cards que será mostrado.
            </p>
          </>
        ),
      },
    ],
  },
  newcards: {
    label: 'Novos Cards',
    topics: [
      {
        label: 'Passos de aprendizagem',
        content: (
          <>
            <p>
              Um ou mais atrasos, separados por espaços. O primeiro atraso será usado quando
              você pressionar o botão Errei em um card novo, e é de 1 minuto por padrão. O botão
              Bom avançará para o próximo passo, que é de 10 minutos por padrão. Uma vez que
              todos os passos tenham sido cumpridos, o card se tornará um card de revisão e
              aparecerá em um dia diferente.
            </p>
            <p>
              Os atrasos são tipicamente minutos (ex.: 1m) ou dias (ex.: 2d), mas horas (ex.:
              1h) e segundos (ex.: 30s) também são suportados.
            </p>
          </>
        ),
      },
      {
        label: 'Ordem de inserção',
        content: (
          <>
            <p>
              Controla a posição (due #) dos cards novos. Cards com posição menor aparecem
              primeiro ao estudar. A posição é atribuída quando você adiciona cards — e, ao
              alterar esta opção, as posições de todos os cards ainda não estudados são
              reatribuídas, no deck e em seus subdecks.
            </p>
            <ul className="mt-1 space-y-1 list-disc pl-5">
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Sequencial:
                </span>{' '}
                atribui posições seguindo a ordem em que os cards foram criados.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Aleatório:
                </span>{' '}
                atribui posições sorteadas ao acaso — a ordem fica valendo até você alterar a
                opção de novo.
              </li>
            </ul>
          </>
        ),
      },
    ],
  },
  lapses: {
    label: 'Lapses (Cards Esquecidos)',
    topics: [
      {
        label: 'Passos de reaprendizagem',
        content: (
          <>
            <p>
              Define os atrasos que um card de revisão cumpre após você marcar como Errei. Por
              padrão, o card reaparece 10 minutos depois.
            </p>
            <p>
              Os atrasos são separados por espaço e usam minutos (ex.: 1m) ou dias (ex.: 2d) —
              horas (ex.: 1h) e segundos (ex.: 30s) também são suportados.
            </p>
          </>
        ),
      },
      {
        label: 'Limite de leech',
        content: (
          <p>
            O número de vezes que o botão Errei precisa ser pressionado em um card de revisão
            antes de ele ser marcado como leech. Leeches são cards que consomem muito do seu
            tempo — e quando um card é marcado como leech, é uma boa ideia reescrevê-lo,
            excluí-lo ou pensar em um mnemônico para ajudá-lo a lembrar.
          </p>
        ),
      },
      {
        label: 'Ação de leech',
        content: (
          <>
            <p>Quando o limite for atingido:</p>
            <ul className="mt-1 space-y-1 list-disc pl-5">
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">Suspender:</span>{' '}
                Além de etiquetar a nota, oculta o card até que ele seja reativado manualmente.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">Etiquetar:</span>{' '}
                Adiciona a tag 'leech' à nota e exibe um pop-up.
              </li>
            </ul>
          </>
        ),
      },
    ],
  },
  audio: {
    label: 'Áudio',
    topics: [
      {
        label: 'Reproduzir áudio automaticamente',
        content: (
          <>
            <p>
              Como os áudios dos cards se comportam quando a pergunta ou a resposta aparece.
            </p>
            <ul className="mt-1 space-y-1 list-disc pl-5">
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">Sim:</span> toca
                o áudio automaticamente.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">Não:</span> toca
                apenas quando você aperta o play.
              </li>
            </ul>
          </>
        ),
      },
    ],
  },
  displayorder: {
    label: 'Ordem de Exibição',
    topics: [
      {
        label: 'Coleta de novos cards',
        content: (
          <>
            <p>
              Reúne, do deck selecionado e de seus subdecks, os cards novos que entrarão na fila
              de hoje.
            </p>
            <ul className="mt-1 space-y-1 list-disc pl-5">
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">Deck:</span>{' '}
                reúne os cards subdeck por subdeck, na ordem em que os subdecks foram criados.
                Dentro de cada subdeck, aplica a sua Ordem de inserção (sequencial ou aleatória).
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Deck, depois notas aleatórias:
                </span>{' '}
                percorre os subdecks na mesma ordem acima, mas sorteia as notas dentro de cada
                um — os cards de cada nota continuam juntos.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Posição crescente:
                </span>{' '}
                coleta pela posição crescente — normalmente os cards mais antigos primeiro.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Posição decrescente:
                </span>{' '}
                coleta pela posição decrescente — os cards mais recentes primeiro.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Notas aleatórias:
                </span>{' '}
                sorteia notas ao acaso e coleta todos os cards de cada uma, mantendo os cards da
                mesma nota juntos.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Cards aleatórios:
                </span>{' '}
                coleta todos os cards em ordem aleatória.
              </li>
            </ul>
            <p className="mt-1">
              Quando o limite diário de novos cards é atingido, a coleta para — nem todos os
              subdecks chegam a ser verificados. A Ordem de Exibição usada é sempre a do deck que
              você seleciona para estudar (herdando do pai), e não a dos subdecks.
            </p>
          </>
        ),
      },
      {
        label: 'Ordem dos novos cards',
        content: (
          <>
            <p>
              Define como os cards novos são apresentados na fila, depois de coletados.
            </p>
            <ul className="mt-1 space-y-1 list-disc pl-5">
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Tipo de card, depois coletado:
                </span>{' '}
                organiza por tipo de card — todos os cards frente→verso primeiro, depois os
                verso→frente; dentro de cada tipo, na ordem em que foram coletados. Os cards da
                mesma nota aparecem na mesma sessão, mas não em cima um do outro.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Ordem coletada:
                </span>{' '}
                mostra os cards exatamente na ordem em que foram coletados — normalmente os
                cards de uma nota aparecem um logo após o outro.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Tipo de card, depois aleatório:
                </span>{' '}
                organiza por tipo de card (todos os frente→verso, depois os verso→frente) e
                embaralha dentro de cada tipo — evita irmãos aparecendo em sequência, mas ainda
                com um grau de aleatoriedade.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Nota aleatória, depois tipo de card:
                </span>{' '}
                sorteia notas ao acaso e mostra todos os cards de cada uma em sequência — os
                irmãos aparecem juntos.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Cards aleatórios:
                </span>{' '}
                mostra todos os cards em ordem aleatória.
              </li>
            </ul>
            <p className="mt-1">
              A ordem usada é sempre a do deck que você seleciona para estudar (herdando do
              pai), e não a dos subdecks.
            </p>
          </>
        ),
      },
      {
        label: 'Novos / Revisões',
        content: (
          <>
            <p>
              Define quando os cards novos aparecem em relação às revisões.
            </p>
            <ul className="mt-1 space-y-1 list-disc pl-5">
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Misturar com revisões:
                </span>{' '}
                embaralha os cards com as revisões.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Mostrar depois das revisões:
                </span>{' '}
                os cards entram depois de revisões.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Mostrar antes das revisões:
                </span>{' '}
                os cards entram antes de revisões.
              </li>
            </ul>
          </>
        ),
      },
      {
        label: 'Aprendizado interdiário / Revisões',
        content: (
          <>
            <p>
              Define a ordem em que os cards em (re)aprendizado que cruzam a virada do dia —
              cujos passos terminam somente em outro dia — aparecem em relação às revisões.
            </p>
            <ul className="mt-1 space-y-1 list-disc pl-5">
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Misturar com revisões:
                </span>{' '}
                embaralha os cards com as revisões.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Mostrar depois das revisões:
                </span>{' '}
                os cards entram depois de revisões.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Mostrar antes das revisões:
                </span>{' '}
                os cards entram antes de revisões.
              </li>
            </ul>
            <p className="mt-1">
              No app, os interdiários entram na contagem do limite diário de revisões e são
              coletados antes delas — quando o limite acaba, são as revisões que ficam de
              fora. Esta opção controla apenas a ordem em que aparecem na fila. A ordem usada
              é sempre a do deck que você seleciona para estudar (herdando do pai), e não a
              dos subdecks.
            </p>
          </>
        ),
      },
      {
        label: 'Ordem das revisões',
        content: (
          <>
            <p>Define como as revisões são ordenadas na fila.</p>
            <ul className="mt-1 space-y-1 list-disc pl-5">
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Vencimento, depois aleatório:
                </span>{' '}
                os cards com vencimento mais próximo primeiro — entre cards do mesmo dia vale
                uma ordem aleatória. O padrão e o recomendado: a aleatoriedade evita que a
                ordem fixa denuncie a resposta.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Vencimento crescente:
                </span>{' '}
                os cards com vencimento mais próximo primeiro — entre cards do mesmo dia vale
                a ordem em que foram coletados.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Vencimento decrescente:
                </span>{' '}
                os cards com vencimento mais distante primeiro — entre cards do mesmo dia vale
                a ordem em que foram coletados.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Vencimento, depois deck:
                </span>{' '}
                os cards com vencimento mais próximo primeiro — os empates de vencimento são
                resolvidos pelo nome do subdeck.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Deck, depois vencimento:
                </span>{' '}
                os subdecks em ordem alfabética primeiro e, dentro de cada um, o vencimento
                mais próximo primeiro — não recomendado: a ordem fixa denuncia a resposta pelo
                contexto.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Intervalo crescente:
                </span>{' '}
                os intervalos mais curtos primeiro — você resolve os cards mais urgentes antes.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Intervalo decrescente:
                </span>{' '}
                os intervalos mais longos primeiro — você resolve os cards mais urgentes por
                último.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Facilidade crescente:
                </span>{' '}
                os mais difíceis primeiro — no app usa a dificuldade estimada pelo FSRS, no
                lugar da facilidade do Anki.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Facilidade decrescente:
                </span>{' '}
                os mais fáceis primeiro — no app usa a dificuldade estimada pelo FSRS, no
                lugar da facilidade do Anki.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Retrievabilidade crescente:
                </span>{' '}
                os mais perto de ser esquecidos primeiro — o recomendado para limpar acúmulos
                pendentes (equivalente FSRS do "Relative overdueness").
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Aleatório:
                </span>{' '}
                ordem totalmente aleatória.
              </li>
            </ul>
            <p className="mt-1">
              A ordem usada é sempre a do deck que você seleciona para estudar (herdando do
              pai), e não a dos subdecks.
            </p>
          </>
        ),
      },
    ],
  },
};

interface DeckModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  editDeck?: Deck | null;
  parentDeckName?: string;
}

export const DeckModal: React.FC<DeckModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  editDeck,
  parentDeckName,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetRetention, setTargetRetention] = useState(0.90);
  const [maxInterval, setMaxInterval] = useState('36500');
  const [helpSection, setHelpSection] = useState<HelpSectionId | null>(null);
  const [newCardsPerDay, setNewCardsPerDay] = useState('20');
  const [maxReviewsPerDay, setMaxReviewsPerDay] = useState('200');
  // Scheduler options — always show the REAL effective values (no 'Padrão' pseudo-option)
  const [learningSteps, setLearningSteps] = useState('1m 10m');
  const [insertionOrder, setInsertionOrder] = useState<InsertionOrder>('sequential');
  const [relearningSteps, setRelearningSteps] = useState('10m');
  const [leechThreshold, setLeechThreshold] = useState('8');
  const [leechAction, setLeechAction] = useState<LeechAction>('suspend');
  const [newGatherOrder, setNewGatherOrder] = useState<NewGatherOrder>('deck');
  const [newSortOrder, setNewSortOrder] = useState<NewSortOrder>('template');
  const [newReviewOrder, setNewReviewOrder] = useState<MixOrder>('mix');
  const [learnReviewOrder, setLearnReviewOrder] = useState<MixOrder>('mix');
  const [reviewSortOrder, setReviewSortOrder] = useState<ReviewSortOrder>('dueRandom');
  const [audioAutoplay, setAudioAutoplay] = useState<'play' | 'dont'>('play');
  // Preset ("options sheet") selected for this deck — the values on screen are
  // its editable copy, saved back when "Salvar" is pressed
  const [presetList, setPresetList] = useState<Preset[]>([]);
  const [presetId, setPresetId] = useState('');
  // Anki-style preset management: ▾ menu + dimmed popups for add/clone/rename/remove
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [presetPrompt, setPresetPrompt] = useState<null | { mode: 'add' | 'clone' | 'rename'; value: string }>(null);
  const [presetDeleteOpen, setPresetDeleteOpen] = useState(false);
  // Anki-style section scopes: edit the preset sheet or just this deck
  const [limitScope, setLimitScope] = useState<'preset' | 'deck'>('preset');
  const [fsrsScope, setFsrsScope] = useState<'preset' | 'deck'>('preset');

  // Populate every option input from a preset sheet
  const applyPreset = (p: Preset) => {
    setTargetRetention(p.fsrsParams.requestRetention);
    setMaxInterval(String(p.fsrsParams.maximumInterval));
    setNewCardsPerDay(String(p.dailyLimits.newCardsPerDay));
    setMaxReviewsPerDay(String(p.dailyLimits.maxReviewsPerDay));
    setLearningSteps(p.schedulerConfig.learningSteps);
    setInsertionOrder(p.schedulerConfig.insertionOrder);
    setRelearningSteps(p.schedulerConfig.relearningSteps);
    setLeechThreshold(String(p.schedulerConfig.leechThreshold));
    setLeechAction(p.schedulerConfig.leechAction);
    setNewGatherOrder(p.displayOrder.newGatherOrder ?? 'deck');
    setNewSortOrder(p.displayOrder.newSortOrder ?? 'template');
    setNewReviewOrder(p.displayOrder.newReviewOrder ?? 'mix');
    setLearnReviewOrder(p.displayOrder.learnReviewOrder ?? 'mix');
    setReviewSortOrder(p.displayOrder.reviewSortOrder ?? 'dueRandom');
    setAudioAutoplay(p.audioConfig.disableAutoplay ? 'dont' : 'play');
  };

  /** Switch presets while the modal is open — reloads that preset's options. */
  const handleSelectPreset = (id: string) => {
    const found = presetList.find((p) => p.id === id);
    if (!found) return;
    setPresetId(found.id);
    applyPreset(found);
    // "This deck" overrides stay in effect over whichever preset is chosen
    applyDeckScope(found);
  };

  /** Re-apply the deck's "This deck" overrides (if any) on top of a preset sheet. */
  const applyDeckScope = (base: Preset) => {
    const decks = StorageService.getDecks();
    const baseId = editDeck
      ? editDeck.id
      : parentDeckName
        ? decks.find((d) => d.name === parentDeckName)?.id
        : undefined;
    const deckObj = baseId ? decks.find((d) => d.id === baseId) : undefined;
    if (deckObj?.dailyLimitsOverride) {
      setLimitScope('deck');
      setNewCardsPerDay(String(deckObj.dailyLimitsOverride.newCardsPerDay));
      setMaxReviewsPerDay(String(deckObj.dailyLimitsOverride.maxReviewsPerDay));
    } else {
      setLimitScope('preset');
      setNewCardsPerDay(String(base.dailyLimits.newCardsPerDay));
      setMaxReviewsPerDay(String(base.dailyLimits.maxReviewsPerDay));
    }
    if (deckObj?.fsrsOverride) {
      setFsrsScope('deck');
      setTargetRetention(deckObj.fsrsOverride.requestRetention);
      setMaxInterval(String(deckObj.fsrsOverride.maximumInterval));
    } else {
      setFsrsScope('preset');
      setTargetRetention(base.fsrsParams.requestRetention);
      setMaxInterval(String(base.fsrsParams.maximumInterval));
    }
  };

  /** Resolve a numeric option, falling back when the input is empty/invalid */
  const parseOption = (value: string, fallback: number): number => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  /** Build an entire preset sheet from the current on-screen inputs (Salvar / Clone). */
  const buildPresetFromInputs = (base: Preset): Preset => {
    const parsedMaxInterval = parseInt(maxInterval, 10);
    return {
      ...base,
      dailyLimits: {
        newCardsPerDay: parseOption(newCardsPerDay, StorageService.DEFAULT_DAILY_LIMITS.newCardsPerDay),
        maxReviewsPerDay: parseOption(maxReviewsPerDay, StorageService.DEFAULT_DAILY_LIMITS.maxReviewsPerDay),
      },
      schedulerConfig: {
        learningSteps: learningSteps.trim() || '1m 10m',
        insertionOrder,
        relearningSteps: relearningSteps.trim() || '10m',
        leechThreshold:
          parseOption(leechThreshold, StorageService.DEFAULT_SCHEDULER.leechThreshold) ||
          StorageService.DEFAULT_SCHEDULER.leechThreshold,
        leechAction,
      },
      displayOrder: {
        newGatherOrder,
        newSortOrder,
        newReviewOrder,
        learnReviewOrder,
        reviewSortOrder,
      },
      audioConfig: { disableAutoplay: audioAutoplay === 'dont' },
      fsrsParams: {
        requestRetention: targetRetention,
        maximumInterval:
          Number.isFinite(parsedMaxInterval) && parsedMaxInterval > 0
            ? parsedMaxInterval
            : StorageService.getFSRSSettings().maximumInterval,
      },
      updatedAt: Date.now(),
    };
  };

  /** Add: a new preset with the app defaults (niche values are edited afterwards). */
  const handleAddPreset = (newName: string) => {
    const p = StorageService.createPreset(newName);
    setPresetList(StorageService.getPresets());
    setPresetId(p.id);
    applyPreset(p);
  };

  /** Clone: a new preset capturing the values currently on screen. */
  const handleClonePreset = (newName: string) => {
    const source = presetId ? StorageService.getPresetById(presetId) : null;
    if (!source) return;
    const clone: Preset = {
      ...buildPresetFromInputs(source),
      id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: newName,
      createdAt: Date.now(),
    };
    StorageService.upsertPreset(clone);
    setPresetList(StorageService.getPresets());
    setPresetId(clone.id);
    applyPreset(clone);
  };

  /** Rename: commits right away (only the name changes, not the options). */
  const handleRenamePreset = (newName: string) => {
    const p = presetId ? StorageService.getPresetById(presetId) : null;
    if (!p) return;
    StorageService.upsertPreset({ ...p, name: newName });
    setPresetList(StorageService.getPresets());
  };

  /** Remove: linked decks re-link to the factory "Padrão" preset. */
  const handleRemovePreset = () => {
    const removedId = presetId;
    StorageService.deletePreset(removedId);
    const list = StorageService.getPresets();
    setPresetList(list);
    const fallback = list.find((p) => p.id === StorageService.DEFAULT_PRESET_ID)!;
    setPresetId(fallback.id);
    applyPreset(fallback);
  };

  /** Commit the naming popup (Add / Clone / Rename). */
  const confirmPresetPrompt = () => {
    if (!presetPrompt) return;
    const trimmed = presetPrompt.value.trim();
    if (!trimmed) return;
    if (presetPrompt.mode === 'add') handleAddPreset(trimmed);
    else if (presetPrompt.mode === 'clone') handleClonePreset(trimmed);
    else handleRenamePreset(trimmed);
    setPresetPrompt(null);
  };

  const PRESET_PROMPT_META: Record<'add' | 'clone' | 'rename', { title: string; subtitle: string }> = {
    add: { title: 'Adicionar Preset', subtitle: 'Cria um preset novo com os valores padrão do app.' },
    clone: { title: 'Clonar Preset', subtitle: 'Cria um preset novo com uma cópia dos valores atuais na tela.' },
    rename: { title: 'Renomear Preset', subtitle: 'Renomeia o preset selecionado; os decks ligados a ele não mudam.' },
  };

  useEffect(() => {
    if (!isOpen) {
      setHelpSection(null);
      return;
    }
    setPresetMenuOpen(false);
    setPresetPrompt(null);
    setPresetDeleteOpen(false);
    const decks = StorageService.getDecks();
    setPresetList(StorageService.getPresets());

    const baseId = editDeck
      ? editDeck.id
      : parentDeckName
        ? decks.find((d) => d.name === parentDeckName)?.id
        : undefined;

    // The deck's linked preset is the single source of truth — no lineage walk
    const preset = baseId
      ? StorageService.getDeckPreset(baseId)
      : StorageService.getPresetById(StorageService.DEFAULT_PRESET_ID)!;
    setPresetId(preset.id);
    applyPreset(preset);

    // "This deck" scopes: deck overrides take priority over the preset's values
    const deckObj = baseId ? decks.find((d) => d.id === baseId) : undefined;
    if (deckObj?.dailyLimitsOverride) {
      setLimitScope('deck');
      setNewCardsPerDay(String(deckObj.dailyLimitsOverride.newCardsPerDay));
      setMaxReviewsPerDay(String(deckObj.dailyLimitsOverride.maxReviewsPerDay));
    } else {
      setLimitScope('preset');
    }
    if (deckObj?.fsrsOverride) {
      setFsrsScope('deck');
      setTargetRetention(deckObj.fsrsOverride.requestRetention);
      setMaxInterval(String(deckObj.fsrsOverride.maximumInterval));
    } else {
      setFsrsScope('preset');
    }

    if (editDeck) {
      setName(editDeck.name);
      setDescription(editDeck.description);
    } else if (parentDeckName) {
      setName(`${parentDeckName}::`);
      setDescription('');
    } else {
      setName('');
      setDescription('');
    }
  }, [isOpen, editDeck, parentDeckName]);

  const handleSave = () => {
    if (!name.trim()) return;

    const decks = StorageService.getDecks();
    // Insertion order before this save — used to detect a mode change below
    const prevInsertionOrder = editDeck
      ? StorageService.getEffectiveSchedulerConfig(editDeck.id).insertionOrder
      : null;

    const presetBase = presetId ? StorageService.getPresetById(presetId) : null;
    if (!presetBase) return; // the top selector always holds a stored preset
    const preset = buildPresetFromInputs(presetBase);
    // Sections scoped to "Este deck" leave the shared preset values untouched
    if (limitScope !== 'preset') preset.dailyLimits = { ...presetBase.dailyLimits };
    if (fsrsScope !== 'preset') preset.fsrsParams = { ...presetBase.fsrsParams };
    StorageService.upsertPreset(preset);

    // Mirror the preset sheet onto the deck's legacy option fields so studies,
    // counts and other consumers keep working until the phase-4 switchover.
    const legacyConfig = {
      fsrsParams: { ...preset.fsrsParams },
      dailyLimits: { ...preset.dailyLimits },
      schedulerConfig: { ...preset.schedulerConfig },
      displayOrder: { ...preset.displayOrder },
      audioConfig: { ...preset.audioConfig },
    };

    // "Este deck" scoped values — written on the deck, never on the preset
    const parsedMaxIntervalForDeck = parseInt(maxInterval, 10);
    const deckScoped = {
      dailyLimitsOverride:
        limitScope === 'deck'
          ? {
              newCardsPerDay: parseOption(newCardsPerDay, StorageService.DEFAULT_DAILY_LIMITS.newCardsPerDay),
              maxReviewsPerDay: parseOption(maxReviewsPerDay, StorageService.DEFAULT_DAILY_LIMITS.maxReviewsPerDay),
            }
          : undefined,
      fsrsOverride:
        fsrsScope === 'deck'
          ? {
              requestRetention: targetRetention,
              maximumInterval:
                Number.isFinite(parsedMaxIntervalForDeck) && parsedMaxIntervalForDeck > 0
                  ? parsedMaxIntervalForDeck
                  : StorageService.getFSRSSettings().maximumInterval,
            }
          : undefined,
    };

    if (editDeck) {
      const updated = decks.map((d) =>
        d.id === editDeck.id
          ? {
              ...d,
              presetId: preset.id,
              name: name.trim(),
              description: description.trim(),
              ...legacyConfig,
              ...deckScoped,
              updatedAt: Date.now(),
            }
          : d
      );
      StorageService.saveDecks(updated);
    } else {
      const newDeck: Deck = {
        id: `deck-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        presetId: preset.id,
        name: name.trim(),
        description: description.trim(),
        ...legacyConfig,
        ...deckScoped,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      StorageService.saveDecks([...decks, newDeck]);
    }

    // Anki-style: changing the insertion order reassigns the "due #" (position)
    // of every new card in this deck and its subdecks (subdecks follow parent)
    if (editDeck && prevInsertionOrder !== insertionOrder) {
      const prefix = `${editDeck.name}::`;
      const affectedDeckIds = decks
        .filter((d) => d.id === editDeck.id || d.name.startsWith(prefix))
        .map((d) => d.id);
      StorageService.reassignNewCardPositions(affectedDeckIds, insertionOrder);
    }

    onSaved();
    onClose();
  };

  if (!isOpen) return null;

  // Deck usage count per preset (unlinked decks count toward the factory "Padrão")
  const usageOf = (pid: string) =>
    StorageService.getDecks().filter((d) =>
      pid === StorageService.DEFAULT_PRESET_ID
        ? !d.presetId || d.presetId === pid
        : d.presetId === pid
    ).length;
  const isFactoryPreset = presetId === StorageService.DEFAULT_PRESET_ID;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-md bg-white dark:bg-ios-card-dark rounded-[20px] border border-black/[0.04] dark:border-white/[0.06] shadow-[0_10px_40px_rgba(0,0,0,0.2)] overflow-hidden flex flex-col max-h-[88vh] ios-fade-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.05] dark:border-white/[0.07]">
          <h3 className="text-[17px] font-bold text-zinc-900 dark:text-zinc-50">
            {editDeck ? 'Editar Deck' : 'Criar Novo Deck'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* ── Preset (folha de opções compartilhada, estilo Anki) ── */}
          <div>
            <div className="flex items-center gap-1 mb-1.5">
              <Layers className="w-3.5 h-3.5 text-zinc-400" />
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Preset
              </label>
              <button
                type="button"
                onClick={() => setHelpSection('preset')}
                className="p-0.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                title="Mais informações"
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <IOSSelect
                value={presetId}
                onChange={handleSelectPreset}
                options={presetList.map((p) => {
                  const n = usageOf(p.id);
                  return {
                    value: p.id as string,
                    label: `${p.name as string} (${n} ${n === 1 ? 'deck' : 'decks'})`,
                  };
                })}
                className="flex-1 min-w-0"
              />
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setPresetMenuOpen((o) => !o)}
                  title="Modificar / gerenciar presets"
                  className="h-9 px-3.5 rounded-full flex items-center gap-1 text-[13px] font-semibold text-zinc-600 dark:text-zinc-200 border border-black/[0.1] dark:border-white/[0.15] bg-white dark:bg-white/[0.09] hover:bg-black/[0.04] dark:hover:bg-white/[0.14] transition-colors active:scale-95"
                >
                  <span>Editar</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                {presetMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setPresetMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-1.5 z-20 w-52 py-1 rounded-[12px] bg-white dark:bg-zinc-900 border border-black/[0.08] dark:border-white/[0.1] shadow-[0_8px_30px_rgba(0,0,0,0.12)] ios-fade-in">
                      <button
                        type="button"
                        onClick={() => {
                          setPresetMenuOpen(false);
                          setPresetPrompt({ mode: 'add', value: '' });
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-zinc-700 dark:text-zinc-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5 text-zinc-400" />
                        Adicionar Preset
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPresetMenuOpen(false);
                          setPresetPrompt({ mode: 'clone', value: '' });
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-zinc-700 dark:text-zinc-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5 text-zinc-400" />
                        Clonar Preset
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPresetMenuOpen(false);
                          const current = presetList.find((p) => p.id === presetId);
                          setPresetPrompt({ mode: 'rename', value: current?.name ?? '' });
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-zinc-700 dark:text-zinc-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5 text-zinc-400" />
                        Renomear Preset
                      </button>
                      <div className="my-0.5 border-t border-black/[0.05] dark:border-white/[0.06]" />
                      <button
                        type="button"
                        disabled={isFactoryPreset}
                        title={
                          isFactoryPreset
                            ? 'O preset de fábrica "Padrão" é permanente e não pode ser removido'
                            : 'Remove o preset; decks ligados passam ao "Padrão"'
                        }
                        onClick={() => {
                          setPresetMenuOpen(false);
                          setPresetDeleteOpen(true);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-red-600 dark:text-red-400 hover:bg-red-500/[0.08] dark:hover:bg-red-500/[0.12] transition-colors disabled:opacity-35 disabled:hover:bg-transparent"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remover Preset
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1 mb-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Nome do Deck
              </label>
              <button
                type="button"
                onClick={() => setHelpSection('name')}
                className="p-0.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                title="Mais informações"
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </button>
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex: Idiomas::Inglês::Vocabulário"
              className="w-full px-3.5 py-2.5 rounded-[12px] bg-black/[0.05] dark:bg-white/[0.09] border border-transparent focus:border-ios-blue focus:outline-none text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
            />
          </div>

          <div>
            <div className="flex items-center gap-1 mb-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Descrição
              </label>
              <button
                type="button"
                onClick={() => setHelpSection('description')}
                className="p-0.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                title="Mais informações"
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </button>
            </div>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Objetivo de estudo deste deck..."
              className="w-full px-3.5 py-2.5 rounded-[12px] bg-black/[0.05] dark:bg-white/[0.09] border border-transparent focus:border-ios-blue focus:outline-none text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 resize-none"
            />
          </div>

          {/* ── FSRS (retenção desejada; escopo Preset / Este deck) ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Sparkle className="w-3.5 h-3.5 text-zinc-400" />
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                FSRS
              </label>
              <button
                type="button"
                onClick={() => setHelpSection('fsrs')}
                className="p-0.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                title="Mais informações"
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </button>
              <ScopeSwitch
                value={fsrsScope}
                onChange={(s) => {
                  setFsrsScope(s);
                  if (s === 'preset') {
                    const cur = presetList.find((p) => p.id === presetId);
                    if (cur) {
                      setTargetRetention(cur.fsrsParams.requestRetention);
                      setMaxInterval(String(cur.fsrsParams.maximumInterval));
                    }
                  }
                }}
              />
            </div>

            <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06] overflow-hidden">
              <div className="px-3.5 py-3">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                      <Sparkle className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      Retenção desejada
                    </span>
                  </div>
                  <span className="text-sm font-mono font-bold tabular-nums text-blue-600 dark:text-blue-400">
                    {Math.round(targetRetention * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.70"
                  max="0.98"
                  step="0.01"
                  value={targetRetention}
                  onChange={(e) => setTargetRetention(parseFloat(e.target.value))}
                  className="w-full accent-blue-600 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
                  <span>70% (Menos revisões)</span>
                  <span>98% (Alta retenção)</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Intervalo Máximo (compartilha o escopo da seção FSRS) ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Hourglass className="w-3.5 h-3.5 text-zinc-400" />
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Intervalo Máximo
              </label>
              <button
                type="button"
                onClick={() => setHelpSection('interval')}
                className="p-0.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                title="Mais informações"
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </button>
              {fsrsScope === 'deck' && (
                <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-ios-blue">
                  Escopo: este deck
                </span>
              )}
            </div>

            <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06] overflow-hidden">
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <Hourglass className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Máx. dias por intervalo
                  </span>
                </div>
                <input
                  type="number"
                  min="30"
                  max="36500"
                  value={maxInterval}
                  onChange={(e) => setMaxInterval(e.target.value)}
                  className="no-spinner w-20 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* ── Daily Limits (estilo iOS, com escopo Preset / Este deck) ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <CalendarClock className="w-3.5 h-3.5 text-zinc-400" />
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Limites Diários
              </label>
              <button
                type="button"
                onClick={() => setHelpSection('limits')}
                className="p-0.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                title="Mais informações"
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </button>
              <ScopeSwitch
                value={limitScope}
                onChange={(s) => {
                  setLimitScope(s);
                  if (s === 'preset') {
                    const cur = presetList.find((p) => p.id === presetId);
                    if (cur) {
                      setNewCardsPerDay(String(cur.dailyLimits.newCardsPerDay));
                      setMaxReviewsPerDay(String(cur.dailyLimits.maxReviewsPerDay));
                    }
                  }
                }}
              />
            </div>

            <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06] divide-y divide-black/[0.05] dark:divide-white/[0.06] overflow-hidden">
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <Sparkle className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Novos cards/dia
                  </span>
                </div>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={newCardsPerDay}
                  onChange={(e) => setNewCardsPerDay(e.target.value)}
                  className="no-spinner w-20 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-between px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <RotateCcw className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Máx. revisões/dia
                  </span>
                </div>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={maxReviewsPerDay}
                  onChange={(e) => setMaxReviewsPerDay(e.target.value)}
                  className="no-spinner w-20 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* ── Novos Cards (Anki) ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <GraduationCap className="w-3.5 h-3.5 text-zinc-400" />
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Novos Cards
              </label>
              <button
                type="button"
                onClick={() => setHelpSection('newcards')}
                className="p-0.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                title="Mais informações"
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06] divide-y divide-black/[0.05] dark:divide-white/[0.06] overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                    <ListOrdered className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Passos de aprendizagem
                  </span>
                </div>
                <input
                  type="text"
                  value={learningSteps}
                  onChange={(e) => setLearningSteps(e.target.value)}
                  className="w-28 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
                    <ArrowDownUp className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Ordem de inserção
                  </span>
                </div>
                {/* iOS segmented control */}
                <div className="flex rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] p-0.5">
                  {(
                    [
                      ['sequential', 'Sequencial'],
                      ['random', 'Aleatório'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setInsertionOrder(value)}
                      className={`px-2.5 py-1 rounded-[10px] text-[11px] font-semibold transition-all ${
                        insertionOrder === value
                          ? 'bg-ios-blue text-white shadow-[0_1px_4px_rgba(0,122,255,0.35)]'
                          : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Lapses (Anki) ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-zinc-400" />
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Lapses (Cards Esquecidos)
              </label>
              <button
                type="button"
                onClick={() => setHelpSection('lapses')}
                className="p-0.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                title="Mais informações"
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06] divide-y divide-black/[0.05] dark:divide-white/[0.06] overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-orange-500/15 text-orange-600 dark:text-orange-400 flex items-center justify-center shrink-0">
                    <RotateCcw className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Passos de reaprendizagem
                  </span>
                </div>
                <input
                  type="text"
                  value={relearningSteps}
                  onChange={(e) => setRelearningSteps(e.target.value)}
                  className="w-28 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                    <BellRing className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Limite de leech
                  </span>
                </div>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={leechThreshold}
                  onChange={(e) => setLeechThreshold(e.target.value)}
                  className="no-spinner w-20 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-red-500/15 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                    <Hand className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Ação de leech
                  </span>
                </div>
                <div className="flex rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] p-0.5">
                  {(
                    [
                      ['suspend', 'Suspender'],
                      ['tag', 'Etiquetar'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setLeechAction(value)}
                      className={`px-2.5 py-1 rounded-[10px] text-[11px] font-semibold transition-all ${
                        leechAction === value
                          ? 'bg-ios-blue text-white shadow-[0_1px_4px_rgba(0,122,255,0.35)]'
                          : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Áudio (Anki) ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Volume2 className="w-3.5 h-3.5 text-zinc-400" />
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Áudio
              </label>
              <button
                type="button"
                onClick={() => setHelpSection('audio')}
                className="p-0.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                title="Mais informações"
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06] divide-y divide-black/[0.05] dark:divide-white/[0.06] overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <Volume2 className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Reproduzir áudio automaticamente
                  </span>
                </div>
                <div className="flex rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] p-0.5">
                  {(
                    [
                      ['play', 'Sim'],
                      ['dont', 'Não'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setAudioAutoplay(value)}
                      className={`px-2.5 py-1 rounded-[10px] text-[11px] font-semibold transition-all ${
                        audioAutoplay === value
                          ? 'bg-ios-blue text-white shadow-[0_1px_4px_rgba(0,122,255,0.35)]'
                          : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

          </div>

          {/* ── Ordem de Exibição (Anki Display Order) ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <ArrowUpDown className="w-3.5 h-3.5 text-zinc-400" />
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Ordem de Exibição
              </label>
              <button
                type="button"
                onClick={() => setHelpSection('displayorder')}
                className="p-0.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                title="Mais informações"
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06] divide-y divide-black/[0.05] dark:divide-white/[0.06] overflow-hidden">
              {[
                {
                  icon: <Layers className="w-3.5 h-3.5" />,
                  color: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
                  label: 'Coleta de novos cards',
                  value: newGatherOrder,
                  onChange: (v: string) => setNewGatherOrder(v as NewGatherOrder),
                  options: [
                    ['deck', 'Deck'],
                    ['deckThenRandomNotes', 'Deck, depois notas aleatórias'],
                    ['positionAsc', 'Posição crescente'],
                    ['positionDesc', 'Posição decrescente'],
                    ['randomNotes', 'Notas aleatórias'],
                    ['random', 'Cards aleatórios'],
                  ],
                },
                {
                  icon: <ArrowDownUp className="w-3.5 h-3.5" />,
                  color: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
                  label: 'Ordem dos novos cards',
                  value: newSortOrder,
                  onChange: (v: string) => setNewSortOrder(v as NewSortOrder),
                  options: [
                    ['template', 'Tipo de card, depois coletado'],
                    ['gathered', 'Ordem coletada'],
                    ['templateRandom', 'Tipo de card, depois aleatório'],
                    ['noteThenCardType', 'Nota aleatória, depois tipo de card'],
                    ['random', 'Aleatório'],
                  ],
                },
                {
                  icon: <Blend className="w-3.5 h-3.5" />,
                  color: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
                  label: 'Novos / Revisões',
                  value: newReviewOrder,
                  onChange: (v: string) => setNewReviewOrder(v as MixOrder),
                  options: [
                    ['mix', 'Misturar com revisões'],
                    ['after', 'Mostrar depois das revisões'],
                    ['before', 'Mostrar antes das revisões'],
                  ],
                },
                {
                  icon: <TimerReset className="w-3.5 h-3.5" />,
                  color: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400',
                  label: 'Aprendizado interdiário / Revisões',
                  value: learnReviewOrder,
                  onChange: (v: string) => setLearnReviewOrder(v as MixOrder),
                  options: [
                    ['mix', 'Misturar com revisões'],
                    ['after', 'Mostrar depois das revisões'],
                    ['before', 'Mostrar antes das revisões'],
                  ],
                },
                {
                  icon: <SortAsc className="w-3.5 h-3.5" />,
                  color: 'bg-lime-500/15 text-lime-600 dark:text-lime-400',
                  label: 'Ordem das revisões',
                  value: reviewSortOrder,
                  onChange: (v: string) => setReviewSortOrder(v as ReviewSortOrder),
                  options: [
                    ['dueRandom', 'Vencimento, depois aleatório'],
                    ['dueAsc', 'Vencimento crescente'],
                    ['dueDesc', 'Vencimento decrescente'],
                    ['dueDeck', 'Vencimento, depois deck'],
                    ['deckThenDue', 'Deck, depois vencimento'],
                    ['intervalAsc', 'Intervalo crescente'],
                    ['intervalDesc', 'Intervalo decrescente'],
                    ['easeAsc', 'Facilidade crescente'],
                    ['easeDesc', 'Facilidade decrescente'],
                    ['retrievabilityAsc', 'Retrievabilidade crescente'],
                    ['random', 'Aleatório'],
                  ],
                },
              ].map(({ icon, color, label, value, onChange, options }) => (
                <div key={label} className="px-3.5 py-2.5 space-y-2">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-lg ${color} flex items-center justify-center shrink-0`}>
                      {icon}
                    </div>
                    <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      {label}
                    </span>
                  </div>
                  <IOSSelect
                    value={value}
                    onChange={onChange}
                    options={options.map(([v, l]) => ({ value: v as string, label: l as string }))}
                    className="w-full"
                  />
                </div>
              ))}
            </div>

            <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
              Controla a ordem da fila de estudo: coleta e ordenação de novos cards, mistura de
              aprendizado/novos com revisões e ordenação das revisões — igual ao Display Order do
              Anki.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-black/[0.05] dark:border-white/[0.07]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-full text-[13px] font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!name.trim()}
            className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-ios-blue hover:bg-[#0071eb] text-white font-semibold text-[13px] shadow-[0_2px_8px_rgba(0,122,255,0.35)] transition-all active:scale-95 disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Salvar</span>
          </button>
        </div>

        {/* ── Popups de gestão de preset (fundo escurecido, estilo Anki) ── */}
        {presetPrompt && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && setPresetPrompt(null)}
          >
            <div className="w-full max-w-xs bg-white dark:bg-ios-card-dark rounded-[16px] border border-black/[0.04] dark:border-white/[0.06] shadow-[0_10px_40px_rgba(0,0,0,0.25)] p-5 space-y-3 ios-fade-in">
              <h4 className="text-[15px] font-bold text-zinc-900 dark:text-zinc-50">
                {PRESET_PROMPT_META[presetPrompt.mode].title}
              </h4>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {PRESET_PROMPT_META[presetPrompt.mode].subtitle}
              </p>
              <input
                type="text"
                autoFocus
                value={presetPrompt.value}
                onChange={(e) => setPresetPrompt({ ...presetPrompt, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmPresetPrompt();
                  if (e.key === 'Escape') setPresetPrompt(null);
                }}
                placeholder="Nome do preset"
                className="w-full px-3 py-2.5 rounded-[12px] bg-black/[0.05] dark:bg-white/[0.09] border border-transparent focus:border-ios-blue focus:outline-none text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
              />
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPresetPrompt(null)}
                  className="px-3.5 py-2 rounded-full text-[13px] font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmPresetPrompt}
                  disabled={!presetPrompt.value.trim()}
                  className="px-4 py-2 rounded-full bg-ios-blue hover:bg-[#0071eb] text-white text-[13px] font-semibold shadow-[0_2px_8px_rgba(0,122,255,0.35)] transition-all active:scale-95 disabled:opacity-50"
                >
                  {presetPrompt.mode === 'rename' ? 'Renomear' : 'Criar'}
                </button>
              </div>
            </div>
          </div>
        )}
        {presetDeleteOpen && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && setPresetDeleteOpen(false)}
          >
            <div className="w-full max-w-xs bg-white dark:bg-ios-card-dark rounded-[16px] border border-black/[0.04] dark:border-white/[0.06] shadow-[0_10px_40px_rgba(0,0,0,0.25)] p-5 space-y-3 ios-fade-in">
              <h4 className="text-[15px] font-bold text-red-600 dark:text-red-400">
                Remover Preset?
              </h4>
              <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                Todos os decks que usam{' '}
                <strong className="font-semibold">
                  "{presetList.find((p) => p.id === presetId)?.name ?? ''}"
                </strong>{' '}
                ({usageOf(presetId)} {usageOf(presetId) === 1 ? 'deck' : 'decks'}) passarão a usar o
                preset de fábrica <strong className="font-semibold">"Padrão"</strong> e receberão as
                opções dele. Esta ação não pode ser desfeita.
              </p>
              <div className="px-3 py-2 rounded-[12px] bg-red-500/10 border border-red-500/20 text-xs font-medium text-zinc-700 dark:text-zinc-200 break-words">
                {presetList.find((p) => p.id === presetId)?.name ?? ''}
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPresetDeleteOpen(false)}
                  className="px-3.5 py-2 rounded-full text-[13px] font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleRemovePreset();
                    setPresetDeleteOpen(false);
                  }}
                  className="px-4 py-2 rounded-full bg-red-600 hover:bg-red-700 text-white text-[13px] font-semibold shadow-[0_2px_8px_rgba(220,38,38,0.35)] transition-all active:scale-95"
                >
                  Remover Preset
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Painel de ajuda (estilo Anki) */}
        <HelpPanel
          isOpen={helpSection !== null}
          onClose={() => setHelpSection(null)}
          label={helpSection ? HELP_SECTIONS[helpSection].label : ''}
          topics={helpSection ? HELP_SECTIONS[helpSection].topics : []}
          showIndex={helpSection ? HELP_SECTIONS[helpSection].showIndex !== false : true}
        />
      </div>
    </div>
  );
};
