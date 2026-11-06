# Herdr File Picker

Press Cmd+O and fzf opens in a centered dialog over the focused terminal, using that terminal's directory and the person's own fzf settings. The person maps fzf keys to commands; a header lists them. Picking a file with one of those keys runs that key's command on the file, in a right split, a lower split, or a popup.

![Herdr File Picker](preview.png)

## What you see

- **Picker:** a centered dialog holding a terminal that runs fzf. A one-line header sits above the list: `key: label` pairs joined by `  ·  `.
- **Result:** the chosen command in a right split, a lower split, or a centered popup.

## How it behaves

- `mod.open:file-picker` opens the picker; `keys.json` binds it to Cmd+O.
- fzf starts in the focused terminal's directory with the optional `query` as initial search text. The person's `FZF_DEFAULT_COMMAND` and `FZF_DEFAULT_OPTS` control listing, filtering, ordering, and previews.
- Enter or another configured key closes the picker and runs that key's command with the selected path, in the same directory. A split attaches to the original pane even if focus moved.
- The split or popup closes when its command exits.
- Escape runs nothing. Dismissing the picker or a result popup stops its process.
- Opening the picker again cancels the one already open.
- A bad config, a missing program, or a remote terminal shows an error notification.

Config is `<app home>/file-picker.json`, read on every open. Unknown keys are errors.

- `query` (string, default `""`); `header` (boolean, default `true`).
- `picker.width`, `picker.height` (default `0.75`, `0.65`).
- `actions`: fzf key name → action; `enter` is required. Key names match `^[a-z0-9-]+$`.
  - `argv`: nonempty string array; `{file}` must appear in an argument after the first, never in `argv[0]`.
  - `label`: single-line string, default `argv[0]`.
  - `destination`: `right` (default), `down`, or `popup`.
  - `size` (splits only, ≥ 1 logical pixel) or `width`/`height` (popups only, default `0.6`/`0.5`).
- All dimensions must be positive. A value up to and including 1 is a fraction of the window; anything larger is pixels.

## Built from

- `mods/file-picker/mod.json`: `{"place": "none", "overlay": {"width": 240, "height": 64}}`.
- `main.js`, one view with two roles chosen by `props()`:
  - `props().overlay` (launcher): runs the flow below, then closes its own overlay. Its 240×64 overlay sits behind the picker dialog, so in practice it isn't seen. `close()` kills a running fzf terminal and deletes the result file.
  - `props().cleanupTerminal` (guard): an empty 1px block placed in each terminal dialog. Its `close()` kills that terminal when the dialog is dismissed.
- `picker.js`: config validation, fzf output parsing, and command building. It doesn't import `herdr`, so `node --test` can run it.
- `herdr` functions: `focused`, `spaces`, `appHome`, `readTextFile`, `exec`, `openOverlay`, `closeOverlay`, `props`, `notify`.
- Flow:
  1. `focused()` gives the pane and cwd. Fail if there's none or if the space has a `machine` (remote).
  2. Read and validate the config. Check `fzf` and each `argv[0]` with `command -v` in the cwd.
  3. `umask 077; mkdir -p <app home>/data/file-picker && mktemp .../selection.XXXXXXXXXX` for the result file.
  4. `hc run --bg --json --no-parent --no-notify --cwd <cwd> -- /bin/sh -c 'exec fzf --no-multi --no-print-query --print0 --query "$query" "$@" > "$result"'`, plus `--expect=<non-enter keys>` and `--header <labels>`.
  5. `openOverlay({kind: "dialog", width, height, layout})`, where layout is a column with `{terminal}` and the 1px guard block.
  6. Repeat `hc wait <terminal> --timeout 20` until `ended`, then `hc rm` it. Stop if it ended by a signal.
  7. Read and delete the result file. Exit code 1 or 130 means cancel. Parse `key\0path\0` (an empty key means Enter), or `path\0` when only `enter` is configured.
  8. Run `/bin/sh -c 'cd "$1" && shift && exec "$@"' <cwd> <argv>` with `{file}` replaced in each argument:
     - popup: `hc run --bg --json --no-parent --no-notify --cwd <cwd>`, then a dialog as in step 5.
     - split: `herdr-app do pane.split {pane, direction, argv}`, then `herdr-app do layout.resize {id, px}` if `size` is set.
- Programs: `/bin/sh`, `mktemp`, `fzf`, `hc`, `herdr-app`, and the configured commands.
- `keys.json`: `{"global": {"cmd-o": "mod.open:file-picker"}}`.

## Watch out

- `exec` times out after 30 seconds. Wait for fzf with repeated `hc wait --timeout 20`, not one long call.
- `hc kill` exits 3 or 11 when the terminal is already gone; treat both as success.
- With `--expect`, fzf prints a key line even for Enter (as an empty line). `fzf --filter` never prints it, so `--filter` tests only cover enter-only configs.
- Pass the path as its own argument and never splice it into shell text. Paths can contain spaces, quotes, `$`, Unicode, and newlines.
- `--expect`, `--print-query`, or `--multi` in `FZF_DEFAULT_OPTS` change the output. Reject output that doesn't match the expected shape; don't guess.
- Action keys override fzf bindings on the same key, and the header replaces any `--header` from the person's options. Plain-letter keys can't be typed into the search.
- Pagers that quit on short output (`less -F`) close their split or popup at once.
- Local terminals only.

## Done when

- Cmd+O over a local terminal opens fzf in a centered dialog.
- The header lists every key and label, and disappears with `"header": false`.
- Enter and each other configured key run their own command on the selected file, in the original directory.
- A file named `quote' ;$(touch x) 雪.txt` arrives unchanged, and no `x` is created.
- Right splits, lower splits, and popups use the configured sizes.
- Exiting the command closes its split or popup.
- Escape runs nothing. Dismissing the picker or a result popup stops its process and leaves no result file behind.
- A bad config, a missing program, or a remote terminal shows an error notification.
