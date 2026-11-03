"""Spoken commands that work the menu: "tăng tốc độ đọc", "tắt chẩn đoán", "mở mục giọng đọc".

The page sends what it can be told to do (`controls`: a name or two in each language,
what kind of thing it is, its range and where it stands now). The verdict is a finished
value, worked out here, so what the assistant says back ("đã đặt tốc độ đọc một phẩy hai")
is exactly what the page then does. Words are matched by sound-alike letters, as in
`commands.py`; nothing here knows any particular setting.

Kinds:
- `number`: min, max, step, value, default. Said as "tăng/giảm", "đặt … 20", "tối đa", "mặc định", "50 phần trăm".
- `toggle`: value true/false. "bật", "tắt", "mở", "đóng".
- `choice`: options, each with its own names. "chuyển sang tiếng Anh".
- `page`: a menu entry to open. Needs the word "mục" ("mở mục giọng đọc").
"""

from __future__ import annotations

import re
from typing import Any

from .commands import _MATCH, _heard, _overlap, _score

_ON = {"bat", "mo", "enable", "turnon", "open", "show", "hien"}
_OFF = {"tat", "dong", "disable", "turnoff", "close", "hide", "giau"}
_UP = {"tang", "increase", "raise", "higher", "bigger", "lon", "cao", "nhanh", "faster"}
_DOWN = {"giam", "decrease", "lower", "reduce", "smaller", "nho", "thap", "cham", "slower"}
_SET = {"dat", "set", "chinh", "doi", "change", "adjust", "dieuchinh"}
_MAX = {"toida", "max", "maximum"}
_MIN = {"toithieu", "min", "minimum"}
_DEFAULT = {"macdinh", "default", "reset", "datlai"}
_CHOOSE = {"chuyen", "sang", "switch", "use", "dung", "change", "doi", "set", "dat"}
_PAGE_WORD = {"muc", "section", "page", "tab", "trang"}
_OPEN = {"mo", "open", "vao", "go", "show", "xem", "chuyen", "switch"}
_PERCENT = {"phantram", "percent"}
_NUMBER = re.compile(r"(?<![\w.,])\d+(?:[.,]\d+)?(?![\w])")
_RELATIVE_SHARE = 0.1
_SCORE_FLOOR = 0.8

_SAY: dict[str, dict[str, str]] = {
    "vi": {
        "set": "Đã đặt {name} thành {value}.",
        "up": "Đã tăng {name} lên {value}.",
        "down": "Đã giảm {name} xuống {value}.",
        "at_limit": "{name} đã ở mức {value} rồi.",
        "on": "Đã bật {name}.",
        "off": "Đã tắt {name}.",
        "already_on": "{name} đang bật rồi.",
        "already_off": "{name} đang tắt rồi.",
        "choose": "Đã chuyển {name} sang {option}.",
        "page": "Đã mở mục {name}.",
        "opened": "Đã mở {name}.",
        "closed": "Đã đóng {name}.",
        "already_open": "{name} đang mở rồi.",
        "already_closed": "{name} đang đóng rồi.",
    },
    "en": {
        "set": "{name} is now {value}.",
        "up": "{name} is up to {value}.",
        "down": "{name} is down to {value}.",
        "at_limit": "{name} is already at {value}.",
        "on": "{name} is on.",
        "off": "{name} is off.",
        "already_on": "{name} is already on.",
        "already_off": "{name} is already off.",
        "choose": "{name} is now {option}.",
        "page": "Opened the {name} section.",
        "opened": "The {name} is open.",
        "closed": "The {name} is closed.",
        "already_open": "The {name} is already open.",
        "already_closed": "The {name} is already closed.",
    },
}


def parse_controls(raw: Any) -> list[dict[str, Any]]:
    """Keeps only well-formed entries; the page is trusted no further than that."""
    if not isinstance(raw, list):
        return []
    kept: list[dict[str, Any]] = []
    for item in raw[:200]:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            continue
        kind = item.get("kind")
        names = {lang: _strings(item.get(lang)) for lang in ("vi", "en")}
        if kind not in {"number", "toggle", "choice", "page"} or not (names["vi"] or names["en"]):
            continue
        entry: dict[str, Any] = {"id": item["id"][:60], "kind": kind, **names, "unit": _unit(item.get("unit"))}
        if kind == "number":
            numbers = [item.get(key) for key in ("min", "max", "step", "value", "default")]
            if not all(isinstance(n, (int, float)) and not isinstance(n, bool) for n in numbers):
                continue
            entry.update(zip(("min", "max", "step", "value", "default"), (float(n) for n in numbers)))
            if entry["step"] <= 0 or entry["max"] <= entry["min"]:
                continue
        elif kind == "toggle":
            entry["value"] = bool(item.get("value"))
            entry["open"] = bool(item.get("open"))
        elif kind == "choice":
            options = []
            for option in item.get("options") or []:
                if isinstance(option, dict) and isinstance(option.get("value"), str):
                    options.append(
                        {"value": option["value"][:30], "vi": _strings(option.get("vi")), "en": _strings(option.get("en"))}
                    )
            if not options:
                continue
            entry["options"] = options
        kept.append(entry)
    return kept


def _unit(raw: Any) -> dict[str, str]:
    """The unit said in each language; a bare string is the same in both."""
    if isinstance(raw, dict):
        return {lang: str(raw.get(lang, ""))[:30] for lang in ("vi", "en")}
    text = str(raw or "")[:30]
    return {"vi": text, "en": text}


