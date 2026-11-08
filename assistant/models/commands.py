"""Spoken commands that act on the headset instead of being answered by the model.

Two families, both about plugins: switching them ("bật plugin bản đồ", "turn off
the face detection plugin") and having the assistant write new ones ("tạo plugin
đếm số người", then "duyệt plugin đếm người"). The page sends the plugins it has
and whether each is on; the verdict names what was meant and what to say back.
Whisper's spelling is close to what was said but rarely the same, so words are
compared by sound-alike letters, accents removed, as the wake words are.
"""

from __future__ import annotations

from difflib import SequenceMatcher
from typing import Any

from .wake import letters

_ENABLE = {"bat", "them", "mo", "kichhoat", "caidat", "enable", "add", "open", "start", "install", "launch", "activate"}
_DISABLE = {"tat", "dung", "go", "xoa", "dong", "tamdung", "disable", "remove", "stop", "close", "delete", "uninstall"}
_PLUGIN = {"plugin", "plugins", "tienich", "extension", "module"}
_CREATE = {"tao", "viet", "sinh", "code", "create", "write", "make", "build", "generate", "develop"}
_REVISE = {"sua", "sualoi", "chinh", "chinhsua", "capnhat", "fix", "edit", "repair", "modify", "update", "debug", "change"}
_APPROVE = {"duyet", "chapnhan", "chapthuan", "dongy", "approve", "accept", "allow", "chophep", "xacnhan"}
_REJECT = {"tuchoi", "huy", "bo", "reject", "discard", "cancel"}
_SWITCH = {"dung", "use", "chuyen", "switch", "chon", "doi", "set"}
_API = {"api", "claude", "online"}
_LOCAL = {"local", "offline", "cucbo", "noibo"}
_MIN_BRIEF = 2
_MATCH = 0.78
_SUBSTRING_FROM = 5

_SAY: dict[str, dict[str, str]] = {
    "vi": {
        "enable": "Đã bật plugin {name}.",
        "already_on": "Plugin {name} đang bật rồi.",
        "disable": "Đã tắt plugin {name}.",
        "already_off": "Plugin {name} đang tắt rồi.",
        "unknown": "Mình không tìm thấy plugin đó. Hiện có: {names}. Muốn mình viết plugin mới thì nói: tạo plugin, rồi mô tả.",
        "revise": "Mình bắt đầu sửa plugin {name}. Xong mình sẽ báo, rồi chờ bạn duyệt mới áp dụng.",
        "revise_brief": "Bạn muốn sửa gì ở plugin này? Nói: sửa plugin, tên plugin, rồi việc cần sửa.",
        "revised": "Mình đã viết xong bản sửa cho plugin {name}. Nói duyệt plugin {name} để áp dụng, hoặc từ chối plugin {name} để bỏ.",
        "revise_failed": "Mình sửa plugin chưa được. Bạn thử mô tả cụ thể hơn nhé.",
        "create": "Mình bắt đầu viết plugin. Xong mình sẽ báo, rồi chờ bạn duyệt mới chạy.",
        "brief": "Bạn muốn plugin làm gì? Nói: tạo plugin, rồi mô tả.",
        "drafted": "Mình đã viết xong plugin {name}. Nói duyệt plugin {name} để cài, hoặc từ chối plugin {name} để bỏ.",
        "draft_failed": "Mình viết plugin chưa được. Bạn thử mô tả đơn giản hơn nhé.",
        "api_missing": "Chưa có khoá API trong tệp env, mình vẫn dùng mô hình trên máy.",
        "source_api": "Từ giờ mình dùng API để viết plugin.",
        "source_local": "Từ giờ mình viết plugin bằng mô hình trên máy, không cần mạng.",
        "approved": "Đã cài plugin {name}. Mình nạp lại ứng dụng ngay.",
        "approve_failed": "Mình chưa cài được plugin này.",
        "rejected": "Đã bỏ plugin {name}.",
        "no_draft": "Hiện không có plugin nào đang chờ duyệt.",
        "which_draft": "Có nhiều plugin đang chờ duyệt: {names}. Bạn nói rõ tên giúp mình.",
    },
    "en": {
        "enable": "The {name} plugin is on.",
        "already_on": "The {name} plugin is already on.",
        "disable": "The {name} plugin is off.",
        "already_off": "The {name} plugin is already off.",
        "unknown": "I could not find that plugin. There are: {names}. To have me write a new one, say: create a plugin, then describe it.",
        "revise": "I am changing the {name} plugin. I will tell you when it is done, and nothing changes until you approve.",
        "revise_brief": "What should change in this plugin? Say: fix plugin, its name, then what to change.",
        "revised": "I wrote the change for the {name} plugin. Say approve the {name} plugin to apply it, or reject the {name} plugin to drop it.",
        "revise_failed": "I could not get a working change written. Try describing it more exactly.",
        "create": "I am writing the plugin. I will tell you when it is done, and it will not run until you approve it.",
        "brief": "What should the plugin do? Say: create a plugin, then describe it.",
        "drafted": "I wrote the {name} plugin. Say approve the {name} plugin to install it, or reject the {name} plugin to drop it.",
        "draft_failed": "I could not get a working plugin written. Try a simpler description.",
        "api_missing": "There is no API key in the env file, so I am still using the model on this machine.",
        "source_api": "From now on I use the API to write plugins.",
        "source_local": "From now on I write plugins with the model on this machine, no network.",
        "approved": "The {name} plugin is installed. Reloading the app now.",
        "approve_failed": "I could not install that plugin.",
        "rejected": "The {name} plugin is dropped.",
        "no_draft": "No plugin is waiting for approval.",
        "which_draft": "Several plugins are waiting: {names}. Please say which one.",
    },
}


