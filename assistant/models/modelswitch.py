"""Choosing the models by voice: where each stage runs, which models SiliconFlow has, and which one to use.

Three things the wearer can say, for any stage (answering, writing plugins, the menu, listening, speaking):

- "dùng API để trả lời", "nghe bằng local": where a stage runs. Applied at once; it is easy to undo.
- "có những model nào", "model qwen nào để viết plugin": reads what SiliconFlow offers, asked of the
  account's own key (`cloud.models_for`).
- "đổi model trả lời sang qwen 72b": the name is matched against that list, never taken as said, and the
  assistant reads back the full name and waits for a "đúng" before it changes anything. Whisper spells model
  names badly, and a wrong one would cost money or break the stage.

What is chosen lasts until the server restarts, like the plugin writer's source. `.env` is never touched.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from . import cloud, pluginsmith, timing
from .catalog import catalog, voice_vi_dir, whisper_path, whisper_wake_path
from .commands import _API, _LOCAL, _PLUGIN, _SWITCH, _heard
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
}
_VARIABLE = {"chat": "VR_LLM_MODEL", "code": "VR_CODE_MODEL", "agent": "VR_AGENT_MODEL", "stt": "VR_STT_MODEL", "tts": "VR_TTS_MODEL"}
_LISTED_AS = {"chat": "chat", "code": "chat", "agent": "chat", "stt": "stt", "tts": "tts"}

_STAGE_NAME = {
    "vi": {"chat": "trả lời", "code": "viết plugin", "agent": "điều khiển menu", "stt": "nghe", "tts": "đọc"},
    "en": {"chat": "answering", "code": "writing plugins", "agent": "the menu", "stt": "listening", "tts": "speaking"},
}
_SAY = {
    "vi": {
        "source_api": "Từ giờ mình dùng API cho việc {stage}.",
        "source_local": "Từ giờ mình dùng mô hình trên máy cho việc {stage}.",
        "api_missing": "Chưa có khoá SiliconFlow trong tệp env, nên mình vẫn dùng mô hình trên máy.",
        "voice_note": " Tiếng Việt vẫn chạy trên máy vì SiliconFlow không ghi hỗ trợ tiếng Việt.",
        "which_stage": "Bạn muốn đổi cho việc nào: trả lời, nghe, đọc hay viết plugin?",
        "no_agent_local": "Việc điều khiển menu bằng mô hình chỉ chạy với API; trên máy mình chỉ hiểu lệnh theo từ khoá.",
        "lookup_failed": "Mình chưa tra được danh sách model của SiliconFlow. Kiểm tra khoá và mạng giúp mình nhé.",
        "no_key": "Chưa có khoá SiliconFlow trong tệp env nên mình chưa tra được danh sách model.",
        "none_found": "Mình không thấy model nào khớp trong danh sách của SiliconFlow.",
        "list_head": "SiliconFlow có {count} model cho việc {stage}. {names}. Nói đổi model {stage} sang, rồi tên model.",
        "list_filtered": "Có {count} model khớp cho việc {stage}: {names}.",
        "which_model": "Bạn muốn đổi sang model nào? Nói: đổi model {stage} sang, rồi tên model.",
        "confirm": "Bạn muốn đổi model {stage} sang {name}, đúng không?",
        "confirmed": "Đã đổi model {stage} sang {name}.",
        "still_local": " Việc này đang chạy trên máy; nói dùng API để {stage} thì mới dùng model này.",
        "cancelled": "Mình giữ nguyên model cũ.",
        "title": "Cấu hình trợ lý",
        "list_title": "Model của SiliconFlow cho việc {stage} ({count}):",
        "more": "… và {count} model nữa. Nói tên để mình lọc.",
        "status_spoken": "Mình đang hiện cấu hình trợ lý trên màn hình.",
        "listed_spoken": "Mình đã hiện danh sách trên màn hình.",
        "api": "API",
        "machine": "máy",
        "with_key": "Khoá SiliconFlow: có",
        "no_key_line": "Khoá SiliconFlow: chưa có",
        "voice_on_api": "Nghe và đọc gửi lên API cho: {langs}",
        "menu_keywords": "chỉ lệnh theo từ khoá",
        "wake_model": "nghe từ gọi",
        "second_session": "phiên thứ hai",
        "speaks_vi": "tiếng Việt",
        "speaks_en": "tiếng Anh",
    },
    "en": {
        "source_api": "From now on I use the API for {stage}.",
        "source_local": "From now on I use the model on this machine for {stage}.",
        "api_missing": "There is no SiliconFlow key in the env file, so I am still using the model on this machine.",
        "voice_note": " Vietnamese still runs on this machine, because SiliconFlow does not list Vietnamese.",
        "which_stage": "Which one: answering, listening, speaking or writing plugins?",
        "no_agent_local": "Working the menu with a model only runs on the API; on this machine I only understand keyword commands.",
        "lookup_failed": "I could not get the model list from SiliconFlow. Please check the key and the network.",
        "no_key": "There is no SiliconFlow key in the env file, so I cannot look up the model list.",
        "none_found": "I found no model that matches in SiliconFlow's list.",
        "list_head": "SiliconFlow has {count} models for {stage}. {names}. Say change the {stage} model to, then a name.",
        "list_filtered": "{count} models match for {stage}: {names}.",
        "which_model": "Which model? Say: change the {stage} model to, then its name.",
        "confirm": "Change the {stage} model to {name}, is that right?",
        "confirmed": "The {stage} model is now {name}.",
        "still_local": " That stage runs on this machine; say use the API for {stage} to use this model.",
        "cancelled": "I keep the old model.",
        "title": "Assistant setup",
        "list_title": "SiliconFlow models for {stage} ({count}):",
        "more": "… and {count} more. Say a name to narrow it.",
        "status_spoken": "I am showing the assistant's setup on the screen.",
        "listed_spoken": "I put the list on the screen.",
        "api": "API",
        "machine": "this machine",
        "with_key": "SiliconFlow key: set",
        "no_key_line": "SiliconFlow key: missing",
        "voice_on_api": "Listening and speaking go to the API for: {langs}",
        "menu_keywords": "keyword commands only",
        "wake_model": "listens for the call",
        "second_session": "second session",
        "speaks_vi": "Vietnamese",
        "speaks_en": "English",
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


def _where(stage: str) -> str:
    """`api` only when the stage will really go to the cloud: chosen, and with a key to do it."""
    chosen = pluginsmith.source() if stage in {"code", "agent"} else cloud.source(stage)
    return "api" if chosen == "api" and cloud.api_key() else "local"


def status(locale: str) -> str:
    """The setup as lines for the screen: where each stage runs and which model it uses."""
    say = _say(locale)
    names = _STAGE_NAME["vi" if locale == "vi" else "en"]
    spot = {"api": say["api"], "local": say["machine"]}
    llm = Path(catalog()[0].gguf).name
    lines = [say["title"]]

    def row(stage: str, detail: str) -> None:
        lines.append(f"{names[stage].capitalize()}: {spot[_where(stage)]} · {detail}")

    row("chat", cloud.model("VR_LLM_MODEL") if _where("chat") == "api" else llm)
    row("code", cloud.model("VR_CODE_MODEL") if _where("code") == "api" else f"{llm} ({say['second_session']})")
    row("agent", cloud.model("VR_AGENT_MODEL") if _where("agent") == "api" else say["menu_keywords"])
    if _where("stt") == "api":
        row("stt", cloud.model("VR_STT_MODEL"))
    else:
        row("stt", f"{whisper_path().name}; {say['wake_model']}: {whisper_wake_path().name}")
    if _where("tts") == "api":
        row("tts", f"{cloud.model('VR_TTS_MODEL')} ({_voice_name()})")
    else:
        row("tts", f"VieNeu {Path(voice_vi_dir()).name} ({say['speaks_vi']}), SAPI ({say['speaks_en']})")
    lines.append(say["with_key"] if cloud.api_key() else say["no_key_line"])
    if "api" in {_where("stt"), _where("tts")}:
        lines.append(say["voice_on_api"].format(langs=", ".join(sorted(cloud.voice_langs()))))
    turn = timing.summary(locale)
    if turn:
        lines.append(turn)
    return "\n".join(lines)


def _voice_name() -> str:
    return cloud._env("VR_TTS_VOICE") or cloud.DEFAULT_VOICE


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


def _use(stage: str, value: str, locale: str) -> tuple[str, bool]:
    """Switch where a stage runs: what to say, and whether it happened."""
    say, name = _say(locale), _STAGE_NAME["vi" if locale == "vi" else "en"][stage]
    if stage == "agent" and value == "local":
        return say["no_agent_local"], False
    if stage in {"code", "agent"}:
        if not pluginsmith.set_source(value):
            return say["api_missing"], False
    elif not cloud.set_source(stage, value):
        return say["api_missing"], False
    line = say[f"source_{value}"].format(stage=name)
    if value == "api" and stage in {"stt", "tts"} and locale not in cloud.voice_langs():
        line += say["voice_note"]
    return line, True


def _running(stage: str) -> str:
    if stage in {"code", "agent"}:
        return pluginsmith.source()
    return cloud.source(stage)


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
        short_answer = len(words) <= 4 and not seen & (_MODEL | _API | _LOCAL)
        if time.monotonic() > _pending["until"]:
            _pending.clear()
        elif short_answer and seen & _YES and not seen & _NO:
            stage, chosen = _pending["stage"], _pending["id"]
            _pending.clear()
            cloud.set_model(_VARIABLE[stage], chosen)
            reply = say["confirmed"].format(stage=stage_names[stage], name=_spoken(chosen))
            if _running(stage) != "api":
                reply += say["still_local"].format(stage=stage_names[stage])
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

    # Where a stage runs: "dùng API để trả lời", "nghe bằng local".
    wants_api, wants_local = bool(seen & _API), bool(seen & _LOCAL)
    if not about_models and wants_api != wants_local and seen & (_CHANGE | _TO):
        value = "api" if wants_api else "local"
        if stage is None:
            return _out(say["which_stage"]) if len(words) <= 4 else None
        reply, done = _use(stage, value, locale)
        return _out(reply, f"{reply}\n\n{status(locale)}", show=True) if done else _out(reply)

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
            ids = cloud.models_for(_LISTED_AS[target])
        except cloud.CloudError as error:
            print(f"  cloud    model list failed: {error}", flush=True)
            return _out(say["lookup_failed" if cloud.api_key() else "no_key"])
        hits = find(ids, wanted) if wanted else ids
        if not hits:
            return _out(say["none_found"])
        key = "list_filtered" if wanted else "list_head"
        reply = say[key].format(count=len(hits), stage=stage_names[target], names=_read(hits))
        return _out(reply, _listing(hits, stage_names[target], locale), show=True)
    return None


def _ask_which(stage: str, wanted: list[str], locale: str) -> dict[str, Any]:
    say = _say(locale)
    try:
        ids = cloud.models_for(_LISTED_AS[stage])
    except cloud.CloudError as error:
        print(f"  cloud    model list failed: {error}", flush=True)
        return _out(say["lookup_failed" if cloud.api_key() else "no_key"])
    hits = find(ids, wanted)
    if not hits:
        return _out(say["none_found"])
    _pending.update(stage=stage, id=hits[0], until=time.monotonic() + CONFIRM_FOR_S)
    names = _STAGE_NAME["vi" if locale == "vi" else "en"]
    asked = say["confirm"].format(stage=names[stage], name=_spoken(hits[0]))
    # The full id is put on the screen: it is the thing to check before saying yes.
    return _out(asked, f"{asked}\n{hits[0]}", show=True)


def reset() -> None:
    _pending.clear()
