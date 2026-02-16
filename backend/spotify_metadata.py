from __future__ import annotations

import os
import re
import time
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

EMBED_PREFIX = "https://open.spotify.com/embed/track/"
SPOTIFY_TRACK_API_PREFIX = "https://api.spotify.com/v1/tracks/"
SPOTIFY_ARTIST_API_PREFIX = "https://api.spotify.com/v1/artists/"
SPOTIFY_ACCOUNTS_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_WEB_TOKEN_URL = (
    "https://open.spotify.com/get_access_token?reason=transport&productType=web_player"
)
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
)
DEFAULT_DELAY_SECONDS = 0.2
_TOKEN_CACHE = {
    "client_credentials": {"token": "", "expires_at": 0.0},
    "web_player": {"token": "", "expires_at": 0.0},
}


def _blank_metadata() -> dict[str, str]:
    return {
        "artist": "",
        "track_name": "",
        "genre": "",
        "album": "",
        "release_date": "",
        "duration": "",
        "explicit": "",
        "popularity": "",
    }


def _format_duration(duration_ms: int | None) -> str:
    if not isinstance(duration_ms, int) or duration_ms <= 0:
        return ""

    total_seconds = duration_ms // 1000
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours > 0:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


def _dedupe_strings(values: list[str]) -> list[str]:
    deduped = []
    seen = set()
    for value in values:
        cleaned = str(value or "").strip()
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(cleaned)
    return deduped


def track_id_from_url(url: str) -> str | None:
    if not url:
        return None

    cleaned = str(url).strip()
    if not cleaned:
        return None

    if cleaned.startswith("spotify:track:"):
        parts = cleaned.split(":")
        return parts[-1] if parts else None

    direct_match = re.search(
        r"open\.spotify\.com/(?:intl-[a-z]{2}/)?(?:embed/)?track/([A-Za-z0-9]+)",
        cleaned,
    )
    if direct_match:
        return direct_match.group(1)

    try:
        parsed = urlparse(cleaned)
    except Exception:
        return None

    path_parts = [segment for segment in parsed.path.split("/") if segment]
    if "track" in path_parts:
        track_index = path_parts.index("track")
        if track_index + 1 < len(path_parts):
            return path_parts[track_index + 1]
    return None


def _extract_track_artist_from_html(html: str) -> tuple[str | None, str | None]:
    soup = BeautifulSoup(html, "html.parser")

    def meta_content(name: str) -> str | None:
        tag = soup.find("meta", attrs={"property": name})
        if not tag:
            return None
        value = str(tag.get("content", "")).strip()
        return value or None

    track_name = meta_content("og:title")
    description = meta_content("og:description")

    artists = None
    if description:
        by_match = re.search(r"\bby\s+(.+?)\s+on\s+Spotify\b", description, re.I)
        if by_match:
            artists = by_match.group(1).strip()
        else:
            parts = [part.strip() for part in description.split("·") if part.strip()]
            if len(parts) >= 2:
                artists = parts[1]
            elif len(parts) == 1 and track_name and parts[0].lower() != track_name.lower():
                artists = parts[0]

    page_text = soup.get_text("\n", strip=True)
    lines = [line.strip() for line in page_text.split("\n") if line.strip()]

    if not track_name:
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

    if not artists:
        artist_links = []
        for anchor in soup.find_all("a", href=True):
            href = str(anchor.get("href", ""))
            if "/artist/" not in href:
                continue
            text = anchor.get_text(strip=True)
            if not text:
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


def _get_client_credentials_token(
    session: requests.Session, timeout: int = 20, force_refresh: bool = False
) -> str:
    client_id = str(os.getenv("SPOTIFY_CLIENT_ID") or "").strip()
    client_secret = str(os.getenv("SPOTIFY_CLIENT_SECRET") or "").strip()
    if not client_id or not client_secret:
        raise ValueError(
            "SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not configured."
        )

    now = time.time()
    cache = _TOKEN_CACHE["client_credentials"]
    if not force_refresh and cache["token"] and now < (cache["expires_at"] - 30):
        return str(cache["token"])

    response = session.post(
        SPOTIFY_ACCOUNTS_TOKEN_URL,
        data={"grant_type": "client_credentials"},
        auth=(client_id, client_secret),
        headers={"User-Agent": UA},
        timeout=timeout,
    )
    response.raise_for_status()

    payload = response.json()
    token = str(payload.get("access_token") or "").strip()
    if not token:
        raise ValueError("Spotify client-credentials token was missing in response.")

    expires_in = payload.get("expires_in")
    if isinstance(expires_in, (int, float)):
        expires_at = now + float(expires_in)
    else:
        expires_at = now + 300

    cache["token"] = token
    cache["expires_at"] = expires_at
    return token


def _get_web_player_token(
    session: requests.Session, timeout: int = 20, force_refresh: bool = False
) -> str:
    now = time.time()
    cache = _TOKEN_CACHE["web_player"]
    if not force_refresh and cache["token"] and now < (cache["expires_at"] - 30):
        return str(cache["token"])

    response = session.get(
        SPOTIFY_WEB_TOKEN_URL,
        headers={"User-Agent": UA, "Accept": "application/json"},
        timeout=timeout,
    )
    response.raise_for_status()

    payload = response.json()
    token = str(payload.get("accessToken") or "").strip()
    if not token:
        raise ValueError("Spotify web access token was missing in response.")

    expiry_ms = payload.get("accessTokenExpirationTimestampMs")
    if isinstance(expiry_ms, (int, float)):
        expires_at = float(expiry_ms) / 1000.0
    else:
        expires_at = now + 300

    cache["token"] = token
    cache["expires_at"] = expires_at
    return token


