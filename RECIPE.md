# Herdr file picker

Open fzf over your Herdr workspace, select a file, and run a command with that path in a new split or popup. Each key you configure runs a different command, such as Enter to edit and Ctrl+D to view a diff. This is for people who want to use their existing fzf setup from a local terminal. It selects one file at a time and does not reuse an existing editor window.

![Herdr file picker](preview.png)

## What you see

- A small "Opening fzf…" overlay (240×64) while the picker starts.
- A centered fzf dialog in the terminal's appearance with your fzf settings. By default, it is 75% of the window width and 65% of its height.
- Above the list, a header such as `enter: edit  ·  ctrl-d: diff` listing each action key and its label. It can be turned off.
- After you select a file, the command for the key you pressed runs in a right split, a lower split, or a popup. Action popups default to 60% of the window width and 50% of its height.

## How it behaves

- `mod.open:file-picker` opens it; the example keybinding is Cmd+O.
- fzf starts in the focused local terminal's directory, with an optional initial search query, and controls file discovery, filtering, ordering, and previews.
- Pressing Enter or another configured key closes the picker and runs that key's command with the selected path.
- The command runs in the directory captured when the picker opened. Splits target the original pane even if focus changes.
- The command's split or popup closes when the command exits.
- Escape cancels without running anything. Dismissing the picker or a command popup stops its process.
- Opening another picker cancels the existing one.
- Invalid configuration, a missing executable, or a non-local terminal shows an error notification.

The picker reads `file-picker.json` from the Herdr home each time it opens:

- `query`: initial search text; empty by default.
- `header`: show the action header; `true` by default.
- `picker.width`, `picker.height`: picker dialog dimensions.
- `actions`: fzf key name to action; `enter` is required. Each action has:
  - `argv`: command argument array with `{file}` in an argument (not the executable).
  - `label`: header text; defaults to `argv[0]`.
  - `destination`: `right` (default), `down`, or `popup`.
  - `size`: split size in logical pixels, or `width` and `height` for a popup.

Dimensions up to and including 1 are window fractions; larger values are pixels. Unknown keys are errors. See [README.md](README.md) for installation and examples.

## Built from

- `mods/file-picker/mod.json`: `place: "none"` with a 240×64 overlay for the launcher.
- `main.js`, the mod view, in two roles chosen by `props()`:
  - With `props().overlay`, the launcher: runs the flow below, then closes its overlay. Its `close()` kills a running picker and deletes the private result file.
  - With `props().cleanupTerminal`, a 1px block inside each terminal dialog whose `close()` kills that terminal when the dialog is dismissed.
- `picker.js`: config validation, fzf output parsing, and `/bin/sh` command construction, kept free of `herdr` imports so Node tests can run it.
- `herdr` functions: `focused`, `spaces`, `appHome`, `readTextFile`, `exec`, `openOverlay`, `closeOverlay`, `props`, `notify`.
- Flow:
  1. Read `focused()` for the pane and cwd; reject remote spaces.
  2. Read and validate the config; check `fzf` and every action's executable with `command -v`.
  3. `mktemp` a private result file under `<app home>/data/file-picker`.
  4. `hc run --bg --json --no-parent --no-notify --cwd <cwd> -- /bin/sh -c 'exec fzf --no-multi --no-print-query --print0 --query "$query" "$@" > "$result"'`, passing `--expect=<non-enter keys>` and `--header <key: label  ·  …>`.
  5. Show it with `openOverlay({ kind: "dialog", layout })`: a column with the terminal block and the 1px cleanup block.
  6. Loop `hc wait <terminal> --timeout 20` until it ends, then `hc rm` it.
  7. Parse the result as `key\0path\0` (empty key is Enter), or `path\0` when only `enter` is configured.
  8. Run the action as `/bin/sh -c 'cd "$1" && shift && exec "$@"'` with `{file}` replaced in each argument:
     - Popup: `hc run --bg`, then a dialog like step 5.
     - Split: `herdr-app do pane.split {pane, direction, argv}`, then `layout.resize {id, px}` when `size` is set.
- Programs: `/bin/sh`, `mktemp`, `fzf`, `hc`, `herdr-app`, and the configured commands.
- `keys.json`: `{"global": {"cmd-o": "mod.open:file-picker"}}`.

## Watch out

- `exec` gives up after 30 seconds, so wait for fzf in bounded `hc wait --timeout 20` calls, not one long call.
- `hc kill` exits 3 or 11 when the terminal is already gone; treat those as success.
- With `--expect`, fzf prints the pressed key line even when it is Enter (empty). `--filter` mode never prints it, so `--filter` tests only cover enter-only configs.
- Pass the selected path as a separate argument; never insert it into shell script text. Paths may contain spaces, quotes, `$`, Unicode, and newlines.
- User `FZF_DEFAULT_OPTS` with `--expect`, `--print-query`, or `--multi` breaks the output format; reject unexpected output instead of guessing.
- Action keys override fzf bindings on the same key, and the header replaces a user `--header`. Plain letters as keys stop you typing them in the search.
- Pagers such as `less -F` exit at once on short output, which closes the split or popup immediately.
- Local terminals only; tested on macOS. Shell and fzf tests also pass on Linux, but Linux desktop integration is untested.
- Available window space may constrain split sizes.

## Done when

- Cmd+O over a local terminal opens fzf in a centered dialog without creating a split.
- The header lists every action key and label, and disappears with `"header": false`.
- Enter and each other action key run their own command on the selected file, in the original directory.
- A file named `quote' ;$(touch x) 雪.txt` arrives unchanged and creates no `x`.
- Right splits, lower splits, and popups use the configured dimensions within window constraints.
- Exiting the command closes its split or popup.
- Escape runs nothing; dismissing the picker or a command popup stops its process and leaves no result file.
- An invalid config, a missing executable, or a remote terminal shows an error notification.
