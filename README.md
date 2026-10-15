<div align="center">
<img width="1200" alt="Anki FSRS Flashcards Multi-Platform" src="https://raw.githubusercontent.com/enzouK/Anki2.0/main/src/assets/logo.svg" />
</div>

# Anki FSRS Flashcards

Uma versão personalizada e moderna do **Anki 2.0** com algoritmo **FSRS** integrado, disponível para **Windows (.exe)** e **Android (.apk)**.

## 📋 Visão Geral

Este projeto transforma o algoritmo **FSRS** (Free Spaced Repetition System) em uma experiência completa de flashcards, empacotada como aplicativos nativos para desktop e mobile.

**Diferente de addons tradicionais**, esta é uma versão modificada do Anki 2.0 própria, com:

- ✅ Algoritmo FSRS otimizado como sistema principal
- ✅ Interface moderna construída com React + TypeScript + Tailwind
- ✅ Empacotamento cross-platform (Windows + Android)
- ✅ Controle total sobre aparência e comportamento

## 🚀 Funcionalidades Principais

| Categoria | Recursos |
|-----------|----------|
| **🧠 Algoritmo FSRS** | Otimização avançada de espaçamento de repetição, cálculo de intervals baseados em ciência da memória |
| **📚 Gerenciamento de Decks** | Criação, edição, exclusão e organização de baralhos e sub-baralhos |
| **📝 Tipos de Nota** | Templates personalizáveis com suporte a campos cloze, enriquecidos com HTML/CSS |
| **📸 Mídia** | Suporte a imagens, áudio e vídeo nos cartões |
| **📊 Estatísticas** | Gráficos de progresso, taxas de retenção, análise de desempenho |
| **🔄 Sincronização** | (Futuro) Sincronização entre dispositivos via cloud/locale |

## 🛠️ Tecnologias

| Camada | Tecnologia | Finalidade |
|--------|------------|------------|
| **Interface** | React + TypeScript + Vite | UI responsiva e moderna |
| **Estilização** | Tailwind CSS + shadcn/ui | Componentes bonitos e consistentes |
| **Algoritmo** | FSRS em TypeScript | Cálculo de intervals de repetição |
| **Empacotamento** | Electron (Windows) / Capacitor (Android) | Converter web → .exe e .apk |
| **Storage** | IndexedDB / SQLite | Dados locais offline-first |

## 📦 Plataformas Suportadas

| Plataforma | Tecnologia | Status |
|------------|------------|--------|
| **Windows** | Electron + React | 🟡 Em desenvolvimento |
| **Android** | Capacitor + React | 🟡 Em desenvolvimento |
| **Web** | Browser (PWA) | ✅ Disponível para testes |

## 🛠️ Getting Started (Desenvolvimento Local)

### **Pré-requisitos**

```bash
Node.js (v18+ recomendado)
npm ou yarn
Git
```

### **Instalação**

```bash
# Clonar repositório
git clone https://github.com/enzouK/Anki2.0.git
cd anki-2.0---fsrs-flashcards

# Instalar dependências
npm install

# Iniciar modo desenvolvimento (web)
npm run dev

# Abrir no browser: http://localhost:5173
```

### **Build para Windows (.exe)**

```bash
# Configurar Electron
npm run build:electron
# ou manualmente:
npx electron-vite build
# Resultado: dist/ ou out/ com .exe
```

### **Build para Android (.apk)**

```bash
# Inicializar Capacitor
npx capacitor init
npx capacitor add android

# Sincronizar e abrir no Android Studio
npx capacitor sync
npx capacitor open android

# No Android Studio: Build → Generate APK
```

## 📁 Estrutura do Projeto

```
src/
├── components/          <- Componentes UI (shadcn/ui)
├── fsrs/                <- Algoritmo FSRS puro em TypeScript
├── services/            <- Serviços de storage, áudio, etc.
├── types/               <- Tipos TypeScript definidos
├── main.tsx             <- Ponto de entrada da aplicação
├── electron/            <- Configurações Electron (Windows)
└── capacitor/           <- Configurações Android (.apk)
```

## 🎯 Roadmap (Planejado)

| Fase | Conquista | Prazo |
|------|-----------|-------|
| **Fase 1** | ✅ Algoritmo FSRS funcional | Concluído |
| **Fase 2** | ✅ UI Moderna (shadcn/ui) | Concluído |
| **Fase 3** | 🟡 Build Windows (.exe) via Electron | Próxima |
| **Fase 4** | 🟡 Build Android (.apk) via Capacitor | Depois |
| **Fase 5** | 🟡 Sincronização entre dispositivos | Futuro |
| **Fase 6** | 🟡 Loja de addons/extensões | Futuro |

## 🤝 Como Contribuir

1. **Fork** o repositório
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. **Commit** suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. **Push** para a branch (`git push origin feature/AmazingFeature`)
5. Abra um **Pull Request**

## 📄 Licença

Este projeto está licenciado sob a licença **MIT** - veja o arquivo [LICENSE](LICENSE) para detalhes.

---

## 💡 Por que este projeto é diferente?

| Aspecto | Addons Tradicionais | Este Projeto |
|---------|---------------------|--------------|
| **Distribuição** | .ankiaddon (requiere Anki instalado) | .exe e .apk autônomos |
| **Interface** | Componentes nativos do Anki | Interface moderna React + shadcn/ui |
| **Personalização** | Limitada (CSS/HTML) | Controle total sobre todos os aspectos |
| **Plataforma** | Apenas desktop (Windows/Mac/Linux) | Windows + Android (multi-platform) |
| **Atualizações** | Via loja Anki ou manual | Atualizações diretas do .exe/.apk |

---

Feito com ❤️ por **enzouK** para revolucionar a experiência de flashcards com FSRS.
