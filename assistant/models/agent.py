"""A model that works the menu by calling tools, and the fence around it.

When the wearer says something the keyword commands do not recognise but that sounds like
asking for a change ("nói chậm lại chút", "chạy cái nhận diện khuôn mặt đi"), a model is
shown the controls and may call `change_setting` on them. It does not act: it names an id,
an action and maybe a value, and `apply_action` decides whether that is allowed and what it
becomes. The id can only be one the page sent, so a wrong guess cannot reach anything else.
It runs only when the wearer has chosen the API as the thinker ("dùng API").

The small model that runs on this machine was tried for this and was not good enough: it
named the wrong setting for plain questions (a clock question switched the menu) and took
7 to 26 seconds. It is not used for this; the keyword commands cover the local case.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from . import cloud, pluginsmith
from .commands import _heard, _overlap
from .controls import _RELATIVE_SHARE, _SAY, _label, _names, _show, _snap

TIMEOUT_S = 25
MAX_CALLS = 4
MAX_CANDIDATES = 60

ACTIONS = ("set", "increase", "decrease", "max", "min", "default", "on", "off", "toggle", "open", "close", "choose")

# A line without any of these and without a setting's name in it is a plain question.
_ASKS = {
    "tang", "giam", "dat", "chinh", "doi", "bat", "tat", "mo", "dong", "chay", "dung", "cho", "lam",
    "nhanh", "cham", "to", "nho", "cao", "thap", "sang", "toi", "hon", "chut", "xiu", "gap",
    "set", "increase", "decrease", "raise", "lower", "turn", "open", "close", "change", "make",
    "faster", "slower", "louder", "quieter", "bigger", "smaller", "higher", "brighter",
    "enable", "disable", "run", "start", "stop",
}

Post = Callable[[dict[str, Any]], dict[str, Any]]


def sounds_like_a_request(heard: str, entries: list[dict[str, Any]], locale: str) -> bool:
    """A cheap look before anything leaves the machine: a verb of changing, or a setting's name."""
    words = heard.replace("-", " ").split()
    if _heard(words) & _ASKS:
        return True
    return any(_overlap(words, name) > 0 for entry in entries for name in _names(entry, locale))


