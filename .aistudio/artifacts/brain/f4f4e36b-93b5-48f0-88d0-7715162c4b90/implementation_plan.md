# Correção e Modernização da Exclusão de Decks, Cards e Note Types

Substituição do comando nativo `window.confirm()` (bloqueado pelo ambiente de segurança de iframes) por um componente de diálogo modal de confirmação elegante, centralizado e seguro, detalhando o nome do item e o impacto da exclusão antes de confirmar.

## Decisões Críticas e Preferências do Usuário

> [!IMPORTANT]
> O ambiente de desenvolvimento embutido (sandboxed iframe) restringe a chamada nativa `window.confirm()`, fazendo com que retorne `false` imediatamente ou falhe silenciosamente, impedindo qualquer exclusão.

- **Formato de Confirmação Confirmado**: Modal visual de confirmação centralizado com foco de atenção, botão de perigo (destaque vermelho suave) e botão de cancelar.
- **Detalhamento do Impacto Confirmado**: Exibição clara do tipo de item, nome em destaque e mensagem explicando as consequências (ex.: no deck, informa a exclusão recursiva de sub-baralhos e cards vinculados; no card, a remoção da nota correspondente; no Tipo de Nota, alerta sobre remoção de template e bloqueio de exclusão do último modelo restante).

---

## 1. Visão Geral e Conceito

- **O que faz**: Proporciona uma experiência confiável e sem falhas para excluir Baralhos (Decks), Cartões (Cards), Tipos de Nota (Note Types) e ações destrutivas nas Configurações (reset FSRS e reset de dados), utilizando um modal dedicado (`ConfirmationModal`).
- **Público-alvo**: Usuários gerenciando coleções de estudos que precisam reorganizar, limpar ou remover itens sem atritos e sem risco de perdas acidentais.
- **Valor Principal**: Eliminação definitiva do bug de bloqueio de exclusão em navegadores e iframes, garantindo feedback visual imediato e prevenindo exclusões involuntárias.

---

## 2. Experiência do Usuário e Design Visual

### Fluxos de Exclusão

1. **Excluir Deck (Baralho)**:
   - O usuário abre o menu de ações do deck ou clica no ícone de lixeira.
   - Um modal centralizado suave é aberto exibindo:
     - Ícone de alerta vermelho em container sutil (`bg-red-500/10 text-red-500`).
     - Título: *"Excluir Baralho"*
     - Mensagem detalhada: *"Tem certeza que deseja excluir o baralho **[Nome do Deck]**? Todos os sub-baralhos e cartões associados também serão removidos permanentemente."*
     - Botões: *"Cancelar"* (zinc neutro) e *"Excluir Baralho"* (vermelho de perigo com estado ativo e foco).
   - Ao confirmar, o deck e seus cards são deletados via `StorageService.deleteDeck`, o modal fecha e a lista atualiza instantaneamente.

2. **Excluir Card (Cartão)**:
   - No gerenciador de cards (`CardBrowser`), ao clicar no ícone de lixeira de um card:
     - Abre o modal com título *"Excluir Cartão"*.
     - Mostra o resumo da pergunta/frente do card e o aviso de que a nota correspondente será excluída.
     - Ao confirmar, a nota e o card são removidos via `StorageService.deleteNote` e a lista atualiza.

3. **Excluir Tipo de Nota (Note Type)**:
   - No gerenciador de Tipos de Nota (`NoteTypeManager`), ao clicar em excluir:
     - Validação defensiva: se for o único tipo de nota restante, exibe aviso modal ou toast amigável (sem `window.alert()`).
     - Se houver outros, abre o modal de perigo destacando o nome do modelo a ser excluído.
     - Ao confirmar, atualiza o storage e o estado local.

4. **Ações Críticas em Configurações (SettingsModal)**:
   - Substituição dos `confirm()` de restaurar parâmetros do FSRS e restaurar dados de demonstração pelo mesmo modal.

### Padrão Visual (Anti-Slop Discipline)
- Backdrop suave com `backdrop-blur-sm bg-black/50`.
- Card modal com cantos arredondados generosos (`rounded-3xl`), sombra profunda, tipografia nítida e hierarquia clara.
- Suporte nativo completo a modo claro e escuro (`dark:bg-zinc-900 dark:border-zinc-800`).
- Tecla `Escape` e clique no backdrop fecham o modal com segurança sem disparar a exclusão.

---

## 3. Decisões de Produto e Arquitetura

- **Componente Reutilizável `ConfirmationModal`**:
  - Criar um componente robusto e flexível em `src/components/common/ConfirmationModal.tsx`.
  - Suporta título, descrição, texto do item em destaque, rótulo do botão de confirmação, variantes (perigo/vermelho vs. neutro) e controle de estado assíncrono.
- **Substituição Abrangente**:
  - Eliminar 100% das chamadas a `confirm()` e `alert()` do projeto (`DeckList`, `CardBrowser`, `NoteTypeManager`, `SettingsModal`).
- **Nenhum mock ou bypass**:
  - Todas as chamadas de exclusão continuam integradas diretamente com `StorageService` e atualizam o estado e re-renderização das listas via `onRefresh()`.

---

## 4. Arquitetura Técnica e Diagrama

```
┌──────────────────────────────────────────────────────────────┐
│                    Ações do Usuário                          │
│   (Clique Lixeira Deck / Lixeira Card / Excluir Note Type)   │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                   Estado Local do Componente                 │
│         pendingDelete = { id, title, description, ... }      │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                 ConfirmationModal (Portal/UI)                │
│    • Backdrop blur + centralização                           │
│    • Destaque do nome do item e impacto                      │
│    • Botão Cancelar & Botão de Perigo ("Excluir")            │
└──────────────────────────────┬───────────────────────────────┘
                               │
               ┌───────────────┴───────────────┐
       [Cancelar]                             [Confirmar]
               │                               │
               ▼                               ▼
       Fecha o modal sem             Chama StorageService:
       nenhuma alteração             • deleteDeck(id)
                                     • deleteNote(noteId)
                                     • saveNoteTypes(updated)
                                               │
                                               ▼
                                     onRefresh() dispara
                                     re-render imediato
```

### Componentes Afetados
- `src/components/common/ConfirmationModal.tsx` *(Novo componente)*
- `src/components/decks/DeckList.tsx` *(Substituir confirm por ConfirmationModal)*
- `src/components/cards/CardBrowser.tsx` *(Substituir confirm por ConfirmationModal)*
- `src/components/notetypes/NoteTypeManager.tsx` *(Substituir confirm/alert por ConfirmationModal e feedback inline)*
- `src/components/settings/SettingsModal.tsx` *(Substituir confirm por ConfirmationModal)*
