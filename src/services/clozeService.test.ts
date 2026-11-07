import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClozeService } from './clozeService';
import { SAMPLE_AUDIO_DATA_URI, SAMPLE_IMAGE_DATA_URI } from './sampleMedia';

test('formatMediaContent: converte data URI de imagem em <img>', () => {
  const out = ClozeService.formatMediaContent(SAMPLE_IMAGE_DATA_URI);
  assert.match(out, /^<img /);
  assert.ok(out.includes(`src="${SAMPLE_IMAGE_DATA_URI}"`));
});

test('formatMediaContent: converte data URI de audio em <audio>', () => {
  const out = ClozeService.formatMediaContent(SAMPLE_AUDIO_DATA_URI);
  assert.match(out, /^<audio /);
  assert.ok(out.includes(`src="${SAMPLE_AUDIO_DATA_URI}"`));
});

test('formatMediaContent: URL de imagem com extensao vira <img>', () => {
  const out = ClozeService.formatMediaContent('https://example.com/foto.jpg');
  assert.match(out, /^<img /);
});

test('formatMediaContent: URL de imagem SEM extensao (Unsplash) vira <img>', () => {
  const url = 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?w=300&auto=format&fit=crop&q=60';
  const out = ClozeService.formatMediaContent(url);
  assert.match(out, /^<img /, `esperava <img>, recebeu: ${out}`);
  assert.ok(out.includes(url));
});

test('formatMediaContent: URL de audio vira <audio>', () => {
  const out = ClozeService.formatMediaContent('https://example.com/audio.mp3');
  assert.match(out, /^<audio /);
});

test('formatMediaContent: [sound:...] vira <audio>', () => {
  const out = ClozeService.formatMediaContent('[sound:track.mp3]');
  assert.match(out, /^<audio /);
});

test('formatMediaContent: nao converte URL que ja esta em src=""', () => {
  const html = '<img src="https://images.unsplash.com/photo-1?w=300" />';
  const out = ClozeService.formatMediaContent(html);
  assert.equal(out, html);
  assert.equal(out.match(/<img/g)?.length, 1);
});

test('formatMediaContent: nao converte URL de link em href=""', () => {
  const html = '<a href="https://images.unsplash.com/photo-1?w=300">link</a>';
  const out = ClozeService.formatMediaContent(html);
  assert.equal(out, html);
});

test('formatMediaContent: URL comum no texto continua texto', () => {
  const out = ClozeService.formatMediaContent('https://example.com/pagina');
  assert.equal(out, 'https://example.com/pagina');
});

test('renderTemplate: campo com data URI de imagem vira <img> no card', () => {
  const html = ClozeService.renderTemplate('{{Foto}}', { Foto: SAMPLE_IMAGE_DATA_URI }, false);
  assert.match(html, /<img /);
  assert.ok(html.includes(SAMPLE_IMAGE_DATA_URI));
});

test('renderTemplate: campo com data URI de audio vira <audio> no card', () => {
  const html = ClozeService.renderTemplate('{{Audio}}', { Audio: SAMPLE_AUDIO_DATA_URI }, false);
  assert.match(html, /<audio /);
});

test('renderTemplate: campo vazio nao satisfaz condicional {{#Campo}}', () => {
  const html = ClozeService.renderTemplate('{{#Foto}}tem foto{{/Foto}}', { Foto: '' }, false);
  assert.equal(html, '');
});

test('renderTemplate: campo preenchido satisfaz condicional {{#Campo}}', () => {
  const html = ClozeService.renderTemplate('{{#Foto}}tem foto{{/Foto}}', { Foto: 'x' }, false);
  assert.equal(html, 'tem foto');
});

test('formatMediaContent: [sound:] contendo data URI vira UMA tag <audio> (bug do anexo duplo)', () => {
  // arquivo anexado é gravado como [sound:data:audio/mpeg;base64,...]
  const out = ClozeService.formatMediaContent(`[sound:${SAMPLE_AUDIO_DATA_URI}]`);
  assert.equal(out.match(/<audio\b/g)?.length, 1);
  assert.ok(!out.includes('[sound:'), `sobrou marcador sound: ${out.slice(0, 120)}`);
  assert.ok(!out.includes('<img'), 'não deve criar <img> no áudio anexado');
  assert.ok(out.includes(`src="${SAMPLE_AUDIO_DATA_URI}"`));
});

