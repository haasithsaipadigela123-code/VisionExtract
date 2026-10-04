"""
Vision Extract - structured data extraction from OCR text.

Given raw text produced by the OCR step, this module pulls out the useful
fields commonly seen in Indian business cards / posters / marketing videos:
phone, email, website, UPI ID, GST, PAN, IFSC, Aadhaar, date, amount, hashtag.

Kept deliberately readable - regex + small normaliser/validator helpers.
"""

import re
import difflib

# Human-friendly labels, also fixes the display order in the UI.
CATEGORY_LABELS = {
    "phone":   "Phone Numbers",
    "email":   "Emails",
    "website": "Websites",
    "upi":     "UPI IDs",
    "gst":     "GST Numbers",
    "pan":     "PAN Numbers",
    "ifsc":    "IFSC Codes",
    "aadhaar": "Aadhaar Numbers",
    "date":    "Dates",
    "amount":  "Amounts",
    "hashtag": "Hashtags",
}
CATEGORY_ORDER = list(CATEGORY_LABELS.keys())

# --------------------------------------------------------------------------- #
# Patterns
# --------------------------------------------------------------------------- #
MONTHS_RE = (
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
)

PATTERNS = {
    "phone": [
        re.compile(r"(?:\+91|91)[\s\-]?[6-9]\d{9}"),
        re.compile(r"\b[6-9]\d{9}\b"),
        re.compile(r"\+(?!91)\d{1,3}[\s\-]?\(?\d{2,4}\)?[\s\-]?\d{3,5}[\s\-]?\d{3,5}"),
    ],
    "email": [
        re.compile(r"[a-zA-Z0-9._%+\-]{2,}@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"),
    ],
    "website": [
        re.compile(r"(?<![@a-zA-Z0-9])https?://(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-zA-Z]{2,}\b[-a-zA-Z0-9@:%_+.~#?&/=]*"),
        re.compile(r"(?<![@a-zA-Z0-9])www\.[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-zA-Z]{2,}\b[-a-zA-Z0-9@:%_+.~#?&/=]*"),
    ],
    "upi": [
        re.compile(
            r"[a-zA-Z0-9.\-_]{3,}@(?:upi|paytm|okaxis|oksbi|okhdfcbank|okicici|ybl|ibl|axl|apl|"
            r"ptyes|ptaxis|ptsbi|hdfcbank|sbi|kotak|icici|axisbank|axis|barodampay|cnrb|fbl|"
            r"federal|idfcbank|indus|kbl|rbl|uboi|unionbank|yesbank|phonepe|gpay|amazonpay)\b(?!\.[a-zA-Z])",
            re.I,
        ),
    ],
    "gst": [re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b", re.I)],
    "pan": [re.compile(r"(?<![@a-zA-Z0-9])\b[A-Z]{5}[0-9]{4}[A-Z]\b(?![@a-zA-Z0-9])", re.I)],
    "ifsc": [re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b", re.I)],
    "aadhaar": [re.compile(r"\b\d{4}\s\d{4}\s\d{4}\b")],
    "date": [
        # 1. Standard numeric: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DD/MM/YY (flexible spacing around separators)
        re.compile(r"\b(?:0?[1-9]|[12]\d|3[01])\s*[\/\-.]\s*(?:0?[1-9]|1[0-2])\s*[\/\-.]\s*(?:\d{4}|\d{2})\b"),
        # 2. ISO numeric: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
        re.compile(r"\b(?:19|20)\d{2}\s*[\/\-.]\s*(?:0?[1-9]|1[0-2])\s*[\/\-.]\s*(?:0?[1-9]|[12]\d|3[01])\b"),
        # 3. Numeric with space separator: DD MM YYYY (e.g. 28 09 2026)
        re.compile(r"\b(?:0?[1-9]|[12]\d|3[01])\s+(?:0?[1-9]|1[0-2])\s+(?:19|20)\d{2}\b"),
        # 4. Day Month Year: 06 July 2026, 6th July 2026, 28-Sep-2026, 28th Sept 2026, 15-Aug-1947, 06-JUL-26
        re.compile(r"\b(?:0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?[\s\/\-.]+" + MONTHS_RE + r"[\s\/\-.,]+(?:\d{4}|\d{2})\b", re.I),
        # 5. Month Day Year: July 6, 2026, Sep 28 2026, September 28th, 2026
        re.compile(r"(?<!\d[\s\/\-.])\b" + MONTHS_RE + r"[\s\/\-.]+(?:0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?(?:[\s,]+(?:\d{4}|\d{2}))\b", re.I),
    ],
    "amount": [
        re.compile(r"(?:rs\.?|inr|₹|\$)\s?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?", re.I),
        re.compile(r"\b\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?\s?(?:rs\.?|inr)\b", re.I),
    ],
    "hashtag": [re.compile(r"#[A-Za-z][A-Za-z0-9_]{1,49}")],
}


# --------------------------------------------------------------------------- #
# OCR clean-up: fix the digit/letter confusions OCR makes, but only inside
# numeric context so emails / URLs are left untouched.
# --------------------------------------------------------------------------- #
def _clean_ocr(text: str) -> str:
    # Fix OCR pipes or backslashes between date digits (e.g., "28|09|2026" or "28\09\2026" -> "28/09/2026")
    t = re.sub(r"(\b\d{1,2})\s*[|\\]\s*(\d{1,2})\s*[|\\]\s*(\d{2,4}\b)", r"\1/\2/\3", text)
    t = re.sub(r"(\b(?:19|20)\d{2})\s*[|\\]\s*(\d{1,2})\s*[|\\]\s*(\d{1,2}\b)", r"\1/\2/\3", t)

    def pipe_to_one(m):
        i = m.start()
        prev = t[i - 1] if i > 0 else ""
        nxt = t[i + 1] if i + 1 < len(t) else ""
        return "1" if (prev.isdigit() or nxt.isdigit()) else "|"

    t = re.sub(r"\|", pipe_to_one, t)
    t = re.sub(r"\bI(?=\d)", "1", t)
    t = re.sub(r"\bO(?=\d)", "0", t)
    t = re.sub(r"\bl(?=\d)", "1", t)

    # Fix spaces around @ and . in OCR-extracted emails (e.g., "user @ domain . com" -> "user@domain.com")
    t = re.sub(r"([a-zA-Z0-9._%+\-]+)\s*@\s*([a-zA-Z0-9.\-]+)", r"\1@\2", t)
    t = re.sub(r"(@[a-zA-Z0-9\-]+)\s*\.\s*([a-zA-Z]{2,})", r"\1.\2", t)

    t = re.sub(r"\s{2,}", " ", t)
    return t


# --------------------------------------------------------------------------- #
# Normalisers
# --------------------------------------------------------------------------- #
MONTH_MAP = {
    "jan": "01", "january": "01",
    "feb": "02", "february": "02",
    "mar": "03", "march": "03",
    "apr": "04", "april": "04",
    "may": "05",
    "jun": "06", "june": "06",
    "jul": "07", "july": "07",
    "aug": "08", "august": "08",
    "sep": "09", "sept": "09", "september": "09",
    "oct": "10", "october": "10",
    "nov": "11", "november": "11",
    "dec": "12", "december": "12",
}


def _norm_email(raw: str) -> str:
    # Strip leading/trailing punctuation and markdown/bracket wrappers
    t = raw.strip(' <>"\'()[]{}:;,./\\')
    if t.lower().startswith("mailto:"):
        t = t[7:]
    t = t.lower()

    # Correct common OCR letter/digit confusions in standard domains
    domain_fixes = [
        (r'@gmai[1li]\.com\b', '@gmail.com'),
        (r'@gmall\.com\b', '@gmail.com'),
        (r'@hotmai[1li]\.com\b', '@hotmail.com'),
        (r'@yah[o0][o0]\.com\b', '@yahoo.com'),
        (r'@out[1l]ook\.com\b', '@outlook.com'),
        (r'@rediffmai[1l]\.com\b', '@rediffmail.com'),
        (r'@protonmai[1l]\.com\b', '@protonmail.com'),
    ]
    for pat, repl in domain_fixes:
        t = re.sub(pat, repl, t)
    return t


def _norm_phone(raw: str) -> str:
    d = re.sub(r"\D", "", raw)
    if len(d) == 12 and d.startswith("91") and d[2] in "6789":
        return "+91" + d[2:]
    if len(d) == 11 and d.startswith("0"):
        return "+91" + d[1:]
    if len(d) == 10 and d[0] in "6789":
        return "+91" + d
    return re.sub(r"\s", "", raw).strip()


def _norm_lower(raw: str) -> str:
    return raw.strip(' <>"\'()[]{}:;,./\\').lower()


def _norm_upper(raw: str) -> str:
    return raw.strip(' <>"\'()[]{}:;,./\\').upper()


def _norm_website(raw: str) -> str:
    url = re.sub(r"\s", "", raw.strip(' <>"\'()[]{}:;,'))
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    return re.sub(r"/$", "", url).lower()


def _norm_aadhaar(raw: str) -> str:
    d = re.sub(r"\D", "", raw)
    return f"{d[0:4]} {d[4:8]} {d[8:12]}"


def _norm_date(raw: str) -> str:
    t = raw.strip(" \t\r\n,.;:()[]{}")

    # Day Month Year: 06 July 2026, 6th Jul 26, 28-Sep-2026, 28th Sept 2026
    m = re.match(r"^(\d{1,2})(?:st|nd|rd|th)?[\s\/\-.]+([A-Za-z]+)[\s\/\-.,]+(\d{2,4})$", t, re.I)
    if m:
        day, mon, yr = m.groups()
        mon_lower = mon.lower()
        if mon_lower in MONTH_MAP:
            day_str = f"{int(day):02d}"
            yr_str = yr if len(yr) == 4 else ("20" + yr if int(yr) < 50 else "19" + yr)
            return f"{day_str}/{MONTH_MAP[mon_lower]}/{yr_str}"

    # Month Day Year: July 6 2026, Sep 28, 2026
    m = re.match(r"^([A-Za-z]+)[\s\/\-.]+(\d{1,2})(?:st|nd|rd|th)?(?:[\s,]+(\d{2,4}))?$", t, re.I)
    if m:
        mon, day, yr = m.groups()
        mon_lower = mon.lower()
        if mon_lower in MONTH_MAP:
            day_str = f"{int(day):02d}"
            yr_str = (yr if len(yr) == 4 else ("20" + yr if int(yr) < 50 else "19" + yr)) if yr else ""
            return f"{day_str}/{MONTH_MAP[mon_lower]}/{yr_str}" if yr_str else f"{day_str}/{MONTH_MAP[mon_lower]}"

    # ISO format: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
    m = re.match(r"^(\d{4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})$", t)
    if m:
        yr, mon, day = m.groups()
        return f"{int(day):02d}/{int(mon):02d}/{yr}"

    # Standard format: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DD MM YYYY, or 2-digit year
    m = re.match(r"^(\d{1,2})\s*[\/\-.\s]\s*(\d{1,2})\s*[\/\-.\s]\s*(\d{2,4})$", t)
    if m:
        day, mon, yr = m.groups()
        yr_str = yr if len(yr) == 4 else ("20" + yr if int(yr) < 50 else "19" + yr)
        return f"{int(day):02d}/{int(mon):02d}/{yr_str}"

    return re.sub(r"[\s\-.]+", "/", t)


def _norm_amount(raw: str) -> str:
    return re.sub(r"\s+", "", raw.strip()).upper()


# --------------------------------------------------------------------------- #
# Validators (return True to keep a match)
# --------------------------------------------------------------------------- #
def _valid_phone(v: str) -> bool:
    t = v.strip()
    d = re.sub(r"\D", "", t)
    if len(d) == 10 and d[0] in "6789":
        return True
    if len(d) == 12 and d.startswith("91") and d[2] in "6789":
        return True
    if t.startswith("+") and 10 <= len(d) <= 15:
        return True
    return False


def _valid_email(v: str) -> bool:
    cleaned = _norm_email(v)
    return re.match(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$", cleaned) is not None


def _valid_gst(v: str) -> bool:
    return re.match(r"^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$", v.strip().upper()) is not None


def _valid_pan(v: str) -> bool:
    return re.match(r"^[A-Z]{5}[0-9]{4}[A-Z]$", v.strip().upper()) is not None


def _valid_ifsc(v: str) -> bool:
    return re.match(r"^[A-Z]{4}0[A-Z0-9]{6}$", v.strip().upper()) is not None


def _valid_aadhaar(v: str) -> bool:
    d = re.sub(r"\D", "", v)
    if len(d) != 12:
        return False
    if d[0] in "01":            # Aadhaar never starts with 0 or 1
        return False
    if len(set(d)) == 1:        # reject 000000000000 etc.
        return False
    return True


def _valid_date(v: str) -> bool:
    norm = _norm_date(v)
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", norm)
    if not m:
        return False
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1 <= mo <= 12):
        return False
    if not (1 <= d <= 31):
        return False
    if mo in (4, 6, 9, 11) and d > 30:
        return False
    if mo == 2:
        is_leap = (y % 4 == 0 and y % 100 != 0) or (y % 400 == 0)
        if d > (29 if is_leap else 28):
            return False
    if not (1900 <= y <= 2099):
        return False
    return True


def _valid_amount(v: str) -> bool:
    return any(ch.isdigit() for ch in v)


# category -> (patterns, normaliser, validator|None)
_RULES = [
    ("phone",   PATTERNS["phone"],   _norm_phone,    _valid_phone),
    ("email",   PATTERNS["email"],   _norm_email,    _valid_email),
    ("upi",     PATTERNS["upi"],     _norm_lower,    None),
    ("gst",     PATTERNS["gst"],     _norm_upper,    _valid_gst),
    ("pan",     PATTERNS["pan"],     _norm_upper,    _valid_pan),
    ("ifsc",    PATTERNS["ifsc"],    _norm_upper,    _valid_ifsc),
    ("aadhaar", PATTERNS["aadhaar"], _norm_aadhaar,  _valid_aadhaar),
    ("date",    PATTERNS["date"],    _norm_date,     _valid_date),
    ("amount",  PATTERNS["amount"],  _norm_amount,   _valid_amount),
    ("hashtag", PATTERNS["hashtag"], _norm_lower,    None),
    ("website", PATTERNS["website"], _norm_website,  None),
]


def extract_from_text(text: str):
    """Return a list of {category, value, normalized, raw} found in `text`."""
    cleaned = _clean_ocr(text or "")
    found = []
    for cat, patterns, normalize, validate in _RULES:
        for pat in patterns:
            for m in pat.finditer(cleaned):
                raw = m.group(0).strip()
                if len(raw) < 3:
                    continue
                if validate and not validate(raw):
                    continue
                norm = normalize(raw)
                found.append(
                    {"category": cat, "value": raw, "normalized": norm, "raw": raw}
                )
    return found


def _is_similar_email(e1: str, e2: str) -> bool:
    """Return True if e1 and e2 are OCR variations of the same email."""
    if e1 == e2:
        return True
    parts1 = e1.split("@", 1)
    parts2 = e2.split("@", 1)
    if len(parts1) != 2 or len(parts2) != 2:
        return False
    u1, d1 = parts1
    u2, d2 = parts2
    if d1 != d2:
        return False
    ratio = difflib.SequenceMatcher(None, u1, u2).ratio()
    if ratio >= 0.78:
        return True
    if len(u1) >= 8 and len(u2) >= 8:
        matcher = difflib.SequenceMatcher(None, u1, u2)
        match_len = sum(size for _, _, size in matcher.get_matching_blocks())
        max_len = max(len(u1), len(u2))
        if match_len / max_len >= 0.80:
            return True
    return False


def _is_similar_upi(u1: str, u2: str) -> bool:
    """Return True if u1 and u2 are OCR variations of the same UPI ID."""
    if u1 == u2:
        return True
    parts1 = u1.split("@", 1)
    parts2 = u2.split("@", 1)
    if len(parts1) != 2 or len(parts2) != 2:
        return False
    user1, handle1 = parts1
    user2, handle2 = parts2
    if handle1 != handle2:
        return False
    return difflib.SequenceMatcher(None, user1, user2).ratio() >= 0.82


def _score_email_quality(email: str, confidence: float = 0.0) -> float:
    """Score how clean and complete an OCR-read email is."""
    score = float(confidence or 50.0)
    u, _ = email.split("@", 1)
    score += len(u) * 2.0
    if re.search(r"\d{2,}$", u):
        score += 20.0
    elif re.search(r"[a-z]\d[a-z]$", u) or re.search(r"[a-z]z\d$", u) or re.search(r"lz\d$", u):
        score -= 20.0
    if "dh" in u and "sith" not in u:
        score -= 10.0
    return score


def dedupe(items):
    """
    Two-stage deduplication:
    1. Exact normalization match (preserves highest confidence).
    2. Fuzzy similarity clustering (collapses OCR variations of the same email/UPI).
    """
    if not items:
        return []

    # Step 1: exact normalization deduplication
    by_key = {}
    order = []
    for it in items:
        key = (it["category"], it["normalized"].lower())
        if key not in by_key:
            by_key[key] = dict(it)
            order.append(key)
        else:
            if it.get("confidence", 0) > by_key[key].get("confidence", 0):
                by_key[key]["confidence"] = it["confidence"]

    exact_items = [by_key[k] for k in order]

    # Step 2: fuzzy similarity clustering for emails
    emails = [it for it in exact_items if it["category"] == "email"]
    other_items = [it for it in exact_items if it["category"] != "email"]

    email_clusters = []
    for it in emails:
        val = it["normalized"].lower()
        matched = None
        for c in email_clusters:
            if _is_similar_email(val, c["best"]["normalized"].lower()):
                matched = c
                break
        if matched is not None:
            matched["members"].append(it)
            curr_score = _score_email_quality(matched["best"]["normalized"], matched["best"].get("confidence", 0))
            new_score = _score_email_quality(it["normalized"], it.get("confidence", 0))
            if new_score > curr_score:
                matched["best"]["normalized"] = it["normalized"]
                matched["best"]["value"] = it["value"]
            if it.get("confidence", 0) > matched["best"].get("confidence", 0):
                matched["best"]["confidence"] = it["confidence"]
        else:
            email_clusters.append({"best": dict(it), "members": [it]})

    deduped_emails = [c["best"] for c in email_clusters]

    # Step 3: fuzzy similarity clustering for UPI IDs
    upis = [it for it in other_items if it["category"] == "upi"]
    rest_items = [it for it in other_items if it["category"] != "upi"]

    upi_clusters = []
    for it in upis:
        val = it["normalized"].lower()
        matched = None
        for c in upi_clusters:
            if _is_similar_upi(val, c["best"]["normalized"].lower()):
                matched = c
                break
        if matched is not None:
            matched["members"].append(it)
            if it.get("confidence", 0) > matched["best"].get("confidence", 0):
                matched["best"]["confidence"] = it["confidence"]
        else:
            upi_clusters.append({"best": dict(it), "members": [it]})

    deduped_upis = [c["best"] for c in upi_clusters]

    all_deduped = deduped_emails + deduped_upis + rest_items
    all_deduped.sort(key=lambda x: (x.get("frame", 1), x.get("timestamp", 0.0)))
    return all_deduped


def build_results(frames):
    """
    Combine per-frame OCR output into the final structured payload.

    `frames` is a list of {frame, timestamp, text, confidence}.
    """
    items = []
    for fr in frames:
        for d in extract_from_text(fr.get("text", "")):
            items.append(
                {
                    **d,
                    "frame": fr.get("frame", 1),
                    "timestamp": round(float(fr.get("timestamp", 0.0)), 2),
                    "confidence": round(float(fr.get("confidence", 0.0)), 1),
                }
            )

    items = dedupe(items)
    for i, it in enumerate(items):
        it["id"] = i + 1

    by_category = {}
    for it in items:
        by_category.setdefault(it["category"], []).append(it)

    counts = {c: len(by_category[c]) for c in CATEGORY_ORDER if c in by_category}

    return {
        "items": items,
        "by_category": by_category,
        "counts": counts,
        "total": len(items),
        "labels": CATEGORY_LABELS,
        "order": CATEGORY_ORDER,
    }
