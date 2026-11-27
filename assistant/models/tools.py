"""Things the wearer can ask for that a language model cannot know or do: a timer, the weather, a look-up.

All three are keyword commands, like the plugin and menu ones: nothing here is left to a model to decide.

- A timer or reminder ("hẹn giờ năm phút", "nhắc tôi tắt bếp sau mười phút", "set a timer for 5 minutes"):
  the server only works out the time and what to say when it is up; the page runs the clock
  (`action: "timer"`), so no connection is needed while it counts down.
- The weather ("thời tiết ở Đà Nẵng ngày mai", "weather in Paris"): Open-Meteo, which needs no key.
  A city said by name; none said, the place the device is at (the page sends its coordinates when it may read them).
- A look-up ("tra cứu Nguyễn Huệ", "look up Alan Turing"): the summary of the Wikipedia page.

The weather and the look-up go to those websites with the place or the subject the wearer named, and nothing else.
`VR_TOOLS=off` turns both off, and then they are answered as unavailable.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from .commands import _heard
from .wake import letters

TIMEOUT_S = 10
MAX_TIMER_S = 24 * 3600
USER_AGENT = "hino-xr/1.0 (https://github.com/t-root/hino-xr)"
SPOKEN_CHARS = 380
SHOWN_CHARS = 1400

_TIMER = {"hengio", "timer", "baothuc", "alarm", "countdown", "demnguoc"}
_REMIND = {"nhac", "remind", "reminder"}
_WEATHER = {"thoitiet", "weather", "dubaothoitiet", "forecast"}
_LOOKUP = {"tracuu", "wikipedia", "lookup", "timtrenwikipedia", "tracuuwikipedia"}
_AT = {"o", "tai", "in", "at", "for"}
_WHEN = {"hom", "nay", "mai", "ngay", "today", "tomorrow", "hien", "bay", "gio", "thenao", "the", "nhu", "what", "like", "is", "how", "ra"}
_TOMORROW = {"ngaymai", "tomorrow", "mai"}
_NUMBER = {
    "khong": 0, "mot": 1, "hai": 2, "ba": 3, "bon": 4, "tu": 4, "nam": 5, "lam": 5, "sau": 6, "bay": 7, "tam": 8, "chin": 9,
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "thirty": 30, "forty": 40, "fortyfive": 45, "fifty": 50, "sixty": 60,
}
_UNIT = {
    "giay": 1, "s": 1, "sec": 1, "second": 1, "seconds": 1,
    "phut": 60, "p": 60, "min": 60, "mins": 60, "minute": 60, "minutes": 60,
    "tieng": 3600, "gio": 3600, "h": 3600, "hour": 3600, "hours": 3600,
}
_FILLER = {
    "hengio", "hen", "gio", "bao", "thuc", "dem", "nguoc", "timer", "baothuc", "alarm", "countdown", "demnguoc", "nhac", "remind", "reminder", "toi", "minh", "me", "giup", "hay", "vui",
    "long", "sau", "trong", "dat", "cho", "set", "a", "an", "for", "in", "to", "of", "please", "luc", "nua", "ruoi", "half", "and",
}

_SAY = {
    "vi": {
        "timer": "Đã hẹn giờ {span}.",
        "timer_label": "Đã hẹn giờ {span}, nhắc bạn {label}.",
        "timer_done": "Hết giờ hẹn {span} rồi.",
        "timer_done_label": "Đến giờ rồi: {label}.",
        "timer_when": "Bạn muốn hẹn giờ bao lâu? Nói: hẹn giờ năm phút.",
        "timer_long": "Mình chỉ hẹn giờ được tối đa hai mươi bốn tiếng.",
        "off": "Mình đang tắt các công cụ cần mạng nên chưa tra được.",
        "offline": "Mình chưa kết nối được để tra. Kiểm tra mạng giúp mình nhé.",
        "weather_where": "Bạn muốn xem thời tiết ở đâu? Nói: thời tiết ở, rồi tên thành phố.",
        "weather_none": "Mình không tìm thấy nơi nào tên {place}.",
        "here": "Chỗ bạn",
        "weather_now": "{place}: hiện {temp} độ, {sky}.",
        "weather_feels": " Cảm giác như {feels} độ.",
        "weather_day": " {day} từ {low} đến {high} độ{rain}.",
        "weather_rain": ", khả năng mưa {rain} phần trăm",
        "today": "Hôm nay",
        "tomorrow": "Ngày mai",
        "lookup_what": "Bạn muốn tra cứu gì? Nói: tra cứu, rồi chủ đề.",
        "lookup_none": "Mình không tìm thấy trang Wikipedia nào về {topic}.",
        "source": "Nguồn: Wikipedia",
        "sky": {0: "trời quang", 1: "gần như quang mây", 2: "có mây rải rác", 3: "trời nhiều mây", 45: "có sương mù", 48: "có sương mù",
                51: "mưa phùn nhẹ", 53: "mưa phùn", 55: "mưa phùn dày", 61: "mưa nhỏ", 63: "mưa vừa", 65: "mưa to", 71: "có tuyết nhẹ",
                73: "có tuyết", 75: "tuyết dày", 80: "mưa rào nhẹ", 81: "mưa rào", 82: "mưa rào lớn", 95: "có dông", 96: "dông kèm mưa đá",
                99: "dông mạnh kèm mưa đá"},
        "unit": {"hour": "giờ", "minute": "phút", "second": "giây"},
    },
    "en": {
        "timer": "Timer set for {span}.",
        "timer_label": "Timer set for {span}, to remind you {label}.",
        "timer_done": "Your {span} timer is up.",
        "timer_done_label": "Time's up: {label}.",
        "timer_when": "How long? Say: set a timer for five minutes.",
        "timer_long": "I can only set a timer for up to twenty-four hours.",
        "off": "The tools that need the internet are turned off, so I cannot look that up.",
        "offline": "I could not connect to look that up. Please check the network.",
        "weather_where": "Where do you want the weather? Say: weather in, then a city.",
        "weather_none": "I could not find a place called {place}.",
        "here": "Where you are",
        "weather_now": "{place}: {temp} degrees now, {sky}.",
        "weather_feels": " It feels like {feels}.",
        "weather_day": " {day}, {low} to {high} degrees{rain}.",
        "weather_rain": ", {rain} percent chance of rain",
        "today": "Today",
        "tomorrow": "Tomorrow",
        "lookup_what": "What should I look up? Say: look up, then the subject.",
        "lookup_none": "I found no Wikipedia page about {topic}.",
        "source": "Source: Wikipedia",
        "sky": {0: "clear sky", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "foggy", 48: "foggy", 51: "light drizzle", 53: "drizzle",
                55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow",
                80: "light showers", 81: "showers", 82: "heavy showers", 95: "thunderstorm", 96: "thunderstorm with hail",
                99: "severe thunderstorm with hail"},
        "unit": {"hour": "hours", "minute": "minutes", "second": "seconds"},
    },
}


def _say(locale: str) -> dict[str, Any]:
    return _SAY["vi" if locale == "vi" else "en"]


def enabled() -> bool:
    return os.environ.get("VR_TOOLS", "on").strip().lower() not in {"off", "0", "false", "no"}


def _get_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
        return json.loads(response.read())


def _out(reply: str, display: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"action": "none", "id": None, "reply": reply}
    if display:
        out["display"] = display
        out["open"] = "assistant"
    return out


def _digit(plain: list[str], words: list[str], index: int) -> int | None:
    word = plain[index]
    if word == "sau" and words[index].lower().strip(".,!?") != "sáu":
        return None
    return _NUMBER.get(word)


def _number_at(plain: list[str], words: list[str], start: int) -> tuple[int, int] | None:
    word = plain[start]
    if word.isdigit():
        return int(word), 1
    if word == "muoi":
        if start + 1 < len(plain):
            ones = _digit(plain, words, start + 1)
            if ones is not None and ones < 10:
                return 10 + ones, 2
        return 10, 1
    value = _digit(plain, words, start)
    if value is None:
        return None
    if value < 10 and start + 1 < len(plain) and plain[start + 1] == "muoi":
        tens = value * 10
        if start + 2 < len(plain):
            ones = _digit(plain, words, start + 2)
            if ones is not None and 0 < ones < 10:
                return tens + ones, 3
        return tens, 2
    return value, 1


def duration(words: list[str]) -> tuple[int, set[int]] | None:
    plain = [letters(word) for word in words]
    total, used, index = 0, set(), 0
    while index < len(plain):
        found = _number_at(plain, words, index)
        if found and index + found[1] < len(plain) and plain[index + found[1]] in _UNIT:
            value, took = found
            unit_at = index + took
            seconds = value * _UNIT[plain[unit_at]]
            used |= set(range(index, unit_at + 1))
            index = unit_at + 1
            if index < len(plain) and plain[index] == "ruoi":
                seconds += _UNIT[plain[unit_at]] // 2
                used.add(index)
                index += 1
            total += seconds
            continue
        if plain[index] in {"nua", "half"} and index + 1 < len(plain) and plain[index + 1] in {"tieng", "gio", "hour", "an"}:
            span = 2 if plain[index + 1] != "an" else 3
            total += 1800
            used |= set(range(index, min(len(plain), index + span)))
            index += span
            continue
        index += 1
    return (total, used) if total > 0 else None


def _span(seconds: int, locale: str) -> str:
    unit = _say(locale)["unit"]
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    parts = [f"{hours} {unit['hour']}"] if hours else []
    if minutes:
        parts.append(f"{minutes} {unit['minute']}")
    if secs or not parts:
        parts.append(f"{secs} {unit['second']}")
    return " ".join(parts)


def _timer(words: list[str], locale: str) -> dict[str, Any]:
    say = _say(locale)
    found = duration(words)
    if found is None:
        return _out(say["timer_when"])
    seconds, used = found
    if seconds > MAX_TIMER_S:
        return _out(say["timer_long"])
    label = " ".join(word for index, word in enumerate(words) if index not in used and letters(word) not in _FILLER).strip(" .,!?")
    span = _span(seconds, locale)
    done = say["timer_done_label"].format(label=label) if label else say["timer_done"].format(span=span)
    reply = say["timer_label"].format(span=span, label=label) if label else say["timer"].format(span=span)
    return {"action": "timer", "id": None, "reply": reply, "value": {"seconds": seconds, "say": done}}


def _after(words: list[str], markers: set[str], stop: set[str]) -> str:
    plain = [letters(word) for word in words]
    for index, word in enumerate(plain):
        if word in markers:
            place = []
            for later, rest in zip(plain[index + 1 :], words[index + 1 :]):
                if later in stop:
                    break
                place.append(rest)
            return " ".join(place).strip(" .,!?")
    return ""


def _weather(words: list[str], locale: str, here: tuple[float, float] | None = None) -> dict[str, Any]:
    say = _say(locale)
    if not enabled():
        return _out(say["off"])
    place = _after(words, _AT, _WHEN)
    if not place and here is None:
        return _out(say["weather_where"])
    plain = {letters(word) for word in words} | _heard(words)
    day = 1 if plain & _TOMORROW else 0
    try:
        if place:
            query = urllib.parse.urlencode({"name": place, "count": 1, "language": "vi" if locale == "vi" else "en"})
            found = (_get_json(f"https://geocoding-api.open-meteo.com/v1/search?{query}").get("results") or [])
            if not found:
                return _out(say["weather_none"].format(place=place))
            spot = found[0]
        else:
            assert here is not None
            spot = {"latitude": here[0], "longitude": here[1], "name": say["here"]}
        forecast = urllib.parse.urlencode(
            {
                "latitude": spot["latitude"],
                "longitude": spot["longitude"],
                "current": "temperature_2m,apparent_temperature,weather_code",
                "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
                "timezone": "auto",
                "forecast_days": 2,
            }
        )
        data = _get_json(f"https://api.open-meteo.com/v1/forecast?{forecast}")
        now, daily = data["current"], data["daily"]
        name = str(spot.get("name") or place)
        sky = say["sky"].get(int(now["weather_code"]), say["sky"][3])
        lines = [say["weather_now"].format(place=name, temp=round(now["temperature_2m"]), sky=sky).strip()]
        rain = daily.get("precipitation_probability_max", [None, None])[day]
        extra = say["weather_rain"].format(rain=round(rain)) if rain is not None else ""
        lines.append(
            say["weather_day"].format(
                day=say["tomorrow" if day else "today"],
                low=round(daily["temperature_2m_min"][day]),
                high=round(daily["temperature_2m_max"][day]),
                rain=extra,
            ).strip()
        )
        if abs(now["apparent_temperature"] - now["temperature_2m"]) >= 2:
            lines.append(say["weather_feels"].format(feels=round(now["apparent_temperature"])).strip())
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError, IndexError, TypeError):
        return _out(say["offline"])
    spoken = " ".join(lines)
    return _out(spoken, "\n".join(lines))


def _lookup(words: list[str], locale: str) -> dict[str, Any]:
    say = _say(locale)
    plain = [letters(word) for word in words]
    skip = _LOOKUP | {"tra", "cuu", "tim", "tren", "tracuu", "wikipedia", "look", "up", "me", "ve", "about", "cho", "giup", "hay", "toi", "minh", "on", "the", "for", "search"}
    topic = " ".join(word for word, flat in zip(words, plain) if flat and flat not in skip).strip(" .,!?")
    if not topic:
        return _out(say["lookup_what"])
    if not enabled():
        return _out(say["off"])
    host = "vi" if locale == "vi" else "en"
    try:
        query = urllib.parse.urlencode({"action": "opensearch", "search": topic, "limit": 1, "format": "json"})
        titles = _get_json(f"https://{host}.wikipedia.org/w/api.php?{query}")[1]
        if not titles:
            return _out(say["lookup_none"].format(topic=topic))
        title = str(titles[0])
        page = _get_json(f"https://{host}.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(title.replace(' ', '_'), safe='')}")
        text = " ".join(str(page.get("extract") or "").split())
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError, IndexError, TypeError):
        return _out(say["offline"])
    if not text:
        return _out(say["lookup_none"].format(topic=topic))
    return _out(_sentences(text, SPOKEN_CHARS), f"{title}\n{text[:SHOWN_CHARS]}\n{say['source']}")


def _sentences(text: str, limit: int) -> str:
    out = ""
    for part in text.replace("? ", "?|").replace("! ", "!|").replace(". ", ".|").split("|"):
        if out and len(out) + len(part) + 1 > limit:
            break
        out = f"{out} {part}".strip()
    return out[:limit]


def command(heard: str, locale: str, here: tuple[float, float] | None = None) -> dict[str, Any] | None:
    words = heard.replace("-", " ").replace(",", " ").split()
    if not words:
        return None
    seen = _heard(words)
    has_time = duration(words) is not None
    if seen & _TIMER or (seen & _REMIND and has_time):
        return _timer(words, locale)
    if seen & _WEATHER:
        return _weather(words, locale, here)
    if seen & _LOOKUP:
        return _lookup(words, locale)
    return None
