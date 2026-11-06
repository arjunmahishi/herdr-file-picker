import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, chmodSync, realpathSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateConfig, sessionCommand, executableCommand, pickerCommand, selectedFile, handlerCommand } from "../mods/file-picker/picker.js";

const base = { actions: { enter: { argv: [process.execPath, "{file}"] } } };
const both = { enter: { label: "edit" }, "ctrl-d": { label: "diff" } };
const run = ([program, ...args], options = {}) => spawnSync(program, args, { encoding: "utf8", timeout: 10000, ...options });

function temporary(callback) {
  const directory = mkdtempSync(join(tmpdir(), "file-picker-test-"));
  try { return callback(directory); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test("configuration defaults, destinations, and validation", () => {
  const config = validateConfig(base);
  assert.equal(config.query, "");
  assert.equal(config.header, true);
  assert.equal(config.actions.enter.destination, "right");
  assert.equal(config.actions.enter.size, null);
  assert.equal(config.actions.enter.label, process.execPath);
  for (const destination of ["right", "down", "popup"]) {
    const value = structuredClone(base);
    Object.assign(value.actions.enter, { destination }, destination === "popup" ? { width: 640, height: 0.5 } : { size: 480 });
    Object.assign(value, { query: "*.js", header: false, picker: { width: 0.8, height: 600 } });
    value.actions["ctrl-d"] = { argv: ["less", "{file}"], label: "read", destination };
    const result = validateConfig(value);
    assert.equal(result.header, false);
    assert.equal(result.actions.enter.destination, destination);
    assert.equal(result.actions["ctrl-d"].label, "read");
  }
  const invalid = [null, [], {}, { query: 12 }, { actions: [] }, { actions: {} }, { handler: base.actions.enter },
    { actions: { "ctrl-d": base.actions.enter } }, { actions: { ...base.actions, "ctrl-d,x": base.actions.enter } },
    { actions: { ...base.actions, "ctrl-d": null } }, { actions: { enter: { argv: [] } } },
    { actions: { enter: { argv: ["", "{file}"] } } }, { actions: { enter: { argv: ["program", 1] } } },
    { actions: { enter: { argv: ["program", "no-placeholder"] } } }, { actions: { enter: { argv: ["{file}", "{file}"] } } }];
  for (const change of [{ query: "\0" }, { query: false }, { query: null }, { header: "yes" }, { header: null }, { unknown: 1 },
    { picker: [] }, { picker: null }, { picker: { width: 0 } }, { picker: { height: true } }, { picker: { width: NaN } },
    { picker: { height: Infinity } }, { picker: { width: "80%" } }, { picker: { height: null } }, { picker: { typo: 1 } }]) {
    invalid.push({ ...structuredClone(base), ...change });
  }
  for (const change of [{ destination: "left" }, { destination: null }, { size: 0.5 }, { size: true }, { size: NaN },
    { width: 500 }, { destination: "popup", size: 500 }, { typo: 1 }, { argv: ["program", "\0{file}"] },
    { label: "" }, { label: 1 }, { label: "two\nlines" }]) {
    const value = structuredClone(base);
    Object.assign(value.actions.enter, change);
    invalid.push(value);
  }
  for (const value of invalid) assert.throws(() => validateConfig(value), Error, JSON.stringify(value));
});

test("POSIX handler preserves literal arguments and working directory", () => temporary(directory => {
  const cwd = join(directory, "cwd quote' ;$(not-executed) 雪\n");
  mkdirSync(cwd);
  const names = ["normal.txt", "space name.txt", "quote'\";$(touch should-not-exist) 雪.txt", "-leading-dash",
    "new\nline.txt", " trailing ", "$& $` $' {file}"];
  const code = "console.log(JSON.stringify([process.cwd(), process.argv.slice(1)]))";
  for (const name of names) {
    const result = run(handlerCommand(cwd, name, [process.execPath, "-e", code, "--", "{file}", "prefix={file}", ""]));
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [realpathSync(cwd), [name, "prefix=" + name, ""]]);
  }
  assert.equal(existsSync(join(cwd, "should-not-exist")), false);
  assert.equal(run(handlerCommand(cwd, "file", [process.execPath, "-e", "process.exit(17)", "--", "{file}"])).status, 17);
  assert.notEqual(run(handlerCommand(directory, "file", ["/nonexistent/file-picker-handler", "{file}"])).status, 0);
  assert.notEqual(run(handlerCommand(join(directory, "missing"), "file", [process.execPath, "{file}"])).status, 0);
}));

test("POSIX mktemp sessions are unique, private, and safe with unusual paths", () => temporary(directory => {
  const location = join(directory, "quote' space;$(not-executed) 雪\n");
  const first = run(sessionCommand(location));
  const second = run(sessionCommand(location));
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  const a = first.stdout.replace(/\n$/, "");
  const b = second.stdout.replace(/\n$/, "");
  assert.notEqual(a, b);
  assert.equal(statSync(a).mode & 0o777, 0o600);
  assert.equal(statSync(b).mode & 0o777, 0o600);
}));

test("executable checks work for PATH, relative programs, missing programs, and shell metacharacters", () => temporary(directory => {
  assert.equal(run(executableCommand(process.execPath)).status, 0);
  assert.equal(run(executableCommand("/nonexistent/file-picker-handler")).status, 127);
  assert.equal(run(executableCommand("fzf"), { env: { ...process.env, PATH: "" } }).status, 127);
  const path = join(directory, "custom-editor");
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o700);
  assert.equal(run(executableCommand("./custom-editor"), { cwd: directory }).status, 0);
  assert.equal(run(executableCommand("missing;touch should-not-exist"), { cwd: directory }).status, 127);
  assert.equal(existsSync(join(directory, "should-not-exist")), false);
}));

