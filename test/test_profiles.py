"""One codebase, two profiles: `VR_PROFILE=cpu` (the default) or `VR_PROFILE=gpu` picks the stages, the downloads and the network."""

from __future__ import annotations

import importlib
import importlib.util
import json
import os
import sys
import unittest

from helpers import ASSISTANT, ROOT

sys.path.insert(0, str(ASSISTANT))
profiles = importlib.import_module("profiles")
ai = importlib.import_module("ai")
sys.path.remove(str(ASSISTANT))

spec = importlib.util.spec_from_file_location("run_for_profile_tests", ROOT / "run.py")
run = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run)

ITEMS = json.loads((ROOT / "downloads.json").read_text(encoding="utf-8"))["items"]


class ProfileTest(unittest.TestCase):
    def setUp(self) -> None:
        self.saved = os.environ.get("VR_PROFILE")
        ai.config.reset()

    def tearDown(self) -> None:
        os.environ.pop("VR_PROFILE", None)
        if self.saved is not None:
            os.environ["VR_PROFILE"] = self.saved
        ai.config.reset()

    def use(self, name: str) -> None:
        os.environ["VR_PROFILE"] = name
        ai.config.reset()

    def test_cpu_is_the_default(self) -> None:
        os.environ.pop("VR_PROFILE", None)
        self.assertEqual(profiles.name(), "cpu")
        os.environ["VR_PROFILE"] = " GPU "
        self.assertEqual(profiles.name(), "gpu")

    def test_an_unknown_profile_is_refused(self) -> None:
        os.environ["VR_PROFILE"] = "tpu"
        with self.assertRaises(ValueError):
            profiles.name()

    def test_each_profile_reads_its_own_stages(self) -> None:
        for name, chat_model, whisper in (("cpu", "qwen3-vl-4b", "ggml-small.bin"), ("gpu", "qwen3-vl-8b", "ggml-large-v3-q5_0.bin")):
            self.use(name)
            self.assertEqual(profiles.stages_file().name, f"stages.{name}.json")
            self.assertEqual(ai.stage("chat").model, chat_model, name)
            self.assertTrue(ai.config.servers()[ai.stage("stt").server]["model"].endswith(whisper), name)

    def test_every_stage_has_a_server_and_every_file_of_a_server_is_downloaded(self) -> None:
        for name in profiles.PROFILES:
            self.use(name)
            fetched = {item["to"] for item in ITEMS if profiles.wanted(item)}
            for stage in (*ai.config.ASSISTANT_STAGES, *ai.config.PLUGIN_STAGES):
                server = ai.stage(stage).server
                if server is not None:
                    self.assertIn(server, ai.config.servers(), f"{name}/{stage}")
            for server, entry in ai.config.servers().items():
                for key in ("model", "mmproj"):
                    if key in entry:
                        self.assertIn(entry[key], fetched, f"{name}/{server}.{key}")
            ports = [entry["port"] for entry in ai.config.servers().values()]
            self.assertEqual(len(ports), len(set(ports)), name)

    def test_the_servers_of_each_profile_are_the_ones_it_always_had(self) -> None:
        self.use("gpu")
        servers = ai.config.servers()
        self.assertEqual({name: entry["port"] for name, entry in servers.items()}, {"llm": 8081, "coder": 8082, "whisper": 8083})
        self.assertEqual({servers["llm"]["group"], servers["coder"]["group"]}, {"gpu"})
        self.use("cpu")
        servers = ai.config.servers()
        self.assertEqual({name: entry["port"] for name, entry in servers.items()}, {"llm": 8081, "coder": 8082, "whisper_wake": 8084})
        self.assertEqual(servers["llm"]["gpu_layers"], 0)

    def test_an_entry_of_the_other_profile_is_not_fetched(self) -> None:
        for name in profiles.PROFILES:
            os.environ["VR_PROFILE"] = name
            wanted = [item["id"] for item in ITEMS if profiles.wanted(item)]
            self.assertTrue(len(wanted) < len(ITEMS), name)
            fetched: list[str] = []
            saved = run._fetch, run._present
            run._fetch = lambda item, dest: fetched.append(item["id"])
            run._present = lambda item, dest: False
            try:
                run._ensure_downloads(ITEMS)
            finally:
                run._fetch, run._present = saved
            self.assertEqual(fetched, wanted, name)

    def test_what_is_shared_is_one_entry_and_a_profile_never_fetches_a_target_twice(self) -> None:
        shared = {item["id"] for item in ITEMS if set(item["profile"]) == set(profiles.PROFILES)}
        self.assertIn("hand-landmarker", shared)
        self.assertTrue(any(name.startswith("voice-vi") for name in shared))
        for name in profiles.PROFILES:
            os.environ["VR_PROFILE"] = name
            targets = [item["to"] for item in ITEMS if profiles.wanted(item) and not item.get("unpack")]
            self.assertEqual(len(targets), len(set(targets)), name)


class AskProfileTest(unittest.TestCase):
    """`run.py` asks which profile to run when none is chosen: Enter is cpu, typing gpu is gpu, nothing to edit."""

    def setUp(self) -> None:
        self.saved = os.environ.pop("VR_PROFILE", None)

    def tearDown(self) -> None:
        os.environ.pop("VR_PROFILE", None)
        if self.saved is not None:
            os.environ["VR_PROFILE"] = self.saved

    def ask(self, *answers: str, tty: bool = True) -> list[str]:
        from unittest import mock

        asked: list[str] = []
        replies = iter(answers)

        def fake_input(prompt: str = "") -> str:
            asked.append(prompt)
            return next(replies)

        with mock.patch("builtins.input", fake_input), mock.patch.object(run.sys.stdin, "isatty", lambda: tty):
            run._ask_profile()
        return asked

    def test_enter_is_cpu(self) -> None:
        self.ask("")
        self.assertEqual(os.environ["VR_PROFILE"], "cpu")

    def test_typing_gpu_is_gpu_in_any_case(self) -> None:
        self.ask("  GPU ")
        self.assertEqual(os.environ["VR_PROFILE"], "gpu")

    def test_a_wrong_answer_asks_again(self) -> None:
        asked = self.ask("cuda", "gpu")
        self.assertEqual(len(asked), 2)
        self.assertEqual(os.environ["VR_PROFILE"], "gpu")

    def test_a_profile_already_chosen_is_not_asked_about(self) -> None:
        os.environ["VR_PROFILE"] = "gpu"
        self.assertEqual(self.ask(), [])
        self.assertEqual(os.environ["VR_PROFILE"], "gpu")

    def test_nobody_to_ask_keeps_the_default(self) -> None:
        self.assertEqual(self.ask(tty=False), [])  # a service or a pipe: no question, and cpu as before
        self.assertNotIn("VR_PROFILE", os.environ)
        self.assertEqual(profiles.name(), "cpu")


if __name__ == "__main__":
    unittest.main()
