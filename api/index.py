from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from backend.spotify_metadata import fill_rows


class FillRequest(BaseModel):
    urls: list[str] = Field(default_factory=list)


class FillRow(BaseModel):
    url: str
    artist: str = ""
    track_name: str = ""
    genre: str = ""
    album: str = ""
    release_date: str = ""
    duration: str = ""
    explicit: str = ""
    popularity: str = ""


class FillResponse(BaseModel):
    rows: list[FillRow]


app = FastAPI(title="Spotify Metadata API (Vercel)", version="1.0.0")


@app.get("/health")
@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _fill_from_urls(payload: FillRequest) -> FillResponse:
    try:
        result_rows = fill_rows(payload.urls)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch track metadata: {exc}",
        ) from exc

    return FillResponse(rows=result_rows)


@app.post("/fill-from-urls", response_model=FillResponse)
@app.post("/api/fill-from-urls", response_model=FillResponse)
def fill_from_urls(payload: FillRequest) -> FillResponse:
    return _fill_from_urls(payload)