test("selection protocol preserves whitespace, maps keys, and rejects malformed output", () => {
  for (const name of ["file", " leading and trailing ", "new\nline.txt", "雪.txt"]) {
    assert.deepEqual(selectedFile(name + "\0", 0, base.actions), { key: "enter", file: name });
    assert.deepEqual(selectedFile("\0" + name + "\0", 0, both), { key: "enter", file: name });
    assert.deepEqual(selectedFile("ctrl-d\0" + name + "\0", 0, both), { key: "ctrl-d", file: name });
  }
  assert.equal(selectedFile("", 1, both), null);
  assert.equal(selectedFile("", 130, both), null);
  for (const output of [null, "", "\0", "file", "one\0two\0", "\0file\0"]) {
    assert.throws(() => selectedFile(output, 0, base.actions), /fzf must return one path/);
  }
  for (const output of [null, "", "file\0", "\0\0", "ctrl-d\0one\0two\0"]) {
    assert.throws(() => selectedFile(output, 0, both), /fzf must return one path/);
  }
  assert.throws(() => selectedFile("ctrl-x\0file\0", 0, both), /No action for fzf key "ctrl-x"/);
  assert.throws(() => selectedFile("", 2, both), /code 2/);
  assert.throws(() => selectedFile("", 127, both), /code 127/);
});

test("picker command passes action keys and header to fzf", () => temporary(directory => {
  const fake = join(directory, "fzf");
  writeFileSync(fake, '#!/bin/sh\nfor arg; do printf "%s\\n" "$arg"; done\n');
  chmodSync(fake, 0o700);
  const env = { ...process.env, PATH: `${directory}:${process.env.PATH}` };
  const args = (actions, header) => {
    const path = join(directory, "args");
    assert.equal(run(pickerCommand(path, "q", actions, header), { env }).status, 0);
    return readFileSync(path, "utf8").trim().split("\n");
  };
  const fixed = ["--no-multi", "--no-print-query", "--print0", "--query", "q"];
  assert.deepEqual(args({ enter: { label: "edit" } }, false), fixed);
  assert.deepEqual(args({ enter: { label: "edit" } }, true), [...fixed, "--header", "enter: edit"]);
  assert.deepEqual(args({ ...both, "alt-x": { label: "run" } }, true),
    [...fixed, "--expect=ctrl-d,alt-x", "--header", "enter: edit  ·  ctrl-d: diff  ·  alt-x: run"]);
  assert.deepEqual(args(both, false), [...fixed, "--expect=ctrl-d"]);
}));

test("real fzf selection, cancellation, protocol errors, and inherited options", () => temporary(directory => {
  const available = run(executableCommand("fzf"));
  assert.equal(available.status, 0, "Install fzf to run these integration tests");
  const name = "needle quote' ;$(not-a-command) 雪\nfile.txt";
  const cases = [
    { options: "--read0 --filter=needle", input: name + "\0other\0", expected: { key: "enter", file: name }, status: 0 },
    { options: "--filter=no-such-match", input: "other\n", expected: null, status: 1 },
    { options: "--file-picker-invalid-option", input: "other\n", error: /code 2/, status: 2 },
    { options: "--filter=needle", input: "needle1\nneedle2\n", error: /one path/, status: 0 },
  ];
  for (const item of cases) {
    const path = join(directory, "result quote' ;$(not-executed) 雪");
    const result = run(pickerCommand(path, "", base.actions, true), { input: item.input, env: { ...process.env, FZF_DEFAULT_OPTS: item.options } });
    assert.equal(result.status, item.status, result.stderr);
    const output = readFileSync(path, "utf8");
    if (item.error) assert.throws(() => selectedFile(output, result.status, base.actions), item.error);
    else assert.deepEqual(selectedFile(output, result.status, base.actions), item.expected);
  }
}));
