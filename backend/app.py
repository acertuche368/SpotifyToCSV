from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

try:
    from .spotify_metadata import fill_rows
except ImportError:
    from spotify_metadata import fill_rows


class FillRequest(BaseModel):
    urls: list[str] = Field(default_factory=list)


class FillRow(BaseModel):
    url: str
    artist: str
    track_name: str


class FillResponse(BaseModel):
    rows: list[FillRow]


app = FastAPI(title="Spotify Metadata API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/fill-from-urls", response_model=FillResponse)
def fill_from_urls(payload: FillRequest) -> FillResponse:
    try:
        result_rows = fill_rows(payload.urls)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch track metadata: {exc}",
        ) from exc

    return FillResponse(rows=result_rows)
