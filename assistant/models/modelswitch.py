"""Looking at and choosing the models by voice, for the assistant's own stages.

Where a stage runs is not changed by voice any more: it is `ai/stages.json` and `.env` (a url, a key, a model), the same
for every stage. What can be said:

- "hiện thông tin model", "model nào đang dùng": the setup, on the screen (the assistant's stages and the plugins');
- "có những model nào", "model qwen nào để viết plugin": what the endpoint of a stage offers (`ai.models`);
- "đổi model trả lời sang qwen 72b": the name is matched against that list, never taken as said, and the
  assistant reads back the full name and waits for a "đúng" before it changes anything. Whisper spells model
  names badly, and a wrong one would cost money or break the stage. It only applies to a stage whose endpoint is
  somebody else's: a server of this machine runs the one model it was started with.

What is chosen lasts until the server restarts. `.env` is never touched.
"""

from __future__ import annotations

import time
from typing import Any

import ai
from . import timing
from .commands import _PLUGIN, _SWITCH, _heard
from .wake import letters

CONFIRM_FOR_S = 60
MAX_READ = 5  # names read aloud
MAX_SHOWN = 40  # names put on the screen
SHOW_PAGE = "assistant"  # the menu page that prints what the assistant says, line breaks kept

_MODEL = {"model", "models", "mohinh", "moden", "modun"}
_LIST = {"nao", "nhung", "danhsach", "lietke", "list", "which", "available", "tracuu", "lookup", "whatmodels", "gi"}
_CHANGE = _SWITCH | {"thay", "thaydoi", "change", "select"}
_TO = {"sang", "thanh", "to", "qua", "bang", "la"}
_STOP = {"de", "cho", "for", "nhe", "di", "voi", "with"}
_YES = {"dung", "dungroi", "phai", "ok", "oke", "okay", "dongy", "duoc", "yes", "yeah", "confirm", "chinhxac", "u", "um", "uh"}
_NO = {"khong", "huy", "thoi", "no", "cancel", "sai", "bo"}
# "Hiện thông tin model", "model nào đang dùng": put the setup on the screen.
_SHOW = {"hien", "hienthi", "xem", "show", "display", "tell"}
_INFO = {"thongtin", "cauhinh", "trangthai", "info", "information", "status", "config", "configuration"}
_ASSISTANT = {"trolyhino", "troly", "assistant", "hino"}
_NOW = {"dang", "hien", "current", "currently", "now"}
_FILLER = _MODEL | _LIST | _CHANGE | _TO | _STOP | _SHOW | _INFO | _ASSISTANT | {
    "cai", "minh", "hay", "giup", "vui", "long", "please", "the", "a", "con", "cac",
    "co", "nhung", "what", "are", "there", "is", "do", "you", "have", "show", "me", "does", "an", "of", "any",
}

# What the wearer calls each stage; first one heard in the line wins.
_STAGE_WORDS = {
    "code": _PLUGIN | {"code", "laptrinh", "coding", "viet", "write", "writing"},
    "agent": {"menu", "agent", "dieukhien"},
    "stt": {"nghe", "listen", "listening", "hearing", "stt"},
    "tts": {"doc", "giong", "speak", "speaking", "voice", "tts", "phatam"},
    "chat": {"traloi", "trochuyen", "hoithoai", "chat", "answer", "answers", "talk", "reply", "conversation"},
    "vision": {"manhinh", "screen", "nhin", "vision", "image", "picture", "sight"},
}

