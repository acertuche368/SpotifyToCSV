import { useState } from "react";
import * as XLSX from "xlsx";
import "./App.css";

const EMPTY_ROW = {
  url: "",
  artist: "",
  trackName: ""
};
const HEADERS = ["URL", "Artist", "Track Name"];
const EDITABLE_COLUMNS = [
  { key: "url", label: "URL", placeholder: "Spotify URL" },
  { key: "artist", label: "Artist", placeholder: "Artist" },
  { key: "trackName", label: "Track Name", placeholder: "Track Name" }
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
  return { url, artist, trackName };
}

function App() {
  const [pasteText, setPasteText] = useState("");
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState(
    "Paste Spotify URLs or import a CSV/XLSX file."
  );
  const [isFilling, setIsFilling] = useState(false);

  const rawApiBase = String(import.meta.env.VITE_API_BASE_URL ?? "").trim();
  const normalizedApiBase = rawApiBase.replace(/\/+$/, "");
  const fillApiEndpoint = normalizedApiBase
    ? `${normalizedApiBase}${normalizedApiBase.endsWith("/api") ? "" : "/api"}/fill-from-urls`
    : "/api/fill-from-urls";

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
      ...rows.map((row) => [row.url, row.artist, row.trackName])
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
        .filter((row) => row.url || row.artist || row.trackName);

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
      let firstErrorMessage = "";

      for (const target of targets) {
        try {
          const response = await fetch(fillApiEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls: [target.url] })
          });

          if (!response.ok) {
            let detail = "";
            try {
              const errorPayload = await response.json();
              detail = errorPayload?.detail
                ? `: ${String(errorPayload.detail)}`
                : "";
            } catch {
              detail = "";
            }
            throw new Error(
              `Backend request failed (${response.status})${detail}`
            );
          }

          const payload = await response.json();
          const apiRow = payload.rows?.[0];

          if (apiRow) {
            nextRows[target.index] = {
              url: apiRow.url ?? nextRows[target.index].url,
              artist: apiRow.artist ?? nextRows[target.index].artist,
              trackName: apiRow.track_name ?? nextRows[target.index].trackName
            };
          }

          if (apiRow && (apiRow.artist || apiRow.track_name)) {
            updated += 1;
          } else {
            failed += 1;
          }
        } catch (error) {
          failed += 1;
          if (!firstErrorMessage) {
            firstErrorMessage =
              error instanceof Error
                ? error.message
                : "Unknown request error";
          }
        }

        completed += 1;
        setRows([...nextRows]);
        setStatus(
          `Filling metadata: ${completed}/${targets.length} completed (${updated} updated, ${failed} failed).`
        );
      }

      const summary = `Done. Processed ${targets.length} URL(s): ${updated} updated, ${failed} failed.`;
      if (updated === 0 && failed > 0 && firstErrorMessage) {
        setStatus(`${summary} First error: ${firstErrorMessage}`);
      } else {
        setStatus(summary);
      }
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
          columns <strong>URL</strong>, <strong>Artist</strong>, and{" "}
          <strong>Track Name</strong>.
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
              {isFilling ? "Filling..." : "Fill Track + Artist"}
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