def plugin_entries(plugins: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Plugins as switches the model can be offered; their ids carry a prefix so they never clash."""
    return [
        {
            "id": f"plugin:{plugin['id']}",
            "kind": "toggle",
            "vi": [plugin["vi"]] if plugin.get("vi") else [],
            "en": [plugin["en"]] if plugin.get("en") else [],
            "value": bool(plugin.get("enabled")),
            "open": False,
            "plugin": plugin["id"],
        }
        for plugin in plugins
    ]


def apply_action(entry: dict[str, Any], action: str, value: Any, locale: str) -> dict[str, Any] | None:
    """Turns a model's choice into the finished command, or None when it does not fit the control.

    The model only picks an id, an action and maybe a value. What happens is decided here: the
    action must suit the control's kind, a number is kept inside its range and on its step, an
    option must be one that exists.
    """
    say = _SAY["vi" if locale == "vi" else "en"]
    name = _label(entry, locale)
    kind = entry["kind"]
    if kind == "number":
        low, high, step, current = entry["min"], entry["max"], entry["step"], entry["value"]
        number = float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None
        jump = number if number else max(step, round((high - low) * _RELATIVE_SHARE / step) * step)
        reply_kind = "set"
        if action == "set" and number is not None:
            target = number
        elif action == "increase":
            target, reply_kind = current + abs(jump), "up"
        elif action == "decrease":
            target, reply_kind = current - abs(jump), "down"
        elif action == "max":
            target = high
        elif action == "min":
            target = low
        elif action == "default":
            target = entry["default"]
        else:
            return None
        result = _snap(target, entry)
        shown = _show(result, step, entry["unit"]["vi" if locale == "vi" else "en"], locale)
        key = "at_limit" if result == current and reply_kind != "set" else reply_kind
        return {"action": "setting", "id": entry["id"], "value": result, "reply": say[key].format(name=name, value=shown)}
    if kind == "toggle":
        if action in {"on", "open"}:
            want = True
        elif action in {"off", "close"}:
            want = False
        elif action == "toggle":
            want = not entry["value"]
        else:
            return None
        if entry.get("open"):
            keys = ("already_open", "already_closed", "opened", "closed")
        else:
            keys = ("already_on", "already_off", "on", "off")
        if want == entry["value"]:
            reply = say[keys[0] if want else keys[1]]
        else:
            reply = say[keys[2] if want else keys[3]]
        return {"action": "setting", "id": entry["id"], "value": want, "reply": reply.format(name=name)}
    if kind == "choice" and action in {"choose", "set"}:
        for option in entry["options"]:
            if value == option["value"]:
                reply = say["choose"].format(name=name, option=_label(option, locale))
                return {"action": "setting", "id": entry["id"], "value": option["value"], "reply": reply}
        return None
    if kind == "page" and action in {"open", "on", "set"}:
        return {"action": "setting", "id": entry["id"], "value": True, "reply": say["page"].format(name=name)}
    return None


def as_command(entry: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    """A finished setting as the page is told it; a plugin switch is an enable or a disable."""
    if "plugin" in entry:
        return {"action": "enable" if result["value"] else "disable", "id": entry["plugin"], "reply": result["reply"]}
    return result


def _describe(entry: dict[str, Any], locale: str) -> str:
    names = " / ".join(_names(entry, locale)[:3]) or entry["id"]
    if entry["kind"] == "number":
        unit = entry["unit"]["vi" if locale == "vi" else "en"]
        return (
            f"- {entry['id']} (number) {names}: {entry['min']} to {entry['max']} {unit}, "
            f"now {entry['value']}, default {entry['default']}"
        )
    if entry["kind"] == "toggle":
        if entry.get("open"):
            state = "open" if entry["value"] else "closed"
        else:
            state = "on" if entry["value"] else "off"
        return f"- {entry['id']} (toggle) {names}, now {state}"
    if entry["kind"] == "choice":
        options = ", ".join(f"{o['value']}={'/'.join(_names(o, locale)[:2])}" for o in entry["options"])
        return f"- {entry['id']} (choice) {names}: {options}"
    return f"- {entry['id']} (page) menu section {names}"


def _tool(ids: list[str]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": "change_setting",
            "description": "Change one setting of the headset. Call it once per setting the wearer asked to change.",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "enum": ids},
                    "action": {"type": "string", "enum": list(ACTIONS)},
                    "value": {
                        "description": "set: the number in the shown unit. increase/decrease: how much, optional. choose: the option value.",
                        "type": ["number", "string", "null"],
                    },
                },
                "required": ["id", "action"],
            },
        },
    }


_SYSTEM = (
    "You work the settings of an AR headset for the person wearing it. They spoke one line, in Vietnamese or English, "
    "turned into text by a recogniser that sometimes mishears. If they are asking for a setting to change, call "
    "change_setting once for each change, using only the ids listed. If the line is just a question or chat, call "
    "nothing and say nothing. Prefer a relative change (increase or decrease) when they say things like 'a bit', "
    "'slower', 'bigger'."
)


def _post_to_api(body: dict[str, Any]) -> dict[str, Any]:
    if not pluginsmith.api_key():
        raise RuntimeError("api key missing")
    return cloud.chat(body, timeout=TIMEOUT_S)


def _tool_calls(reply: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        calls = reply["choices"][0]["message"].get("tool_calls") or []
    except (KeyError, IndexError, TypeError, AttributeError):
        return []
    return [call for call in calls if isinstance(call, dict)]


def plan(
    heard: str,
    controls: list[dict[str, Any]],
    plugins: list[dict[str, Any]],
    locale: str,
    post: Post | None = None,
) -> list[dict[str, Any]]:
    """The commands the model chose for `heard`, already checked; empty when it chose none or could not.

    `post` is the HTTP call, replaceable so this can be tested without the network.
    """
    entries = [*controls, *plugin_entries(plugins)][:MAX_CANDIDATES]
    if not entries or not sounds_like_a_request(heard, entries, locale):
        return []
    ids = [entry["id"] for entry in entries]
    listing = "\n".join(_describe(entry, locale) for entry in entries)
    body = {
        "model": cloud.model("VR_AGENT_MODEL"),
        "max_tokens": 400,
        "tools": [_tool(ids)],
        "messages": [
            {"role": "system", "content": f"{_SYSTEM}\n\nSettings:\n{listing}"},
            {"role": "user", "content": heard},
        ],
    }
    try:
        reply = (post or _post_to_api)(body)
    except (cloud.CloudError, ValueError, RuntimeError, OSError):
        return []
    by_id = {entry["id"]: entry for entry in entries}
    commands: list[dict[str, Any]] = []
    for tool_call in _tool_calls(reply):
        function = tool_call.get("function") or {}
        if function.get("name") != "change_setting":
            continue
        try:
            call = json.loads(function.get("arguments") or "{}")  # a string, and the model may get it wrong
        except ValueError:
            continue
        if not isinstance(call, dict):
            continue
        entry = by_id.get(call.get("id"))
        if entry is None or call.get("action") not in ACTIONS:
            continue
        result = apply_action(entry, call["action"], call.get("value"), locale)
        if result is not None:
            commands.append(as_command(entry, result))
        if len(commands) >= MAX_CALLS:
            break
    return commands
