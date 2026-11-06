"""Small terminal bridge; fzf owns file discovery and matching."""

import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def dimension(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be positive pixels, or a fraction between 0 and 1")
    return value


def validate_config(value):
    if not isinstance(value, dict):
        raise ValueError("Configuration must be an object")
    unknown = value.keys() - {"query", "picker", "handler"}
    if unknown:
        raise ValueError(f"Unknown configuration keys: {', '.join(sorted(unknown))}")
    query = value.get("query", "")
    if not isinstance(query, str) or "\0" in query:
        raise ValueError("query must be a string without NUL characters")
    picker = value.get("picker", {})
    handler = value.get("handler")
    if not isinstance(picker, dict) or picker.keys() - {"width", "height"}:
        raise ValueError("picker accepts only width and height")
    if not isinstance(handler, dict) or handler.keys() - {"argv", "destination", "size", "width", "height"}:
        raise ValueError("handler requires argv; optional fields: destination, size, width, height")
    argv = handler.get("argv")
    if not isinstance(argv, list) or not argv or not all(isinstance(arg, str) and "\0" not in arg for arg in argv) or not argv[0]:
        raise ValueError("handler.argv must be a nonempty command argument array without NUL characters")
    if "{file}" in argv[0] or not any("{file}" in arg for arg in argv[1:]):
        raise ValueError("Put {file} in a handler argument, not the executable")
    destination = handler.get("destination", "right")
    if destination not in ("right", "down", "popup"):
        raise ValueError("handler.destination must be right, down, or popup")
    if destination == "popup" and "size" in handler:
        raise ValueError("Use handler.width and height for a popup, not size")
    if destination != "popup" and ("width" in handler or "height" in handler):
        raise ValueError("Use handler.size for a split, not width or height")
    size = handler.get("size")
    if size is not None and (isinstance(size, bool) or not isinstance(size, (int, float)) or not math.isfinite(size) or size < 1):
        raise ValueError("handler.size must be at least 1 logical pixel")
    return {
        "query": query,
        "picker": {key: dimension(picker.get(key, default), f"picker.{key}") for key, default in (("width", 0.75), ("height", 0.65))},
        "handler": {
            "argv": argv, "destination": destination, "size": size,
            "width": dimension(handler.get("width", 0.6), "handler.width"),
            "height": dimension(handler.get("height", 0.5), "handler.height"),
        },
    }


def expand_handler(argv, selected):
    return [arg.replace("{file}", selected) for arg in argv]


def pick(result_path, query):
    try:
        result = subprocess.run(
            ["fzf", "--no-multi", "--no-print-query", "--print0", "--query", query],
            stdout=subprocess.PIPE,
        )
        if result.returncode in (1, 130):
            outcome = {"cancelled": True}
        elif result.returncode:
            raise RuntimeError(f"fzf exited with code {result.returncode}; check its terminal output and FZF_DEFAULT_OPTS")
        else:
            fields = result.stdout.split(b"\0")
            if len(fields) != 2 or fields[-1] or not fields[0]:
                raise RuntimeError("fzf must return one path; remove output-changing options such as --expect or --print-query")
            outcome = {"file": os.fsdecode(fields[0])}
    except (OSError, RuntimeError) as error:
        outcome = {"error": str(error)}
    Path(result_path).write_text(json.dumps(outcome))
    return 2 if "error" in outcome else 0


def main(args):
    action, *args = args
    if action == "prepare":
        raw, cwd, directory = args
        config = validate_config(json.loads(raw))
        os.chdir(cwd)
        for executable in ("fzf", config["handler"]["argv"][0]):
            if not shutil.which(executable):
                raise ValueError(f"Executable not found: {executable}")
        Path(directory).mkdir(parents=True, exist_ok=True)
        fd, path = tempfile.mkstemp(prefix="selection-", suffix=".json", dir=directory)
        os.close(fd)
        print(json.dumps({"config": config, "result": path}))
    elif action == "pick":
        return pick(*args)
    elif action == "result":
        path = Path(args[0])
        try:
            value = json.loads(path.read_text())
        finally:
            path.unlink(missing_ok=True)
        print(json.dumps(value))
    elif action == "discard":
        Path(args[0]).unlink(missing_ok=True)
        print("null")
    elif action == "handler":
        cwd, selected, raw = args
        argv = expand_handler(json.loads(raw), selected)
        os.chdir(cwd)
        if not shutil.which(argv[0]):
            raise ValueError(f"Executable not found: {argv[0]}")
        print(json.dumps([sys.executable, str(Path(__file__).resolve()), "exec", cwd, json.dumps(argv)]))
    elif action == "exec":
        cwd, raw = args
        os.chdir(cwd)
        argv = json.loads(raw)
        os.execvp(argv[0], argv)
    else:
        raise ValueError(f"Unknown action: {action}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (OSError, ValueError, RuntimeError) as error:
        print(f"file-picker: {error}", file=sys.stderr)
        sys.exit(1)
