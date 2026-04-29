import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './Start.css';
import packageJson from '../../package.json';

type NavTab = 'tuner' | 'setup' | 'learn-guitar';

interface StartProps {
  onNavigate: (tab: NavTab) => void;
}

const CHAR_MS = 32;
const PAUSE_MS = 450;   // pause after a line finishes before the next starts
const BTN_DELAY = 600;  // extra wait after last line before button appears

function playBeep(ctx: AudioContext, accent = false) {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = accent ? 1400 : 900;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(accent ? 0.22 : 0.14, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.14);
  } catch { /* autoplay blocked */ }
}

export default function Start({ onNavigate }: StartProps) {
  const { t } = useTranslation(['game']);

  const steps = [
    { text: t('game:start_step1'), nav: 'tuner'         as NavTab },
    { text: t('game:start_step2'), nav: 'setup'         as NavTab },
    { text: t('game:start_step3'), nav: 'learn-guitar'  as NavTab },
    { text: t('game:start_step4'), nav: null },
  ];

  const [lineIdx, setLineIdx]       = useState(-1);    // line being typed
  const [charIdx, setCharIdx]       = useState(0);     // chars shown
  const [checked, setChecked]       = useState<boolean[]>([false, false, false, false]);
  const [showBtn, setShowBtn]       = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const cancelRef   = useRef(false);

  // Unlock AudioContext on first gesture (pointer or key anywhere on the page)
  useEffect(() => {
    const unlock = () => {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (audioCtxRef.current.state === 'suspended') {
        void audioCtxRef.current.resume();
      }
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown',    unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown',    unlock);
    };
  }, []);

  // Typewriter animation
  useEffect(() => {
    cancelRef.current = false;

    const delay = (ms: number) =>
      new Promise<void>(res => {
        const id = window.setTimeout(res, ms);
        // store for cleanup — we keep it simple with the cancel flag
        void id;
      });

    (async () => {
      await delay(600); // brief silence before we start

      for (let i = 0; i < steps.length; i++) {
        if (cancelRef.current) return;
        setLineIdx(i);
        setCharIdx(0);

        // type character by character
        for (let c = 1; c <= steps[i].text.length; c++) {
          if (cancelRef.current) return;
          await delay(CHAR_MS);
          setCharIdx(c);
        }

        // line complete — beep + checkmark
        if (!cancelRef.current) {
          if (!audioCtxRef.current) {
            try {
              audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            } catch { /* noop */ }
          }
          if (audioCtxRef.current) playBeep(audioCtxRef.current, i === steps.length - 1);
          setChecked(prev => {
            const next = [...prev];
            next[i] = true;
            return next;
          });
          await delay(PAUSE_MS);
        }
      }

      if (!cancelRef.current) {
        await delay(BTN_DELAY);
        setShowBtn(true);
      }
    })();

    return () => {
      cancelRef.current = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Skip — show everything instantly
  const skip = () => {
    cancelRef.current = true;
    setLineIdx(steps.length - 1);
    setCharIdx(steps[steps.length - 1].text.length);
    setChecked([true, true, true, true]);
    setShowBtn(true);
  };

  return (
    <div className="start-screen" onClick={showBtn ? undefined : skip}>
      <div className="start-terminal">
        <div className="start-header">
          <span className="start-prompt">{'>'}</span>
          <span className="start-title">Bassmaster Workbench</span>
          <span className="start-version">v{packageJson.version}</span>
        </div>

        <ul className="start-steps">
          {steps.map((step, i) => {
            const isActive  = lineIdx === i;
            const isVisible = lineIdx >= i;
            const text      = isActive
              ? step.text.slice(0, charIdx)
              : isVisible ? step.text : '';
            return (
              <li key={i} className={`start-line ${isVisible ? 'start-line--visible' : ''}`}>
                <span className={`start-check ${checked[i] ? 'start-check--done' : ''}`}>
                  {checked[i] ? '✓' : '○'}
                </span>
                <span className="start-line-text">
                  {text}
                  {isActive && !checked[i] && <span className="start-cursor">▋</span>}
                </span>
                {checked[i] && step.nav && (
                  <button
                    className="start-nav-btn"
                    onClick={e => { e.stopPropagation(); onNavigate(step.nav!); }}
                  >
                    →
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {showBtn && (
          <div className="start-cta-row">
            <button className="start-cta" onClick={() => onNavigate('learn-guitar')}>
              {t('game:start_cta')} →
            </button>
          </div>
        )}

        {!showBtn && lineIdx >= 0 && (
          <div className="start-skip-hint">{t('game:start_skip')}</div>
        )}
      </div>
    </div>
  );
}
