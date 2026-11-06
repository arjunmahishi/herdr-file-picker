import { View, div } from "gpui-kit";
import { unlink } from "fs/promises";
import { validateConfig, sessionCommand, executableCommand, pickerCommand, selectedFile, handlerCommand } from "./picker.js";
import { appHome, focused, spaces, exec, readTextFile, openOverlay, closeOverlay, props, notify } from "herdr";

async function checkedExec(program, args, options) {
  const result = await exec(program, args, options);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `${program} exited with code ${result.code}`);
  return result.stdout;
}

async function jsonExec(program, args, options) {
  return JSON.parse(await checkedExec(program, args, options));
}

async function killTerminal(terminal) {
  const result = await exec("hc", ["kill", terminal]);
  if (![0, 3, 11].includes(result.code)) throw new Error(result.stderr || "Could not stop terminal");
}

function showTerminal(terminal, dimensions) {
  return openOverlay({
    kind: "dialog", ...dimensions,
    layout: {
      id: "file-picker-root", type: "column",
      children: [
        { id: "terminal", type: "block", content: { terminal } },
        { id: "cleanup", type: "block", size: { px: 1 }, content: { mod: "file-picker", props: { cleanupTerminal: terminal } } },
      ],
    },
  });
}

export default class FilePicker extends View {
  init(_props, cx) {
    this.terminal = props()?.cleanupTerminal;
    if (this.terminal) return;
    this.launcher = props()?.overlay;
    if (!this.launcher) return;
    const origin = focused();
    cx.spawn(async () => {
      try {
        if (!origin?.pane || !origin.cwd) throw new Error("Focus a local terminal pane first");
        if (spaces().find(s => s.id === origin.space)?.machine) throw new Error("Remote terminals are not supported");
        const raw = await readTextFile(appHome() + "/file-picker.json");
        if (raw === null) throw new Error(`Create ${appHome()}/file-picker.json from config.example.json first`);
        const config = validateConfig(JSON.parse(raw));
        for (const executable of ["fzf", config.handler.argv[0]]) {
          const [program, ...args] = executableCommand(executable);
          await checkedExec(program, args, { cwd: origin.cwd });
        }
        const [program, ...args] = sessionCommand(appHome() + "/data/file-picker");
        this.result = (await checkedExec(program, args)).replace(/\n$/, "");
        const started = await jsonExec("hc", ["run", "--bg", "--json", "--no-parent", "--no-notify", "--cwd", origin.cwd, "--", ...pickerCommand(this.result, config.query)]);
        this.terminal = started.address;
        this.pickerOverlay = showTerminal(this.terminal, config.picker);
        let ended;
        // exec has a 30-second limit; hc waits for exit, in shorter bounded calls.
        do {
          ended = await jsonExec("hc", ["wait", this.terminal, "--timeout", "20"]);
        } while (!ended.ended);
        const terminal = this.terminal;
        this.terminal = null;
        await jsonExec("hc", ["rm", terminal]);
        if (ended.signal) return;
        const output = await readTextFile(this.result);
        await unlink(this.result);
        this.result = null;
        const selected = selectedFile(output, ended.exit_code);
        if (selected === null) return;
        const handler = config.handler;
        const [executable, ...checkArgs] = executableCommand(handler.argv[0]);
        await checkedExec(executable, checkArgs, { cwd: origin.cwd });
        const argv = handlerCommand(origin.cwd, selected, handler.argv);
        if (handler.destination === "popup") {
          const opened = await jsonExec("hc", ["run", "--bg", "--json", "--no-parent", "--no-notify", "--cwd", origin.cwd, "--", ...argv]);
          try {
            showTerminal(opened.address, { width: handler.width, height: handler.height });
          } catch (error) {
            await killTerminal(opened.address);
            throw error;
          }
        } else {
          const opened = await jsonExec("herdr-app", ["do", "pane.split", JSON.stringify({ pane: origin.pane, direction: handler.destination, argv })]);
          if (handler.size !== null) {
            await jsonExec("herdr-app", ["do", "layout.resize", JSON.stringify({ id: opened.pane, px: handler.size })]);
          }
        }
      } catch (error) {
        notify({ title: "File picker failed", body: String(error), level: "error" });
      } finally {
        closeOverlay(this.launcher);
      }
    });
  }

  async close() {
    try {
      if (this.terminal) await killTerminal(this.terminal);
      if (this.pickerOverlay) closeOverlay(this.pickerOverlay);
      if (this.result) await unlink(this.result);
    } catch (error) {
      console.log("File picker cleanup failed: " + String(error));
      notify({ title: "File picker cleanup failed", body: String(error), level: "error" });
    }
  }

  render() { return this.launcher ? div().child("Opening fzf…") : div(); }
}
