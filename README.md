# Morpheus Script VSCode Extension

VSCode extension for the Morpheus scripting language used in Medal of Honor: Allied Assault (MOHAA).

## Features

- **Syntax Highlighting**: Complete support for `.scr` files including keywords, vectors, and dynamic entities.
- **Autocomplete**: Context-aware suggestions for standard commands and game-specific events.
- **Validation**: Basic syntax checking.
- **Hover Documentation**: View command documentation by hovering over commands.

## Screenshots

![Syntax Highlighting](screenshots/screen1.png)

## Configuration

The extension provides several settings to customize your Morpheus scripting experience. Access these via **File > Preferences > Settings** (or `Ctrl+,`) and search for "Morpheus".

### Available Settings

#### `morpheus.validation.enable`

- **Type**: `boolean`
- **Default**: `true`
- **Description**: Enable or disable syntax validation for Morpheus scripts. When enabled, the validator checks for bracket/paren balance, unclosed strings, assignment-in-condition warnings, unknown commands, and thread label references.

#### `morpheus.formatting.enable`

- **Type**: `boolean`
- **Default**: `true`
- **Description**: Enable or disable automatic code formatting. The formatter normalizes indentation for labels, braces, control flow blocks, and case statements.

#### `morpheus.validation.sexecPath`

- **Type**: `string`
- **Default**: `""` (empty)
- **Description**: Path to the `mfuse_exec` (or `sexec`) executable for advanced external validation. If provided, the extension can invoke this tool to perform additional runtime checks beyond built-in diagnostics.

#### `morpheus.validation.trigger`

- **Type**: `string`
- **Allowed Values**: `"onSave"`, `"onChange"`, `"disabled"`
- **Default**: `"onSave"`
- **Description**: Control when external validation runs:
  - `onSave`: Run validation when you save the file
  - `onChange`: Run validation on every edit (may impact performance for large files)
  - `disabled`: Never run external validation

#### `morpheus.paths.commandsJson`

- **Type**: `string`
- **Default**: `""` (empty)
- **Description**: Custom path to a `commands.json` file. If empty, the extension uses the bundled command database. Use this to override with project-specific or extended command definitions.

#### `morpheus.paths.commandsTxt`

- **Type**: `string`
- **Default**: `""` (empty)
- **Description**: Custom path to a `commands.txt` file. If provided, the extension can parse this simpler format for command references (typically used during development or scraping workflows).

#### `morpheus.trace.server`

- **Type**: `string`
- **Allowed Values**: `"off"`, `"messages"`, `"verbose"`
- **Default**: `"off"`
- **Description**: Trace the communication between VS Code and the Morpheus language server for debugging:
  - `off`: No tracing
  - `messages`: Log protocol messages
  - `verbose`: Log detailed protocol and internal server activity

### Example Configuration

To customize settings, open your `settings.json` (Ctrl+Shift+P → "Preferences: Open Settings (JSON)") and add:

```json
{
  "morpheus.validation.enable": true,
  "morpheus.formatting.enable": true,
  "morpheus.validation.trigger": "onSave",
  "morpheus.validation.sexecPath": "/usr/local/bin/sexec",
  "morpheus.paths.commandsJson": "${workspaceFolder}/custom-commands.json",
  "morpheus.trace.server": "off"
}
```

## Quick Start

- Install the extension (VSIX or marketplace) and open any `.scr` file.
- Hover a command to see docs; press `Ctrl+Space` for suggestions.
- Use the formatter (Format Document) to normalize indentation and blocks.

---

## Tooling: morfuse and sexec

This extension works best alongside two external tools commonly used in MOHAA scripting workflows: `morfuse` and `sexec`.

### morfuse

`morfuse` is a CLI helper for working with Morpheus scripts (searching, linting, transforming). It’s maintained separately.

- Source/Home: see the `morfuse_repo` project (external git submodule or separate clone)
- Build: typically a standard C/C++ build or script-based build depending on the repo you use
- Requirements: compiler toolchain (e.g., gcc/clang) and any dependencies listed in that repo

Build example (generic):

```bash
git clone <morfuse-repo-url>
cd morfuse
make # or cmake .. && make, or npm/yarn if JS-based
```

After building, ensure the binary is discoverable by your shell and tools:

```bash
export PATH="/path/to/morfuse/bin:$PATH"
```

### sexec

`sexec` is a script execution helper/runner used to test-drive Morpheus commands or batch operations.

- Source/Home: see the `sexec` project (external git submodule or separate clone)
- Build: follow the instructions in that repo (commonly `make`/`cmake` or equivalent)

Build example (generic):

