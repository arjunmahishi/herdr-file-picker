import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "mods/file-picker/runner.py"
spec = importlib.util.spec_from_file_location("runner", SCRIPT)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
BASE = {"handler": {"argv": [sys.executable, "{file}"]}}


class RunnerTest(unittest.TestCase):
    def run_helper(self, *args, **kwargs):
        return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, timeout=10, **kwargs)

    def test_config(self):
        config = runner.validate_config(BASE)
        self.assertEqual(config["query"], "")
        self.assertEqual(config["handler"]["destination"], "right")
        self.assertIsNone(config["handler"]["size"])
        for destination in ("right", "down", "popup"):
            with self.subTest(destination=destination):
                value = copy.deepcopy(BASE)
                value["handler"]["destination"] = destination
                value["handler"].update({"width": 640, "height": 0.5} if destination == "popup" else {"size": 480})
                value.update({"query": "*.py", "picker": {"width": 0.8, "height": 600}})
                self.assertEqual(runner.validate_config(value)["handler"]["destination"], destination)
        invalid = [None, [], {}, {"query": 12}, {"handler": []}, {"handler": {"argv": []}},
                   {"handler": {"argv": ["", "{file}"]}}, {"handler": {"argv": ["program", 1]}},
                   {"handler": {"argv": ["program", "no-placeholder"]}},
                   {"handler": {"argv": ["{file}", "{file}"]}}]
        for changes in ({"query": "\0"}, {"query": False}, {"unknown": 1}, {"picker": []},
                        {"picker": {"width": 0}}, {"picker": {"height": True}},
                        {"picker": {"width": float("nan")}}, {"picker": {"height": float("inf")}},
                        {"picker": {"width": "80%"}}, {"picker": {"typo": 1}}):
            invalid.append(dict(copy.deepcopy(BASE), **changes))
        for changes in ({"destination": "left"}, {"size": 0.5}, {"size": True}, {"size": float("nan")},
                        {"width": 500}, {"destination": "popup", "size": 500}, {"typo": 1},
                        {"argv": ["program", "\0{file}"]}):
            value = copy.deepcopy(BASE)
            value["handler"].update(changes)
            invalid.append(value)
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                runner.validate_config(value)

    def test_argument_transport_and_exec(self):
        names = ["normal.txt", "space name.txt", "quote'\";$(touch should-not-exist) 雪.txt", "-leading-dash", "new\nline.txt", " trailing "]
        with tempfile.TemporaryDirectory() as directory:
            for name in names:
                with self.subTest(name=name):
                    template = [sys.executable, "-c", "import json,os,sys;print(json.dumps([os.getcwd(),sys.argv[1:]]))", "{file}", "prefix={file}"]
                    argv = runner.expand_handler(template, name)
                    self.assertEqual(argv[-2:], [name, "prefix=" + name])
                    generated = self.run_helper("handler", directory, name, json.dumps(template))
                    self.assertEqual(generated.returncode, 0, generated.stderr)
                    result = subprocess.run(json.loads(generated.stdout), capture_output=True, timeout=10)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    cwd, received = json.loads(result.stdout)
                    self.assertEqual(Path(cwd), Path(directory).resolve())
                    self.assertEqual(received, [name, "prefix=" + name])
            self.assertFalse((Path(directory) / "should-not-exist").exists())
            result = self.run_helper("exec", directory, json.dumps([sys.executable, "-c", "raise SystemExit(17)"]))
            self.assertEqual(result.returncode, 17)
            missing = self.run_helper("handler", directory, "file", json.dumps(["/nonexistent/file-picker-handler", "{file}"]))
            self.assertEqual(missing.returncode, 1)
            self.assertIn(b"Executable not found", missing.stderr)
            result = self.run_helper("exec", directory, json.dumps(["/nonexistent/file-picker-handler"]))
            self.assertEqual(result.returncode, 1)
            self.assertIn(b"No such file", result.stderr)

    @unittest.skipUnless(shutil.which("fzf"), "fzf is required for integration tests")
    def test_sessions(self):
        with tempfile.TemporaryDirectory() as directory:
            args = ("prepare", json.dumps(BASE), directory, str(Path(directory) / "sessions"))
            first = self.run_helper(*args)
            second = self.run_helper(*args)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(second.returncode, 0, second.stderr)
            a, b = json.loads(first.stdout), json.loads(second.stdout)
            self.assertNotEqual(a["result"], b["result"])
            path = Path(a["result"])
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            path.write_text(json.dumps({"file": "some file"}))
            outcome = self.run_helper("result", str(path))
            self.assertEqual(json.loads(outcome.stdout), {"file": "some file"})
            self.assertFalse(path.exists())
            for _ in range(2):
                self.assertEqual(self.run_helper("discard", b["result"]).returncode, 0)
            missing_fzf = self.run_helper(*args, env=dict(os.environ, PATH=""))
            self.assertNotEqual(missing_fzf.returncode, 0)
            self.assertIn(b"Executable not found: fzf", missing_fzf.stderr)
            relative = Path(directory) / "custom-editor"
            relative.write_text("#!/bin/sh\nexit 0\n")
            relative.chmod(0o700)
            custom = {"handler": {"argv": ["./custom-editor", "{file}"]}}
            prepared = self.run_helper("prepare", json.dumps(custom), directory, directory)
            self.assertEqual(prepared.returncode, 0, prepared.stderr)
            self.run_helper("discard", json.loads(prepared.stdout)["result"])
            missing = {"handler": {"argv": ["/nonexistent/file-picker-handler", "{file}"]}}
            result = self.run_helper("prepare", json.dumps(missing), directory, directory)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"Executable not found", result.stderr)

    @unittest.skipUnless(shutil.which("fzf"), "fzf is required for integration tests")
    def test_real_fzf(self):
        filename = "needle quote' ;$(not-a-command) 雪\nfile.txt"
        cases = [
            ("--read0 --filter=needle", (filename + "\0other\0").encode(), {"file": filename}, 0),
            ("--filter=no-such-match", b"other\n", {"cancelled": True}, 0),
            ("--file-picker-invalid-option", b"other\n", None, 2),
            ("--filter=needle", b"needle1\nneedle2\n", None, 2),
        ]
        with tempfile.TemporaryDirectory() as directory:
            for options, candidates, expected, code in cases:
                with self.subTest(options=options):
                    path = Path(directory) / "result.json"
                    env = dict(os.environ, FZF_DEFAULT_OPTS=options)
                    result = self.run_helper("pick", str(path), "", input=candidates, env=env)
                    self.assertEqual(result.returncode, code, result.stderr)
                    actual = json.loads(path.read_text())
                    if expected is None:
                        self.assertIn("error", actual)
                    else:
                        self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
