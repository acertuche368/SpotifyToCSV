import { useState } from "react";
import * as XLSX from "xlsx";
import "./App.css";

const EMPTY_ROW = { url: "", artist: "", trackName: "" };
const HEADERS = ["URL", "Artist", "Track Name"];

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
      ...rows.map((row) => [row.url, row.artist, row.trackName])
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Tracks");
    XLSX.writeFile(workbook, "spotify_tracks.xlsx");
    setStatus(`Exported ${rows.length} row(s) to spotify_tracks.xlsx.`);
  };

  const importWorkbook = async (event) => {
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

    const urls = rows.map((row) => row.url.trim());
    if (!urls.some(Boolean)) {
      setStatus("No Spotify URLs found in the URL column.");
      return;
    }

    setIsFilling(true);
    setStatus("Fetching Track Name and Artist from Spotify...");

    try {
      const response = await fetch(`${apiBase}/api/fill-from-urls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls })
      });

      if (!response.ok) {
        throw new Error(`Backend request failed (${response.status}).`);
      }

      const payload = await response.json();
      const enrichedRows = rows.map((row, index) => {
        const apiRow = payload.rows?.[index];
        if (!apiRow) {
          return row;
        }

        return {
          url: apiRow.url ?? row.url,
          artist: apiRow.artist ?? row.artist,
          trackName: apiRow.track_name ?? row.trackName
        };
      });

      const filledCount = enrichedRows.filter(
        (row) => row.artist || row.trackName
      ).length;
      setRows(enrichedRows);
      setStatus(`Metadata filled for ${filledCount} row(s).`);
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
        />

        <div className="button-row">
          <button type="button" onClick={loadUrls}>
            Load URLs Into Table
          </button>
          <label className="file-button">
            Import CSV/XLSX
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={importWorkbook}
            />
          </label>
          <button type="button" className="ghost" onClick={addRow}>
            Add Empty Row
          </button>
          <button type="button" className="ghost" onClick={clearAll}>
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
            <button type="button" className="ghost" onClick={exportWorkbook}>
              Export XLSX
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>URL</th>
                <th>Artist</th>
                <th>Track Name</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row, index) => (
                  <tr key={`${row.url}-${index}`}>
                    <td>
                      <input
                        value={row.url}
                        onChange={(event) =>
                          updateCell(index, "url", event.target.value)
                        }
                        placeholder="Spotify URL"
                      />
                    </td>
                    <td>
                      <input
                        value={row.artist}
                        onChange={(event) =>
                          updateCell(index, "artist", event.target.value)
                        }
                        placeholder="Artist"
                      />
                    </td>
                    <td>
                      <input
                        value={row.trackName}
                        onChange={(event) =>
                          updateCell(index, "trackName", event.target.value)
                        }
                        placeholder="Track Name"
                      />
                    </td>
                    <td className="action-cell">
                      <button
                        type="button"
                        className="danger"
                        onClick={() => removeRow(index)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="empty-state">
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
