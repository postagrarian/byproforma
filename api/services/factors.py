"""
Download and cache Fama-French 5 + Momentum monthly factors from Ken French data library.
Adapted from the working byProforma research scripts.
"""
import io, zipfile, time, requests
import pandas as pd

FACTOR_COLS = ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "Mom"]
_BASE = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp"


def _fetch_zip(url: str) -> bytes:
    for attempt in range(4):
        try:
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            return r.content
        except Exception as exc:
            if attempt == 3:
                raise RuntimeError(f"Download failed ({url}): {exc}") from exc
            time.sleep(4 ** attempt)


def _parse_csv(raw_bytes: bytes) -> pd.DataFrame:
    with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
        name = [n for n in zf.namelist() if n.upper().endswith(".CSV")][0]
        text = zf.read(name).decode("utf-8", errors="replace")

    lines = text.splitlines()
    header_idx = None
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith(",") and any(f in s for f in ["Mkt-RF", "SMB", "Mom", "MOM"]):
            header_idx = i
            break
    if header_idx is None:
        raise ValueError("Cannot find column header in Ken French CSV")

    cols = [c.strip() for c in lines[header_idx].split(",") if c.strip()]
    rows = []
    for line in lines[header_idx + 1:]:
        parts = [p.strip() for p in line.split(",")]
        if not parts or not parts[0]:
            break
        ds = parts[0]
        if not (ds.isdigit() and len(ds) == 6):
            break
        try:
            vals = [float(v) for v in parts[1 : len(cols) + 1]]
        except ValueError:
            continue
        if len(vals) != len(cols):
            continue
        rows.append([pd.Timestamp(int(ds[:4]), int(ds[4:6]), 1)] + vals)

    df = pd.DataFrame(rows, columns=["date"] + cols).set_index("date")
    return df / 100.0


def fetch_factors(start: str = "2010-01-01") -> pd.DataFrame:
    ff5 = _parse_csv(_fetch_zip(f"{_BASE}/F-F_Research_Data_5_Factors_2x3_CSV.zip"))
    mom = _parse_csv(_fetch_zip(f"{_BASE}/F-F_Momentum_Factor_CSV.zip"))

    mom_col = [c for c in mom.columns if c.upper() == "MOM"]
    if mom_col and mom_col[0] != "Mom":
        mom = mom.rename(columns={mom_col[0]: "Mom"})
    elif not mom_col:
        mom = mom.rename(columns={mom.columns[0]: "Mom"})

    factors = ff5.join(mom[["Mom"]], how="inner").loc[start:]
    return factors


def factors_to_rows(df: pd.DataFrame) -> list[dict]:
    """Convert factors DataFrame to list of dicts for Supabase upsert."""
    rows = []
    for dt, row in df.iterrows():
        rows.append({
            "date":   dt.strftime("%Y-%m-%d"),
            "mkt_rf": float(row.get("Mkt-RF", 0)),
            "smb":    float(row.get("SMB", 0)),
            "hml":    float(row.get("HML", 0)),
            "rmw":    float(row.get("RMW", 0)),
            "cma":    float(row.get("CMA", 0)),
            "mom":    float(row.get("Mom", 0)),
            "rf":     float(row.get("RF", 0)),
        })
    return rows


def rows_to_dataframe(rows: list[dict]) -> pd.DataFrame:
    """Reconstruct factors DataFrame from Supabase rows."""
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").sort_index()
    df = df.rename(columns={
        "mkt_rf": "Mkt-RF", "smb": "SMB", "hml": "HML",
        "rmw": "RMW", "cma": "CMA", "mom": "Mom", "rf": "RF"
    })
    return df
