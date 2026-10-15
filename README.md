<div align="center">
<img width="1200" alt="Anki FSRS Flashcards Banner" src="https://raw.githubusercontent.com/enzouK/Anki2.0/main/src/assets/logo.svg" />
</div>

# Anki FSRS Flashcards

Aplicativo de flashcards inteligente usando o algoritmo FSRS (Spaced Repetition System) para Anki.

## 📋 Sobre

Este projeto implementa o algoritmo **FSRS** (Free Spaced Repetition System) para o Anki, proporcionando uma otimização inteligente do espaçamento de repetição baseado na ciência da memória.

## 🚀 Funcionalidades

- **Algoritmo FSRS**: Otimização personalizada do espaçamento baseada em pesquisas de memória
- **Integração Anki**: Plugin completo para o cliente de flashcards Anki
- **Gerenciamento de Decks**: Criação, edição e exclusão de baralhos
- **Tipos de Nota**: Suporte a templates de notas personalizáveis
- **Estudo Interativo**: Interface fluida para revisão de cartões

## 🛠️ Tecnologias

- **Frontend**: React + TypeScript + Vite
- **Storage**: IndexedDB via serviço personalizado
- **FSRS Algorithm**: Implementação do algoritmo FSRS em TypeScript
- **Anki Addon**: Integração com o ecossistema Anki

## 📦 Instalação

```bash
# Instalar dependências
npm install

# Executar em modo desenvolvimento
npm run dev

# Build para produção
npm run build
```

## 📁 Estrutura do Projeto

```
src/
├── components/     <- Componentes UI
├── fsrs/           <- Algoritmo FSRS
├── services/       <- Serviços Anki/Audio
├── types/          <- Tipos TypeScript
└── main.tsx        <- Ponto de entrada
```

## 🎯 Propósito

Este plugin substitui o sistema de repetição padrão do Anki pelo algoritmo FSRS, que foi desenvolvido por pesquisadores da Universidade de Waterloo e tem demonstrado melhores resultados na retenção de longo prazo comparado aos métodos tradicionais.

## 📄 Licença

MIT
