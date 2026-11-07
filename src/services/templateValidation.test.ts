import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findUnknownFields,
  findHtmlIssues,
  findCssIssues,
  validateTemplates,
} from './templateValidation';

test('findUnknownFields: campo correto não gera problema', () => {
  const issues = findUnknownFields('<div class="c">{{Frente}}</div>', ['Frente', 'Verso']);
  assert.deepEqual(issues, []);
});

test('findUnknownFields: campo inexistente gera problema', () => {
  const issues = findUnknownFields('<div>{{Frentr}}</div>', ['Frente', 'Verso']);
  assert.equal(issues.length, 1);
  assert.ok(issues[0].includes('{{Frentr}}'));
});

test('findUnknownFields: campo com grafia diferente (maiúsculas) também é erro, sem sugestão', () => {
  const issues = findUnknownFields('{{verso}}', ['Verso']);
  assert.equal(issues.length, 1);
  assert.ok(issues[0].includes('{{verso}}'));
  assert.ok(!issues[0].includes('quer dizer'));
});

test('findUnknownFields: tags especiais não contam como campo', () => {
  const html =
    '{{FrontSide}}{{cloze:Texto}}{{hint:Dica}}{{furigana:Kanji}}{{kanji:X}}{{kana:Y}}{{voice:record}}{{#B}}z{{/B}}{{^B}}w{{/B}}';
  const issues = findUnknownFields(html, ['Texto', 'Dica', 'Kanji', 'X', 'Y']);
  assert.deepEqual(issues, []);
});

test('findUnknownFields: não repete o mesmo campo citado duas vezes', () => {
  const issues = findUnknownFields('{{Foo}}{{Foo}}', []);
  assert.equal(issues.length, 1);
});

test('findUnknownFields: cloze: com campo certo passa e com erro de digitação falha', () => {
  assert.deepEqual(findUnknownFields('{{cloze:Frente}}', ['Frente', 'Verso']), []);
  const issues = findUnknownFields('{{cloze:Frentr}}', ['Frente', 'Verso']);
  assert.equal(issues.length, 1);
  assert.ok(issues[0].includes('{{cloze:Frentr}}'));
});

test('findUnknownFields: hint:, furigana:, kanji: e kana: validam o campo dentro deles', () => {
  const html = '{{hint:Dicca}}{{furigana:Kanjii}}{{kanji:X}}{{kana:Y}}';
  const issues = findUnknownFields(html, ['Dica', 'Kanji', 'X', 'Y']);
  assert.equal(issues.length, 2);
  assert.ok(issues.every((i) => i.includes('não existe')));
});

test('findUnknownFields: voice: com comando certo passa e com erro de digitação falha', () => {
  assert.deepEqual(findUnknownFields('{{voice:record}}{{voice:reproduce}}', []), []);
  const issues = findUnknownFields('{{voice:recrd}}', []);
  assert.equal(issues.length, 1);
  assert.ok(issues[0].includes('{{voice:recrd}} inválido'));
  assert.ok(issues[0].includes('voice:record'));
});

test('findUnknownFields: prefixo errado com dois-pontos é tag não reconhecida', () => {
  const issues = findUnknownFields('{{hitnt:Frase}}{{voicce:record}}', ['Frase']);
  assert.equal(issues.length, 2);
  assert.ok(issues.some((i) => i.includes('{{hitnt:Frase}} não é reconhecida')));
  assert.ok(issues.some((i) => i.includes('{{voicce:record}} não é reconhecida')));
});

test('findHtmlIssues: template saudável passa limpo', () => {
  const html = '<div class="x"><span>a</span></div><hr id="answer"><img src="a.png"><br>';
  assert.deepEqual(findHtmlIssues(html), []);
});

test('findHtmlIssues: div sem fechar', () => {
  const issues = findHtmlIssues('<div><span>a</span>');
  assert.deepEqual(issues, ['Tag <div> não fechada']);
});

test('findHtmlIssues: fechamento sem abertura', () => {
  const issues = findHtmlIssues('a</span>b');
  assert.deepEqual(issues, ['</span> sem a abertura correspondente']);
});

test('findHtmlIssues: auto-fechamento (fecha fora de ordem) não é erro', () => {
  const issues = findHtmlIssues('<div><span></div></span>');
  assert.deepEqual(issues, []);
});

test('findHtmlIssues: tag incompleta sem ">"', () => {
  const issues = findHtmlIssues('<div class="x');
  assert.deepEqual(issues, ['Tag incompleta (falta o ">" no fim)']);
});

test('findHtmlIssues: comentário e self-closing não estragam o balanceamento', () => {
  const html = '<!-- nota --><div>a</div><audio class="x"></audio>';
  assert.deepEqual(findHtmlIssues(html), []);
});

test('findHtmlIssues: entidade &lt; não é tratada como tag', () => {
  assert.deepEqual(findHtmlIssues('a &lt;div&gt; b'), []);
});

test('findHtmlIssues: repete a mensagem com contagem quando acontece 2x', () => {
  const issues = findHtmlIssues('<div>a</div></b></b>');
  assert.deepEqual(issues, ['</b> sem a abertura correspondente (2x)']);
});

test('findCssIssues: css saudável passa limpo', () => {
  assert.deepEqual(findCssIssues('.card { font-size: 24px; }\n.x { color: red; }'), []);
});

test('findCssIssues: chave sem fechar', () => {
  assert.deepEqual(findCssIssues('.card { font-size: 24px;'), ['Chave { sem a correspondente }']);
});

test('findCssIssues: chave a mais', () => {
  assert.deepEqual(findCssIssues('.card { color: red; } }'), ['Chave } a mais (1x)']);
});

test('findCssIssues: comentário sem fechar', () => {
  assert.deepEqual(findCssIssues('/* regra da frente .card { color: red; }'), [
    'Comentário do CSS (/*) sem fechar',
  ]);
});

test('findCssIssues: css vazio é válido (aba limpa)', () => {
  assert.deepEqual(findCssIssues(''), []);
});

test('validateTemplates: junta tudo com o nome do template e a aba', () => {
  const issues = validateTemplates(
    [
      { name: 'Card 1', qfmt: '{{Frentr}}', afmt: '{{Verso}}<div>' },
    ],
    '.card { color: red;',
    ['Frente', 'Verso']
  );
  assert.ok(issues.some((i) => i.startsWith('Card 1 (frente)') && i.includes('{{Frentr}}')));
  assert.ok(issues.some((i) => i.startsWith('Card 1 (verso)') && i.includes('<div> não fechada')));
});

test('validateTemplates: templates saudáveis devolvem lista vazia', () => {
  const issues = validateTemplates(
    [
      {
        name: 'Card 1',
        qfmt: '<div class="r">{{Frente}}</div>',
        afmt: '{{FrontSide}}<hr id="answer">{{Verso}}',
      },
    ],
    '.card { font-size: 24px; }',
    ['Frente', 'Verso']
  );
  assert.deepEqual(issues, []);
});
