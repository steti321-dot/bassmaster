import React, { useState } from 'react';
import Upload from '../pages/Upload';
import Editor from '../pages/Editor';

type AppState = 'upload' | 'processing' | 'editor';

interface ConversionResult {
  notes: Array<{
    fret: number;
    string: number;
    stringName?: string;
    time: number;
    duration: number;
    frequency: number;
  }>;
  tempo: number;
  timeSignature: { numerator: number; denominator: number };
  instrument: 'guitar' | 'bass';
  gp4Data: Uint8Array;
}

/**
 * Tab 1: Music-to-Notes — the original transcription pipeline.
 *
 * Flow: Upload (file or YouTube) → Processing → Editor (preview + export GP4).
 */
export default function Music2Notes() {
  const [state, setState] = useState<AppState>('upload');
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [progress, setProgress] = useState(0);

  const handleAudioReady = (conversionResult: ConversionResult) => {
    setResult(conversionResult);
    setState('editor');
  };

  const handleProcessingStart = () => {
    setState('processing');
    setProgress(0);
  };

  const handleProgressUpdate = (percent: number) => {
    setProgress(percent);
  };

  const handleExport = async (gp4Data: Uint8Array, filename: string) => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.saveGp4File) {
      const savedPath = await electronAPI.saveGp4File(gp4Data, filename);
      if (savedPath) {
        console.log('File saved to:', savedPath);
      }
      return;
    }

    // Fallback: browser download
    const blob = new Blob([gp4Data as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {state === 'upload' && (
        <Upload
          onProcessingStart={handleProcessingStart}
          onProgressUpdate={handleProgressUpdate}
          onAudioReady={handleAudioReady}
        />
      )}

      {state === 'processing' && (
        <div className="processing">
          <div className="spinner"></div>
          <p>Processing audio... {progress}%</p>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }}></div>
          </div>
        </div>
      )}

      {state === 'editor' && result && (
        <Editor
          result={result}
          onExport={handleExport}
          onNewFile={() => {
            setState('upload');
            setResult(null);
          }}
        />
      )}
    </>
  );
}
