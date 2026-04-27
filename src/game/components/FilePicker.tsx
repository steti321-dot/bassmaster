import React, { useEffect, useRef, useState } from 'react';
import './SongPicker.css';
import { listRecentFiles, loadRecentFile, removeRecentFile, saveRecentFile } from '../recentFiles';
import type { RecentFile } from '../recentFiles';
import {
  gprotabAvailable,
  gprotabDownload,
  gprotabSearch,
} from '../../services/gprotabClient';
import { fetchGpFromUrl } from '../../services/fetchGpUrl';

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

interface FilePickerProps {
  onFilePicked: (file: PickedFile) => void;
}

/**
 * Phase 1: pick a GP file. Shows a recent-files dropdown plus an "Open"
 * button for browsing the disk. Recent files are cached in IndexedDB so
 * the user can re-open without re-browsing.
 */
export default function FilePicker({ onFilePicked }: FilePickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [recents, setRecents] = useState<RecentFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  // gprotab.net search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<
    Array<{ artist: string; title: string; url: string }>
  >([]);
  const [searching, setSearching] = useState(false);
  const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null);
  const hasGprotabApi = gprotabAvailable();

  // Paste-URL state
  const [pasteUrl, setPasteUrl] = useState('');
  const [pasting, setPasting] = useState(false);

  useEffect(() => {
    refreshRecents();
  }, []);

  const refreshRecents = async () => {
    setRecents(await listRecentFiles());
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!/\.(gp[3-5])$/i.test(file.name)) {
      setError(`${file.name} is not a recognized Guitar Pro file (.gp3, .gp4, .gp5).`);
      return;
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await saveRecentFile(file.name, bytes);
      await refreshRecents();
      onFilePicked({ name: file.name, bytes });
    } catch (err) {
      setError(`Could not read "${file.name}": ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRecentSelected = async (name: string) => {
    setError(null);
    try {
      const bytes = await loadRecentFile(name);
      if (!bytes) {
        setError(`"${name}" is no longer cached. Open it again from disk.`);
        await removeRecentFile(name);
        await refreshRecents();
        return;
      }
      onFilePicked({ name, bytes });
    } catch (err) {
      setError(
        `Could not load "${name}": ${err instanceof Error ? err.message : 'unknown'}`
      );
    }
  };

  const handleRemoveRecent = async (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    await removeRecentFile(name);
    await refreshRecents();
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!searchQuery.trim() || !hasGprotabApi) return;
    setSearching(true);
    try {
      const results = await gprotabSearch(searchQuery);
      setSearchResults(results);
    } catch (err) {
      setError(`Search failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setSearching(false);
    }
  };

  const handleSearchResultPick = async (
    result: { artist: string; title: string; url: string },
  ) => {
    if (!hasGprotabApi) return;
    setError(null);
    setDownloadingUrl(result.url);
    try {
      const { data, filename } = await gprotabDownload(result.url);
      // Default to .gp5 if filename has no Guitar Pro extension
      const safeName = /\.gp[3-5]$/i.test(filename)
        ? filename
        : `${result.artist} - ${result.title}.gp5`.replace(/[\\/:*?"<>|]/g, '_');
      await saveRecentFile(safeName, data);
      await refreshRecents();
      onFilePicked({ name: safeName, bytes: data });
    } catch (err) {
      setError(`Download failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setDownloadingUrl(null);
    }
  };

  const handlePasteUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!pasteUrl.trim()) return;
    setPasting(true);
    try {
      const { bytes, filename } = await fetchGpFromUrl(pasteUrl);
      await saveRecentFile(filename, bytes);
      await refreshRecents();
      onFilePicked({ name: filename, bytes });
      setPasteUrl('');
    } catch (err) {
      setError(`Could not load URL: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setPasting(false);
    }
  };

  return (
    <div className="song-picker">
      <h2>Pick a song to practice</h2>

      {hasGprotabApi && (
        <div className="picker-section">
          <h3>
            Search online{' '}
            <span className="picker-source">
              · tabs from{' '}
              <a
                href="https://gprotab.net/"
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  window.open('https://gprotab.net/', '_blank');
                }}
              >
                gprotab.net
              </a>
            </span>
          </h3>
          <form className="gprotab-search-form" onSubmit={handleSearch}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Artist or song title…"
              className="gprotab-input"
            />
            <button type="submit" disabled={searching || !searchQuery.trim()} className="gprotab-search-btn">
              {searching ? '…' : '🔎 Search'}
            </button>
          </form>
          {searchResults.length > 0 && (
            <ul className="gprotab-results">
              {searchResults.map((r) => (
                <li key={r.url}>
                  <button
                    className="gprotab-result-btn"
                    onClick={() => handleSearchResultPick(r)}
                    disabled={downloadingUrl !== null}
                  >
                    <span className="gprotab-artist">{r.artist}</span>
                    <span className="gprotab-title">{r.title}</span>
                    <span className="gprotab-action">
                      {downloadingUrl === r.url ? 'downloading…' : '⬇ open'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="picker-hint">
            For personal practice. Tabs are user-submitted to gprotab.net — please respect their site.
          </p>
        </div>
      )}

      <div className="picker-section">
        <h3>Recent files</h3>
        {recents.length === 0 ? (
          <p className="picker-hint">
            No recent files yet. Open a Guitar Pro file below — it'll appear here next time.
          </p>
        ) : (
          <ul className="recent-list">
            {recents.map((r) => (
              <li key={r.name}>
                <button className="recent-btn" onClick={() => handleRecentSelected(r.name)}>
                  <span className="recent-name">📁 {r.name}</span>
                  <span className="recent-meta">
                    {(r.size / 1024).toFixed(1)} KB · {timeAgo(r.lastOpened)}
                  </span>
                  <span
                    className="recent-remove"
                    onClick={(e) => handleRemoveRecent(e, r.name)}
                    title={`Remove "${r.name}" from recents`}
                  >
                    ✕
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="picker-section">
        <h3>Open from disk</h3>
        <input
          ref={fileInputRef}
          type="file"
          accept=".gp3,.gp4,.gp5"
          onChange={handleFile}
          style={{ display: 'none' }}
        />
        <button className="import-btn" onClick={() => fileInputRef.current?.click()}>
          📁 Open Guitar Pro file (.gp3 / .gp4 / .gp5)
        </button>
        <p className="picker-hint">
          You can also export a GP4 from the Audio to Notes tab and load it here.
        </p>
      </div>

      <div className="picker-section">
        <h3>Open from URL</h3>
        <form className="gprotab-search-form" onSubmit={handlePasteUrl}>
          <input
            type="text"
            value={pasteUrl}
            onChange={(e) => setPasteUrl(e.target.value)}
            placeholder="https://example.com/song.gp5"
            className="gprotab-input"
            disabled={pasting}
          />
          <button
            type="submit"
            disabled={pasting || !pasteUrl.trim()}
            className="gprotab-search-btn"
          >
            {pasting ? '…' : '⬇ Load'}
          </button>
        </form>
        <p className="picker-hint">
          Paste a direct link to a .gp / .gp4 / .gp5 file.
        </p>
      </div>

      {error && <div className="picker-error">{error}</div>}
    </div>
  );
}

function timeAgo(when: number): string {
  const sec = (Date.now() - when) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h ago`;
  return `${Math.floor(sec / 86400)} d ago`;
}
