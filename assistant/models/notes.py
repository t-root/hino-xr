
from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import time
import unicodedata
from pathlib import Path
from typing import Any

from .commands import _heard
from .tools import _digit, _number_at
from .wake import letters

FILE = Path(__file__).resolve().parents[1] / "data" / "notes.json"
MAX_NOTES = 200
MAX_CHARS = 300
READ_ALOUD = 4
SPOKEN_CHARS = 190
CONFIRM_FOR_S = 60

_lock = threading.Lock()
_pending: dict[str, Any] = {}

_ADD = (
    ("ghi", "nho"), ("ghi", "chu"), ("ghi", "lai"), ("luu", "lai"), ("nho", "la"), ("nho", "giup"), ("them", "viec"), ("them", "ghi", "chu"),
    ("them", "vao", "danh", "sach"), ("remember", "that"), ("remember", "to"), ("note", "that"), ("note", "to"), ("note", "down"),
    ("add", "a", "note"), ("add", "a", "task"), ("add", "a", "to", "do"), ("add", "to", "my", "list"), ("add", "task"), ("add", "note"),
)
_LINK = {"la", "rang", "that", "to", "den"}
_ABOUT_A_NOTE = {"nay", "kia", "nao", "cua"}
_LIST = (
    re.compile(r"\b(?:doc|xem|mo|liet ke|cho toi xem|cho minh xem)\b.*\b(?:ghi chu|viec can lam|danh sach viec|cong viec)\b"),
    re.compile(r"^(?:ghi chu|viec can lam|danh sach viec|cong viec)(?: cua toi| cua minh)?$"),
    re.compile(r"\bhom nay (?:co|toi co|minh co) (?:nhung )?(?:viec|gi can lam)\b"),
    re.compile(r"\b(?:read|show|list|what.s on|what is on|open)\b.*\b(?:notes|my list|to.?do|tasks)\b"),
    re.compile(r"^(?:my )?(?:notes|to.?do list|tasks)$"),
)
_DONE = re.compile(r"\b(?:xong|hoan thanh|danh dau xong|done|finish|finished|complete|completed|tick off|check off)\b")
_DELETE = re.compile(r"\b(?:xoa|bo|delete|remove|clear)\b")
_NOUN = re.compile(r"\b(?:ghi chu|viec|cong viec|danh sach|note|notes|task|tasks|list|item|number)\b")
_ALL = {"het", "tatca", "all", "everything", "toanbo"}
_YES = {"dung", "dungroi", "phai", "ok", "oke", "okay", "dongy", "yes", "yeah", "confirm", "chinhxac", "u", "um"}
_NO = {"khong", "huy", "thoi", "no", "cancel", "sai"}

_SAY = {
    "vi": {
        "added": "Đã ghi nhớ: {text}.",
        "added_n": "Đã ghi nhớ: {text}. Bạn có {count} việc.",
        "what": "Bạn muốn ghi nhớ gì? Nói: ghi nhớ, rồi nội dung.",
        "empty": "Bạn chưa có ghi chú nào.",
        "head": "Bạn có {count} ghi chú. {items}",
        "item": "Số {n}: {text}.",
        "more": " Còn {count} ghi chú nữa, mình đã hiện trên màn hình.",
        "title": "Ghi chú và việc cần làm ({count}):",
        "done": "Đã đánh dấu xong: {text}.",
        "was_done": "Việc này đã xong rồi: {text}.",
        "removed": "Đã xóa ghi chú {n}: {text}.",
        "which": "Số mấy? Mình đang có {count} ghi chú.",
        "no_such": "Mình không có ghi chú số {n}.",
        "confirm_all": "Bạn chắc muốn xóa hết {count} ghi chú? Nói đúng để xóa.",
        "cleared": "Đã xóa hết ghi chú.",
        "kept": "Mình giữ nguyên các ghi chú.",
        "full": "Danh sách đã đầy {count} ghi chú. Hãy xóa bớt trước.",
        "mark": "xong",
    },
    "en": {
        "added": "Noted: {text}.",
        "added_n": "Noted: {text}. You have {count} items.",
        "what": "What should I note? Say: note, then what to remember.",
        "empty": "You have no notes.",
        "head": "You have {count} notes. {items}",
        "item": "Number {n}: {text}.",
        "more": " {count} more are on the screen.",
        "title": "Notes and things to do ({count}):",
        "done": "Marked done: {text}.",
        "was_done": "That one is already done: {text}.",
        "removed": "Deleted note {n}: {text}.",
        "which": "Which number? You have {count} notes.",
        "no_such": "There is no note number {n}.",
        "confirm_all": "Delete all {count} notes? Say yes to delete.",
        "cleared": "All notes deleted.",
        "kept": "I am keeping your notes.",
        "full": "The list is full at {count} notes. Delete some first.",
        "mark": "done",
    },
}


def _say(locale: str) -> dict[str, str]:
    return _SAY["vi" if locale == "vi" else "en"]


def _fold(word: str) -> str:
    return letters(word)