```bash
git clone <sexec-repo-url>
cd sexec
make
export PATH="/path/to/sexec/bin:$PATH"
```

Tip: You can place both tools into a common `~/tools/moh/` directory and add that directory to your `PATH` once:

```bash
mkdir -p ~/tools/moh
cp /path/to/morfuse/bin/morfuse ~/tools/moh/
cp /path/to/sexec/bin/sexec   ~/tools/moh/
export PATH="$HOME/tools/moh:$PATH"
```

---

## Commands Data: `commands.json` vs `commands.txt`

The extension ships with `commands.json`, which powers hover documentation and autocomplete. You can also work with a simpler `commands.txt` format during authoring or scraping.

### `commands.json` (structured, used by the extension)

This is a machine-readable, rich format consumed by the language server at runtime. Each top-level key is the command name. Values include metadata used for docs and validation.

Minimal example:

```json
{
  "iprintln": {
    "event_var": "EV_PrintLn",
    "file": "Entities.cpp",
    "args": ["string"],
    "doc": "Prints text to player HUD"
  },
  "spawn": {
    "event_var": "EV_Spawn",
    "file": "script.cpp",
    "args": ["classname", "origin?", "angles?"],
    "doc": "Spawns an entity"
  }
}
```

Notes:

- The language server attempts to load `commands.json` from the extension root; it is included in the packaged VSIX.
- Fields:
  - `event_var`: engine/event identifier (for reference)
  - `file`: source component where implemented (for traceability)
  - `args`: ordered argument types or names (for future signature help)
  - `doc`: human-readable documentation shown in hover

### `commands.txt` (authoring/scraping, plain text)

This is a human-friendly format useful when building or scraping command lists before converting them to JSON.

Typical layout:

```text
CommandName  ; short doc or category
  arg1       ; arg description
  arg2?      ; optional arg

AnotherCommand
  paramA
  paramB?
```

Usage workflow:

- Maintain `commands.txt` while researching or scraping engine headers.
- Convert to `commands.json` with a simple script (Python/Node) that maps lines to structured JSON entries.
- Check the JSON with a linter (e.g., `jq`, `eslint` for JSON files via plugins) before packaging.

---

## File Formatting & Conventions

The extension includes a formatter that normalizes common Morpheus patterns:

- **Blocks & Labels**: Lines ending with `:` are treated as labels and start a new logical block. Subsequent lines indent accordingly.
- **Braces `{}`**: Standard brace indentation is applied; closing braces dedent.
- **Control Flow**: `if`, `while`, `for`, `else` are treated as control statements and may induce temporary indentation on single-line bodies.
- **Case/Default**: Within `switch` blocks, `case value:` and `default:` align to the block depth for readability.
- **Arrays/Vectors**: Square brackets `[]` for arrays and whitespace-separated vector literals (e.g., `( 0 0 -30 )`) are preserved; spacing is left minimal to avoid altering semantics.
- **Comments**: Line comments `//` are kept in place; block comments `/* ... */` are preserved and excluded from diagnostics.

Best practices:

- Keep labels on their own line: `my_label:`
- Avoid trailing code after a label definition.
- Use consistent casing for keywords (engine is often case-insensitive, but consistency helps readability).
- Prefer explicit braces for multi-line control statements.

---

## Diagnostics & Validation

The validator provides helpful checks without being intrusive:

- **Bracket/Paren/Square Balance**: Detects unbalanced `{}`, `()`, `[]` across the file.
- **Unclosed Strings**: Warns on lines with an odd number of quotes.
- **Assignment-in-Condition**: Warns if a single `=` appears within `if`/`while` conditions (suggesting `==`).
- **Unknown Command/Keyword**: Flags the first token on a line if it’s neither a known command nor keyword (skips labels and member access).
- **Thread Labels**: Warns when `thread/waitthread/exec` target labels are not defined in the current file (but allows external `script::label`).

You can toggle validation in VS Code Settings:

- `morpheus.validation.enable`: `true` by default.
- `morpheus.formatting.enable`: `true` by default.

---

## Troubleshooting

If hover docs or autocomplete don’t appear:

- Ensure the file language mode is set to **Morpheus** (click the status bar language and select Morpheus).
- Check the Output panel → **Morpheus Language Server** for logs.
- Verify the extension installed includes `commands.json` and dependencies (`vscode-languageclient`, `vscode-languageserver`).
- On Linux, confirm your VS Code Insiders path differences don’t block module resolution.

---

## Contributing

- Submit improvements to `commands.json` (better docs, args) and grammar in `syntaxes/morpheus.tmLanguage.json`.
- Share scripts for converting `commands.txt` to JSON in `tools/`.
- PRs welcome for validator rules and formatter refinements.
