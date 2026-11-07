import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countCardsUsingFeature,
  detectFeatures,
  featureImpactText,
  featureOfTag,
  htmlUsesFeature,
  noteTypeUsesFeature,
  resolveFeatures,
} from './noteTypeFeatures';
import { Card, CardTemplate, Note, NoteType } from '../types/runora';

const tpl = (qfmt: string, afmt = ''): CardTemplate => ({
  id: 't1',
  name: 'Card 1',
  ord: 0,
  qfmt,
  afmt,
});

const mkType = (templates: CardTemplate[]): NoteType => ({
  id: 'nt-1',
  name: 'Teste',
  fields: [
    { id: 'f1', name: 'Texto', ord: 0 },
    { id: 'f2', name: 'Leitura', ord: 1 },
  ],
  templates,
  css: '',
  isCloze: false,
  hintsEnabled: false,
  voiceRecordingEnabled: false,
  furiganaEnabled: false,
  createdAt: 0,
  updatedAt: 0,
});

/* ---------- Detecção ---------- */

test('htmlUsesFeature: acha furigana, kanji e kana', () => {
  assert.equal(htmlUsesFeature('{{furigana:Leitura}}', 'furigana'), true);
  assert.equal(htmlUsesFeature('{{kanji:Texto}}', 'furigana'), true);
  assert.equal(htmlUsesFeature('{{kana:Texto}}', 'furigana'), true);
  assert.equal(htmlUsesFeature('{{Texto}}', 'furigana'), false);
});

test('htmlUsesFeature: acha hint, voice e cloze', () => {
  assert.equal(htmlUsesFeature('{{hint}}', 'hints'), true);
  assert.equal(htmlUsesFeature('{{hint:Dica}}', 'hints'), true);
  assert.equal(htmlUsesFeature('{{voice:record}}', 'voice'), true);
  assert.equal(htmlUsesFeature('{{voice:reproduce}}', 'voice'), true);
  assert.equal(htmlUsesFeature('{{cloze:Texto}}', 'cloze'), true);
  assert.equal(htmlUsesFeature('{{c1::palavra}}', 'cloze'), false);
});

test('noteTypeUsesFeature: olha frente e verso', () => {
  const tipo = mkType([tpl('{{Texto}}', '{{furigana:Leitura}}')]);
  assert.equal(noteTypeUsesFeature(tipo, 'furigana'), true);
  assert.equal(noteTypeUsesFeature(tipo, 'hints'), false);
});

test('featureOfTag: identifica o recurso de cada tag', () => {
  assert.equal(featureOfTag('hint'), 'hints');
  assert.equal(featureOfTag('hint:Dica'), 'hints');
  assert.equal(featureOfTag('furigana:Leitura'), 'furigana');
  assert.equal(featureOfTag('kanji:Texto'), 'furigana');
  assert.equal(featureOfTag('cloze:Texto'), 'cloze');
  assert.equal(featureOfTag('voice:record'), 'voice');
  assert.equal(featureOfTag('Texto'), null);
});

test('detectFeatures: descobre os recursos usados nos templates', () => {
  const f = detectFeatures([
    tpl('{{Texto}}', '{{furigana:Leitura}}\n{{hint}}\n{{voice:record}}'),
  ]);
  assert.equal(f.furigana, true);
  assert.equal(f.hints, true);
  assert.equal(f.voice, true);
  assert.equal(f.cloze, false);
});

test('resolveFeatures: usa a flag quando ela existe', () => {
  const tipo = mkType([tpl('{{furigana:Texto}}')]);
  tipo.furiganaEnabled = false;
  assert.equal(resolveFeatures(tipo).furigana, false);
});

test('resolveFeatures: detecta pelo template quando a flag não existe', () => {
  const tipo = mkType([tpl('{{furigana:Texto}}')]);
  delete (tipo as any).furiganaEnabled;
  assert.equal(resolveFeatures(tipo).furigana, true);
});

/* ---------- Contagem de cards ---------- */

const mkNote = (id: string, noteTypeId: string): Note => ({
  id,
  noteTypeId,
  deckId: 'd1',
  fields: {},
  media: [],
  tags: [],
  createdAt: 0,
  updatedAt: 0,
});

const mkCard = (id: string, noteId: string): Card => ({
  id,
  noteId,
  deckId: 'd1',
  templateOrd: 0,
  due: 0,
  fsrs: {} as Card['fsrs'],
  createdAt: 0,
  updatedAt: 0,
});

test('countCardsUsingFeature: conta os cards das notas do tipo', () => {
  const tipo = mkType([tpl('{{furigana:Texto}}')]);
  const notas = [mkNote('n1', 'nt-1'), mkNote('n2', 'nt-1'), mkNote('n3', 'nt-outro')];
  const cards = [
    mkCard('c1', 'n1'),
    mkCard('c2', 'n1'),
    mkCard('c3', 'n2'),
    mkCard('c4', 'n3'),
  ];

  assert.equal(countCardsUsingFeature(tipo, 'furigana', notas, cards), 3);
});

test('countCardsUsingFeature: zero quando o template não usa o recurso', () => {
  const tipo = mkType([tpl('{{Texto}}')]);
  const notas = [mkNote('n1', 'nt-1')];
  const cards = [mkCard('c1', 'n1')];

  assert.equal(countCardsUsingFeature(tipo, 'furigana', notas, cards), 0);
});

/* ---------- Textos do aviso ---------- */

test('featureImpactText: avisa quantos cards usam o recurso', () => {
  const t = featureImpactText('furigana', 3);
  assert.equal(t.includes('3 cards'), true);
  assert.equal(t.includes('{{furigana:Campo}}'), true);
});

test('featureImpactText: avisa quando nenhum card é afetado', () => {
  const t = featureImpactText('furigana', 0);
  assert.equal(t.includes('Nenhum card'), true);
});

test('featureImpactText: no singular', () => {
  const t = featureImpactText('hints', 1);
  assert.equal(t.includes('1 card deste tipo'), true);
  assert.equal(t.includes('{{hint:Campo}}'), true);
});