def _get_spotify_access_token(
    session: requests.Session, timeout: int = 20, force_refresh: bool = False
) -> str:
    errors = []
    providers = [_get_client_credentials_token, _get_web_player_token]
    for provider in providers:
        try:
            return provider(session=session, timeout=timeout, force_refresh=force_refresh)
        except Exception as exc:
            errors.append(f"{provider.__name__}: {exc}")

    joined = " | ".join(errors) if errors else "No token providers available."
    raise RuntimeError(f"Unable to obtain Spotify token. {joined}")


def _spotify_api_get(
    session: requests.Session, url: str, timeout: int = 20
) -> dict:
    response = None
    last_error = None
    for attempt in range(2):
        try:
            token = _get_spotify_access_token(
                session=session, timeout=timeout, force_refresh=(attempt == 1)
            )
        except Exception as exc:
            last_error = exc
            continue

        response = session.get(
            url,
            headers={"Authorization": f"Bearer {token}", "User-Agent": UA},
            timeout=timeout,
        )
        if response.status_code == 401 and attempt == 0:
            continue
        response.raise_for_status()
        data = response.json()
        return data if isinstance(data, dict) else {}

    if response is not None:
        response.raise_for_status()
    if last_error is not None:
        raise last_error
    return {}


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


def fetch_track_metadata(
    spotify_url: str,
    session: requests.Session,
    artist_genre_cache: dict[str, list[str]],
    timeout: int = 20,
) -> dict[str, str]:
    metadata = _blank_metadata()

    track_id = track_id_from_url(spotify_url)
    if not track_id:
        return metadata

    try:
        track_payload = _spotify_api_get(
            session, f"{SPOTIFY_TRACK_API_PREFIX}{track_id}", timeout=timeout
        )
        track_name = str(track_payload.get("name") or "").strip()
        artists_data = track_payload.get("artists") or []
        artists = []
        genres = []

        for artist_entry in artists_data:
            if not isinstance(artist_entry, dict):
                continue

            artist_name = str(artist_entry.get("name") or "").strip()
            if artist_name:
                artists.append(artist_name)

            artist_id = str(artist_entry.get("id") or "").strip()
            if not artist_id:
                continue

            if artist_id not in artist_genre_cache:
                try:
                    artist_payload = _spotify_api_get(
                        session, f"{SPOTIFY_ARTIST_API_PREFIX}{artist_id}", timeout=timeout
                    )
                    raw_genres = artist_payload.get("genres") or []
                    artist_genre_cache[artist_id] = _dedupe_strings(
                        [str(genre) for genre in raw_genres]
                    )
                except Exception:
                    artist_genre_cache[artist_id] = []

            genres.extend(artist_genre_cache[artist_id])

        album_data = track_payload.get("album")
        album_data = album_data if isinstance(album_data, dict) else {}

        explicit_value = track_payload.get("explicit")
        if isinstance(explicit_value, bool):
            explicit = "Yes" if explicit_value else "No"
        else:
            explicit = ""

        popularity_value = track_payload.get("popularity")
        popularity = (
            str(popularity_value)
            if isinstance(popularity_value, int)
            else ""
        )

        metadata["track_name"] = track_name
        metadata["artist"] = ", ".join(_dedupe_strings(artists))
        metadata["genre"] = ", ".join(_dedupe_strings(genres))
        metadata["album"] = str(album_data.get("name") or "").strip()
        metadata["release_date"] = str(album_data.get("release_date") or "").strip()
        metadata["duration"] = _format_duration(track_payload.get("duration_ms"))
        metadata["explicit"] = explicit
        metadata["popularity"] = popularity

        if metadata["track_name"] or metadata["artist"] or metadata["genre"]:
            return metadata
    except Exception:
        pass

    try:
        fallback_track, fallback_artist = fetch_track_artist(
            spotify_url=spotify_url,
            session=session,
            timeout=timeout,
        )
        metadata["track_name"] = fallback_track or ""
        metadata["artist"] = fallback_artist or ""
    except Exception:
        pass

    return metadata


def fill_rows(urls: list[str], delay_seconds: float = DEFAULT_DELAY_SECONDS) -> list[dict]:
    session = requests.Session()
    artist_genre_cache: dict[str, list[str]] = {}
    output_rows = []
    total = len(urls)

    for index, value in enumerate(urls, start=1):
        url = str(value or "").strip()
        if not url:
            output_rows.append({"url": "", **_blank_metadata()})
            continue

        metadata = fetch_track_metadata(
            spotify_url=url,
            session=session,
            artist_genre_cache=artist_genre_cache,
        )

        output_rows.append({"url": url, **metadata})

        if delay_seconds > 0 and index < total:
            time.sleep(delay_seconds)

    return output_rows


def fill_dataframe(df: pd.DataFrame, url_column: str = "Spotify URL") -> pd.DataFrame:
    import pandas as pd

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
    import pandas as pd

    input_path = Path(input_path)
    if output_path is None:
        output_path = input_path.with_name(f"{input_path.stem}_with_metadata.xlsx")

    df = pd.read_excel(input_path, sheet_name=sheet_name)
    filled_df = fill_dataframe(df, url_column=url_column)

    output_path = Path(output_path)
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        filled_df.to_excel(writer, index=False, sheet_name=sheet_name)

    return output_path
