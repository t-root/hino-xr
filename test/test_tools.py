"""A timer, the weather, a look-up, and "stop": keyword commands that need no language model."""

from __future__ import annotations

import contextlib
import importlib
import io
import os
import sys
import unittest

from helpers import ASSISTANT

sys.path.insert(0, str(ASSISTANT))
tools = importlib.import_module("models.tools")
wake = importlib.import_module("models.wake")
engine_module = importlib.import_module("models.engine")
catalog = importlib.import_module("models.catalog")
speech_module = importlib.import_module("models.speech")
sys.path.remove(str(ASSISTANT))

GEOCODING = {"results": [{"name": "Đà Nẵng", "latitude": 16.07, "longitude": 108.22}]}
FORECAST = {
    "current": {"temperature_2m": 31.2, "apparent_temperature": 36.0, "weather_code": 3},
    "daily": {"temperature_2m_max": [33.4, 30.0], "temperature_2m_min": [26.1, 25.0], "precipitation_probability_max": [60, 20]},
}


def seconds(line: str, locale: str = "vi") -> int | None:
    out = tools.command(line, locale)
    return out["value"]["seconds"] if out and out["action"] == "timer" else None


class TimerTest(unittest.TestCase):
    def test_a_time_said_in_digits_or_words(self) -> None:
        self.assertEqual(seconds("hẹn giờ 5 phút"), 300)
        self.assertEqual(seconds("hẹn giờ năm phút"), 300)
        self.assertEqual(seconds("đặt hẹn giờ hai mươi lăm giây"), 25)
        self.assertEqual(seconds("hẹn giờ mười phút"), 600)
        self.assertEqual(seconds("hẹn giờ một tiếng rưỡi"), 5400)
        self.assertEqual(seconds("hẹn giờ nửa tiếng"), 1800)
        self.assertEqual(seconds("hẹn giờ sáu phút"), 360)  # "sáu" is six...
        self.assertEqual(seconds("hẹn giờ sau mười phút"), 600)  # ...and "sau" is only "after"

    def test_english(self) -> None:
        self.assertEqual(seconds("set a timer for 5 minutes", "en"), 300)
        self.assertEqual(seconds("set a timer for 2 hours 30 minutes", "en"), 9000)
        self.assertEqual(seconds("timer for half an hour", "en"), 1800)

    def test_a_reminder_keeps_what_to_be_reminded_of(self) -> None:
        out = tools.command("nhắc tôi tắt bếp sau mười phút", "vi")
        self.assertEqual(out["value"]["seconds"], 600)
        self.assertEqual(out["value"]["say"], "Đến giờ rồi: tắt bếp.")
        english = tools.command("remind me in 10 minutes to turn off the stove", "en")
        self.assertEqual(english["value"]["say"], "Time's up: turn off the stove.")

    def test_a_timer_without_a_label_says_how_long_it_was(self) -> None:
        out = tools.command("hẹn giờ 5 phút", "vi")
        self.assertEqual(out["value"]["say"], "Hết giờ hẹn 5 phút rồi.")
        self.assertEqual(out["reply"], "Đã hẹn giờ 5 phút.")

    def test_no_time_asks_for_one_and_a_day_is_too_long(self) -> None:
        self.assertEqual(tools.command("hẹn giờ", "vi")["action"], "none")
        self.assertEqual(tools.command("hẹn giờ ba mươi tiếng", "vi")["action"], "none")

    def test_ordinary_lines_are_not_timers(self) -> None:
        for line in ("mấy giờ rồi", "nhắc lại câu vừa rồi", "hôm nay trời đẹp không", "what time is it", "tăng tốc độ đọc"):
            self.assertIsNone(tools.command(line, "vi"), line)


