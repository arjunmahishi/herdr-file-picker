# Herdr file picker

Open fzf over your Herdr workspace, select a file, and run your preferred command with that path in a new split or popup. This is for people who want to use their existing fzf setup from a local terminal. It selects one file at a time and does not reuse an existing editor window.

![Herdr file picker](preview.png)

## What you see

A centered fzf popup using your terminal appearance and fzf settings. By default, it takes 75% of the window width and 65% of its height.

The selected file opens with your configured command in a right split, a lower split, or another popup. Handler popups default to 60% of the window width and 50% of its height.

## How it behaves

- Open it with `mod.open:file-picker`. The example keybinding is Cmd+O.
- Start in the focused local terminal's directory, with an optional initial search query.
- Let fzf control file discovery, filtering, ordering, and previews.
- On selection, close the picker and run the configured command with the selected path.
- Use the original directory and source pane even if focus changes.
- Close the command's split or popup when the command exits.
- Escape cancels the picker. Dismissing a popup stops its command.
- Opening another picker cancels the existing one.

## Configuration

Read `file-picker.json` from the Herdr home each time the picker opens. Let the user choose:

- The initial search query and picker popup dimensions.
- A command argument array containing `{file}` for the selected path.
- A right split, lower split, or popup for the command.
- An optional split size in logical pixels, or popup width and height.

Preserve spaces, quotes, Unicode, and line breaks in the selected path. Treat the path as an argument, not shell script text.

See [README.md](README.md) for installation, configuration defaults, and examples.

## Limits

- Local terminals only; macOS and Linux are the supported targets.
- Desktop integration has been tested on macOS, not Linux.
- One selected file per invocation. fzf options or bindings that print extra output are not supported.
- A command that exits immediately does not leave a persistent pane.
- Available window space may constrain split sizes.

## Acceptance checks

- The picker opens over the workspace without creating a split.
- Selecting a file opens the chosen command in the original directory.
- Filenames with whitespace and shell punctuation arrive unchanged.
- Right splits, lower splits, and popups use the configured dimensions within window constraints.
- Exiting the command closes its split or popup.
- Escape opens no command; dismissing a popup stops its command.
- Invalid configuration and missing executables produce error notifications.
