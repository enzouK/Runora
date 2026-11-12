# AGENTS.md — Instruções para agentes (OpenCode e afins)

Este arquivo é lido no início de cada sessão. Siga-o.

## 1. Plano de implementação: `.opencode/PLANO.md` (OBRIGATÓRIO)

O plano vive em `.opencode/PLANO.md` — pasta fora do git (`.gitignore`),
para não ficar visível no repositório público.
O chat é volátil — planos e decisões que ficarem só na conversa se perdem.
Por isso:

1. **Leia `.opencode/PLANO.md` no começo de toda tarefa** — nele estão as
   decisões já tomadas, o que está pendente e o histórico do que foi feito.
2. **Antes de implementar qualquer coisa, escreva o plano lá primeiro**:
   objetivo, etapas em checklist (`- [ ]`), riscos, e como será validado.
3. **Durante a implementação, mantenha o arquivo vivo**: marque os itens
   concluídos (`- [x]`), anote medidas reais e atualize o status da etapa
   (⬜ PENDENTE → 🔄 EM ANDAMENTO → ✅ CONCLUÍDA) — não espere o fim.
4. **Decisões novas** tomadas com o usuário (escolhas de design, limites,
   "nunca faça X") viram itens na seção **Decisões permanentes** do PLANO.md.
5. Etapa concluída = ganho/resultado resumido + commit previsto/real na entrada.

## 2. Regras de colaboração (acordadas com o dono do projeto)

- Responda sempre em **PT-BR**, em linguagem acessível (usuário leigo).
- **Pergunte antes de commitar** cada etapa; só commite com autorização
  explícita. Push somente quando pedido explicitamente.
- Builds (.exe / APK) **somente quando pedidos** explicitamente.
- Validação/testes primeiro no servidor Vite (`http://127.0.0.1:3000/`).
- Testes: `npm test` + `npx tsc --noEmit` antes de qualquer commit.

## 3. Regras do domínio (Runora — NÃO violar)

- **NÃO tocar** no algoritmo FSRS, na lógica de estudo nem no formato atual
  do `.colpkg`.
- O `.colpkg` **NUNCA será deletado** do Drive — ele é o ponto de backup
  ("Restaurar do Drive"), decisivo para voltar atrás.
- Protocolo de sync: `.colpkg` = base; delta incremental é sempre aplicado
  **por cima** do `.colpkg`, nunca no lugar dele.
- USN = contador **compartilhado** (Drive = referência); avança só com
  mudança real de conteúdo.
- Identidade universal: nota = GUID, card = (GUID da nota, ordem do template),
  deck/tipo/preset = NOME.
- Login do Google é feito **pelo usuário** no dispositivo (não injetar token).
