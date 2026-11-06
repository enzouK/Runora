/**
 * Mídia de exemplo EMBUTIDA no app (data URI).
 *
 * Motivo: a pré-visualização dos templates precisa mostrar uma imagem e um
 * áudio de exemplo SEM depender de internet, de site de terceiros ou de link
 * que possa quebrar. Como data URI, funciona igual no navegador, no
 * emulador Android (WebView) e no app desktop (Electron), inclusive offline.
 *
 * - Imagem: SVG (texto, nítido em qualquer zoom, ~2 KB)
 * - Áudio: WAV mono 8 kHz / 8 bits, 0,55 s (~6 KB)
 */

/** SVG de exemplo: paisagem com o rótulo "Imagem de exemplo". */
export const SAMPLE_IMAGE_DATA_URI =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NDAiIGhlaWdodD0iNDIwIiB2aWV3Qm94PSIwIDAgNjQwIDQyMCI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9InNreSIgeDE9IjAiIHkxPSIwIiB4Mj0iMCIgeTI9IjEiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAlIiBzdG9wLWNvbG9yPSIjYTViNGZjIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iNTUlIiBzdG9wLWNvbG9yPSIjYzRiNWZkIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1jb2xvcj0iI2ZiY2ZlOCIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0iaGlsbDEiIHgxPSIwIiB5MT0iMCIgeDI9IjAiIHkyPSIxIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iIzhiNWNmNiIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiM2ZDI4ZDkiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImhpbGwyIiB4MT0iMCIgeTE9IjAiIHgyPSIwIiB5Mj0iMSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiNjMDg0ZmMiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjYTg1NWY3Ii8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogIDwvZGVmcz4KICA8cmVjdCB3aWR0aD0iNjQwIiBoZWlnaHQ9IjQyMCIgZmlsbD0idXJsKCNza3kpIi8+CiAgPGNpcmNsZSBjeD0iNDcwIiBjeT0iMTA4IiByPSI0NiIgZmlsbD0iI2ZmZjdlZCIgb3BhY2l0eT0iMC45MiIvPgogIDxjaXJjbGUgY3g9IjQ3MCIgY3k9IjEwOCIgcj0iNjYiIGZpbGw9IiNmZmY3ZWQiIG9wYWNpdHk9IjAuMjUiLz4KICA8cGF0aCBkPSJNMCAzMDAgTDE1MCAxOTAgTDI4MCAzMDAgWiIgZmlsbD0idXJsKCNoaWxsMSkiLz4KICA8cGF0aCBkPSJNMjAwIDMwMCBMMzgwIDE2NSBMNTYwIDMwMCBaIiBmaWxsPSJ1cmwoI2hpbGwyKSIvPgogIDxwYXRoIGQ9Ik0zODAgMzAwIEw1MjAgMjE1IEw2NDAgMzAwIFoiIGZpbGw9InVybCgjaGlsbDEpIiBvcGFjaXR5PSIwLjg1Ii8+CiAgPHJlY3QgeT0iMzAwIiB3aWR0aD0iNjQwIiBoZWlnaHQ9IjEyMCIgZmlsbD0iIzRjMWQ5NSIvPgogIDxyZWN0IHk9IjMwMCIgd2lkdGg9IjY0MCIgaGVpZ2h0PSIxMjAiIGZpbGw9IiMzMTJlODEiIG9wYWNpdHk9IjAuMzUiLz4KICA8ZyBmaWxsPSIjZmZmZmZmIiBvcGFjaXR5PSIwLjU1Ij4KICAgIDxjaXJjbGUgY3g9IjcwIiBjeT0iNzAiIHI9IjMiLz48Y2lyY2xlIGN4PSIxMzAiIGN5PSI0MiIgcj0iMi4yIi8+CiAgICA8Y2lyY2xlIGN4PSIyNTAiIGN5PSI4NiIgcj0iMi42Ii8+PGNpcmNsZSBjeD0iMzQwIiBjeT0iNDYiIHI9IjIiLz4KICAgIDxjaXJjbGUgY3g9IjU2MCIgY3k9IjYyIiByPSIyLjQiLz48Y2lyY2xlIGN4PSI2MDAiIGN5PSIxMDQiIHI9IjEuOCIvPgogIDwvZz4KICA8dGV4dCB4PSIzMjAiIHk9IjM3OCIgZm9udC1mYW1pbHk9InN5c3RlbS11aSwgLWFwcGxlLXN5c3RlbSwgU2Vnb2UgVUksIFJvYm90bywgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyMSIgZm9udC13ZWlnaHQ9IjYwMCIgZmlsbD0iI2ZmZmZmZiIgb3BhY2l0eT0iMC44MiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+SW1hZ2VtIGRlIGV4ZW1wbG88L3RleHQ+Cjwvc3ZnPg==';

