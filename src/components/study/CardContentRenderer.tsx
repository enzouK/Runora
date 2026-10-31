import React, { useEffect, useState } from 'react';
import { VOICE_RECORD_SLOT, VOICE_REPRODUCE_SLOT } from '../../services/clozeService';
import { MediaStore } from '../../services/mediaStore';
import { VoiceRecorder } from './VoiceRecorder';
import { AudioPlayer } from './AudioPlayer';

interface CardContentRendererProps {
  html: string;
  recordedAudioUrl?: string | null;
  onRecordingComplete?: (url: string | null) => void;
  isPreview?: boolean;
  cardId?: string;
  /** Deck option: "Don't play audio automatically" */
  disableAutoplay?: boolean;
}
const TOKEN_SPLIT_REGEX = /(<!--VOICE_RECORD_SLOT-->|<!--VOICE_REPRODUCE_SLOT-->|<audio\b[^>]*>(?:<\/audio>)?|<audio\b[^>]*\/>|\[sound:[^\]]+\])/gi;

export const CardContentRenderer: React.FC<CardContentRendererProps> = ({
  html,
  recordedAudioUrl = null,
  onRecordingComplete = () => {},
  isPreview = false,
  cardId,
  disableAutoplay = false,
}) => {
  // Resolve local media filenames (imported .apkg media) into blob: URLs.
  // Keep {src, html} pairs so we never flash stale content from a previous card/side.
  const [resolved, setResolved] = useState<{ src: string; html: string }>({ src: html, html });

  useEffect(() => {
    let alive = true;
    // Fast path: no bare-filename references at all
    if (!/\[sound:/i.test(html) && !/\bsrc=["'](?!https?|data:|blob:|#)/i.test(html)) {
      setResolved((prev) => (prev.src === html ? prev : { src: html, html }));
      return () => {
        alive = false;
      };
    }
    MediaStore.resolveHtml(html).then(({ html: out }) => {
      if (alive) setResolved({ src: html, html: out });
    });
    return () => {
      alive = false;
    };
  }, [html]);

  const effectiveHtml = resolved.src === html ? resolved.html : html;

  if (!effectiveHtml) return null;

  // Check if content has any special interactive elements
  const hasInteractiveElements =
    effectiveHtml.includes(VOICE_RECORD_SLOT) ||
    effectiveHtml.includes(VOICE_REPRODUCE_SLOT) ||
    /<audio\b/i.test(effectiveHtml) ||
    /\[sound:/i.test(effectiveHtml);

  if (!hasInteractiveElements) {
    return <div dangerouslySetInnerHTML={{ __html: effectiveHtml }} />;
  }

  // Tokenize by slots, audio tags, and sound markers
  const tokens = effectiveHtml.split(TOKEN_SPLIT_REGEX);

  return (
    <>
      {tokens.map((token, index) => {
        if (!token) return null;

        // 1. Voice Record Slot
        if (token === VOICE_RECORD_SLOT) {
          if (isPreview) {
            return (
              <div
                key={index}
                className="my-3 p-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-semibold flex items-center gap-2 select-none"
              >
                <span>🎙️</span>
                <span>[Botão de Gravação de Voz: {'{{voice:record}}'}]</span>
              </div>
            );
          }
          return (
            <div key={index} className="my-3">
              <VoiceRecorder
                recordedAudioUrl={recordedAudioUrl}
                onRecordingComplete={onRecordingComplete}
              />
            </div>
          );
        }

        // 2. Voice Reproduce Slot
        if (token === VOICE_REPRODUCE_SLOT) {
          if (isPreview) {
            return (
              <div
                key={index}
                className="my-3 p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-xs font-semibold flex items-center gap-2 select-none"
              >
                <span>▶</span>
                <span>[Player da Sua Voz Gravada: {'{{voice:reproduce}}'}]</span>
              </div>
            );
          }
          return (
            <div key={index} className="my-3">
              {recordedAudioUrl ? (
                <AudioPlayer
                  src={recordedAudioUrl}
                  label="Sua Gravação de Voz"
                  accentColor="indigo"
                  cardId={cardId}
                />
              ) : (
                <div className="p-3 rounded-2xl bg-zinc-100/80 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 text-xs text-zinc-400 italic text-center select-none">
                  🎙️ Nenhuma gravação de voz realizada neste card
                </div>
              )}
            </div>
          );
        }

        // 3. Native <audio> tag replacement with Modern Audio Player
        if (/^<audio\b/i.test(token.trim())) {
          const srcMatch = token.match(/src=["']([^"']+)["']/i);
          const src = srcMatch ? srcMatch[1] : '';
          const autoPlay = /autoplay/i.test(token);

          // Extract optional data-label or title if present
          const labelMatch = token.match(/(?:data-label|title)=["']([^"']+)["']/i);
          const customLabel = labelMatch ? labelMatch[1] : undefined;

          if (src) {
            return (
              <div key={index} className="my-2.5 not-prose">
                <AudioPlayer
                  src={src}
                  label={customLabel}
                  autoPlay={autoPlay && !disableAutoplay}
                  cardId={cardId}
                />
              </div>
            );
          }
          return <span key={index} dangerouslySetInnerHTML={{ __html: token }} />;
        }

        // 4. Raw [sound:...] fallback
        // [sound:...] plays automatically when autoplay is enabled
        if (/^\[sound:/i.test(token.trim())) {
          const soundMatch = token.match(/\[sound:([^\]]+)\]/i);
          const soundUrl = soundMatch ? soundMatch[1].trim() : '';
          if (soundUrl) {
            return (
              <div key={index} className="my-2.5 not-prose">
                <AudioPlayer
                  src={soundUrl}
                  autoPlay={!disableAutoplay}
                  cardId={cardId}
                />
              </div>
            );
          }
          return null;
        }

        // 5. Normal HTML fragment (div, not span: fragments may contain tables)
        return <div key={index} dangerouslySetInnerHTML={{ __html: token }} />;
      })}
    </>
  );
};