def say_for(locale: str, key: str, **values: str) -> str:
    """A fixed line in the wearer's language, also used for results that arrive after the command."""
    return _SAY["vi" if locale == "vi" else "en"][key].format(**values)


def _heard(words: list[str]) -> set[str]:
    """Each word and each pair of words run together, so "từ chối" is found as "tuchoi"."""
    plain = [letters(word) for word in words]
    return set(plain) | {a + b for a, b in zip(plain, plain[1:])}


def _action(words: list[str]) -> str | None:
    plain = [letters(word) for word in words]
    joined = {a + b for a, b in zip(plain, plain[1:])}
    if "turnon" in joined or "turnoff" in joined:
        return "enable" if "turnon" in joined else "disable"
    for word in plain:
        if word in _ENABLE:
            return "enable"
        if word in _DISABLE:
            return "disable"
    return None


def _plugin_at(words: list[str]) -> tuple[int, int] | None:
    """Where the word "plugin" is: (index of its first word, how many words it took)."""
    plain = [letters(word) for word in words]
    for index, word in enumerate(plain):
        if word in _PLUGIN:
            return index, 1
        if index + 1 < len(plain) and word + plain[index + 1] in _PLUGIN:
            return index, 2
    return None


def _score(words: list[str], name: str) -> float:
    target = letters(name)
    if not target:
        return 0.0
    count = len(name.split())
    best = 0.0
    for size in range(max(1, count - 1), count + 2):
        for start in range(len(words) - size + 1):
            candidate = letters("".join(words[start : start + size]))
            if not candidate:
                continue
            if len(candidate) >= _SUBSTRING_FROM and candidate in target:
                best = max(best, 0.85)
            best = max(best, SequenceMatcher(None, candidate, target).ratio())
    return best


# Words people use for the same thing: the plugin says "phát hiện", the wearer says "nhận diện".
_SAME = {"nhandien": ("phat", "hien"), "dienhien": ("phat", "hien")}
_SKIP = _ENABLE | _DISABLE | _PLUGIN | _CREATE | _REVISE | _APPROVE | _REJECT | {"cai", "cho", "minh", "giup", "hay", "vui", "long", "the", "please"}
_WORD_MATCH = 0.85


def _overlap(words: list[str], name: str) -> float:
    """How much of the name was said, word by word, when it was not said whole.

    "mở plugin nhận diện khuôn mặt" never equals "Phát hiện khuôn mặt", but two of
    its four words are there, and that is more than any other plugin has.
    """
    heard: list[str] = []
    plain = [letters(word) for word in words]
    index = 0
    while index < len(plain):
        pair = plain[index] + plain[index + 1] if index + 1 < len(plain) else ""
        if pair in _SAME:
            heard.extend(_SAME[pair])
            index += 2
            continue
        if plain[index] and plain[index] not in _SKIP:
            heard.append(plain[index])
        index += 1
    target = [letters(word) for word in name.split() if len(letters(word)) >= 2]
    if not target or not heard:
        return 0.0
    hits = sum(
        1 for word in target if max(SequenceMatcher(None, word, said).ratio() for said in heard) >= _WORD_MATCH
    )
    share = hits / len(target)
    return 0.8 if hits >= 2 and share >= 0.5 else (share if hits == len(target) else 0.0)


def _name(plugin: dict[str, Any], locale: str) -> str:
    return str(plugin.get("vi" if locale == "vi" else "en", plugin.get("id", "")))