/** WAV de exemplo: dois tons (sino) de 0,55 s. */
export const SAMPLE_AUDIO_DATA_URI =
  'data:audio/wav;base64,UklGRlQRAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YTARAACAgIGCgoGAf317eXt/hYmJh4SBfXl0cnV9iJCRjYeCfHVuam56ipaZlIuDfHJoYmZ2i5yhm5CFfHBkW15wiqCoopWIfG9gVFZqiaSwqpuLfW5dUFBkhaSyrZ6Nf3BfUU9hgaCxrp+PgHJiU09efZ2wr6GQgnRkVE9ceZmusKOShHZmVk9ZdZassKWUhXhpWFBYcZKqsKaWh3prWlBWbY6osKiYiHttXVFVaoqlr6mZin1vX1JUZ4air6qbjH5xYVRTZIKfrqudjYBzY1VSYX6crayfj4J1ZVdSX3qYq6ygkYN2Z1lSXXeVqq2ikoV4altTW3ORqK2jlIZ6bFxTWXCOpa2llod7bl5UWGyKo6yml4l9cGBVV2mGoKynmYp+cWNWVmaDnquom4yAc2VYVWR/m6qpnI6BdWdZVWF8mKmpno+Cd2lbVV94lKeqn5GEeGtdVl51kaWqoZKFem1eVlxxjqOqopSHe25gV1tuiqGqo5WIfXBiWFprh5+ppJeJfnJkWVlpg5yopZiLf3RmWlhmgJqnppqMgXVoW1hkfZemppuOgndqXVhieZSlp52Pg3hsX1hgdpGjp56RhXptYFlfc46ip5+ShntvYlldcIqgp6CUh3xxZFpcbYedp6GViH5yZVtca4SbpqKWin90Z1xbaYGZpaOYi4B2aV5bZn6WpKSZjIJ3a19bZHuTo6SbjoN4bGBbY3iQoaScj4R6bmJbYXWNoKSdkYV7cGNcYHKKnqSekoZ8cWVdX2+HnKSfk4h+c2ddXm2EmqSglYl/dGheXmuBmKOhloqAdmpgXWl/laKhl4uBd2xhXWd8k6GimI2CeW1iXWV5kKCimo6Dem9kXmR2jZ6im4+Fe3FlXmJzipyinJCGfHJnX2FxiJuinZKHfnNoX2FvhZmhnpOIf3VqYGBtgpehnpSJgHZrYWBrf5Sgn5WKgXhtY2BpfZKfn5eLgnluZGBnepCeoJiNg3pwZWBmd42coJmOhHtxZmBldYqboJqPhXxzaGFkc4iZoJuQhn10aWFjcIWXn5uRh351a2JiboOWn5yTiH93bGNibICTnp2UiYF4bmRia32RnZ2VioJ5b2ViaXuPnJ2WjIJ6cGdiaHmNm56XjYN7cmhiZ3aKmp6YjoR8c2ljZnSImJ6Zj4V9dGpjZXKFlp2ZkIZ+dmxkZHCDlZ2akYd/d21lZG6Bk5ybkoiAeG9mZG1+kZubk4mBeXBnZGt8j5qblIuCenFoZGp6jJmclYyDe3JpZGl3ipiclo2EfHRqZGh1iJecl46FfXVsZWdzhpWbmI+GfnZtZmZxg5SbmJCHf3duZmZwgZKamZGIgHhvZ2Zuf5CamZKJgXlxaGZtfY6ZmpOKgnpyaWZse4yYmpOLg3tzamZqeIqXmpSMg3x0a2Zqd4iWmpWMhH11bWdpdYaUmpaNhX53bmdoc4STmZaOhn94b2hocYKRmZePh4B5cGlncH+PmJeQiIF6cWpnbn2OmJiRiYF7c2tnbXuMl5iSioJ7dGxobHmKlpiTi4N8dW1oa3iIlJiUi4R9dm5oanaGk5iUjIV+d29panSEkpiVjYV/eHBpaXOCkJeVjoaAeXFqaXGAj5eWj4eAenJraXB+jZaWkIiBe3NsaW98i5WWkYmCfHRtaW56ipSXkYqDfHVuaW15iJOXkoqDfXZvamx3hpKWk4uEfndwamt1hJGWk4yFf3hxa2t0gpCWlI2Gf3lya2tygI6VlI6GgHpzbGtxf42VlY+HgXt0bWtwfYuUlY+Ignx1bmtve4mTlZCJgnx2b2tueYiSlZGKg313cGtueIaRlZGKhH54cGxtdoSQlZKLhH94cWxtdYOPlZKMhX95cm1sdIGOlJONhoB6c21scn+MlJONh4F7dG5scX2Lk5OOh4F8dW9scHyJkpSPiIJ8dnBscHqIkZSPiYN9d3Bsb3mGkJSQiYN+eHFtbneEj5ORioR/eXJtbnaDjpORi4V/enNubnWBjZORjIWAenRubXSAjJKSjIaAe3VvbXN+ipKSjYeBfHZwbXJ9iZGSjoeCfXdwbXF7iJCSjoiCfXdxbnB6hpCSj4mDfnhybnB4hY+Sj4mEf3lzbm93g46SkIqEf3p0b292gYySkIuFgHt1b291gIuRkYuFgHt1cG90f4qRkYyGgXx2cW9zfYmQkY2HgX13cW9yfIeQkY2Hgn14cm9xeoaPkY6Ig355c29xeYWOkY6Jg355dG9weIONkY+JhH96dHBwd4KMkY+KhIB7dXBwdoCLkI+KhYB7dnFwdX+KkJCLhYF8d3FwdH6Ij5CMhoF9d3Jwc3yHj5CMh4J9eHNwc3uGjpCNh4J+eXNwcnqFjZCNiIN+enRwcnmDjJCOiIN/enVxcXiCi5COiYR/e3ZxcXeBio+OioSAfHZycXZ/iY+PioWBfHdycXV+iI6Pi4aBfXhzcXR9h46Pi4aBfXl0cXR8ho2PjIeCfnl0cXN7hYyPjIeCfnp1cXN5g4yPjYiDf3t2cnJ4gouPjYiDf3t2cnJ3gYqOjYmEgHx3c3J3gImOjomFgHx4c3J2f4iOjoqFgX14dHJ1fYeNjoqGgX15dHJ1fIaMjouGgn56dXJ0e4WMjouHgn56dXJ0eoOLjoyHg397dnNzeYKKjoyIg397d3NzeIGJjYyIhIB8d3Nzd4CJjY2JhIB8eHRzd3+IjY2JhYF9eXRzdn6HjI2KhYF9eXVzdX2GjI2KhoJ+enVzdXyFi42KhoJ+enZzdXuDi42Lh4J/e3dzdHqCio2Lh4N/e3d0dHmBiY2Lh4OAfHh0dHiAiIyMiISAfXh1dHd/h4yMiISBfXl1dHd+hoyMiYWBfXp1dHZ9hYuMiYWBfnp2dHZ8hIuMioaCfnt3dHV7g4qMioaCf3t3dHV6gomMioaDf3x4dHV6gYmMi4eDgHx4dXV5gIiMi4eDgH15dXR4gIeLi4iEgH15dnR4f4aLi4iEgX56dnR3foWLi4mFgX56d3V3fYSKi4mFgn57d3V2fIOJi4mFgn97eHV2e4OJi4qGgn98eHV2eoKIi4qGg4B8eXV1eoGIi4qHg4B9eXZ1eYCHi4qHg4B9enZ1eH+GioqIhIF+end1eH6FiouIhIF+e3d1d32EiYuIhYF+e3d1d3yDiYuJhYJ/fHh2d3yDiIuJhYJ/fHh2dnuCiIqJhoJ/fHl2dnqBh4qJhoOAfXl2dnqAhoqKh4OAfXp3dnl/hoqKh4OAfnp3dnh+hYmKh4SBfnt4dnh+hImKiISBfnt4dnh9g4iKiIWBf3x4dnd8g4iKiIWCf3x5dnd7goeKiIWCf315d3d7gYeKiYaCgH16d3d6gIaJiYaDgH16d3d6f4aJiYaDgH57eHd5f4WJiYeEgX57eHd5foSIiYeEgX57eHd4fYOIiYeEgX98eXd4fIOIiYiFgn98eXd4fIKHiYiFgn99end3e4GHiYiFgoB9enh3e4CGiYiGg4B9enh3eoCFiYiGg4B+e3h3en+FiImGg4F+e3h3eX6EiImGhIF+fHmAgH9+fX+ChYSCgH15eHyEioqFgHt1cniFj4+IgXpxbHOFlJWMgnluZm6FmJuQhHlrYWiDnKGVhnlpW2KAn6eaiHlnV1x8oa2fi3plUlV4orOljntmUVJ0n7KmkH1oU1FwnLKokn5qVVBsmLGpk4BtV09olLCrlYJvWU9lkK6sl4NxW09ijKytmYVzXU9fiKqum4Z0X1BchKivnYh2YVFagKavn4p4Y1JYfKOvoIt6ZlNXeKCvoo17aFRVdJ2vpI99alZUcZqupZB+bFhTbZaup5KAbllTapOsqJSCcFtSZ4+rqZaDcl1SZIuqqpeFc19TYYioq5mGdWFTX4SmrJuId2NUXYCjrJ2JeWVVW3yhrJ6LemdWWXmerKCMfGlXWHWbrKGOfWtZV3KYq6OPf21aVm6Vq6SRgG9cVmuRqaWTgXFeVWiOqKaUg3NgVWaLp6eWhHRhVmOHpaiXhnZjVmGEo6mZh3hlV1+AoambiHlnWF19n6mcintpWVx5nKmei3xrWlt2mamfjX1tW1pzlqigjn9uXVlwk6iikIBwXlhtkKejkYFyYFhqjaakk4N0YlhoiqSllIR1Y1llh6OlloV3ZVljg6Gml4d4Z1phgJ+mmYh6aVpgfZymmol7a1teepqmnIt8bF1dd5imnYx9bl5cdJWmno1/cF9ccZKln4+AcWFbbo+koZCBc2Jba4yjoZKCdGRbaYmiopOEdmVbZ4ago5SFd2dcZYOfo5aGeWlcY4CdpJeHempdYn2bpJmJe2xeYHqYpJqKfG5fX3eWpJuLfm9gX3SUo5yMf3FhXnKRo52OgHJjXm+Oop6PgXRkXW2LoZ+QgnVmXWuJoKCSg3dnXmmGnqGThXhpXmeDnaGUhnlqX2WAm6GWh3psX2R9maKXiHxtYGN6l6GYiX1vYWJ4laGZin5wYmF1kqGajH9yY2BzkKCbjYBzZWBwjaCcjoF1ZmBui5+dj4J2Z2BsiJ2ekYN3aWBqhZyekoR4amBog5ufk4V6bGFngJmflIZ7bWFmfZeflYd8b2Jle5Wfl4l9cGNkeJOfmIp+cWRjdpGfmYt/c2VidI+emoyAdGZicYydmo2BdWhib4qdm46Cd2libYebnI+DeGpibIWanJGEeWxiaoKZnZKFem1jaYCXnZOGe25jZ36WnZSHfHBkZnuUnZWIfXFlZXmSnZaJfnJmZXeQnZeKf3RnZHSOnJiLgHVoZHKMm5mMgXZpZHCJm5mNgndrZG+HmpqOg3hsZG2FmZuQhHltZGyCl5uRhXpuZWqAlpuShntwZWl+lJuTh3xxZmh7k5uUh31yZ2d5kZuViH5zaGd3j5uWiX90aWZ1jZqWioB2amZzi5qXi4F3a2ZxiZmYjIJ4bGZwh5iYjoN5bWZuhJeZj4N6bmZtgpaZkIR7b2dsgJSZkIV8cWdrfpOZkYZ9cmhqfJGZkod9c2lpepCZk4h+dGloeI6ZlIl/dWpodoyZlYqAdmtodIqYlouBd2xncoiXloyCeG1ncYaWl42CeW5ob4SVl46Dem9oboKUl46Ee3FobYCTmI+FfHJpbH6SmJCGfXNpa3yQmJGHfnRqanqPmJKHfnVraniNl5OIf3ZsaXeLl5OJgHdtaXWJlpSKgXhuaXOIlpWLgnlvaXKGlZWMgnpwaXGElJaNg3txaW+Ck5aOhHtyam6AkpaOhXxzam1+kJaPhX10a218j5aQhn51bGx7jpaRh392bGt5jJaRiH93bWt3ipWSiYB3bmt2iZWTiYF4b2t0h5STioF5cGtzhZOUi4J6cWtyhJOUjIN7cmtwgpKUjYR8c2tvgJGVjYR8c2xvfo+VjoV9dGxufY6Vj4Z+dW1te42VkIZ/dm5teYuUkId/d25seIqUkYiAeG9sdoiTkomBeXBsdYeTkomBenFsdIWSkoqCe3Jsc4ORk4uDe3NscYKQk4yDfHNtcYCPk42EfXRtcH6Ok42FfXVub32Nk46FfnZubnuMk4+Gf3dvbnqLk4+Hf3hvbniJk5CHgHlwbXeIkpCIgXlxbXaGkpGJgXpybXWFkZGKgntzbXODkJKKgnxzbnKCj5KLg3x0bnKAjpKMhH11bnF+jZKMhH52b3B9jJKNhX53b3B8i5KOhn94cG96ipKOhn94cW95iJGPh4B5cW94h5GPiIF6cm92hpCQiIF7c291hJCQiYJ7c290g4+QioJ8dG9zgY6RioN9dW9zgI2Ri4N9dnByf4yRjIR+d3BxfYuRjIV+d3BxfIqRjYV/eHFwe4mRjYZ/eXJweYiQjoaAenJweIeQjoeBenNwd4WPj4iBe3RwdoSPj4iCfHRwdYOOj4mCfHVwdIGNkIqDfXZwcw==';

