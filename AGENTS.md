# AGENTS.md — Instruções para agentes (OpenCode e afins)

Este arquivo é lido no início de cada sessão. Siga-o.

---

## 1. Workflow da tarefa (OBRIGATÓRIO)

O trabalho em curso vive em três arquivos, com papéis bem separados:

| Arquivo | Guarda | Quando ler |
|---|---|---|
| `.opencode/PLANO.md` | o que **falta** fazer + o plano da tarefa em andamento | sempre, no começo de cada tarefa |
| `.opencode/HISTORICO.md` | o que **já foi feito** (commit, medições, bugs) | quando precisar de contexto do passado |
| `AGENTS.md` (este) | as **regras permanentes** | sempre carregado, automaticamente |

`.opencode/` está fora do git (`.gitignore`) — os planos e o histórico não vão
para o repositório público. O chat é volátil: o que ficar só na conversa se
perde. Por isso:

1. **Leia `.opencode/PLANO.md` no começo de toda tarefa** — nele estão a fila
   do que falta e o plano da tarefa em andamento.
2. **Antes de implementar qualquer coisa, escreva o plano lá primeiro**:
   objetivo, etapas em checklist (`- [ ]`), riscos e como será validado.
3. **Durante a implementação, mantenha o arquivo vivo**: marque os itens
   concluídos (`- [x]`), anote medidas reais e atualize o status da etapa
   (⬜ PENDENTE → 🔄 EM ANDAMENTO → ✅ CONCLUÍDA) — não espere o fim.
4. **Quando a tarefa terminar** (commit/push feito): mova a entrada da tarefa
   para `.opencode/HISTORICO.md` (com o resultado, as medições, os bugs
   encontrados e o commit), atualize o índice de lá, e tire a tarefa da fila
   do `PLANO.md`.
5. **Antes de responder ao usuário**: confira se o `PLANO.md` e o `HISTORICO.md`
   refletem o que você acabou de fazer. Se não refletirem, **atualize os dois
   primeiro** e só então responda.
6. **Tarefas só de conversa** (perguntas, discussões, consultas): **não** mexa
   nos arquivos — a menos que o dono **aprove** uma decisão nova. Nesse caso,
   registre a decisão aprovada nas regras permanentes deste `AGENTS.md` (e/ou
   no `HISTORICO.md`) e diga o que mudou.

> Um plugin local (`.opencode/plugins/runora-plano/`) injeta um lembrete
> automático antes da resposta quando os arquivos ficaram desatualizados.

---

## 2. Regras de colaboração (acordadas com o dono do projeto)

- Responda sempre em **PT-BR**, em linguagem acessível (usuário leigo).
- **Pergunte antes de commitar** cada etapa; só commite com autorização
  explícita.
- **Depois de commitar, pergunte se o dono quer push.** Push só com a
  autorização dele.
- **Ao final de toda implementação que mexa no app, faça o build do `.exe`,
  do `APK-dev.apk` e do `APK-prod.apk`** — antes do commit. A ordem é:
  implementar → validar no Vite → `npm test` + `npx tsc --noEmit` →
  **build** → commit → perguntar sobre o push.
  Tarefas que **não** mexem no app (só documentação, ferramentas, `.opencode/`)
  não precisam de build.
- Validação/testes primeiro no servidor Vite (`http://127.0.0.1:3000/`).
- Testes: `npm test` + `npx tsc --noEmit` antes de qualquer commit.

---

## 3. Regras do domínio (Runora)

- **Login do Google é feito pelo usuário** no dispositivo (não injetar token).
- **O `.colpkg` não é apagado do Drive** — ele é o ponto de backup
  ("Restaurar do Drive"), decisivo para voltar atrás. Ele só pode ser
  substituído por algo igualmente seguro, e essa decisão é do dono.
- **Protocolo de sync:** `.colpkg` = base; o delta incremental é sempre
  aplicado **por cima** dele, nunca no lugar.
- **USN = contador compartilhado** (Drive = referência); avança só com mudança
  real de conteúdo.
- **Identidade universal:** nota = GUID, card = (GUID da nota, ordem do
  template), deck/tipo/preset = NOME.
- **Estabilidade (barra alta, não é proibição):** o algoritmo FSRS atual e a
  lógica de estudo funcionam bem e agradam o dono. Mexer neles é possível,
  mas só **com conversa e aprovação explícita**, explicando o que muda para o
  usuário. O mesmo vale para o **formato do `.colpkg`**: mudá-lo quebra a
  compatibilidade com pacotes do Anki e com aparelhos antigos — só com plano
  aprovado.

---

## 4. Ambiente e builds

- O client secret do Google fica em **`.env.local`** (gitignored) — **nunca**
  commitado no repositório público (aviso do Google Cloud). O Google exige
  secret na troca do código mesmo com PKCE.
- APK emulador = dev (`http://10.0.2.2:3000`); APK celular real = produção
  (origem `https://localhost/`).
- **Os dois APKs são sempre gerados JUNTOS, do mesmo `dist`** — é o mesmo
  app, só muda de onde ele carrega o código (o `dev` busca no Vite do PC; o
  `prod` usa o bundle embutido). Nunca deixar um deles para trás: um
  `APK-prod.apk` novo com um `APK-dev.apk` velho (ou o contrário) faz o
  emulador e o celular rodarem **códigos diferentes**.
  - Montagem: `npm run android:dev` / `npm run android:prod` (o script
    `scripts/android-apk.mjs` monta **os dois** e instala o escolhido), ou
    na mão: `npm run build` → `CAP_SERVER_URL='http://10.0.2.2:3000' npx
    cap copy android` → Gradle (JDK 21, com `-PdevBuild=true`) →
    `release\Runora-APK-dev.apk` → **depois, sem a variável**: `npx
    cap copy android` → Gradle (sem a opção) →
    `release\Runora-APK-prod.apk`.
  - **Termine sempre pelo de produção** — é o estado que deve ficar na pasta
    `android/` do projeto (a config gerada fica lá).
  - Antes de entregar, confira que o bundle dentro dos dois APKs tem o
    **mesmo hash** do `dist` final.
- **O APK de dev é OUTRO pacote (`com.runora.fsrs.dev`, rótulo "Runora Dev")**
  → ele **convive** com o de produção (`com.runora.fsrs`) no mesmo aparelho:
  os dois ficam instalados lado a lado, sem trocar um pelo outro e sem perder
  dados. O `applicationId`/rótulo são trocados pelo Gradle quando se monta com
  `-PdevBuild=true` (ver `android/app/build.gradle`) e o `capacitor.config.ts`
  acompanha a mesma troca.
  - Atenção: o app dev tem **dados próprios** (origem `http://10.0.2.2:3000`)
    → começa vazio. Se alguém logar nele, ele vira um **segundo aparelho** no
    Drive (o `.colpkg` não é mexido por isso). O login do Google no Android
    volta sempre em `https://localhost` (única origem registrada no Google
    Cloud) → no app dev essa volta carrega o **bundle embutido**, não o Vite.
  - O `network_security_config.xml` libera HTTP (cleartext) **só** para
    `10.0.2.2`, `localhost` e `127.0.0.1` — sem isso o APK de dev abriria em
    branco (o Android bloqueia HTTP desde a API 28).
