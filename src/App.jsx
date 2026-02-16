import { useState } from "react";
import * as XLSX from "xlsx";
import "./App.css";

const EMPTY_ROW = {
  url: "",
  artist: "",
  trackName: "",
  genre: "",
  album: "",
  releaseDate: "",
  duration: "",
  explicit: "",
  popularity: ""
};
const HEADERS = [
  "URL",
  "Artist",
  "Track Name",
  "Genre",
  "Album",
  "Release Date",
  "Duration",
  "Explicit",
  "Popularity"
];
const EDITABLE_COLUMNS = [
  { key: "url", label: "URL", placeholder: "Spotify URL" },
  { key: "artist", label: "Artist", placeholder: "Artist" },
  { key: "trackName", label: "Track Name", placeholder: "Track Name" },
  { key: "genre", label: "Genre", placeholder: "Genre" },
  { key: "album", label: "Album", placeholder: "Album" },
  { key: "releaseDate", label: "Release Date", placeholder: "YYYY-MM-DD" },
  { key: "duration", label: "Duration", placeholder: "m:ss" },
  { key: "explicit", label: "Explicit", placeholder: "Yes/No" },
  { key: "popularity", label: "Popularity", placeholder: "0-100" }
];

function parseUrlsFromText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeImportedRow(row) {
  const url = String(row.URL ?? row["Spotify URL"] ?? row.url ?? "").trim();
  const artist = String(row.Artist ?? row.artist ?? "").trim();
  const trackName = String(
    row["Track Name"] ?? row.Track ?? row.trackName ?? row.track ?? ""
  ).trim();
  const genre = String(row.Genre ?? row.genre ?? "").trim();
  const album = String(row.Album ?? row.album ?? "").trim();
  const releaseDate = String(
    row["Release Date"] ?? row.releaseDate ?? row.release_date ?? ""
  ).trim();
  const duration = String(row.Duration ?? row.duration ?? "").trim();

  const explicitRaw = row.Explicit ?? row.explicit ?? "";
  const explicit =
    typeof explicitRaw === "boolean"
      ? explicitRaw
        ? "Yes"
        : "No"
      : String(explicitRaw).trim();

  const popularity = String(row.Popularity ?? row.popularity ?? "").trim();

  return {
    url,
    artist,
    trackName,
    genre,
    album,
    releaseDate,
    duration,
    explicit,
    popularity
  };
}