/** Tipo do conteúdo guardado em um campo de exemplo. */
export type SampleMediaKind = 'text' | 'image' | 'audio';

/** Estado de um campo de exemplo: o texto digitado + o tipo de mídia. */
export interface SampleFieldState {
  /** Valor bruto usado na renderização do preview. */
  value: string;
  /** 'image'/'audio' quando o valor é a mídia embutida de exemplo. */
  kind: SampleMediaKind;
}

/** Campo de exemplo vazio (padrão: em branco, como o usuário pediu). */
export const emptySampleField = (): SampleFieldState => ({ value: '', kind: 'text' });

/** True quando o valor é uma data URI de imagem. */
export const isImageDataUri = (value: string): boolean => /^data:image\//i.test(value);

/** True quando o valor é uma data URI de áudio. */
export const isAudioDataUri = (value: string): boolean => /^data:audio\//i.test(value);

/* ------------------------------------------------------------------
 * Persistência dos valores de exemplo (por tipo de nota)
 *
 * O modal é desmontado ao fechar, então o estado vive em memória
 * enquanto ele está aberto. Para não perder o trabalho do usuário a
 * cada abertura, os valores ficam salvos no localStorage.
 * ------------------------------------------------------------------ */

const SAMPLE_STORAGE_PREFIX = 'runora_template_samples_';

