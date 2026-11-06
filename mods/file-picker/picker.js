function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fields(value, allowed, name) {
  if (!object(value)) throw new Error(`${name} must be an object`);
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) throw new Error(`Unknown ${name} keys: ${unknown.join(", ")}`);
}

function dimension(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive pixels, or a fraction between 0 and 1`);
  }
  return value;
}

export function validateConfig(value) {
  fields(value, ["query", "picker", "handler"], "configuration");
  const query = value.query === undefined ? "" : value.query;
  if (typeof query !== "string" || query.includes("\0")) throw new Error("query must be a string without NUL characters");
  const picker = value.picker === undefined ? {} : value.picker;
  const handler = value.handler;
  fields(picker, ["width", "height"], "picker");
  fields(handler, ["argv", "destination", "size", "width", "height"], "handler");
  const argv = handler.argv;
  if (!Array.isArray(argv) || !argv.length || !argv.every(arg => typeof arg === "string" && !arg.includes("\0")) || !argv[0]) {
    throw new Error("handler.argv must be a nonempty command argument array without NUL characters");
  }
  if (argv[0].includes("{file}") || !argv.slice(1).some(arg => arg.includes("{file}"))) {
    throw new Error("Put {file} in a handler argument, not the executable");
  }
  const destination = handler.destination === undefined ? "right" : handler.destination;
  if (!["right", "down", "popup"].includes(destination)) throw new Error("handler.destination must be right, down, or popup");
  if (destination === "popup" && "size" in handler) throw new Error("Use handler.width and height for a popup, not size");
  if (destination !== "popup" && ("width" in handler || "height" in handler)) throw new Error("Use handler.size for a split, not width or height");
  const size = handler.size === undefined ? null : handler.size;
  if (size !== null && (typeof size !== "number" || !Number.isFinite(size) || size < 1)) {
    throw new Error("handler.size must be at least 1 logical pixel");
  }
  return {
    query,
    picker: {
      width: dimension(picker.width === undefined ? 0.75 : picker.width, "picker.width"),
      height: dimension(picker.height === undefined ? 0.65 : picker.height, "picker.height"),
    },
    handler: {
      argv, destination, size,
      width: dimension(handler.width === undefined ? 0.6 : handler.width, "handler.width"),
      height: dimension(handler.height === undefined ? 0.5 : handler.height, "handler.height"),
    },
  };
}

export function sessionCommand(directory) {
  return ["/bin/sh", "-c", 'umask 077; mkdir -p "$1" && mktemp "$1/selection.XXXXXXXXXX"', "file-picker", directory];
}

export function executableCommand(executable) {
  return ["/bin/sh", "-c", 'command -v "$1" >/dev/null 2>&1 || { printf "Executable not found: %s\\n" "$1" >&2; exit 127; }', "file-picker", executable];
}

export function pickerCommand(result, query) {
  return ["/bin/sh", "-c", 'exec fzf --no-multi --no-print-query --print0 --query "$2" > "$1"', "file-picker", result, query];
}

export function selectedFile(output, exitCode) {
  if (exitCode === 1 || exitCode === 130) return null;
  if (exitCode !== 0) throw new Error(`fzf exited with code ${exitCode}; check its terminal output and FZF_DEFAULT_OPTS`);
  if (typeof output !== "string" || output.length < 2 || !output.endsWith("\0") || output.indexOf("\0") !== output.length - 1) {
    throw new Error("fzf must return one path; remove output-changing options such as --expect or --print-query");
  }
  return output.slice(0, -1);
}

export function handlerCommand(cwd, selected, argv) {
  return ["/bin/sh", "-c", 'cd "$1" && shift && exec "$@"', "file-picker", cwd,
    ...argv.map(arg => arg.split("{file}").join(selected))];
}