function App() {
  const [pasteText, setPasteText] = useState("");
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState(
    "Paste Spotify URLs or import a CSV/XLSX file."
  );
  const [isFilling, setIsFilling] = useState(false);

  const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

  const loadUrls = () => {
    const urls = parseUrlsFromText(pasteText);
    if (!urls.length) {
      setStatus("No URLs were found in the pasted text.");
      return;
    }

    const nextRows = urls.map((url) => ({ ...EMPTY_ROW, url }));
    setRows(nextRows);
    setStatus(`Loaded ${nextRows.length} URL(s) into the table.`);
  };

  const addRow = () => {
    setRows((current) => [...current, { ...EMPTY_ROW }]);
  };

  const removeRow = (index) => {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  };

  const updateCell = (index, key, value) => {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row
      )
    );
  };

  const clearAll = () => {
    setRows([]);
    setPasteText("");
    setStatus("Cleared all rows.");
  };

  const exportWorkbook = () => {
    const worksheetData = [
      HEADERS,
      ...rows.map((row) => [
        row.url,
        row.artist,
        row.trackName,
        row.genre,
        row.album,
        row.releaseDate,
        row.duration,
        row.explicit,
        row.popularity
      ])
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Tracks");
    XLSX.writeFile(workbook, "spotify_tracks.xlsx");
    setStatus(`Exported ${rows.length} row(s) to spotify_tracks.xlsx.`);
  };

  const importWorkbook = async (event) => {
    if (isFilling) {
      event.target.value = "";
      return;
    }

    const [file] = event.target.files ?? [];
    if (!file) {
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const targetSheet = workbook.SheetNames.includes("Tracks")
        ? "Tracks"
        : workbook.SheetNames[0];
      const worksheet = workbook.Sheets[targetSheet];
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
      const importedRows = rawRows
        .map(normalizeImportedRow)
        .filter(
          (row) =>
            row.url ||
            row.artist ||
            row.trackName ||
            row.genre ||
            row.album ||
            row.releaseDate ||
            row.duration ||
            row.explicit ||
            row.popularity
        );

      setRows(importedRows);
      setStatus(
        `Imported ${importedRows.length} row(s) from ${file.name} (${targetSheet}).`
      );
    } catch (error) {
      setStatus(`Import failed: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  };

  const fillMetadata = async () => {
    if (!rows.length) {
      setStatus("Add at least one row before filling metadata.");
      return;
    }

    const targets = rows
      .map((row, index) => ({ index, url: row.url.trim() }))
      .filter((entry) => entry.url);

    if (!targets.length) {
      setStatus("No Spotify URLs found in the URL column.");
      return;
    }

    setIsFilling(true);
    setStatus(`Starting metadata fill for ${targets.length} URL(s)...`);

    try {
      const nextRows = rows.map((row) => ({ ...row }));
      let completed = 0;
      let updated = 0;
      let failed = 0;

      for (const target of targets) {
        try {
          const response = await fetch(`${apiBase}/api/fill-from-urls`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls: [target.url] })
          });

          if (!response.ok) {
            throw new Error(`Backend request failed (${response.status}).`);
          }

          const payload = await response.json();
          const apiRow = payload.rows?.[0];

          if (apiRow) {
            nextRows[target.index] = {
              url: apiRow.url ?? nextRows[target.index].url,
              artist: apiRow.artist ?? nextRows[target.index].artist,
              trackName: apiRow.track_name ?? nextRows[target.index].trackName,
              genre: apiRow.genre ?? nextRows[target.index].genre,
              album: apiRow.album ?? nextRows[target.index].album,
              releaseDate:
                apiRow.release_date ?? nextRows[target.index].releaseDate,
              duration: apiRow.duration ?? nextRows[target.index].duration,
              explicit: apiRow.explicit ?? nextRows[target.index].explicit,
              popularity: apiRow.popularity ?? nextRows[target.index].popularity
            };
          }

          if (
            apiRow &&
            (
              apiRow.artist ||
              apiRow.track_name ||
              apiRow.genre ||
              apiRow.album ||
              apiRow.release_date ||
              apiRow.duration ||
              apiRow.explicit ||
              apiRow.popularity
            )
          ) {
            updated += 1;
          } else {
            failed += 1;
          }
        } catch (error) {
          failed += 1;
        }

        completed += 1;
        setRows([...nextRows]);
        setStatus(
          `Filling metadata: ${completed}/${targets.length} completed (${updated} updated, ${failed} failed).`
        );
      }

      setStatus(
        `Done. Processed ${targets.length} URL(s): ${updated} updated, ${failed} failed.`
      );
    } catch (error) {
      setStatus(
        `Metadata fill failed: ${error.message}. Ensure backend is running on port 8000.`
      );
    } finally {
      setIsFilling(false);
    }
  };

  return (
    <main className="app-shell">
      <section className="title-block">
        <p className="eyebrow">Spotify To CSV</p>
        <h1>CSV Viewer / Editor for Spotify URLs</h1>
        <p>
          Paste newline-separated Spotify track URLs. The table starts with
          columns <strong>URL</strong>, <strong>Artist</strong>,{" "}
          <strong>Track Name</strong>, and auto-filled metadata like{" "}
          <strong>Genre</strong>, <strong>Album</strong>, and more.
        </p>
      </section>

      <section className="panel">
        <label htmlFor="url-paste-box">Paste Spotify URLs</label>
        <textarea
          id="url-paste-box"
          rows={6}
          placeholder="https://open.spotify.com/track/..."
          value={pasteText}
          onChange={(event) => setPasteText(event.target.value)}
          disabled={isFilling}
        />

        <div className="button-row">
          <button type="button" onClick={loadUrls} disabled={isFilling}>
            Load URLs Into Table
          </button>
          <label className="file-button">
            Import CSV/XLSX
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={importWorkbook}
              disabled={isFilling}
            />
          </label>
          <button type="button" className="ghost" onClick={addRow} disabled={isFilling}>
            Add Empty Row
          </button>
          <button type="button" className="ghost" onClick={clearAll} disabled={isFilling}>
            Clear
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="table-actions">
          <div>
            <strong>{rows.length}</strong> row(s)
          </div>
          <div className="button-row">
            <button type="button" onClick={fillMetadata} disabled={isFilling}>
              {isFilling ? "Filling..." : "Fill Metadata"}
            </button>
            <button type="button" className="ghost" onClick={exportWorkbook} disabled={isFilling}>
              Export XLSX
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {EDITABLE_COLUMNS.map((column) => (
                  <th key={column.key}>{column.label}</th>
                ))}
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row, index) => (
                  <tr key={`${row.url}-${index}`}>
                    {EDITABLE_COLUMNS.map((column) => (
                      <td key={`${column.key}-${index}`}>
                        <input
                          value={row[column.key]}
                          onChange={(event) =>
                            updateCell(index, column.key, event.target.value)
                          }
                          placeholder={column.placeholder}
                          disabled={isFilling}
                        />
                      </td>
                    ))}
                    <td className="action-cell">
                      <button
                        type="button"
                        className="danger"
                        onClick={() => removeRow(index)}
                        disabled={isFilling}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={EDITABLE_COLUMNS.length + 1} className="empty-state">
                    Table is empty. Paste URLs and click "Load URLs Into Table",
                    or import an existing file.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="status">{status}</footer>
    </main>
  );
}

export default App;
