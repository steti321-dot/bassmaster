import React, { useEffect, useMemo, useState } from 'react';
import './LyricsStrip.css';
import type { LyricLine } from '../types';

interface LyricsStripProps {
  lyrics: LyricLine[];        // sorted by time; pass [] when the song has none
  currentTimeMs: number;
  /** When false, the strip renders a 0-height placeholder so toggling it doesn't
   *  shift the rest of the layout. Also hidden via CSS on mobile portrait. */
  visible?: boolean;
}

/** Split lyrics into "display lines": a fresh line begins after every
 *  isLineBreak marker, and we hard-cap line length so long verses without
 *  breaks still get chunked into legible pieces. */
const MAX_LINE_LEN = 14;

/** Lyrics align with the audio the user is *hearing*, not the raw game clock.
 *  BackingSynth schedules each note for `ctx.currentTime + 0.1` (see
 *  BackingSynth.ts), so the audio is ~100 ms behind the game clock. We add
 *  the same lag here so the highlighted syllable matches what the singer
 *  is currently singing rather than what the game thinks should be next. */
const AUDIO_LAG_MS = 100;

/** Dev-mode flag — show a small drift readout on the strip so the user can
 *  see whether timing problems live in the GP file or in our software. */
const DEV = process.env.NODE_ENV === 'development';

interface DisplayLine {
  syllables: LyricLine[];
  startIdx: number;  // index in the flat lyrics array of the first syllable
  endIdx: number;    // exclusive; index just past the last syllable
}

/** Wide-PC viewport gets a two-row layout (current line + next-line preview).
 *  Narrower laptops/tablets stay one row. Mobile portrait is hidden via CSS. */
const TWO_ROW_MIN_WIDTH = 1100;

/** Live-tracks `(min-width: 1100px)` so the strip switches between
 *  one-row and two-row layouts when the user resizes. */
function useTwoRowLayout(): boolean {
  const [twoRow, setTwoRow] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(`(min-width: ${TWO_ROW_MIN_WIDTH}px)`).matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(min-width: ${TWO_ROW_MIN_WIDTH}px)`);
    const handler = (e: MediaQueryListEvent) => setTwoRow(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else (mq as unknown as { addListener: (h: typeof handler) => void }).addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
      else (mq as unknown as { removeListener: (h: typeof handler) => void }).removeListener(handler);
    };
  }, []);
  return twoRow;
}

/** Walk the flat lyrics array, group into static display lines. */
function buildLines(lyrics: LyricLine[]): DisplayLine[] {
  const lines: DisplayLine[] = [];
  let buf: LyricLine[] = [];
  let bufStart = 0;

  const flush = (endIdx: number) => {
    if (buf.length === 0) return;
    lines.push({ syllables: buf, startIdx: bufStart, endIdx });
    buf = [];
  };

  for (let i = 0; i < lyrics.length; i++) {
    const l = lyrics[i];
    if (l.isLineBreak) {
      flush(i);
      bufStart = i + 1;
      continue;
    }
    if (buf.length === 0) bufStart = i;
    buf.push(l);
    if (buf.length >= MAX_LINE_LEN) {
      flush(i + 1);
      bufStart = i + 1;
    }
  }
  flush(lyrics.length);
  return lines;
}

/**
 * Two-line static karaoke strip. Top row carries the line currently being
 * sung — the active syllable glows in place, surrounding syllables stay
 * fully readable so the eye has a fix point. The bottom row previews the
 * next line at lower opacity so the singer can read ahead without the
 * text scrolling away. When the active syllable crosses into the next
 * line, both rows refresh with a soft fade/slide-up.
 *
 * Hidden on mobile portrait via the CSS @media query so the rain isn't
 * squashed.
 */
/** Single-row mode shifts to the *next* line when the current syllable is
 *  this close to the end of the displayed line — gives the singer a chance
 *  to read what's coming. With two-row layout the next line is always shown
 *  in the bottom slot, so this trick isn't needed there. */
const EARLY_SWAP_THRESHOLD = 4;

export default function LyricsStrip({
  lyrics, currentTimeMs, visible = true,
}: LyricsStripProps) {
  const lines = useMemo(() => buildLines(lyrics), [lyrics]);
  const twoRow = useTwoRowLayout();

  // No lyrics → render the invisible placeholder so the rain stays in place.
  if (!visible || lines.length === 0) {
    return <div className="lyrics-strip lyrics-strip--empty" aria-hidden="true" />;
  }

  // Find the current syllable index in the flat lyrics array.
  // Subtract AUDIO_LAG_MS so we lock onto the syllable the audio is
  // actually playing right now, not the one the game clock would suggest.
  const t = currentTimeMs - AUDIO_LAG_MS;
  let curIdx = -1;
  for (let i = lyrics.length - 1; i >= 0; i--) {
    if (lyrics[i].isLineBreak) continue;
    if (lyrics[i].time <= t) { curIdx = i; break; }
  }
  if (curIdx < 0) curIdx = lines[0].startIdx;

  // Find which display line contains the current syllable.
  let curLineIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (curIdx >= lines[i].startIdx && curIdx < lines[i].endIdx) {
      curLineIdx = i;
      break;
    }
    // curIdx past the end of all lines — pin to the last one.
    if (i === lines.length - 1) curLineIdx = i;
  }

  // Single-row early-swap: when the active syllable is in the last few of
  // its line and there's a next line, jump the displayed line forward.
  let effectiveLineIdx = curLineIdx;
  if (!twoRow) {
    const remaining = lines[curLineIdx].endIdx - curIdx;
    if (remaining <= EARLY_SWAP_THRESHOLD && curLineIdx + 1 < lines.length) {
      effectiveLineIdx = curLineIdx + 1;
    }
  }

  const topLine = lines[effectiveLineIdx];
  const bottomLine = lines[effectiveLineIdx + 1] ?? null;

  return (
    <div
      className={`lyrics-strip lyrics-strip--${twoRow ? 'two' : 'one'}`}
      aria-live="polite"
    >
      <DisplayLineRow
        line={topLine}
        curIdx={curIdx}
        role="top"
        key={`top-${effectiveLineIdx}`}
      />
      {twoRow && bottomLine && (
        <DisplayLineRow
          line={bottomLine}
          curIdx={curIdx}
          role="bottom"
          key={`bot-${effectiveLineIdx + 1}`}
        />
      )}
      {DEV && lyrics[curIdx] && (
        <div className="lyrics-debug">
          {`now=${(currentTimeMs / 1000).toFixed(2)}s`}
          {` · syl=${(lyrics[curIdx].time / 1000).toFixed(2)}s`}
          {` · drift=${Math.round(currentTimeMs - AUDIO_LAG_MS - lyrics[curIdx].time)}ms`}
          {` · "${lyrics[curIdx].text}"`}
        </div>
      )}
    </div>
  );
}

interface DisplayLineRowProps {
  line: DisplayLine;
  curIdx: number;
  role: 'top' | 'bottom';
}

function DisplayLineRow({ line, curIdx, role }: DisplayLineRowProps) {
  return (
    <div className={`lyrics-line lyrics-line--${role}`}>
      {line.syllables.map((syl, i) => {
        const idx = line.startIdx + i;
        const isCur = idx === curIdx;
        const cls = isCur ? 'lyric-cur' : 'lyric-syl-static';
        return (
          <span key={idx} className={`lyric-syl ${cls}`}>
            {syl.text}
          </span>
        );
      })}
    </div>
  );
}