def load() -> list[dict[str, Any]]:
    try:
        data = json.loads(FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [item for item in data if isinstance(item, dict) and isinstance(item.get("text"), str)] if isinstance(data, list) else []


def _save(items: list[dict[str, Any]]) -> None:
    FILE.parent.mkdir(parents=True, exist_ok=True)
    handle, temp = tempfile.mkstemp(dir=FILE.parent, suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as out:
            json.dump(items, out, ensure_ascii=False, indent=2)
        os.replace(temp, FILE)
    except OSError:
        Path(temp).unlink(missing_ok=True)
        raise


def _out(reply: str, display: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"action": "none", "id": None, "reply": reply}
    if display:
        out["display"] = display
        out["open"] = "assistant"
    return out


def _listing(items: list[dict[str, Any]], locale: str) -> dict[str, Any]:
    say = _say(locale)
    if not items:
        return _out(say["empty"])
    mark = say["mark"]
    shown = [f"{index}. {'[' + mark + '] ' if item.get('done') else ''}{item['text']}" for index, item in enumerate(items, 1)]
    aloud = " ".join(say["item"].format(n=index, text=item["text"]) for index, item in enumerate(items[:READ_ALOUD], 1))
    spoken = say["head"].format(count=len(items), items=aloud)[:SPOKEN_CHARS]
    if len(items) > READ_ALOUD:
        spoken = say["head"].format(count=len(items), items=aloud)[: SPOKEN_CHARS - 70] + say["more"].format(count=len(items) - READ_ALOUD)
    return _out(spoken, say["title"].format(count=len(items)) + "\n" + "\n".join(shown))


def _number(words: list[str]) -> int | None:
    plain = [letters(word) for word in words]
    for index in range(len(plain)):
        found = _number_at(plain, words, index)
        if found:
            return found[0]
    return None


def _starts_note(words: list[str]) -> list[str] | None:
    folded = [_fold(word) for word in words]
    for verb in sorted(_ADD, key=len, reverse=True):
        if tuple(folded[: len(verb)]) == verb:
            rest = words[len(verb) :]
            break
    else:
        return None
    if rest and _fold(rest[0]) in _ABOUT_A_NOTE:
        return None
    while rest and _fold(rest[0]) in _LINK:
        rest = rest[1:]
    return rest


def _plain(text: str) -> str:
    out = []
    for char in unicodedata.normalize("NFC", text):
        base = unicodedata.normalize("NFD", char)[0]
        out.append("d" if char in "đĐ" else base.lower())
    return re.sub(r"[^a-z0-9']+", " ", "".join(out)).strip()


def command(heard: str, locale: str) -> dict[str, Any] | None:
    words = heard.replace(",", " ").replace(":", " ").split()
    if not words:
        return None
    say = _say(locale)
    seen = _heard(words)

    if _pending:
        short = len(words) <= 4
        if time.monotonic() > _pending["until"]:
            _pending.clear()
        elif short and seen & _YES and not seen & _NO:
            _pending.clear()
            with _lock:
                _save([])
            return _out(say["cleared"])
        elif short and seen & _NO:
            _pending.clear()
            return _out(say["kept"])
        else:
            _pending.clear()

    text = _plain(heard)
    if any(pattern.search(text) for pattern in _LIST):
        return _listing(load(), locale)
    note = _starts_note(words)
    if note is not None:
        if not note:
            return _out(say["what"])
        content = " ".join(note).strip(" .,!?")[:MAX_CHARS]
        with _lock:
            items = load()
            if len(items) >= MAX_NOTES:
                return _out(say["full"].format(count=len(items)))
            items.append({"text": content, "done": False, "at": time.strftime("%Y-%m-%d %H:%M")})
            _save(items)
        return _out(say["added_n"].format(text=content, count=len(items)) if len(items) > 1 else say["added"].format(text=content))

    if _DELETE.search(text) and _NOUN.search(text):
        flat = {letters(word) for word in words} | seen
        items = load()
        if flat & _ALL:
            if not items:
                return _out(say["empty"])
            _pending.update(until=time.monotonic() + CONFIRM_FOR_S)
            return _out(say["confirm_all"].format(count=len(items)))
        return _pick(items, words, locale, remove=True)

    if _DONE.search(text) and _NOUN.search(text):
        return _pick(load(), words, locale, remove=False)
    return None


def _pick(items: list[dict[str, Any]], words: list[str], locale: str, remove: bool) -> dict[str, Any]:
    say = _say(locale)
    if not items:
        return _out(say["empty"])
    number = _number(words)
    if number is None:
        return _out(say["which"].format(count=len(items)))
    if not 1 <= number <= len(items):
        return _out(say["no_such"].format(n=number))
    with _lock:
        items = load()
        if not 1 <= number <= len(items):
            return _out(say["no_such"].format(n=number))
        item = items[number - 1]
        if remove:
            del items[number - 1]
            reply = say["removed"].format(n=number, text=item["text"])
        elif item.get("done"):
            return _out(say["was_done"].format(text=item["text"]))
        else:
            item["done"] = True
            reply = say["done"].format(text=item["text"])
        _save(items)
    return _out(reply, _listing(items, locale).get("display") or None)
