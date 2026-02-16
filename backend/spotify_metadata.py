from __future__ import annotations

import re
import time
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd
import requests
from bs4 import BeautifulSoup

EMBED_PREFIX = "https://open.spotify.com/embed/track/"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
)
DEFAULT_DELAY_SECONDS = 0.2


def track_id_from_url(url: str) -> str | None:
    if not url:
        return None

    cleaned = str(url).strip()
    if not cleaned:
        return None

    if cleaned.startswith("spotify:track:"):
        parts = cleaned.split(":")
        return parts[-1] if parts else None

    direct_match = re.search(r"open\.spotify\.com/track/([A-Za-z0-9]+)", cleaned)
    if direct_match:
        return direct_match.group(1)

    try:
        parsed = urlparse(cleaned)
    except Exception:
        return None

    path_parts = [segment for segment in parsed.path.split("/") if segment]
    if len(path_parts) >= 2 and path_parts[0] == "track":
        return path_parts[1]
    return None


def _extract_track_artist_from_html(html: str) -> tuple[str | None, str | None]:
    soup = BeautifulSoup(html, "html.parser")
    page_text = soup.get_text("\n", strip=True)
    lines = [line.strip() for line in page_text.split("\n") if line.strip()]

    track_name = None
    for line in lines:
        if line in {"#", "##", "E"}:
            continue
        lower = line.lower()
        if lower.startswith("preview of spotify"):
            continue
        if lower.startswith("sign up to get unlimited songs"):
            continue
        if lower.startswith("listen on spotify"):
            continue
        track_name = line
        break

    ignored_links = {
        "Spotify",
        "Preview of Spotify",
        "Listen on Spotify",
    }
    artist_links = []
    for anchor in soup.find_all("a"):
        text = anchor.get_text(strip=True)
        if not text or text in ignored_links:
            continue
        if track_name and text == track_name:
            continue
        artist_links.append(text)

    deduped = []
    seen = set()
    for artist in artist_links:
        key = artist.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(artist)

    artists = ", ".join(deduped) if deduped else None
    return track_name, artists


def fetch_track_artist(
    spotify_url: str, session: requests.Session, timeout: int = 20
) -> tuple[str | None, str | None]:
    track_id = track_id_from_url(spotify_url)
    if not track_id:
        return None, None

    embed_url = f"{EMBED_PREFIX}{track_id}"
    response = session.get(embed_url, headers={"User-Agent": UA}, timeout=timeout)
    response.raise_for_status()
    return _extract_track_artist_from_html(response.text)


def fill_rows(urls: list[str], delay_seconds: float = DEFAULT_DELAY_SECONDS) -> list[dict]:
    session = requests.Session()
    output_rows = []
    total = len(urls)

    for index, value in enumerate(urls, start=1):
        url = str(value or "").strip()
        if not url:
            output_rows.append({"url": "", "artist": "", "track_name": ""})
            continue

        track_name = ""
        artist = ""
        try:
            fetched_track, fetched_artist = fetch_track_artist(url, session)
            track_name = fetched_track or ""
            artist = fetched_artist or ""
        except Exception:
            track_name = ""
            artist = ""

        output_rows.append(
            {"url": url, "artist": artist, "track_name": track_name}
        )

        if delay_seconds > 0 and index < total:
            time.sleep(delay_seconds)

    return output_rows


def fill_dataframe(df: pd.DataFrame, url_column: str = "Spotify URL") -> pd.DataFrame:
    if url_column not in df.columns:
        if "URL" in df.columns:
            url_column = "URL"
        else:
            raise ValueError(
                f'Expected column "{url_column}" (or fallback "URL") in input data.'
            )

    urls = df[url_column].fillna("").astype(str).tolist()
    filled_rows = fill_rows(urls)

    out = df.copy()
    out["Track Name"] = [row["track_name"] for row in filled_rows]
    out["Artist"] = [row["artist"] for row in filled_rows]
    return out


def process_workbook(
    input_path: str | Path,
    output_path: str | Path | None = None,
    sheet_name: str = "Tracks",
    url_column: str = "Spotify URL",
) -> Path:
    input_path = Path(input_path)
    if output_path is None:
        output_path = input_path.with_name(f"{input_path.stem}_with_metadata.xlsx")

    df = pd.read_excel(input_path, sheet_name=sheet_name)
    filled_df = fill_dataframe(df, url_column=url_column)

    output_path = Path(output_path)
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        filled_df.to_excel(writer, index=False, sheet_name=sheet_name)

    return output_path
