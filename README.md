# Herdr file picker

Pick a file with fzf without leaving Herdr, then open it in an editor or another command in a new split or popup. Bind different commands to different keys, such as Enter to edit and Ctrl+D to view a diff.

Use this if you already use fzf and want a shortcut to open files from your current terminal directory. It uses your fzf configuration. It supports local terminals and one selected file at a time.

![Herdr file picker](preview.png)

## Requirements

- Herdr App with `hc` and `herdr-app` available
- macOS or Linux with `/bin/sh`, `mktemp`, and fzf
- An installed command to open the selected file; the example uses Neovim

Tested with Herdr App 0.1.13 and fzf 0.43.0 on macOS. Shell and fzf tests also passed on Linux; Linux desktop integration has not been tested.

## Install

Run from this repository. These commands use Herdr's configured home, or `~/.config/herdr-app` by default. If `mods/file-picker` already exists there, skip the link command; do not install over it.

```sh
herdr_home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
mkdir -p "$herdr_home/mods"
ln -s "$PWD/mods/file-picker" "$herdr_home/mods/file-picker"
cp -i config.example.json "$herdr_home/file-picker.json"
```

If prompted to overwrite your config, answer `n` to keep it.

Edit `file-picker.json` in that directory to choose your commands. Merge this binding into Herdr's existing `keys.json`; do not replace the whole file:

```json
{"global": {"cmd-o": "mod.open:file-picker"}}
```

Press **Cmd+O** with a local terminal focused. You can also open the picker with:

```sh
herdr-app do mod.open --name file-picker
```

## Configure

Configuration is read each time the picker opens.

```json
{
  "query": "",
  "header": true,
  "picker": { "width": 0.75, "height": 0.65 },
  "actions": {
    "enter": {
      "argv": ["nvim", "--", "{file}"],
      "label": "edit",
      "destination": "right"
    },
    "ctrl-d": {
      "argv": ["git", "diff", "--", "{file}"],
      "label": "diff",
      "destination": "popup"
    }
  }
}
```

`actions` maps fzf key names to commands. An `enter` action is required. Press an action's key in fzf to open the highlighted file with that action. Key names follow fzf's `--expect` option, such as `ctrl-d`, `alt-x`, or `f2`; see `man fzf` for the full list. Action keys replace any fzf binding for the same key.

By default, the picker shows a header listing each key and its label, such as `enter: edit  ·  ctrl-d: diff`. Set `"header": false` to hide it.

Each action's `argv` is required. Put `{file}` in an argument where the selected path should go, not in the command name. Each array item is a separate argument. Include `--` before the path if your command supports it, so filenames beginning with `-` are not treated as options.

| Setting | Meaning | Default |
| --- | --- | --- |
| `query` | Initial fzf search text | Empty |
| `header` | Show action keys and labels above the list | `true` |
| `picker.width`, `picker.height` | Picker popup dimensions | `0.75`, `0.65` |
| `label` | Action name shown in the header | The command name, `argv[0]` |
| `destination` | `right`, `down`, or `popup` | `right` |
| `size` | Split width (`right`) or height (`down`), in logical pixels; at least `1` | Herdr's default |
| `width`, `height` | Action popup dimensions; use instead of `size` for `popup` | `0.6`, `0.5` |

Popup dimensions must be positive: values up to and including `1` are fractions of the window; larger values are pixels. Available window space may constrain split sizes.

Both fzf and your command use the directory captured when the picker opens. Splits target the original pane even if focus changes. Exiting the command closes its split or popup. Escape cancels the picker without opening anything; dismissing a popup stops its command.

## Examples

Each example is a complete `file-picker.json` with a single `enter` action. To combine them, give each action its own key under `actions`. Install the commands an example uses first. Run Git examples from a Git repository.

### Edit in a Neovim popup

```json
{
  "actions": {
    "enter": {
      "argv": ["nvim", "--", "{file}"],
      "destination": "popup",
      "width": 0.9,
      "height": 0.85
    }
  }
}
```

### Read a file with less

Open a read-only viewer in a right split. Press `q` to close it.

```json
{
  "actions": {
    "enter": {
      "argv": ["less", "--", "{file}"],
      "destination": "right",
      "size": 700
    }
  }
}
```

### View a file's Git diff

Show unstaged changes with Git and less.

```json
{
  "actions": {
    "enter": {
      "argv": ["sh", "-c", "git diff --color=always -- \"$1\" | less -R", "file-diff", "{file}"],
      "destination": "popup",
      "width": 0.8,
      "height": 0.8
    }
  }
}
```

Pass `{file}` as a separate shell argument, as above. Do not insert it into shell script text.

### Review changes with Hunk

Show the selected file's working-tree diff.

```json
{
  "actions": {
    "enter": {
      "argv": ["hunk", "diff", "--", "{file}"],
      "destination": "popup",
      "width": 0.95,
      "height": 0.9
    }
  }
}
```

For staged Git changes, replace `argv` with `["hunk", "diff", "--staged", "--", "{file}"]`.

### Inspect the last commit with Hunk

Show what the last commit changed in the selected file.

```json
{
  "actions": {
    "enter": {
      "argv": ["hunk", "show", "--", "{file}"],
      "destination": "popup",
      "width": 0.95,
      "height": 0.9
    }
  }
}
```

### Browse a file's Git history

Show commits and patches, following renames. Git uses your configured pager.

```json
{
  "actions": {
    "enter": {
      "argv": ["git", "log", "--follow", "-p", "--", "{file}"],
      "destination": "popup",
      "width": 0.9,
      "height": 0.85
    }
  }
}
```

## Your fzf settings

Use `FZF_DEFAULT_COMMAND` and `FZF_DEFAULT_OPTS` to configure file discovery, previews, filtering, and ordering.

The picker requires one selected path and sets fzf's `--expect` from your actions. Do not set `--expect` or `--print-query` yourself, and avoid multiple selections and bindings that print extra output. When `header` is `true`, it replaces any `--header` from your fzf options. Opening another picker cancels the existing one.
