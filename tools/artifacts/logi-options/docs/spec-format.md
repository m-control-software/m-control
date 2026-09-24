# Spec format — `*.logi.json` v1

The authoring reference. A spec names buttons and actions; it never contains
Logitech slot ids, card bodies, UUIDs, paths of this machine, or anything else
from Options+ internals. The tool compiles specs into what the Options+ UI would
have written, byte for byte ([internals.md](internals.md#how-the-ui-builds-a-card)).

## File

```json
{
  "specVersion": 1,
  "pack": "personal",
  "device": "mx-master-4",
  "description": "optional free text",
  "profiles": [
    {
      "application": { "executable": "rider64.exe", "name": "Rider" },
      "description": "optional: why these bindings, which keymap they assume",
      "buttons": {
        "back":    { "shortcut": "ALT+LEFT" },
        "forward": { "shortcut": "ALT+RIGHT" },
        "thumb":   { "gestures": { "left": { "shortcut": "CTRL+PAGEUP" }, "right": { "shortcut": "CTRL+PAGEDOWN" } } }
      }
    }
  ]
}
```

- **File name:** `<anything>.logi.json`, in a pack directory (see [Where specs live](#where-specs-live)).
- **`pack`:** a kebab-case id, used in error messages. One pack can span several files.
- **`device`:** `mx-master-4`, the only device in v1. Another model is one entry
  in `lib/catalog.py` `DEVICES`; see [maintenance.md](maintenance.md#adding-a-device).
- **Unknown fields are errors.** This is deliberate: it catches typos and invented fields.

## `application` — exactly one of

| Form | Meaning | Identity on another machine |
|---|---|---|
| `{"global": true}` | the Global profile ("All applications") | Logitech constant |
| `{"builtin": "google-chrome"}` | an app Options+ knows natively (22 of them, e.g. `microsoft-excel`, `microsoft-teams-new`, `zoom`) | Logitech constant |
| `{"executable": "rider64.exe", "name": "Rider", "searchPaths": ["%LOCALAPPDATA%\\Programs\\Rider\\bin"]}` | any other app | matched by **file name**; the path is found on each machine |

- `executable` is a **file name**, never a path. `searchPaths` are hints that may
  use environment variables. The tool also searches PATH, Program Files,
  `%LOCALAPPDATA%\Programs`, and the JetBrains Toolbox apps folder.
- `name` is the label shown in Options+ (custom apps only).
- The list of built-ins comes from `mctl run logi-options mode=presets` (`builtinApps`).

## `buttons` — MX Master 4

| Button | Where it is | Default action | Aliases |
|---|---|---|---|
| `middle` | scroll-wheel click | middle click | `wheel`, `middle-button` |
| `top` | small button behind the scroll wheel | SmartShift: toggle ratchet / free-spin (`mode-shift`) | `mode-shift` |
| `back` | lower thumb button | back | |
| `forward` | upper thumb button | forward | |
| `thumb` | large thumb button under the thumb rest, which **is the gesture button** | gestures: `virtual-desktops` | `gesture`, `gesture-button` |
| `haptic-panel` | pressure-sensitive area at the thumb (the haptic sense panel) | show the Actions Ring (`show-radial-menu`) | `sense-panel`, `actions-ring` |
| `thumb-wheel` | horizontal wheel at the thumb | horizontal scroll (Chrome: tab navigation) | `thumbwheel` |

Only the buttons you list are written. Every other slot of an existing profile
stays byte-identical. A new profile starts from Logitech's defaults (the column
above, adjusted per built-in app). It is **not** a copy of your Global profile.

## Actions — exactly one form per button

| Form | Example | Notes |
|---|---|---|
| `shortcut` | `{"shortcut": "CTRL+SHIFT+A"}` | see [Shortcut grammar](#shortcut-grammar) |
| `preset` | `{"preset": "back"}` | one of Logitech's ~268 actions by name: `task-view`, `hide-show-desktop`, `copy`, `volume-up`, `media-play-pause`, `screen-capture`, `horizontal-scroll`, `tab-navigation`, `zoom-in-out`, `mode-shift`, `show-radial-menu`, `middle-button`, … Full list: `mctl run logi-options mode=presets` |
| `card` | `{"card": "card_photoshop_brushSize"}` | any Logitech catalog card by id; for app-specific actions that have no preset alias |
| `nothing` | `{"nothing": true}` | the button does nothing |
| `raw` | `{"raw": { …Logitech card… }}` | verbatim internal card. It's the lossless escape hatch export falls back to, not something to write by hand, and not portable across Options+ versions |
| `gestures` | see below | **`thumb` only** |

### Gestures (thumb button)

Hold the thumb button and move the mouse:

```json
"thumb": { "gestures": "media-control" }
```
Presets: `virtual-desktops` (default), `media-control`, `window-management`,
`application-navigation`, `zoom-rotate`, `pan`, `arrange-windows`.

```json
"thumb": { "gestures": {
  "left":  { "shortcut": "CTRL+SHIFT+TAB" },
  "right": { "shortcut": "CTRL+TAB" },
  "click": { "preset": "task-view" }
} }
```
Custom gestures: directions `up`, `down`, `left`, `right`, `click` (a press without
moving). Each takes any action except `gestures`. **An unlisted direction does
nothing.** The gesture set is declarative as a whole.

A `thumb` entry is either a single action **or** `gestures`, never both. That is
physics, not a tool limitation: the MX Master 4 has one thumb button.

### Shortcut grammar

`MOD+MOD+KEY`, case-insensitive, `+`-separated, key last.

- **Modifiers:** `CTRL SHIFT ALT WIN` (left) and `RCTRL RSHIFT RALT RWIN`.
  Aliases: `CONTROL`, `META`/`SUPER`/`CMD` → `WIN`, `ALTGR` → `RALT`.
- **Keys:** `A`–`Z`, `0`–`9`, `F1`–`F24`, `ESC`, `TAB`, `ENTER`, `SPACE`, `BACKSPACE`, `DELETE`,
  `INSERT`, `HOME`, `END`, `PAGEUP`, `PAGEDOWN`, `LEFT`, `RIGHT`, `UP`, `DOWN`, `MINUS`, `EQUAL`,
  `LBRACKET`, `RBRACKET`, `BACKSLASH`, `SEMICOLON`, `QUOTE`, `GRAVE`, `COMMA`, `PERIOD`, `SLASH`,
  `CAPSLOCK`, `PRINTSCREEN`, `SCROLLLOCK`, `PAUSE`, `NUMLOCK`, `NUMPAD0`–`NUMPAD9`, `NUMPADPLUS`,
  `NUMPADMINUS`, `NUMPADMULTIPLY`, `NUMPADDIVIDE`, `NUMPADDECIMAL`, `NUMPADENTER`.
  Symbol aliases: `-` `=` `[` `]` `\` `;` `'` `` ` `` `,` `.` `/`.
- The `+` key is `SHIFT+EQUAL`. A modifier alone (`"ALT"`) is allowed: it is held for as long as the button is held.
- Keys are sent as USB HID usages, i.e. physical positions. On a non-US layout,
  `SLASH` is the key where US `/` sits.

## Choosing the shortcuts (read this before writing a profile)

A binding is only right if the application really does what you expect on
that shortcut. **Look it up rather than recalling it:**

| App | Where its real key bindings are |
|---|---|
| JetBrains IDEs (Rider, WebStorm, IntelliJ, PyCharm) | `%APPDATA%\JetBrains\<Product><version>\options\keymap.xml` names the active keymap (absent = the product default); custom keymaps are `...\keymaps\*.xml` and list only the differences from their parent |
| VS Code | `%APPDATA%\Code\User\keybindings.json` (overrides only) on top of the defaults |
| Browsers, Office, Teams | vendor shortcut lists; Options+ also ships app-specific actions (`card:` ids for `builtin` apps, see `mode=presets`) |

If the binding can't be determined, say so in the profile's `description`
instead of guessing. [`../examples/rider.logi.json`](../examples/rider.logi.json)
shows the pattern.

## Where specs live

Packs are discovered in:
- the tool's own `specs/` folder (empty on purpose: shipping a mouse layout would apply it to anyone), and
- every directory in `tools.logi-options.packDirs` (`~/.m-control/config.json`),
  including one level of subfolders, so `packDirs` can be a root holding several
  packs.

**Personal and client-specific specs never go into the m-control repo** (ADR-0009).
When several packs contribute to the same profile, their buttons merge. The same
button set in two places is an error that names both files.

## Workflow

```powershell
mctl run logi-options mode=presets     # vocabulary: buttons, presets, gesture presets, keys, built-in apps
mctl run logi-options check=true       # validate every pack, report drift, show the planned change; writes nothing
mctl run logi-options                  # apply: backup -> stop agent -> patch -> start -> verify (~15 s; mouse on defaults meanwhile)
mctl run logi-options mode=export app=rider64.exe out=C:/path/to/pack/rider.logi.json   # adopt a change made in the UI
```

Sync is **one-way, spec → device**. A change made in the Options+ UI shows up as
drift in `check=true` and is overwritten by the next apply, unless you export it
into the pack first.

## What v1 cannot express

- Device settings: pointer speed, SmartShift sensitivity, scroll direction,
  haptic strength. These live only in the Global profile and are left untouched.
- The Actions Ring's own contents, macros, and Smart Actions authoring
  (existing ones survive as `card`/`raw`).
- Other devices (keyboards, other mice), and macOS.
