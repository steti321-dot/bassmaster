import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './SongPicker.css';
import { listRecentFiles, loadRecentFile, removeRecentFile, saveRecentFile } from '../recentFiles';
import type { RecentFile } from '../recentFiles';
import {
  gprotabAvailable,
  gprotabDownload,
  gprotabSearch,
} from '../../services/gprotabClient';
import { fetchGpFromUrl } from '../../services/fetchGpUrl';
import { DEMO_SONGS } from '../demoSongs';
import type { Song } from '../types';

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

interface FilePickerProps {
  onFilePicked: (file: PickedFile) => void;
  /** Optional: hand a fully-built Song straight to the game, skipping the
   *  TrackPicker. Used by the built-in "Quick start" songs. */
  onSongDirect?: (song: Song) => void;
}

/**
 * Phase 1: pick a GP file. Shows a recent-files dropdown plus an "Open"
 * button for browsing the disk. Recent files are cached in IndexedDB so
 * the user can re-open without re-browsing.
 */
export default function FilePicker({ onFilePicked, onSongDirect }: FilePickerProps) {
  const { t } = useTranslation(['common']);
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

  // Picker tab state — search bar always visible above; the tab decides
  // which "secondary" source is shown below it.
  type PickerTab = 'demo' | 'recent' | 'files' | 'web';
  const [tab, setTab] = useState<PickerTab>(
    onSongDirect ? 'demo' : 'recent',
  );

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

    if (!/\.gp[x3-9]?$/i.test(file.name)) {
      setError(`${file.name} is not a recognized Guitar Pro file (.gp / .gp3–.gp8 / .gpx).`);
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
      // Always prefer artist + title from the search result for the display name.
      // Keep whatever Guitar Pro extension the server actually served (.gp3 /
      // .gp4 / .gp5 / .gpx) so AlphaTab still gets the right format hint —
      // gprotab.net otherwise returns generic "tab5.gp5"-style filenames.
      const extMatch = filename.match(/\.gp[x3-9]?$/i);
      const ext      = extMatch ? extMatch[0].toLowerCase() : '.gp5';
      const baseName = `${result.artist} - ${result.title}`
        .replace(/[\\/:*?"<>|]/g, '_')
        .trim();
      const safeName = `${baseName}${ext}`;
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
      <h2>{t('common:pick_a_song')}</h2>

      {/* Search bar — always visible at the top. Results appear below it. */}
      {hasGprotabApi && (
        <div className="picker-search">
          <form className="gprotab-search-form" onSubmit={handleSearch}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔎 Search gprotab.net by artist or song…"
              className="gprotab-input"
            />
            <button
              type="submit"
              disabled={searching || !searchQuery.trim()}
              className="gprotab-search-btn"
            >
              {searching ? '…' : t('common:search')}
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
        </div>
      )}

      {/* Tab strip for the secondary sources. */}
      <div className="picker-tabs" role="tablist">
        {onSongDirect && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'demo'}
            className={`picker-tab ${tab === 'demo' ? 'active' : ''}`}
            onClick={() => setTab('demo')}
          >
            {t('common:tab_demo')}
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'recent'}
          className={`picker-tab ${tab === 'recent' ? 'active' : ''}`}
          onClick={() => setTab('recent')}
        >
          {t('common:tab_recent')} {recents.length > 0 ? `(${recents.length})` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'files'}
          className={`picker-tab ${tab === 'files' ? 'active' : ''}`}
          onClick={() => setTab('files')}
        >
          {t('common:tab_files')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'web'}
          className={`picker-tab ${tab === 'web' ? 'active' : ''}`}
          onClick={() => setTab('web')}
        >
          {t('common:tab_web_url')}
        </button>
      </div>

      {/* Tab content */}
      <div className="picker-tab-content">
        {tab === 'demo' && onSongDirect && (
          <div className="picker-section">
            <ul className="quick-start-list">
              {DEMO_SONGS.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className="quick-start-btn"
                    onClick={() => onSongDirect(d.build())}
                  >
                    {d.label}
                  </button>
                </li>
              ))}
            </ul>
            <p className="picker-hint">
              Built-in beginner songs — no download needed. Try with Kids Mode + Training Mode.
            </p>
          </div>
        )}

        {tab === 'recent' && (
          <div className="picker-section">
            {recents.length === 0 ? (
              <p className="picker-hint">
                No recent files yet. Use Files / Web URL / Demo to open one — it'll appear here next time.
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
        )}

        {tab === 'files' && (
          <div className="picker-section">
            <input
              ref={fileInputRef}
              type="file"
              accept=".gp,.gp3,.gp4,.gp5,.gp6,.gp7,.gp8,.gpx"
              onChange={handleFile}
              style={{ display: 'none' }}
            />
            <button
              className="import-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              📁 Open Guitar Pro file (.gp · .gp3–.gp8 · .gpx)
            </button>
            <p className="picker-hint">
              Drag &amp; drop also works. Files stay on your device — nothing is uploaded.
            </p>
          </div>
        )}

        {tab === 'web' && (
          <div className="picker-section">
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
              Paste a direct link to a .gp / .gp4–.gp8 / .gpx file. CORS-blocked URLs route through the proxy automatically.
            </p>
          </div>
        )}
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
