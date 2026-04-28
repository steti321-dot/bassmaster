import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { processAudio } from '../services/audioService';
import { downloadAudio, isValidYouTubeUrl, getVideoInfo } from '../services/youtubeService';
import { MicRecorder } from '../services/micRecorder';
import './Upload.css';

interface UploadProps {
  onProcessingStart: () => void;
  onProgressUpdate: (percent: number) => void;
  onAudioReady: (result: any) => void;
}

type Mode = 'mono' | 'chords' | 'ai';
type InputMode = 'file' | 'youtube' | 'mic';

const SUPPORTED_EXTENSIONS = ['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.mp4'];
const UNSUPPORTED_EXTENSIONS = ['.webm', '.opus'];

function checkSupportedFormat(filename: string): string | null {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!ext) return 'File has no extension. Use one of: ' + SUPPORTED_EXTENSIONS.join(', ');
  if (UNSUPPORTED_EXTENSIONS.includes(ext)) {
    return `${ext} (Opus/WebM) is not supported by the audio decoder yet. Convert to MP3, M4A, or WAV first (e.g. with Audacity).`;
  }
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return `${ext} is not a recognized audio format. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`;
  }
  return null;
}

function friendlyErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/unsupported codec|unsupported feature.*codec/i.test(raw)) {
    return 'This file uses an audio codec we can\'t decode (likely Opus inside WebM). Convert to MP3, M4A, or WAV first.';
  }
  if (/Audio decode failed/.test(raw)) {
    return 'The audio could not be decoded. Try a different file (MP3 / M4A / WAV recommended).';
  }
  if (/transcribe binary not found/.test(raw)) {
    return 'The transcribe binary is missing. Run: cargo build --release';
  }
  if (/yt-dlp not found/.test(raw)) {
    return 'yt-dlp.exe is missing from bin/. Run: node scripts/setup-ytdlp.mjs';
  }
  if (/Electron API not available/.test(raw)) {
    return 'This page must run inside the Electron app, not a browser tab.';
  }
  if (/Permission denied|NotAllowedError/i.test(raw)) {
    return 'Microphone access was denied. Allow it in your OS / browser settings and try again.';
  }
  return raw;
}

