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

function action(value, name) {
  fields(value, ["argv", "label", "destination", "size", "width", "height"], name);
  const argv = value.argv;
  if (!Array.isArray(argv) || !argv.length || !argv.every(arg => typeof arg === "string" && !arg.includes("\0")) || !argv[0]) {
    throw new Error(`${name}.argv must be a nonempty command argument array without NUL characters`);
  }
  if (argv[0].includes("{file}") || !argv.slice(1).some(arg => arg.includes("{file}"))) {
    throw new Error(`Put {file} in a ${name} argument, not the executable`);
  }
  const label = value.label === undefined ? argv[0] : value.label;
  if (typeof label !== "string" || !label || /[\0\n]/.test(label)) throw new Error(`${name}.label must be a nonempty single-line string`);
  const destination = value.destination === undefined ? "right" : value.destination;
  if (!["right", "down", "popup"].includes(destination)) throw new Error(`${name}.destination must be right, down, or popup`);
  if (destination === "popup" && "size" in value) throw new Error(`Use ${name}.width and height for a popup, not size`);
  if (destination !== "popup" && ("width" in value || "height" in value)) throw new Error(`Use ${name}.size for a split, not width or height`);
  const size = value.size === undefined ? null : value.size;
  if (size !== null && (typeof size !== "number" || !Number.isFinite(size) || size < 1)) {
    throw new Error(`${name}.size must be at least 1 logical pixel`);
  }
  return {
    argv, label, destination, size,
    width: dimension(value.width === undefined ? 0.6 : value.width, `${name}.width`),
    height: dimension(value.height === undefined ? 0.5 : value.height, `${name}.height`),
  };
}

export function validateConfig(value) {
  fields(value, ["query", "header", "picker", "actions"], "configuration");
  const query = value.query === undefined ? "" : value.query;
  if (typeof query !== "string" || query.includes("\0")) throw new Error("query must be a string without NUL characters");
  const header = value.header === undefined ? true : value.header;
  if (typeof header !== "boolean") throw new Error("header must be true or false");
  const picker = value.picker === undefined ? {} : value.picker;
  fields(picker, ["width", "height"], "picker");
  if (!object(value.actions)) throw new Error("actions must be an object");
  if (!("enter" in value.actions)) throw new Error("actions must include enter");
  const actions = {};
  for (const [key, entry] of Object.entries(value.actions)) {
    // fzf validates key names; this only keeps --expect's comma-separated list intact.
    if (!/^[a-z0-9-]+$/.test(key)) throw new Error(`Invalid fzf key name in actions: ${JSON.stringify(key)}`);
    actions[key] = action(entry, `actions.${key}`);
  }
  return {
    query, header,
    picker: {
      width: dimension(picker.width === undefined ? 0.75 : picker.width, "picker.width"),
      height: dimension(picker.height === undefined ? 0.65 : picker.height, "picker.height"),
    },
    actions,
  };
}

export function sessionCommand(directory) {
  return ["/bin/sh", "-c", 'umask 077; mkdir -p "$1" && mktemp "$1/selection.XXXXXXXXXX"', "file-picker", directory];
}

export function executableCommand(executable) {
  return ["/bin/sh", "-c", 'command -v "$1" >/dev/null 2>&1 || { printf "Executable not found: %s\\n" "$1" >&2; exit 127; }', "file-picker", executable];
}

export function pickerCommand(result, query, actions, header) {
  const keys = Object.keys(actions).filter(key => key !== "enter");
  const options = keys.length ? ["--expect=" + keys.join(",")] : [];
  if (header) options.push("--header", Object.entries(actions).map(([key, { label }]) => `${key}: ${label}`).join("  ·  "));
  return ["/bin/sh", "-c", 'result=$1; query=$2; shift 2; exec fzf --no-multi --no-print-query --print0 --query "$query" "$@" > "$result"',
    "file-picker", result, query, ...options];
}

// With --expect, fzf prints the pressed key (empty for enter) before the path.
export function selectedFile(output, exitCode, actions) {
  if (exitCode === 1 || exitCode === 130) return null;
  if (exitCode !== 0) throw new Error(`fzf exited with code ${exitCode}; check its terminal output and FZF_DEFAULT_OPTS`);
  const parts = typeof output === "string" ? output.split("\0") : [];
  const expectsKey = Object.keys(actions).some(key => key !== "enter");
  if (parts.length !== (expectsKey ? 3 : 2) || parts.at(-1) !== "" || !parts.at(-2)) {
    throw new Error("fzf must return one path; remove output-changing options such as --expect or --print-query");
  }
  const key = expectsKey ? parts[0] || "enter" : "enter";
  if (!(key in actions)) throw new Error(`No action for fzf key ${JSON.stringify(key)}; remove --expect from FZF_DEFAULT_OPTS`);
  return { key, file: parts.at(-2) };
}

export function handlerCommand(cwd, selected, argv) {
  return ["/bin/sh", "-c", 'cd "$1" && shift && exec "$@"', "file-picker", cwd,
    ...argv.map(arg => arg.split("{file}").join(selected))];
}
