import React, { useState } from 'react';
import './Editor.css';
import TabPreview from '../components/TabPreview';

interface Note {
  fret: number;
  string: number;
  stringName?: string;
  time: number;
  duration: number;
  frequency: number;
}

interface EditorProps {
  result: {
    notes: Note[];
    tempo: number;
    timeSignature: { numerator: number; denominator: number };
    instrument: 'guitar' | 'bass';
    gp4Data: Uint8Array;
  };
  onExport: (data: Uint8Array, filename: string) => void;
  onNewFile: () => void;
}

const STRINGS = [
  { number: 0, name: 'High E', tuning: 329.63 },
  { number: 1, name: 'B', tuning: 246.94 },
  { number: 2, name: 'G', tuning: 196.00 },
  { number: 3, name: 'D', tuning: 146.83 },
  { number: 4, name: 'A', tuning: 110.00 },
  { number: 5, name: 'Low E', tuning: 82.41 },
];

export default function Editor({ result, onExport, onNewFile }: EditorProps) {
  const [notes, setNotes] = useState<Note[]>(result.notes);
  const [tempo, setTempo] = useState(result.tempo);
  const [selectedNote, setSelectedNote] = useState<number | null>(null);

  const handleNoteChange = (index: number, field: keyof Note, value: number) => {
    const updatedNotes = [...notes];
    updatedNotes[index] = { ...updatedNotes[index], [field]: value };
    setNotes(updatedNotes);
  };

  const handleDeleteNote = (index: number) => {
    setNotes(notes.filter((_, i) => i !== index));
  };

  const handleExport = () => {
    // TODO: Regenerate GP4 with modified notes
    const filename = `transcription_${new Date().toISOString().split('T')[0]}.gp4`;
    onExport(result.gp4Data, filename);
  };

  return (
    <div className="editor-container">
      <div className="editor-header">
        <div className="header-info">
          <h2>Note Editor</h2>
          <div className="song-details">
            <span>Tempo: <input type="number" value={tempo} onChange={(e) => setTempo(Number(e.target.value))} min="40" max="300" /></span>
            <span>Time Signature: {result.timeSignature.numerator}/{result.timeSignature.denominator}</span>
            <span>Notes: {notes.length}</span>
          </div>
        </div>
        <div className="header-actions">
          <button className="export-btn" onClick={handleExport}>
            📥 Export GP4
          </button>
          <button className="new-btn" onClick={onNewFile}>
            ➕ New File
          </button>
        </div>
      </div>

      <div className="editor-tab-preview">
        <TabPreview notes={notes} tempo={tempo} instrument={result.instrument} />
      </div>

      <div className="editor-main">
        <div className="notes-list">
          <div className="list-header">
            <span className="col-time">Time (ms)</span>
            <span className="col-fret">Fret</span>
            <span className="col-string">String</span>
            <span className="col-duration">Duration (ms)</span>
            <span className="col-action">Action</span>
          </div>

          <div className="notes-scroll">
            {notes.length === 0 ? (
              <div className="empty-state">
                <p>No notes detected. Try another file or adjust audio settings.</p>
              </div>
            ) : (
              notes.map((note, idx) => (
                <div
                  key={idx}
                  className={`note-row ${selectedNote === idx ? 'selected' : ''}`}
                  onClick={() => setSelectedNote(idx)}
                >
                  <input
                    className="col-time"
                    type="number"
                    value={Math.round(note.time)}
                    onChange={(e) => handleNoteChange(idx, 'time', Number(e.target.value))}
                  />
                  <input
                    className="col-fret"
                    type="number"
                    value={note.fret}
                    onChange={(e) => handleNoteChange(idx, 'fret', Number(e.target.value))}
                    min="0"
                    max="24"
                  />
                  <select
                    className="col-string"
                    value={note.string}
                    onChange={(e) => handleNoteChange(idx, 'string', Number(e.target.value))}
                  >
                    {STRINGS.map((s) => (
                      <option key={s.number} value={s.number}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="col-duration"
                    type="number"
                    value={Math.round(note.duration)}
                    onChange={(e) => handleNoteChange(idx, 'duration', Number(e.target.value))}
                    min="10"
                  />
                  <button
                    className="col-action delete-btn"
                    onClick={() => handleDeleteNote(idx)}
                  >
                    🗑️
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="editor-preview">
          <div className="fretboard">
            <h3>Fretboard Preview</h3>
            <div className="fret-rows">
              {STRINGS.map((string) => (
                <div key={string.number} className="fret-row">
                  <div className="string-label">{string.name}</div>
                  <div className="frets">
                    {Array.from({ length: 25 }).map((_, fret) => {
                      const noteOnString = notes.find(
                        (n) => n.string === string.number && n.fret === fret
                      );
                      return (
                        <div
                          key={fret}
                          className={`fret ${noteOnString ? 'active' : ''}`}
                          title={`Fret ${fret}`}
                        >
                          {noteOnString ? fret : ''}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="stats">
            <h3>Statistics</h3>
            <div className="stat-item">
              <span>Average Fret:</span>
              <span>
                {notes.length > 0
                  ? (notes.reduce((sum, n) => sum + n.fret, 0) / notes.length).toFixed(1)
                  : 'N/A'}
              </span>
            </div>
            <div className="stat-item">
              <span>Highest Fret:</span>
              <span>{notes.length > 0 ? Math.max(...notes.map((n) => n.fret)) : 'N/A'}</span>
            </div>
            <div className="stat-item">
              <span>Lowest Fret:</span>
              <span>{notes.length > 0 ? Math.min(...notes.map((n) => n.fret)) : 'N/A'}</span>
            </div>
            <div className="stat-item">
              <span>Most Used String:</span>
              <span>
                {notes.length > 0
                  ? STRINGS.find(
                      (s) =>
                        s.number ===
                        Number(
                          Object.entries(
                            notes.reduce(
                              (acc, n) => {
                                acc[n.string] = (acc[n.string] || 0) + 1;
                                return acc;
                              },
                              {} as Record<number, number>
                            )
                          ).sort(([, a], [, b]) => b - a)[0]?.[0]
                        )
                    )?.name
                  : 'N/A'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
