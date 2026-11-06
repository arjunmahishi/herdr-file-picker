import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, chmodSync, realpathSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateConfig, sessionCommand, executableCommand, pickerCommand, selectedFile, handlerCommand } from "../mods/file-picker/picker.js";

const base = { handler: { argv: [process.execPath, "{file}"] } };
const run = ([program, ...args], options = {}) => spawnSync(program, args, { encoding: "utf8", timeout: 10000, ...options });

function temporary(callback) {
  const directory = mkdtempSync(join(tmpdir(), "file-picker-test-"));
  try { return callback(directory); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test("configuration defaults, destinations, and validation", () => {
  const config = validateConfig(base);
  assert.equal(config.query, "");
  assert.equal(config.handler.destination, "right");
  assert.equal(config.handler.size, null);
  for (const destination of ["right", "down", "popup"]) {
    const value = structuredClone(base);
    Object.assign(value.handler, { destination }, destination === "popup" ? { width: 640, height: 0.5 } : { size: 480 });
    Object.assign(value, { query: "*.js", picker: { width: 0.8, height: 600 } });
    assert.equal(validateConfig(value).handler.destination, destination);
  }
  const invalid = [null, [], {}, { query: 12 }, { handler: [] }, { handler: { argv: [] } },
    { handler: { argv: ["", "{file}"] } }, { handler: { argv: ["program", 1] } },
    { handler: { argv: ["program", "no-placeholder"] } }, { handler: { argv: ["{file}", "{file}"] } }];
  for (const change of [{ query: "\0" }, { query: false }, { query: null }, { unknown: 1 }, { picker: [] }, { picker: null },
    { picker: { width: 0 } }, { picker: { height: true } }, { picker: { width: NaN } }, { picker: { height: Infinity } },
    { picker: { width: "80%" } }, { picker: { height: null } }, { picker: { typo: 1 } }]) {
    invalid.push({ ...structuredClone(base), ...change });
  }
  for (const change of [{ destination: "left" }, { destination: null }, { size: 0.5 }, { size: true }, { size: NaN },
    { width: 500 }, { destination: "popup", size: 500 }, { typo: 1 }, { argv: ["program", "\0{file}"] }]) {
    const value = structuredClone(base);
    Object.assign(value.handler, change);
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

test("selection protocol preserves whitespace and rejects malformed output", () => {
  for (const name of ["file", " leading and trailing ", "new\nline.txt", "雪.txt"]) {
    assert.equal(selectedFile(name + "\0", 0), name);
  }
  assert.equal(selectedFile("", 1), null);
  assert.equal(selectedFile("", 130), null);
  for (const output of [null, "", "\0", "file", "one\0two\0", "\0file\0"]) {
    assert.throws(() => selectedFile(output, 0), /fzf must return one path/);
  }
  assert.throws(() => selectedFile("", 2), /code 2/);
  assert.throws(() => selectedFile("", 127), /code 127/);
});

test("real fzf selection, cancellation, protocol errors, and inherited options", () => temporary(directory => {
  const available = run(executableCommand("fzf"));
  assert.equal(available.status, 0, "Install fzf to run these integration tests");
  const name = "needle quote' ;$(not-a-command) 雪\nfile.txt";
  const cases = [
    { options: "--read0 --filter=needle", input: name + "\0other\0", expected: name, status: 0 },
    { options: "--filter=no-such-match", input: "other\n", expected: null, status: 1 },
    { options: "--file-picker-invalid-option", input: "other\n", error: /code 2/, status: 2 },
    { options: "--filter=needle", input: "needle1\nneedle2\n", error: /one path/, status: 0 },
  ];
  for (const item of cases) {
    const path = join(directory, "result quote' ;$(not-executed) 雪");
    const result = run(pickerCommand(path, ""), { input: item.input, env: { ...process.env, FZF_DEFAULT_OPTS: item.options } });
    assert.equal(result.status, item.status, result.stderr);
    const output = readFileSync(path, "utf8");
    if (item.error) assert.throws(() => selectedFile(output, result.status), item.error);
    else assert.equal(selectedFile(output, result.status), item.expected);
  }
}));
