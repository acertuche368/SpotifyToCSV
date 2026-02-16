from __future__ import annotations

import argparse

try:
    from .spotify_metadata import process_workbook
except ImportError:
    from spotify_metadata import process_workbook


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Fill Track Name + Artist for Spotify track URLs in an XLSX file. "
            'Defaults: sheet="Tracks", URL column="Spotify URL".'
        )
    )
    parser.add_argument("input_xlsx", help="Path to input .xlsx file")
    parser.add_argument(
        "output_xlsx",
        nargs="?",
        default=None,
        help="Optional output path. Defaults to <input>_with_metadata.xlsx",
    )
    parser.add_argument("--sheet", default="Tracks", help='Sheet name (default: "Tracks")')
    parser.add_argument(
        "--url-column",
        default="Spotify URL",
        help='URL column name (default: "Spotify URL"; fallback supports "URL")',
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    out_path = process_workbook(
        input_path=args.input_xlsx,
        output_path=args.output_xlsx,
        sheet_name=args.sheet,
        url_column=args.url_column,
    )
    print(f"Saved: {out_path}")


if __name__ == "__main__":
    main()