/** Carrega os valores de exemplo salvos de um tipo de nota. */
export function loadSampleFields(noteTypeId: string): Record<string, SampleFieldState> {
  try {
    const raw = localStorage.getItem(SAMPLE_STORAGE_PREFIX + noteTypeId);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, SampleFieldState> = {};
    for (const [name, raw2] of Object.entries(parsed)) {
      if (raw2 && typeof raw2 === 'object') {
        const entry = raw2 as { value?: unknown; kind?: unknown };
        const value = typeof entry.value === 'string' ? entry.value : '';
        const kind: SampleMediaKind =
          entry.kind === 'image' || entry.kind === 'audio' ? entry.kind : 'text';
        out[name] = { value, kind };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Salva os valores de exemplo de um tipo de nota. */
export function saveSampleFields(
  noteTypeId: string,
  fields: Record<string, SampleFieldState>
): void {
  try {
    localStorage.setItem(SAMPLE_STORAGE_PREFIX + noteTypeId, JSON.stringify(fields));
  } catch {
    /* localStorage indisponível (modo privado) — o preview segue funcionando */
  }
}

/** Limpa os valores de exemplo salvos de um tipo de nota. */
export function clearSampleFields(noteTypeId: string): void {
  try {
    localStorage.removeItem(SAMPLE_STORAGE_PREFIX + noteTypeId);
  } catch {
    /* ignora */
  }
}