class WeatherAndLookupTest(unittest.TestCase):
    def setUp(self) -> None:
        self.asked: list[str] = []
        self.keep = tools._get_json
        self.saved = {k: os.environ.get(k) for k in ("VR_TOOLS",)}
        os.environ.pop("VR_TOOLS", None)

        def fake(url: str):
            self.asked.append(url)
            if "geocoding" in url:
                return GEOCODING
            if "api.open-meteo" in url:
                return FORECAST
            if "opensearch" in url:
                return ["x", ["Alan Turing"], [""], [""]]
            return {"extract": "Alan Turing là nhà toán học người Anh. Ông là cha đẻ của khoa học máy tính. " + "Câu dài. " * 100}

        tools._get_json = fake

    def tearDown(self) -> None:
        tools._get_json = self.keep
        for key, value in self.saved.items():
            os.environ.pop(key, None)
            if value is not None:
                os.environ[key] = value

    def test_the_weather_in_a_named_city(self) -> None:
        out = tools.command("thời tiết ở Đà Nẵng hôm nay", "vi")
        self.assertIn("Đà Nẵng: hiện 31 độ", out["reply"])
        self.assertIn("từ 26 đến 33 độ", out["reply"])
        self.assertIn("mưa 60 phần trăm", out["reply"])
        self.assertEqual(out["open"], "assistant")
        self.assertIn("name=%C4%90%C3%A0+N%E1%BA%B5ng", self.asked[0])  # the city, and nothing else, is sent

    def test_tomorrow(self) -> None:
        out = tools.command("thời tiết ở Đà Nẵng ngày mai", "vi")
        self.assertIn("Ngày mai từ 25 đến 30 độ", out["reply"])

    def test_english_weather(self) -> None:
        out = tools.command("what is the weather in Da Nang", "en")
        self.assertIn("31 degrees now", out["reply"])
        self.assertIn("Today, 26 to 33 degrees", out["reply"])

    def test_no_city_uses_where_the_device_is_or_asks(self) -> None:
        self.assertIn("ở đâu", tools.command("thời tiết hôm nay thế nào", "vi")["reply"])  # no city and no position
        out = tools.command("thời tiết hôm nay", "vi", (16.05, 108.2))
        self.assertIn("Chỗ bạn: hiện 31 độ", out["reply"])
        self.assertTrue(any("latitude=16.05" in url and "longitude=108.2" in url for url in self.asked))
        self.assertFalse(any("geocoding" in url for url in self.asked))  # nothing to look up: only the two numbers go out
        self.assertIn("Where you are: 31 degrees", tools.command("weather today", "en", (16.05, 108.2))["reply"])

    def test_a_city_that_is_said_wins_over_where_the_device_is(self) -> None:
        tools.command("thời tiết ở Hà Nội", "vi", (16.05, 108.2))
        self.assertIn("name=H", self.asked[0])

    def test_a_place_that_does_not_exist(self) -> None:
        tools._get_json = lambda url: {}
        self.assertIn("không tìm thấy nơi nào tên Xyz", tools.command("thời tiết ở Xyz", "vi")["reply"])

    def test_without_the_internet(self) -> None:
        def down(url):
            raise OSError("offline")

        tools._get_json = down
        self.assertIn("chưa kết nối được", tools.command("thời tiết ở Hà Nội", "vi")["reply"])
        self.assertIn("chưa kết nối được", tools.command("tra cứu Alan Turing", "vi")["reply"])

    def test_the_tools_can_be_turned_off_and_then_nothing_is_sent(self) -> None:
        os.environ["VR_TOOLS"] = "off"
        self.assertIn("tắt", tools.command("thời tiết ở Hà Nội", "vi")["reply"])
        self.assertIn("tắt", tools.command("tra cứu Alan Turing", "vi")["reply"])
        self.assertEqual(self.asked, [])

    def test_a_look_up_is_read_in_whole_sentences_and_shown_in_full(self) -> None:
        out = tools.command("tra cứu Alan Turing", "vi")
        self.assertTrue(out["reply"].startswith("Alan Turing là nhà toán học người Anh. Ông là cha đẻ"))
        self.assertTrue(out["reply"].endswith("."))
        self.assertLessEqual(len(out["reply"]), tools.SPOKEN_CHARS)
        self.assertIn("Nguồn: Wikipedia", out["display"])
        self.assertIn("Alan+Turing", self.asked[0])
        self.assertTrue(self.asked[0].startswith("https://vi.wikipedia.org"))

    def test_a_look_up_without_a_subject_asks_for_one(self) -> None:
        self.assertIn("tra cứu gì", tools.command("tra cứu", "vi")["reply"])


class StopTest(unittest.TestCase):
    def test_a_line_that_is_only_stop(self) -> None:
        for line in ("dừng lại", "Dừng lại.", "Hino, im đi", "stop", "Stop it", "be quiet", "That's enough", "thôi"):
            self.assertTrue(wake.is_stop(line, "Hino"), line)

    def test_the_assistants_own_sentences_do_not_stop_it(self) -> None:
        for line in ("tôi sẽ dừng lại ở đây nhé", "stop the music please", "mình nói tiếp nhé", "dừng lại ở ngã tư rồi rẽ phải"):
            self.assertFalse(wake.is_stop(line, "Hino"), line)

    def test_the_page_and_the_server_have_it(self) -> None:
        root = ASSISTANT.parent
        self.assertIn('"stop"', (root / "src/core/models/WakeController.ts").read_text(encoding="utf-8"))
        self.assertIn("bargeIn: false", (root / "src/core/state/settings.ts").read_text(encoding="utf-8"))  # off until asked for
        self.assertIn("is_stop", (ASSISTANT / "app.py").read_text(encoding="utf-8"))


class SpokenPathTest(unittest.TestCase):
    """What the page receives when the wearer asks for a timer."""

    def test_a_timer_reaches_the_page_as_a_command_with_its_clock(self) -> None:
        engine = engine_module.Engine()
        spec = catalog.ModelSpec(id="t")
        engine._spec, engine.state = spec, "ready"
        engine_module.ai.ready = lambda name: None  # no server of this machine in a test
        keep = (speech_module.speech.transcribe, engine_module._tts)
        speech_module.speech.transcribe = lambda *a, **k: "hẹn giờ năm phút"
        engine_module._tts = lambda text, locale, tuning: None
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                events = list(engine.talk(spec, b"wav", "vi"))
        finally:
            speech_module.speech.transcribe, engine_module._tts = keep
        command = next(e for e in events if e["type"] == "command")
        self.assertEqual(command["action"], "timer")
        self.assertEqual(command["value"]["seconds"], 300)
        self.assertTrue(any(e["type"] == "timing" for e in events))  # the page logs how long the turn took


if __name__ == "__main__":
    unittest.main()