test('formatMediaContent: [sound:] com arquivo normal continua funcionando', () => {
  const out = ClozeService.formatMediaContent('[sound:audio.mp3]');
  assert.equal(out.match(/<audio\b/g)?.length, 1);
  assert.ok(out.includes('src="audio.mp3"'));
});

test('renderTemplate: template com audio anexado não deixa texto de tag no card', () => {
  const campo = `[sound:${SAMPLE_AUDIO_DATA_URI}]`;
  const front = ClozeService.renderTemplate('{{Audio}}', { Audio: campo }, false);
  // o card inteiro é UM <audio> — nada de fragmento de tag solto em volta
  assert.match(front, /^\s*<audio\b[^>]*><\/audio>\s*$/, `recebeu: ${front.slice(0, 200)}`);
  // o verso embute a frente via {{FrontSide}} — o áudio não pode se duplicar
  const back = ClozeService.renderTemplate('{{FrontSide}}<hr/>', { Audio: campo }, true, front);
  assert.equal(back.match(/<audio\b/g)?.length, 1, `esperava 1 audio no verso, recebeu: ${back.slice(0, 200)}`);
  assert.match(back, /^<audio\b[^>]*><\/audio><hr\/>$/, `recebeu: ${back.slice(0, 200)}`);
});

test('{{hint:Campo}}: na frente vira botão Show Hint colapsado', () => {
  const html = ClozeService.renderTemplate('{{hint:Dica}}', { Dica: 'conteúdo da dica' }, false);
  assert.match(html, /<details class="runora-hint-details/);
  assert.ok(html.includes('Show Hint'));
  assert.ok(html.includes('conteúdo da dica'));
});

test('{{hint:Campo}}: no verso a dica aparece revelada, sem botão', () => {
  const html = ClozeService.renderTemplate('{{hint:Dica}}', { Dica: 'conteúdo da dica' }, true);
  assert.ok(!html.includes('<details'), `não devia ter <details>: ${html}`);
  assert.ok(html.includes('conteúdo da dica'));
  assert.ok(html.includes('runora-hint-revealed'));
});

test('{{FrontSide}}: botão de dica da frente vira caixa revelada no verso', () => {
  const front = ClozeService.renderTemplate('{{hint:Dica}}', { Dica: 'lembre-se' }, false);
  assert.ok(front.includes('runora-hint-details'));
  const back = ClozeService.renderTemplate('{{FrontSide}}<hr/>Resposta', { Dica: 'lembre-se' }, true, front);
  assert.ok(!back.includes('<details'));
  assert.ok(back.includes('lembre-se'));
  assert.ok(back.includes('runora-hint-revealed'));
  assert.ok(back.includes('Resposta'));
});

test('renderTemplate: template da frente re-renderizado em modo verso revela o cloze', () => {
  // verso do tipo Cloze sem {{cloze:Campo}}: a StudyView re-renderiza a
  // frente em modo verso para manter os divs/CSS e revelar a resposta
  const qfmt = '<div class="campo">{{cloze:Texto}}</div>';
  const campos = { Texto: 'Aqui {{c1::segredo}} aqui.' };
  const frente = ClozeService.renderTemplate(qfmt, campos, false, undefined, 1);
  assert.ok(frente.includes('runora-cloze-front-placeholder'), `mascara esperada: ${frente}`);
  const frenteNoVerso = ClozeService.renderTemplate(qfmt, campos, true, undefined, 1);
  assert.ok(frenteNoVerso.includes('runora-cloze-back-revealed'), `revelado esperado: ${frenteNoVerso}`);
  assert.ok(!frenteNoVerso.includes('runora-cloze-front-placeholder'));
  assert.ok(frenteNoVerso.includes('segredo'));
});
