import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFieldBlock,
  buildFieldCssRule,
  buildFieldSlugs,
  CARD_CSS_SELECTOR,
  cssFieldSelectors,
  cssSelectorAt,
  ensureFieldCssRule,
  extractStyleableTags,
  fieldCssSelector,
  getCssProperty,
  hasCssRule,
  hasFieldCssRule,
  removeCssProperty,
  setCssProperty,
  slugifyFieldName,
  tagCssSlug,
  templateUsesField,
  toggleCssProperty,
} from './templateBlocks';

test('slugifyFieldName: mantém o nome em inglês', () => {
  assert.equal(slugifyFieldName('Sentence'), 'sentence');
  assert.equal(slugifyFieldName('Image'), 'image');
});

test('slugifyFieldName: remove acentos', () => {
  assert.equal(slugifyFieldName('Sentença'), 'sentenca');
  assert.equal(slugifyFieldName('Áudio'), 'audio');
  assert.equal(slugifyFieldName('Leitura'), 'leitura');
});

test('slugifyFieldName: troca espaços e pontuação por hífen', () => {
  assert.equal(slugifyFieldName('My Field'), 'my-field');
  assert.equal(slugifyFieldName('Front / Back'), 'front-back');
});

test('slugifyFieldName: nunca fica vazio', () => {
  assert.equal(slugifyFieldName(''), 'campo');
  assert.equal(slugifyFieldName('***'), 'campo');
});

test('buildFieldSlugs: nomes iguais não colidem', () => {
  const slugs = buildFieldSlugs(['My Field', 'my-field']);
  assert.equal(slugs['My Field'], 'my-field');
  assert.equal(slugs['my-field'], 'my-field-2');
});

test('buildFieldBlock: cria o wrapper com a classe do campo (sem rótulo)', () => {
  const block = buildFieldBlock('Sentence', 'sentence');
  assert.equal(block, '<div class="runora-field runora-field--sentence">{{Sentence}}</div>');
  // o bloco NÃO pode levar style inline (a regra do CSS do tipo de nota manda)
  assert.ok(!block.includes('style='));
  assert.ok(!block.includes('runora-field-label'));
});

test('buildFieldCssRule: cria a regra da classe do campo (sem negrito)', () => {
  const rule = buildFieldCssRule('sentence');
  assert.ok(rule.includes('.runora-field--sentence {'));
  assert.ok(rule.includes('font-size: 24px;'));
  // o campo NÃO pode nascer em negrito (o botão Negrito ficaria ligado)
  assert.ok(!rule.includes('font-weight'));
});

test('hasFieldCssRule / hasCssRule: encontra a regra existente', () => {
  const css = buildFieldCssRule('sentence');
  assert.equal(hasFieldCssRule(css, 'sentence'), true);
  assert.equal(hasFieldCssRule(css, 'image'), false);
  assert.equal(hasCssRule(css, fieldCssSelector('sentence')), true);
  assert.equal(hasCssRule(css, CARD_CSS_SELECTOR), false);
});

test('getCssProperty: lê o valor da propriedade', () => {
  const css = buildFieldCssRule('sentence');
  assert.equal(getCssProperty(css, fieldCssSelector('sentence'), 'font-size'), '24px');
  assert.equal(getCssProperty(css, fieldCssSelector('sentence'), 'font-weight'), null);
  assert.equal(getCssProperty(css, fieldCssSelector('sentence'), 'text-align'), null);
  assert.equal(getCssProperty(css, fieldCssSelector('image'), 'font-size'), null);
});

test('setCssProperty: troca a propriedade dentro da regra', () => {
  const css = buildFieldCssRule('sentence');
  const out = setCssProperty(css, fieldCssSelector('sentence'), 'font-size', '40px');
  assert.equal(getCssProperty(out, fieldCssSelector('sentence'), 'font-size'), '40px');
  // não pode duplicar a propriedade
  assert.equal((out.match(/font-size/g) || []).length, 1);
  // as outras propriedades continuam
  assert.equal(getCssProperty(out, fieldCssSelector('sentence'), 'font-weight'), null);
});

test('setCssProperty: cria a regra se ainda não existir', () => {
  const out = setCssProperty('.outro { font-size: 20px; }', CARD_CSS_SELECTOR, 'font-weight', 'bold');
  assert.equal(getCssProperty(out, CARD_CSS_SELECTOR, 'font-weight'), 'bold');
  assert.ok(out.includes('.outro { font-size: 20px; }'));
  assert.ok(out.includes('.card {'));
});