def _best(words: list[str], plugins: list[dict[str, Any]]) -> dict[str, Any] | None:
    best: tuple[float, dict[str, Any]] | None = None
    for plugin in plugins:
        score = max(
            max(_score(words, str(plugin.get(key, ""))), _overlap(words, str(plugin.get(key, ""))))
            for key in ("vi", "en")
        )
        if score >= _MATCH and (best is None or score > best[0]):
            best = (score, plugin)
    return best[1] if best else None


def plugin_command(
    heard: str,
    plugins: list[dict[str, Any]],
    locale: str,
    drafts: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """The plugin command in `heard`, or None when the line is an ordinary question.

    `plugins` is `[{"id", "vi", "en", "enabled"}]`; `drafts` the same without `enabled`, for
    plugins the assistant wrote that still wait to be approved. The result is
    `{"action", "id", "reply", ...}` where action is one of:

    - "enable" / "disable": switch a plugin the headset has;
    - "create": write a new one; `description` says what it should do;
    - "revise": change an installed one (`id`); `description` says what to change;
    - "approve" / "reject": install or drop a draft;
    - "source": who writes the code, `value` "api" or "local" (the server acts on it);
    - "none": a command that named nothing the headset has.
    """
    words = heard.replace("-", " ").split()
    found = _plugin_at(words) if words else None
    if found is None:
        return None
    at, took = found
    plain = [letters(word) for word in words]
    heard_set = _heard(words)
    say = _SAY["vi" if locale == "vi" else "en"]
    before = _heard(words[:at])
    after = words[at + took :]

    # Who writes the code: "dùng API để viết plugin", "use local for plugins".
    if heard_set & _SWITCH:
        wants_api = bool(heard_set & _API)
        wants_local = bool(heard_set & _LOCAL)
        if wants_api != wants_local:
            return {"action": "source", "id": None, "value": "api" if wants_api else "local", "reply": ""}

    # Changing a plugin that exists: "sửa plugin bản đồ, thêm nút…" (the verb comes before the word plugin).
    if before & _REVISE and not before & _CREATE:
        target = _best(words, plugins)
        if target is None:
            names = ", ".join(_name(p, locale) for p in plugins)
            return {"action": "none", "id": None, "reply": say["unknown"].format(names=names or "—")}
        if len(after) < _MIN_BRIEF:
            return {"action": "none", "id": None, "reply": say["revise_brief"]}
        return {
            "action": "revise",
            "id": str(target["id"]),
            "description": " ".join(after),
            "reply": say["revise"].format(name=_name(target, locale)),
        }

    # Writing a new plugin: the verb comes first, then what it should do.
    if before & _CREATE:
        if len(after) < _MIN_BRIEF:
            return {"action": "none", "id": None, "reply": say["brief"]}
        return {"action": "create", "id": None, "description": " ".join(after), "reply": say["create"]}

    drafts = drafts or []
    for verb, action in ((_APPROVE, "approve"), (_REJECT, "reject")):
        if heard_set & verb:
            if not drafts:
                if action == "approve":
                    return {"action": "none", "id": None, "reply": say["no_draft"]}
                break
            chosen = _best(words, drafts) or (drafts[0] if len(drafts) == 1 else None)
            if chosen is None:
                names = ", ".join(_name(item, locale) for item in drafts)
                return {"action": "none", "id": None, "reply": say["which_draft"].format(names=names)}
            reply = say["rejected"].format(name=_name(chosen, locale)) if action == "reject" else ""
            return {"action": action, "id": str(chosen["id"]), "reply": reply}

    action = _action(words)
    if action is None:
        return None
    plugin = _best(words, plugins)
    if plugin is None:
        names = ", ".join(_name(p, locale) for p in plugins)
        return {"action": "none", "id": None, "reply": say["unknown"].format(names=names or "—")}
    name = _name(plugin, locale)
    on = bool(plugin.get("enabled"))
    if action == "enable":
        key = "already_on" if on else "enable"
    else:
        key = "already_off" if not on else "disable"
    return {"action": action, "id": str(plugin["id"]), "reply": say[key].format(name=name)}


def parse_plugins(raw: Any) -> list[dict[str, Any]]:
    """Keeps only well-formed entries; the page is trusted no further than that."""
    if not isinstance(raw, list):
        return []
    kept = []
    for item in raw[:64]:
        if isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"]:
            kept.append(
                {
                    "id": item["id"],
                    "vi": str(item.get("vi", ""))[:80],
                    "en": str(item.get("en", ""))[:80],
                    "enabled": bool(item.get("enabled")),
                }
            )
    return kept
