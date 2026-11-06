# Herdr file picker

Run your own fzf configuration in a Herdr popup. Select a file to run a command with that path in a new split or popup. Exiting the command closes its surface; canceling the picker opens nothing.

No editor integration, file discovery, sorting, or ignore rules are implemented by this mod. fzf and its environment decide those things.

## Requirements

- Herdr App 0.1.13 and its `hc` command
- Python 3.8 or newer
- fzf (tested with 0.43.0)
- The command you configure as the handler

Local terminals only. Tested on macOS; other platforms are not certified.

## Install locally

From this repository, with Herdr already installed:

```sh
ln -s "$PWD/mods/file-picker" "$HOME/.config/herdr-app/mods/file-picker"
cp config.example.json "$HOME/.config/herdr-app/file-picker.json"
herdr-app check "$HOME/.config/herdr-app/mods/file-picker"
```

Do not overwrite an existing mod or config. Change the example's handler to your preferred command. Config can itself be a symlink to your dotfiles.

Merge the example `keys.json` binding into your existing Herdr keys; do not replace the whole file:

```json
{"global": {"cmd-o": "mod.open:file-picker"}}
```

Or open it without a binding:

```sh
herdr-app do mod.open --name file-picker
```

## Configure

Herdr reads `~/.config/herdr-app/file-picker.json` on each invocation (`$HERDR_APP_HOME/file-picker.json` for a custom home).

```json
{
  "query": "",
  "picker": { "width": 0.75, "height": 0.65 },
  "handler": {
    "argv": ["nvim", "--", "{file}"],
    "destination": "right",
    "size": 700
  }
}
```

- `query`: initial fzf query. Empty by default. This does not set candidate ordering.
- `picker.width` / `height`: pixels, or window fractions from 0 to 1. Defaults: 0.75 and 0.65.
- `handler.argv`: required command argument array. `{file}` is replaced literally in arguments, never evaluated as shell code. Include your command's end-of-options marker if it supports one.
- `handler.destination`: `right` (default), `down`, or `popup`.
- `handler.size`: optional split width (`right`) or height (`down`), in logical pixels. Omit it for Herdr's native split sizing. The window and sibling panes may constrain the requested size.
- For `popup`, use `handler.width` / `height` instead of `size`; defaults are 0.6 and 0.5. These accept pixels or window fractions, like the picker dimensions.

Both fzf and the handler run in the directory captured from the focused terminal when the picker opens. Selection targets that original pane even if focus changes. Config changes apply the next time you open the picker.

### A diff viewer instead of an editor

For example, to view one file's diff with a pager:

```json
{
  "handler": {
    "argv": ["sh", "-c", "git diff --color=always -- \"$1\" | less -R", "file-diff", "{file}"],
    "destination": "popup",
    "width": 0.8,
    "height": 0.8
  }
}
```

The file is a positional shell argument, not interpolated into the script. The handler must remain running while you want its pane visible. A command that exits immediately produces no persistent pane.

### fzf configuration

Your `FZF_DEFAULT_COMMAND` and `FZF_DEFAULT_OPTS` remain in effect. Configure candidate generation, ignores, hidden files, previews, and ordering there. This mod does not provide a newest-first command.

The mod reserves single selection and NUL-delimited output. Avoid options/bindings that change the output protocol, such as `--expect`, multiple selections, or actions that print extra output.

## Lifecycle and limitations

- Escape cancels fzf normally. Closing a terminal popup externally kills its command through a cleanup hook.
- Picker results use private, per-invocation files under Herdr's `data/file-picker/`, removed after completion or normal cancellation.
- Cleanup is best effort on application quit; a forced termination may leave a terminal or result file. Herdr limits mod cleanup time.
- Run one picker at a time. Opening another via the binding while one is active cancels the existing invocation.
- This mod runs local programs and reads its config and selection results. It does not make network requests. Your configured fzf commands and handler may do more.

## Tests

```sh
python3 -m unittest discover -s tests -v
herdr-app check mods/file-picker
```

Tests run the actual fzf binary for matching, cancellation, and protocol errors. No Python packages are required.