test('setCssProperty: soma na regra que já existe', () => {
  const out = setCssProperty(
    '.card { font-size: 20px; }',
    CARD_CSS_SELECTOR,
    'font-weight',
    'bold'
  );
  assert.ok(out.includes('.card {'));
  assert.equal((out.match(/\.card\s*\{/g) || []).length, 1);
  assert.equal(getCssProperty(out, CARD_CSS_SELECTOR, 'font-size'), '20px');
  assert.equal(getCssProperty(out, CARD_CSS_SELECTOR, 'font-weight'), 'bold');
});

test('setCssProperty: mexe só na regra pedida (não em outras com prefixo parecido)', () => {
  const css = '.card-body { color: red; }';
  const out = setCssProperty(css, CARD_CSS_SELECTOR, 'color', 'blue');
  assert.ok(out.includes('.card-body { color: red; }'));
  assert.ok(out.includes('.card {'));
});

test('removeCssProperty: tira a propriedade da regra', () => {
  const css = buildFieldCssRule('sentence');
  const out = removeCssProperty(css, fieldCssSelector('sentence'), 'font-weight');
  assert.equal(getCssProperty(out, fieldCssSelector('sentence'), 'font-weight'), null);
  assert.equal(getCssProperty(out, fieldCssSelector('sentence'), 'font-size'), '24px');
});

test('toggleCssProperty: liga e desliga o mesmo formato', () => {
  const css = buildFieldCssRule('sentence');
  const ligado = toggleCssProperty(css, fieldCssSelector('sentence'), 'font-style', 'italic');
  assert.equal(getCssProperty(ligado, fieldCssSelector('sentence'), 'font-style'), 'italic');
  const desligado = toggleCssProperty(ligado, fieldCssSelector('sentence'), 'font-style', 'italic');
  assert.equal(getCssProperty(desligado, fieldCssSelector('sentence'), 'font-style'), null);
});

test('templateUsesField: acha o campo no HTML', () => {
  const html = '<div class="runora-field runora-field--sentence">{{Sentence}}</div>';
  assert.equal(templateUsesField(html, 'Sentence'), true);
  assert.equal(templateUsesField(html, 'Image'), false);
});

test('templateUsesField: acha o campo com tag prefixada', () => {
  assert.equal(templateUsesField('{{furigana:Reading}}', 'Reading'), true);
  assert.equal(templateUsesField('{{cloze:Front}}', 'Front'), true);
});

test('templateUsesField: não confunde {{FrontSide}} com o campo Front', () => {
  assert.equal(templateUsesField('{{FrontSide}}', 'Front'), false);
  assert.equal(templateUsesField('{{FrontSide}}', 'FrontSide'), true);
});

test('ensureFieldCssRule: cria a regra quando ela não existe', () => {
  const out = ensureFieldCssRule('.card { font-size: 20px; }', 'hint');
  assert.ok(out.includes('.runora-field--hint {'));
  assert.equal(getCssProperty(out, fieldCssSelector('hint'), 'font-size'), '24px');
});

test('ensureFieldCssRule: não mexe no CSS se a regra já existe', () => {
  const css = buildFieldCssRule('hint');
  assert.equal(ensureFieldCssRule(css, 'hint'), css);
});

test('ensureFieldCssRule: funciona com CSS vazio', () => {
  const out = ensureFieldCssRule('', 'voice-record');
  assert.ok(out.includes('.runora-field--voice-record {'));
});

test('extractStyleableTags: acha os campos usados no HTML', () => {
  const html = '<div class="runora-field runora-field--sentence">{{Sentence}}</div>';
  const out = extractStyleableTags(html, ['Sentence', 'Image']);
  assert.deepEqual(out, ['Sentence']);
});

test('extractStyleableTags: acha as tags especiais', () => {
  const html = [
    '<div class="runora-field runora-field--hint">{{hint}}</div>',
    '<div class="runora-field runora-field--furigana-reading">{{furigana:Reading}}</div>',
    '<div class="runora-field runora-field--voice-record">{{voice:record}}</div>',
    '<div class="runora-field runora-field--voice-reproduce">{{voice:reproduce}}</div>',
  ].join('\n');
  const out = extractStyleableTags(html, ['Reading']);
  assert.deepEqual(out, ['hint', 'furigana:Reading', 'voice:record', 'voice:reproduce']);
});

test('extractStyleableTags: ignora {{FrontSide}} e tags desconhecidas', () => {
  const out = extractStyleableTags('{{FrontSide}}<hr id="answer">{{Type}}', ['Sentence']);
  assert.deepEqual(out, []);
});

test('extractStyleableTags: não repete o mesmo campo', () => {
  const out = extractStyleableTags('{{Sentence}} {{Sentence}}', ['Sentence']);
  assert.deepEqual(out, ['Sentence']);
});

test('cssFieldSelectors: lista os campos que têm regra no CSS', () => {
  const css = '.card { font-size: 20px; }\n\n.runora-field--sentence {\n  font-size: 28px;\n}\n\n.runora-field--hint {\n}';
  assert.deepEqual(cssFieldSelectors(css), ['sentence', 'hint']);
});

test('cssFieldSelectors: CSS sem regra de campo devolve lista vazia', () => {
  assert.deepEqual(cssFieldSelectors('.card { font-size: 20px; }'), []);
});

test('cssSelectorAt: acha o seletor onde o cursor está', () => {
  const css = '.card {\n  font-size: 20px;\n}\n\n.runora-field--sentence {\n  font-size: 28px;\n}';
  // dentro da regra do sentence
  assert.equal(cssSelectorAt(css, css.indexOf('font-size: 28px')), '.runora-field--sentence');
  // dentro da regra do card
  assert.equal(cssSelectorAt(css, css.indexOf('font-size: 20px')), '.card');
  // no seletor (antes da chave)
  assert.equal(cssSelectorAt(css, css.indexOf('{')), '.card');
});

test('cssSelectorAt: devolve null quando não há regra antes do cursor', () => {
  assert.equal(cssSelectorAt('', 0), null);
  assert.equal(cssSelectorAt('/* só um comentário */', 5), null);
});

test('cssSelectorAt: aceita seletor com mais de um alvo', () => {
  const css = '.card, .runora-field--sentence {\n  color: red;\n}';
  assert.equal(cssSelectorAt(css, css.indexOf('color')), '.card, .runora-field--sentence');
});

test('cssSelectorAt: acha o seletor quando o cursor está em cima dele', () => {
  const css = '.runora-field--image {\n  font-size: 28px;\n}';
  // cursor no meio do nome do seletor (antes da chave)
  assert.equal(cssSelectorAt(css, 10), '.runora-field--image');
});

test('cssSelectorAt: cada seletor pega o seu próprio (não o da regra de cima)', () => {
  const css = [
    '.runora-field--image {',
    '  font-size: 28px;',
    '}',
    '',
    '.runora-field--sentence {',
    '  font-size: 28px;',
    '}',
  ].join('\n');
  // no nome do seletor da segunda regra
  const pos = css.indexOf('.runora-field--sentence') + 5;
  assert.equal(cssSelectorAt(css, pos), '.runora-field--sentence');
  // dentro das declarações da segunda regra
  assert.equal(
    cssSelectorAt(css, css.lastIndexOf('font-size: 28px;') + 3),
    '.runora-field--sentence'
  );
  // na primeira regra continua funcionando
  assert.equal(
    cssSelectorAt(css, css.indexOf('.runora-field--image') + 5),
    '.runora-field--image'
  );
});

test('cssSelectorAt: seletor em várias linhas', () => {
  const css = '.card,\n.runora-field--sentence {\n  color: red;\n}';
  assert.equal(
    cssSelectorAt(css, css.indexOf('.runora-field--sentence') + 5),
    '.runora-field--sentence'
  );
});

/* ---------- Slug compartilhado ---------- */

test('tagCssSlug: campo do tipo de nota usa o mapa', () => {
  const slugs = buildFieldSlugs(['Sentence', 'My Field']);
  assert.equal(tagCssSlug('Sentence', slugs), 'sentence');
  assert.equal(tagCssSlug('My Field', slugs), 'my-field');
});

test('tagCssSlug: tags especiais usam o slug direto', () => {
  assert.equal(tagCssSlug('furigana:Reading', {}), 'furigana-reading');
  assert.equal(tagCssSlug('voice:record', {}), 'voice-record');
  assert.equal(tagCssSlug('voice:reproduce', {}), 'voice-reproduce');
  assert.equal(tagCssSlug('cloze:Texto', {}), 'cloze-texto');
  assert.equal(tagCssSlug('hint', {}), 'hint');
  assert.equal(tagCssSlug('hint:Dica', {}), 'hint-dica');
});

test('extractStyleableTags: acha a tag {{hint:Campo}}', () => {
  const tags = extractStyleableTags('<div class="runora-field runora-field--hint-dica">{{hint:Dica}}</div>', [
    'Frase',
    'Dica',
  ]);
  assert.deepEqual(tags, ['hint:Dica']);
});