_STAGE_NAME = {
    "vi": {"chat": "trả lời", "code": "viết plugin", "agent": "điều khiển menu", "stt": "nghe", "stt_wake": "nghe từ gọi", "tts": "đọc", "vision": "nhìn màn hình"},
    "en": {"chat": "answering", "code": "writing plugins", "agent": "the menu", "stt": "listening", "stt_wake": "listening for the call", "tts": "speaking", "vision": "looking at the screen"},
}
_PLUGIN_NAME = {"vi": {"plugin_chat": "plugin hỏi đáp"}, "en": {"plugin_chat": "plugin chat"}}
_SAY = {
    "vi": {
        "lookup_failed": "Mình chưa tra được danh sách model của việc này. Kiểm tra địa chỉ và khoá trong tệp env giúp mình nhé.",
        "none_found": "Mình không thấy model nào khớp trong danh sách.",
        "list_head": "Có {count} model cho việc {stage}. {names}. Nói đổi model {stage} sang, rồi tên model.",
        "list_filtered": "Có {count} model khớp cho việc {stage}: {names}.",
        "which_model": "Bạn muốn đổi sang model nào? Nói: đổi model {stage} sang, rồi tên model.",
        "confirm": "Bạn muốn đổi model {stage} sang {name}, đúng không?",
        "confirmed": "Đã đổi model {stage} sang {name}.",
        "fixed_here": "Việc {stage} đang chạy bằng model nạp sẵn trên máy này nên mình không đổi bằng giọng nói được. Muốn đổi thì sửa tệp stages.json hoặc đặt địa chỉ API trong tệp env.",
        "cancelled": "Mình giữ nguyên model cũ.",
        "title": "Cấu hình trợ lý",
        "plugins_title": "Plugin",
        "list_title": "Model cho việc {stage} ({count}):",
        "more": "… và {count} model nữa. Nói tên để mình lọc.",
        "status_spoken": "Mình đang hiện cấu hình trợ lý trên màn hình.",
        "api": "API ngoài",
        "machine": "máy này",
        "voice_vi": "VieNeu (tiếng Việt), SAPI (tiếng Anh)",
    },
    "en": {
        "lookup_failed": "I could not get the model list for this stage. Please check the address and the key in the env file.",
        "none_found": "I found no model that matches in the list.",
        "list_head": "There are {count} models for {stage}. {names}. Say change the {stage} model to, then a name.",
        "list_filtered": "{count} models match for {stage}: {names}.",
        "which_model": "Which model? Say: change the {stage} model to, then its name.",
        "confirm": "Change the {stage} model to {name}, is that right?",
        "confirmed": "The {stage} model is now {name}.",
        "fixed_here": "{stage} runs on the model loaded on this machine, so I cannot change it by voice. Edit stages.json, or put an API address in the env file.",
        "cancelled": "I keep the old model.",
        "title": "Assistant setup",
        "plugins_title": "Plugins",
        "list_title": "Models for {stage} ({count}):",
        "more": "… and {count} more. Say a name to narrow it.",
        "status_spoken": "I am showing the assistant's setup on the screen.",
        "api": "an outside API",
        "machine": "this machine",
        "voice_vi": "VieNeu (Vietnamese), SAPI (English)",
    },
}

_pending: dict[str, Any] = {}


def _say(locale: str) -> dict[str, str]:
    return _SAY["vi" if locale == "vi" else "en"]


def _stage(words: list[str]) -> str | None:
    """The stage named first in the line, looking at each word and each two words run together."""
    plain = [letters(word) for word in words]
    for index, word in enumerate(plain):
        pair = word + plain[index + 1] if index + 1 < len(plain) else ""
        for stage, names in _STAGE_WORDS.items():
            if word in names or pair in names:
                return stage
    return None


def _out(reply: str, display: str | None = None, show: bool = False) -> dict[str, Any]:
    """What `engine.talk` does with a result: speak `reply`; print `display` (the whole of it) and open its page when `show`."""
    out: dict[str, Any] = {"action": "none", "id": None, "reply": reply}
    if show:
        out["display"] = display or reply
        out["open"] = SHOW_PAGE
    return out


def _where(name: str, say: dict[str, str]) -> str:
    return say["api"] if ai.stage(name).external else say["machine"]


def _model_of(name: str, say: dict[str, str]) -> str:
    stage = ai.stage(name)
    return say["voice_vi"] if stage.kind == "tts" and stage.inprocess else (stage.model or "-")


def status(locale: str) -> str:
    """The setup as lines for the screen: where each stage runs and which model it uses."""
    say = _say(locale)
    names = _STAGE_NAME["vi" if locale == "vi" else "en"]
    lines = [say["title"]]
    for name in ai.config.ASSISTANT_STAGES:
        lines.append(f"{names[name].capitalize()}: {_where(name, say)} · {_model_of(name, say)}")
    lines.append(say["plugins_title"])
    for name, label in _PLUGIN_NAME["vi" if locale == "vi" else "en"].items():
        lines.append(f"{label.capitalize()}: {_where(name, say)} · {_model_of(name, say)}")
    turn = timing.summary(locale)
    if turn:
        lines.append(turn)
    return "\n".join(lines)


def _spoken(model_id: str) -> str:
    """The name without the maker's prefix: it is read aloud."""
    return model_id.split("/", 1)[-1]


def _read(ids: list[str]) -> str:
    return ", ".join(_spoken(item) for item in ids[:MAX_READ])


def _search_words(words: list[str], stage_words: set[str]) -> list[str]:
    """What is left of the line once the verbs, fillers and stage names are gone: parts of a model's name."""
    plain = [letters(word) for word in words]
    pairs = {i for i in range(len(plain) - 1) if plain[i] + plain[i + 1] in stage_words}  # "trả lời" is "tra" "loi"
    kept = []
    for index, word in enumerate(plain):
        if not word or word in _FILLER or word in stage_words or index in pairs or index - 1 in pairs:
            continue
        kept.append(word)
    return kept


def find(ids: list[str], wanted: list[str]) -> list[str]:
    """Models whose id holds every word said, shortest first. Dots and dashes do not matter: 2.5 is 25."""
    plain = [(letters(item), item) for item in ids]
    hits = [item for flat, item in plain if all(word in flat for word in wanted)]
    return sorted(hits, key=lambda item: (len(item), item))