def _strings(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    return [str(value)[:60] for value in raw[:8] if isinstance(value, str) and value.strip()]


def _names(entry: dict[str, Any], locale: str) -> list[str]:
    own = "vi" if locale == "vi" else "en"
    other = "en" if own == "vi" else "vi"
    return [*entry.get(own, []), *entry.get(other, [])]


def _label(entry: dict[str, Any], locale: str) -> str:
    own = entry.get("vi" if locale == "vi" else "en") or entry.get("en") or entry.get("vi") or [entry["id"]]
    return own[0]


def _match(words: list[str], phrases: list[str]) -> float:
    return max((max(_score(words, p), _overlap(words, p)) for p in phrases), default=0.0)


def _decimals(step: float) -> int:
    text = f"{step:.6f}".rstrip("0")
    return len(text.split(".")[1]) if "." in text else 0


def _show(value: float, step: float, unit: str, locale: str) -> str:
    text = f"{value:.{_decimals(step)}f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    if locale == "vi":
        text = text.replace(".", " phẩy ")
    return f"{text} {unit}".strip()


def _snap(value: float, entry: dict[str, Any]) -> float:
    low, high, step = entry["min"], entry["max"], entry["step"]
    clamped = min(high, max(low, value))
    return min(high, max(low, round((clamped - low) / step) * step + low))


def _number_command(entry: dict[str, Any], heard_set: set[str], heard: str, locale: str) -> dict[str, Any] | None:
    say = _SAY["vi" if locale == "vi" else "en"]
    current, low, high, step = entry["value"], entry["min"], entry["max"], entry["step"]
    typed = _NUMBER.search(heard)
    kind = "set"
    if typed:
        number = float(typed.group(0).replace(",", "."))
        target = low + (high - low) * number / 100 if heard_set & _PERCENT or "%" in heard else number
    elif heard_set & _MAX:
        target = high
    elif heard_set & _MIN:
        target = low
    elif heard_set & _DEFAULT:
        target = entry["default"]
    elif heard_set & _UP or heard_set & _DOWN:
        jump = max(step, round((high - low) * _RELATIVE_SHARE / step) * step)
        kind = "up" if heard_set & _UP else "down"
        target = current + jump if kind == "up" else current - jump
    else:
        return None
    value = _snap(target, entry)
    shown = _show(value, step, entry["unit"]["vi" if locale == "vi" else "en"], locale)
    name = _label(entry, locale)
    if value == current and kind != "set":
        reply = say["at_limit"].format(name=name, value=shown)
    else:
        reply = say[kind].format(name=name, value=shown)
    return {"action": "setting", "id": entry["id"], "value": value, "reply": reply}


def _toggle_command(entry: dict[str, Any], heard_set: set[str], locale: str) -> dict[str, Any] | None:
    say = _SAY["vi" if locale == "vi" else "en"]
    if heard_set & _OFF:
        want = False
    elif heard_set & _ON:
        want = True
    else:
        return None
    name = _label(entry, locale)
    # Something that opens and closes (the menu) is told as "opened", not "turned on".
    keys = ("already_open", "already_closed", "opened", "closed") if entry.get("open") else ("already_on", "already_off", "on", "off")
    if want == entry["value"]:
        reply = say[keys[0] if want else keys[1]].format(name=name)
    else:
        reply = say[keys[2] if want else keys[3]].format(name=name)
    return {"action": "setting", "id": entry["id"], "value": want, "reply": reply}


def control_command(heard: str, controls: list[dict[str, Any]], locale: str) -> dict[str, Any] | None:
    """The menu command in `heard`, or None when the line is an ordinary question.

    The result is `{"action": "setting", "id", "value", "reply"}`; `value` is a number,
    a bool, an option's value, or True for a page to open.
    """
    words = heard.replace("-", " ").split()
    if not words or not controls:
        return None
    heard_set = _heard(words)
    say = _SAY["vi" if locale == "vi" else "en"]

    if heard_set & _PAGE_WORD and heard_set & _OPEN:
        best_page: tuple[float, dict[str, Any]] | None = None
        for entry in (c for c in controls if c["kind"] == "page"):
            score = _match(words, _names(entry, locale))
            if score >= _SCORE_FLOOR and (best_page is None or score > best_page[0]):
                best_page = (score, entry)
        if best_page:
            entry = best_page[1]
            return {
                "action": "setting",
                "id": entry["id"],
                "value": True,
                "reply": say["page"].format(name=_label(entry, locale)),
            }

    if heard_set & _CHOOSE:
        for entry in (c for c in controls if c["kind"] == "choice"):
            best_option: tuple[float, dict[str, Any]] | None = None
            for option in entry["options"]:
                score = _match(words, _names(option, locale))
                if score >= _SCORE_FLOOR and (best_option is None or score > best_option[0]):
                    best_option = (score, option)
            if best_option:
                option = best_option[1]
                reply = say["choose"].format(name=_label(entry, locale), option=_label(option, locale))
                return {"action": "setting", "id": entry["id"], "value": option["value"], "reply": reply}

    best: tuple[float, dict[str, Any]] | None = None
    for entry in (c for c in controls if c["kind"] in {"number", "toggle"}):
        score = _match(words, _names(entry, locale))
        if score >= _SCORE_FLOOR and (best is None or score > best[0]):
            best = (score, entry)
    if best is None:
        return None
    entry = best[1]
    if entry["kind"] == "toggle":
        return _toggle_command(entry, heard_set, locale)
    return _number_command(entry, heard_set, heard, locale)
