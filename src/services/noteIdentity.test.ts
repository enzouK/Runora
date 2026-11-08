import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateGuid,
  hasGuid,
  normalizeFieldValue,
  computeNoteSignature,
  ensureNoteGuids,
} from './noteIdentity';
import type { Note } from '../types/runora';

function makeNote(partial: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    noteTypeId: 'tipo-1',
    deckId: 'deck-1',
    fields: { Frente: 'gato', Verso: 'cat' },
    media: [],
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

test('generateGuid: guias únicos com formato estável', () => {
  const a = generateGuid();
  const b = generateGuid();
  assert.ok(a.length >= 16);
  assert.notEqual(a, b);
});

test('hasGuid: true com GUID e false para ausente/blank', () => {
  assert.equal(hasGuid(makeNote({ guid: 'anki-guid-1' })), true);
  assert.equal(hasGuid(makeNote({ guid: '   ' })), false);
  assert.equal(hasGuid(makeNote()), false);
});

test('normalizeFieldValue: remove etiquetas HTML, entidades e colapsa espaços', () => {
  assert.equal(normalizeFieldValue('<b>gato</b>'), 'gato');
  assert.equal(normalizeFieldValue('<div> olá \n mundo </div>'), 'olá mundo');
  assert.equal(normalizeFieldValue('a&nbsp;&amp;&nbsp;b<br>'), 'a & b');
  assert.equal(normalizeFieldValue('&lt;i&gt;x&lt;/i&gt;'), '<i>x</i>');
  assert.equal(normalizeFieldValue(undefined as unknown as string), '');
});

test('normalizeFieldValue: preserva maiúsculas/minúsculas (conteúdo real)', () => {
  assert.equal(normalizeFieldValue('Gato'), 'Gato');
  assert.notEqual(normalizeFieldValue('Gato'), normalizeFieldValue('gato'));
});

test('computeNoteSignature: mesma nota (conteúdos equivalentes) → mesma assinatura', () => {
  const a = makeNote({ fields: { Frente: '<b>gato</b>', Verso: '<i>cat</i>' } });
  const b = makeNote({ fields: { Frente: 'gato', Verso: 'cat' } });
  assert.equal(
    computeNoteSignature(a, 'Básico', 'Japanese'),
    computeNoteSignature(b, 'Básico', 'Japanese')
  );
});

test('computeNoteSignature: conteúdo diferente → assinatura diferente', () => {
  const a = makeNote();
  const b = makeNote({ fields: { Frente: 'cão', Verso: 'dog' } });
  assert.notEqual(
    computeNoteSignature(a, 'Básico', 'Japanese'),
    computeNoteSignature(b, 'Básico', 'Japanese')
  );
});

test('computeNoteSignature: deck ou tipo diferentes → assinatura diferente', () => {
  const a = makeNote();
  assert.notEqual(
    computeNoteSignature(a, 'Básico', 'Japanese'),
    computeNoteSignature(a, 'Básico', 'Italian')
  );
  assert.notEqual(
    computeNoteSignature(a, 'Básico', 'Japanese'),
    computeNoteSignature(a, 'Cloze', 'Japanese')
  );
});

test('computeNoteSignature: campo vazio/marcado em branco e campo ausente são a mesma nota', () => {
  const a = makeNote({ fields: { Frente: 'gato' } });
  const b = makeNote({ fields: { Frente: 'gato', Verso: ' <div></div> ' } });
  const c = makeNote({ fields: { Frente: 'gato', Verso: '' } });
  const s = computeNoteSignature(a, 'Básico', 'D');
  assert.equal(s, computeNoteSignature(b, 'Básico', 'D'));
  assert.equal(s, computeNoteSignature(c, 'Básico', 'D'));
});

test('computeNoteSignature: ordem das propriedades do campo não importa', () => {
  const a = makeNote({ fields: { Frente: 'gato', Verso: 'cat' } });
  const b = makeNote({ fields: { Verso: 'cat', Frente: 'gato' } });
  assert.equal(
    computeNoteSignature(a, 'Básico', 'D'),
    computeNoteSignature(b, 'Básico', 'D')
  );
});

test('ensureNoteGuids: preenche apenas as que faltam e preserva o GUID existente', () => {
  const notes = [
    makeNote({ id: 'n1', guid: '  ' }),
    makeNote({ id: 'n2', guid: 'anki-2' }),
    makeNote({ id: 'n3' }),
  ];
  const out = ensureNoteGuids(notes);
  assert.equal(out[0].guid!.length >= 16, true);
  assert.equal(out[1].guid, 'anki-2');
  assert.equal(out[2].guid!.length >= 16, true);
  // Cada nota ganhou um GUID distinto
  assert.notEqual(out[0].guid, out[2].guid);
});

test('ensureNoteGuids: quando tudo tem GUID, devolve a MESMA referência', () => {
  const notes = [makeNote({ guid: 'a' }), makeNote({ guid: 'b' })];
  assert.equal(ensureNoteGuids(notes), notes);
});

test('ensureNoteGuids: lista vazia não muda nada', () => {
  const notes: Note[] = [];
  assert.equal(ensureNoteGuids(notes), notes);
});