def _listing(ids: list[str], stage_name: str, locale: str) -> str:
    """The models on offer as lines for the screen, as many as fit; the voice reads only the first few."""
    say = _say(locale)
    lines = [say["list_title"].format(stage=stage_name, count=len(ids))]
    lines += [f"• {name}" for name in ids[:MAX_SHOWN]]
    if len(ids) > MAX_SHOWN:
        lines.append(say["more"].format(count=len(ids) - MAX_SHOWN))
    return "\n".join(lines)


def command(heard: str, locale: str) -> dict[str, Any] | None:
    """The voice command about models in `heard`, or None when it is an ordinary line.

    The result is `{"action": "none", "id": None, "reply": ...}`: everything is done here and the
    reply is only what to say. When there is something to look at it also holds `display` (all of
    it, for the screen) and `open` (the menu page to open so it is seen); the voice reads only `reply`.
    """
    words = heard.replace("-", " ").replace(",", " ").split()
    if not words:
        return None
    say = _say(locale)
    seen = _heard(words)
    plain = [letters(word) for word in words]
    stage_names = _STAGE_NAME["vi" if locale == "vi" else "en"]

    if _pending:
        # "dùng" is also "đúng" once accents go, so an answer is a short line that is not itself a request.
        short_answer = len(words) <= 4 and not seen & _MODEL
        if time.monotonic() > _pending["until"]:
            _pending.clear()
        elif short_answer and seen & _YES and not seen & _NO:
            stage, chosen = _pending["stage"], _pending["id"]
            _pending.clear()
            ai.config.set_model(stage, chosen)
            reply = say["confirmed"].format(stage=stage_names[stage], name=_spoken(chosen))
            return _out(reply, f"{reply}\n\n{status(locale)}", show=True)
        elif short_answer and seen & _NO:
            _pending.clear()
            return _out(say["cancelled"])
        else:
            _pending.clear()  # said something else: the question is dropped, and the line is looked at as usual

    stage = _stage(words)
    stage_words = set().union(*_STAGE_WORDS.values())
    about_models = bool(seen & _MODEL)

    # What is set up now: "hiện thông tin model", "model nào đang dùng", "cho tôi xem cấu hình trợ lý".
    shows, asks_now = bool(seen & _SHOW), bool(seen & {"dang", "current", "currently", "now"})
    if (shows and (about_models or seen & _ASSISTANT) and (seen & _INFO or not seen & _LIST)) or (about_models and asks_now):
        return _out(say["status_spoken"], status(locale), show=True)

    if not about_models:
        return None
    target = stage or "chat"

    # Which model: "đổi model trả lời sang qwen 72b".
    if seen & _CHANGE and seen & _TO and not seen & _LIST:
        start = next((i for i, word in enumerate(plain) if word in _TO), len(words))
        said = []
        for word in plain[start + 1 :]:
            if word in _STOP:
                break
            if word and word not in _FILLER and word not in stage_words:
                said.append(word)
        if not said:
            return _out(say["which_model"].format(stage=stage_names[target]))
        return _ask_which(target, said, locale)

    # What there is: "có những model nào", "model qwen nào".
    if seen & _LIST:
        wanted = _search_words(words, stage_words)
        try:
            ids = ai.models(target)
        except ai.AIError as error:
            print(f"  ai       model list failed: {error}", flush=True)
            return _out(say["lookup_failed"])
        hits = find(ids, wanted) if wanted else ids
        if not hits:
            return _out(say["none_found"])
        key = "list_filtered" if wanted else "list_head"
        reply = say[key].format(count=len(hits), stage=stage_names[target], names=_read(hits))
        return _out(reply, _listing(hits, stage_names[target], locale), show=True)
    return None


def _ask_which(stage: str, wanted: list[str], locale: str) -> dict[str, Any]:
    say = _say(locale)
    names = _STAGE_NAME["vi" if locale == "vi" else "en"]
    if not ai.stage(stage).external:
        return _out(say["fixed_here"].format(stage=names[stage].capitalize()))
    try:
        ids = ai.models(stage)
    except ai.AIError as error:
        print(f"  ai       model list failed: {error}", flush=True)
        return _out(say["lookup_failed"])
    hits = find(ids, wanted)
    if not hits:
        return _out(say["none_found"])
    _pending.update(stage=stage, id=hits[0], until=time.monotonic() + CONFIRM_FOR_S)
    asked = say["confirm"].format(stage=names[stage], name=_spoken(hits[0]))
    # The full id is put on the screen: it is the thing to check before saying yes.
    return _out(asked, f"{asked}\n{hits[0]}", show=True)


def reset() -> None:
    _pending.clear()
