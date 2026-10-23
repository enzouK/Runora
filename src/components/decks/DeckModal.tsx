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
} from 'lucide-react';
import {
  Deck,
  DisplayOrderConfig,
  InsertionOrder,
  LeechAction,
  MixOrder,
  NewGatherOrder,
  NewSortOrder,
  ReviewSortOrder,
} from '../../types/anki';
import { StorageService } from '../../services/storage';
import { IOSSelect } from '../common/IOSSelect';
import { HelpPanel, HelpTopic } from '../common/HelpPanel';

type HelpSectionId =
  | 'name'
  | 'description'
  | 'fsrs'
  | 'interval'
  | 'limits'
  | 'newcards'
  | 'lapses'
  | 'audio'
  | 'displayorder';

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
              Controla a posição (due #) atribuída aos cards novos quando você adiciona cards.
              Cards com um número de vencimento menor serão mostrados primeiro ao estudar.
              Alterar esta opção atualizará automaticamente a posição existente dos cards novos.
            </p>
            <ul className="mt-1 space-y-1 list-disc pl-5">
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Sequencial:
                </span>{' '}
                segue a ordem em que os cards foram criados.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Aleatório:
                </span>{' '}
                ordem aleatória.
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
                intercalados com as revisões.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Mostrar depois das revisões:
                </span>{' '}
                só aparecem após terminar as revisões.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Mostrar antes das revisões:
                </span>{' '}
                aparecem antes de começar as revisões.
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
              No app, esses cards são sempre coletados primeiro e nunca são limitados pelo
              limite diário — esta opção controla apenas a ordem em que aparecem na fila. A
              ordem usada é sempre a do deck que você seleciona para estudar (herdando do pai),
              e não a dos subdecks.
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
                prioriza os que esperam há mais tempo — o recomendado quando você está em dia.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Vencimento, depois deck:
                </span>{' '}
                idem, desempatando pelos subdecks em ordem.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Deck, depois vencimento:
                </span>{' '}
                cada subdeck em turno — não recomendado: a ordem fixa denuncia a resposta pelo
                contexto.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Intervalo crescente:
                </span>{' '}
                intervalos curtos primeiro.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Intervalo decrescente:
                </span>{' '}
                intervalos longos primeiro.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Facilidade crescente:
                </span>{' '}
                os mais difíceis primeiro.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Facilidade decrescente:
                </span>{' '}
                os mais fáceis primeiro.
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Retrievabilidade crescente:
                </span>{' '}
                os mais perto de ser esquecidos primeiro — recomendado para backlogs (equivalente
                FSRS do "Relative overdueness").
              </li>
              <li>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Cards aleatórios:
                </span>{' '}
                embaralha as revisões.
              </li>
            </ul>
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

  useEffect(() => {
    if (!isOpen) {
      setHelpSection(null);
      return;
    }
    const decks = StorageService.getDecks();

    // Effective (resolved) values: the deck's own settings where set,
    // otherwise inherited from the parent lineage or the global defaults.
    const baseId = editDeck
      ? editDeck.id
      : parentDeckName
        ? decks.find((d) => d.name === parentDeckName)?.id
        : undefined;

    const effDaily = baseId
      ? StorageService.getEffectiveDailyLimits(baseId)
      : {
          newCardsPerDay: StorageService.DEFAULT_DAILY_LIMITS.newCardsPerDay,
          maxReviewsPerDay: StorageService.DEFAULT_DAILY_LIMITS.maxReviewsPerDay,
        };
    const effSched = baseId
      ? StorageService.getEffectiveSchedulerConfig(baseId)
      : {
          learningSteps: StorageService.DEFAULT_SCHEDULER.learningSteps,
          insertionOrder: StorageService.DEFAULT_SCHEDULER.insertionOrder,
          relearningSteps: StorageService.DEFAULT_SCHEDULER.relearningSteps,
          leechThreshold: StorageService.DEFAULT_SCHEDULER.leechThreshold,
          leechAction: StorageService.DEFAULT_SCHEDULER.leechAction,
        };
    const effOrder = baseId
      ? StorageService.getEffectiveDisplayOrder(baseId)
      : { ...StorageService.DEFAULT_DISPLAY_ORDER };
    const effAudio = baseId
      ? StorageService.getEffectiveAudioConfig(baseId)
      : { disableAutoplay: false };

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

    setTargetRetention(editDeck?.fsrsParams?.requestRetention ?? 0.90);
    setMaxInterval(
      String(
        editDeck?.fsrsParams?.maximumInterval ??
          StorageService.getFSRSSettings().maximumInterval
      )
    );
    setNewCardsPerDay(String(effDaily.newCardsPerDay));
    setMaxReviewsPerDay(String(effDaily.maxReviewsPerDay));
    setLearningSteps(StorageService.formatSteps(effSched.learningSteps));
    setInsertionOrder(effSched.insertionOrder);
    setRelearningSteps(StorageService.formatSteps(effSched.relearningSteps));
    setLeechThreshold(String(effSched.leechThreshold));
    setLeechAction(effSched.leechAction);
    setNewGatherOrder(effOrder.newGatherOrder);
    setNewSortOrder(effOrder.newSortOrder);
    setNewReviewOrder(effOrder.newReviewOrder);
    setLearnReviewOrder(effOrder.learnReviewOrder);
    setReviewSortOrder(effOrder.reviewSortOrder);
    setAudioAutoplay(effAudio.disableAutoplay ? 'dont' : 'play');
  }, [isOpen, editDeck, parentDeckName]);

  const parseLimit = (value: string): number | null => {
    if (value.trim() === '') return null; // cleared → inherit from the deck parent
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const handleSave = () => {
    if (!name.trim()) return;

    const decks = StorageService.getDecks();
    const dailyLimits = {
      newCardsPerDay: parseLimit(newCardsPerDay),
      maxReviewsPerDay: parseLimit(maxReviewsPerDay),
    };
    const schedulerConfig = {
      learningSteps: learningSteps.trim() || null,
      insertionOrder,
      relearningSteps: relearningSteps.trim() || null,
      leechThreshold: parseLimit(leechThreshold),
      leechAction,
    };
    const displayOrder: DisplayOrderConfig = {
      newGatherOrder,
      newSortOrder,
      newReviewOrder,
      learnReviewOrder,
      reviewSortOrder,
    };
    const audioConfig = {
      disableAutoplay: audioAutoplay === 'dont',
    };
    // Per-deck FSRS overrides: only fields the user set are saved;
    // anything left empty falls back to the global settings at runtime.
    const fsrsParams: { requestRetention: number; maximumInterval?: number } = {
      requestRetention: targetRetention,
    };
    const parsedMaxInterval = parseInt(maxInterval, 10);
    if (Number.isFinite(parsedMaxInterval) && parsedMaxInterval > 0) {
      fsrsParams.maximumInterval = parsedMaxInterval;
    }

    if (editDeck) {
      const updated = decks.map((d) =>
        d.id === editDeck.id
          ? {
              ...d,
              name: name.trim(),
              description: description.trim(),
              fsrsParams,
              dailyLimits,
              schedulerConfig,
              displayOrder,
              audioConfig,
              updatedAt: Date.now(),
            }
          : d
      );
      StorageService.saveDecks(updated);
    } else {
      const newDeck: Deck = {
        id: `deck-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: name.trim(),
        description: description.trim(),
        fsrsParams,
        dailyLimits,
        schedulerConfig,
        displayOrder,
        audioConfig,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      StorageService.saveDecks([...decks, newDeck]);
    }

    onSaved();
    onClose();
  };

  if (!isOpen) return null;

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

          {/* ── FSRS (retenção desejada por deck) ── */}
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
                  <span>90% (Padrão)</span>
                  <span>98% (Alta retenção)</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Intervalo Máximo (FSRS por deck; vazio = global) ── */}
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
                  className="w-20 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* ── Daily Limits (estilo iOS, como no Anki) ── */}
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
                  className="w-20 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  className="w-20 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  className="w-20 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
