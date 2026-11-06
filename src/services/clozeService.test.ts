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