export default function Upload({ onProcessingStart, onProgressUpdate, onAudioReady }: UploadProps) {
  const { t } = useTranslation(['music2notes']);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [inputMode, setInputMode] = useState<InputMode>('file');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectionMode, setDetectionMode] = useState<Mode>('ai');
  const [instrument, setInstrument] = useState<'guitar' | 'bass'>('guitar');
  const [cleanDrums, setCleanDrums] = useState(false);

  // Mic recording state
  const recorderRef = useRef<MicRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordedSec, setRecordedSec] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const recTimerRef = useRef<number | null>(null);

  const detectionOptions = {
    useAi: detectionMode === 'ai',
    polyphonic: detectionMode === 'chords',
    instrument,
    cleanDrums,
  };

  // Cleanup any in-flight recorder on unmount
  useEffect(() => {
    return () => {
      recorderRef.current?.dispose();
      recorderRef.current = null;
      if (recTimerRef.current !== null) clearInterval(recTimerRef.current);
    };
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formatError = checkSupportedFormat(file.name);
    if (formatError) {
      setError(formatError);
      return;
    }

    setLoading(true);
    setError(null);
    onProcessingStart();

    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await processAudio(
        new Uint8Array(arrayBuffer),
        file.name,
        onProgressUpdate,
        detectionOptions
      );
      onAudioReady(result);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleYoutubeSubmit = async () => {
    if (!youtubeUrl.trim()) {
      setError('Please enter a YouTube URL');
      return;
    }

    if (!isValidYouTubeUrl(youtubeUrl)) {
      setError('Invalid YouTube URL format');
      return;
    }

    setLoading(true);
    setError(null);
    onProcessingStart();

    try {
      onProgressUpdate(5);
      const info = await getVideoInfo(youtubeUrl);
      console.log('Processing video:', info.title, 'by', info.author);

      onProgressUpdate(10);
      const { data: audioData, extension } = await downloadAudio(youtubeUrl, (percent) => {
        onProgressUpdate(10 + Math.round(percent * 0.4));
      });

      const formatErr = checkSupportedFormat('downloaded' + extension);
      if (formatErr) {
        throw new Error(
          `YouTube returned a ${extension} stream that we can't decode. ${formatErr}`
        );
      }

      const safeTitle = (info.title || 'video').replace(/[^a-zA-Z0-9_-]+/g, '_');
      const result = await processAudio(
        audioData,
        `${safeTitle}${extension}`,
        (percent) => onProgressUpdate(50 + Math.round(percent * 0.5)),
        detectionOptions
      );

      onAudioReady(result);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleStartRecording = async () => {
    setError(null);
    if (recorderRef.current) recorderRef.current.dispose();
    const rec = new MicRecorder();
    recorderRef.current = rec;
    try {
      await rec.start({ onLevel: (rms) => setMicLevel(rms) });
      setRecording(true);
      setRecordedSec(0);
      // Tick the recorded-time display
      recTimerRef.current = window.setInterval(() => {
        setRecordedSec(rec.durationMs() / 1000);
      }, 100);
    } catch (err) {
      setError(friendlyErrorMessage(err));
      rec.dispose();
      recorderRef.current = null;
    }
  };

  const handleStopAndProcess = async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (recTimerRef.current !== null) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    try {
      const wavBytes = await rec.stop();
      setRecording(false);
      setMicLevel(0);
      if (wavBytes.byteLength < 8000) {
        setError('Recording is too short to transcribe (need at least ~1 second).');
        rec.dispose();
        recorderRef.current = null;
        return;
      }
      setLoading(true);
      onProcessingStart();
      const result = await processAudio(
        wavBytes,
        'mic-recording.wav',
        onProgressUpdate,
        detectionOptions,
      );
      onAudioReady(result);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      rec.dispose();
      recorderRef.current = null;
      setLoading(false);
    }
  };

  const handleCancelRecording = () => {
    if (recTimerRef.current !== null) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    recorderRef.current?.dispose();
    recorderRef.current = null;
    setRecording(false);
    setRecordedSec(0);
    setMicLevel(0);
  };

  return (
    <div className="upload-container">
      <div className="upload-card">
        <h2>{t('music2notes:title')}</h2>

        <div className="input-mode-toggle">
          <button
            className={`mode-btn ${inputMode === 'file' ? 'active' : ''}`}
            onClick={() => setInputMode('file')}
            disabled={loading || recording}
          >
            {t('music2notes:input_file')}
          </button>
          <button
            className={`mode-btn ${inputMode === 'youtube' ? 'active' : ''}`}
            onClick={() => setInputMode('youtube')}
            disabled={loading || recording}
          >
            {t('music2notes:input_youtube')}
          </button>
          <button
            className={`mode-btn ${inputMode === 'mic' ? 'active' : ''}`}
            onClick={() => setInputMode('mic')}
            disabled={loading}
          >
            {t('music2notes:input_mic')}
          </button>
        </div>

        {inputMode === 'file' && (
          <div className="file-upload">
            <div
              className="drop-zone"
              onDragOver={(e) => {
                e.preventDefault();
                e.currentTarget.classList.add('drag-over');
              }}
              onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('drag-over');
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                  handleFileUpload({ target: { files } } as any);
                }
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,video/*"
                onChange={handleFileUpload}
                disabled={loading}
                style={{ display: 'none' }}
              />
              <p>{t('music2notes:drop_zone_hint')}</p>
              <button
                className="browse-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
              >
                {t('music2notes:browse')}
              </button>
              <p className="formats">MP3, M4A, WAV, FLAC, OGG, MP4</p>
            </div>
          </div>
        )}

        {inputMode === 'youtube' && (
          <div className="youtube-input">
            <input
              type="text"
              placeholder="https://youtube.com/watch?v=..."
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              disabled={loading}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !loading) handleYoutubeSubmit();
              }}
            />
            <button
              className="submit-btn"
              onClick={handleYoutubeSubmit}
              disabled={loading || !youtubeUrl.trim()}
            >
              {t('music2notes:process')}
            </button>
          </div>
        )}

        {inputMode === 'mic' && (
          <div className="mic-input">
            {!recording ? (
              <button
                className="mic-record-btn"
                onClick={handleStartRecording}
                disabled={loading}
              >
                {t('music2notes:start_recording')}
              </button>
            ) : (
              <div className="mic-recording-row">
                <button className="mic-stop-btn" onClick={handleStopAndProcess}>
                  {t('music2notes:stop_transcribe')}
                </button>
                <button className="mic-cancel-btn" onClick={handleCancelRecording}>
                  {t('music2notes:cancel')}
                </button>
                <span className="mic-time">{formatRecordedTime(recordedSec)}</span>
                <div className="mic-level">
                  <div
                    className="mic-level-fill"
                    style={{ width: `${Math.min(100, micLevel * 400)}%` }}
                  />
                </div>
              </div>
            )}
            <p className="mic-hint">{t('music2notes:mic_hint')}</p>
          </div>
        )}

        {error && <div className="error-message">{error}</div>}

        <div className="settings-row">
          <div className="settings-group">
            <span className="settings-label">{t('music2notes:instrument_label')}</span>
            <div className="settings-buttons">
              <button
                className={`inst-btn ${instrument === 'guitar' ? 'active' : ''}`}
                onClick={() => setInstrument('guitar')}
                disabled={loading || recording}
              >
                {t('music2notes:guitar')}
              </button>
              <button
                className={`inst-btn ${instrument === 'bass' ? 'active' : ''}`}
                onClick={() => setInstrument('bass')}
                disabled={loading || recording}
              >
                {t('music2notes:bass')}
              </button>
            </div>
          </div>

          <div className="settings-group">
            <span className="settings-label">{t('music2notes:detection_label')}</span>
            <div className="settings-buttons">
              <button
                className={`inst-btn ${detectionMode === 'ai' ? 'active' : ''}`}
                onClick={() => setDetectionMode('ai')}
                disabled={loading || recording}
                title="Spotify Basic Pitch — best quality"
              >
                {t('music2notes:detection_ai')}
              </button>
              <button
                className={`inst-btn ${detectionMode === 'mono' ? 'active' : ''}`}
                onClick={() => setDetectionMode('mono')}
                disabled={loading || recording}
                title="YIN single-note tracker — fastest"
              >
                {t('music2notes:detection_mono')}
              </button>
              <button
                className={`inst-btn ${detectionMode === 'chords' ? 'active' : ''}`}
                onClick={() => setDetectionMode('chords')}
                disabled={loading || recording}
                title="FFT polyphonic — picks up harmonics"
              >
                {t('music2notes:detection_chords')}
              </button>
            </div>
          </div>

          <label className="clean-toggle-compact" title="Pre-process audio to remove percussive content">
            <input
              type="checkbox"
              checked={cleanDrums}
              onChange={(e) => setCleanDrums(e.target.checked)}
              disabled={loading || recording}
            />
            <span>{t('music2notes:suppress_drums')}</span>
          </label>
        </div>
      </div>
    </div>
  );
}

function formatRecordedTime(s: number): string {
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
