# ADM — Advanced Download Manager

A multi-channel desktop download manager with deep browser integration.
**Rust + Tauri 2** backend, **SolidJS** frontend.

ADM is the Rust/Tauri counterpart of the WPF (.NET 10) edition. Both the
UI and the engine behaviour were ported one-to-one from the macOS
**MC Download Manager** (Swift/SwiftUI) application. Along the way the
layout was rebuilt around MC's structure — sidebar, table, status bar and
a per-file detail window — and the port picked up several fixes the WPF
version never had.

- **Platforms** — Windows 10/11 is the primary target. The release
  workflow also produces Linux (`.deb`, AppImage) and macOS (`.dmg`)
  installers; the browser extension additionally ships an experimental
  unsigned Safari build.
- **Languages** — the UI, logs and error messages are available in
  Turkish and English. Source comments are written in Turkish.

---

## Features

### Download engine

- **Multi-channel downloads** — 1–32 channels, at least 1 MB per channel
- **Per-channel resume** — channel bounds are persisted on pause and each
  channel continues from the exact byte it stopped at
- **Work stealing** — a finished channel takes over half the remaining
  work of the channel with the most left
- **Adaptive throttling** — when the server answers `408 / 425 / 429 /
  500 / 502 / 503 / 504` the open channel count drops by one and climbs
  back on success (MC's `throttle` / `activeLimit`); the backoff curve is
  `min(15, 1.5 × attempt)` seconds, at most 12 attempts per channel
- **`200` → single stream** — if a `Range` request answers `200` instead
  of `206`, the download falls back to a single stream so the file is
  never corrupted
- **Queue** — once `max_concurrent` is reached new downloads stay
  `Queued`; the queue pumps itself when a download finishes

### Browser integration

- **Browser extension** (Chrome / Edge / Brave / Firefox) — captures
  downloads, sniffs page media, shows progress on the badge, offers
  context menus and cookie hand-off
- **Local bridge** — an HTTP server on `127.0.0.1:<port>` that only
  accepts extension-originated requests (`/ping`, `/downloads`,
  `/download`, `/action`); `Host` validation and CORS scope mirror MC
- **Setup wizard** — step-by-step guidance per browser; extension files
  are copied under `%LocalAppData%\ADM\Browser Plugins\<Browser>`
- **Clipboard watcher** — asks about links copied to the clipboard
  (video / file / ignore); on video pages the "video" option is offered
  first

### Video (yt-dlp)

- **yt-dlp / ffmpeg / deno** are downloaded from GitHub at runtime and
  installed under `%LocalAppData%\ADM\tools`; deno is verified against
  its published SHA-256
- **Site login** — an in-app login window (Tauri + WebView2) exports
  cookies in Netscape format and hands them to yt-dlp
- **Format pickers** — container (mp4 / webm / mkv / keep original),
  maximum height, custom `-f` expression; the effective arguments are
  previewed live in Settings
- **Stage tracking** — `MCFMT|` / `Destination:` / `[Merger]` /
  `[ExtractAudio]` lines are translated into human-readable stage text;
  the last ~6000 characters of the log are kept

### Interface

- **MC layout** — title bar (☰ menu button · language · settings · window
  buttons), table, status bar, per-file detail window
- **Left menu** — overlay panel toggled from the title bar: Actions
  (add download, paste from clipboard, select all, start queue, stop all,
  cancel all, clear finished), task filters, 7 categories, Finished /
  Unfinished, tools (sort + search) and settings / browser / about
- **Table columns** — Name (category icon + sub-label) · Size · Status
  (% + stage text + segment bar) · Speed · Remaining · Added
- **Detail window** — info grid, progress, connection table
  (N. / Downloaded / Start / Info), yt-dlp log for video downloads, and a
  finished view (Open / Show in Folder)
- **Tabbed settings** — General · File Types · Browsers · Video ·
  Interface
- **Bulk actions** — pause / resume / cancel / clear finished
- **Multi-selection** — Ctrl/Shift row selection, right-click context
  menu, double-click to open the file
- **Live updates** — events every 500 ms; speed, time remaining and
  channel distribution
- **Turkish / English** — UI, logs and error messages
  (`src/lib/i18n/`, `src-tauri/src/i18n.rs`); status enums stay English
  in the database and are translated on read
- **Tray icon** — Show / Hide · Pause All / Resume All · Quit; with
  "close to tray" enabled the window hides instead of closing
- **Persistent history** — SQLite (`%LocalAppData%\ADM\downloads.db`,
  WAL)
- **Graceful shutdown** — active downloads are cancelled on exit and
  channel states are saved

> **Settings not wired up yet.** `notify_on_complete` (completion
> notification), `show_detail_on_start` (open the detail window when a
> download starts), `autostart` (run at Windows sign-in) and
> `start_in_tray` (start hidden) are stored in the database and visible
> in the UI, but their behaviour is not implemented yet.

## Requirements

- Rust 1.98+ (edition 2024)
- Node.js 20+ (the release workflow uses 24)
- Windows 10/11 + WebView2 (bundled with Windows 11)

## Getting started

```bash
npm install
npm run tauri:dev      # run the app
npm run tauri:build    # produce installers (NSIS / MSI on Windows)
```

> **First clone:** the extension build directory is generated, not
> committed. Run `npm run extension:build` once, otherwise the in-app
> setup wizard reports "extension files not found" during
> `tauri dev`.

`npm run typecheck` validates both the UI and the extension types.

## Browser extension

`src-extension/` holds the MV3 bridge extension for Chrome / Edge /
Brave / Firefox. Sources are TypeScript (`src/`) and compile through
`npm run extension:build` into `build/`. That build step has two parts:
`tsc` produces `background.js`, `content.js` and `popup.js` from the
`.ts` entries, and `scripts/copy-extension-assets.mjs` copies
`manifest.json`, `popup.html`, `popup.css`, `icons/` and `_locales/`
alongside them — `tsc` only ever sees TypeScript inputs.

```bash
npm run extension:build   # src/*.ts -> build/ (scripts + static assets)
npm run extension:watch   # full build, then watch mode
```

`build/` is the extension's only runtime shape: the Tauri bundle
(`tauri.conf.json` → `resources`) and the setup wizard copy exactly this
directory; `src/*.ts` never ships. Only sources are tracked — `build/` is
in `.gitignore` and regenerated by `npm run build`, so stale output can
never be distributed.

`npm run typecheck` checks the extension types as well.

### Why `background` carries two fields

`manifest.json` points both `service_worker` and `scripts` at the same
file. This is **intentional duplication** and must not be "cleaned up":

- **Chromium** (Chrome / Edge / Brave) runs MV3 backgrounds strictly as a
  service worker → it reads `service_worker`.
- **Firefox** does not support `background.service_worker`
  ([bug 1573659](https://bugzil.la/1573659)) and uses an MV3 event page
  (`scripts`) instead. A manifest that only declares `service_worker`
  loads in Firefox but **silently** never starts the background script —
  download capture, media sniffing, context menus and the badge all stop
  working.

This is the cross-browser form MDN recommends. **Note:** Chrome versions
before 121 refuse to load an MV3 manifest that contains `scripts` (January
2024; that is a safe lower bound today).

`browser_specific_settings.gecko.id` is mandatory for Firefox /
addons.mozilla.org. The `strict_min_version: 115.0` in
`build/manifest.json` is the development value; the packaged Firefox
target (`npm run extension:dist`) is bumped to **140.0**, because AMO
requires a `data_collection_permissions` declaration on new submissions
and that key arrived in Firefox 140.

The extension talks to ADM's local bridge (`http://127.0.0.1:48213`)
using an `X-ADM-Extension` header. It forwards browser downloads, page
media (video/audio) and context-menu requests to the app, and reports
progress through the badge and the popup.

### Install steps

ADM prepares the extension files from Settings → **Browsers**:

1. Pick a browser and press **"Prepare files"** — the extension is copied
   to `%LocalAppData%\ADM\Browser Plugins\<Browser>` with a `README.txt`
   next to it.
2. Press **"Open extension page"** (e.g. `edge://extensions`).
3. Turn on **Developer mode** (top right).
4. Choose **Load unpacked** and select the prepared folder.
5. Click the extension icon and press **"Connect to ADM"** — the bridge
   indicator in the status bar turns green.

For Firefox, use **Load Temporary Add-on** on
`about:debugging#/runtime/this-firefox` and pick `manifest.json` (an
unsigned xpi).

**Bridge port.** The default is `48213`, changeable in Settings →
Browsers. Changing the port restarts the bridge and the extension has to
reconnect. Windows Firewall may ask for permission the first time, and
the server sets the CORS headers Chrome's Private Network Access
preflight requires.

### Release packaging (GitHub Actions)

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds the
desktop installers **and** the browser extension packages and uploads
everything to a single GitHub Release.

#### Desktop installers

| Platform | Bundles | Signing |
|---|---|---|
| Windows | NSIS `.exe`, MSI | `WINDOWS_CERTIFICATE` (+ password), falls back to an ephemeral self-signed certificate; the public part is published as `adm-code-signing.cer` |
| Linux | `.deb`, AppImage | AppImage signed with `GPG_PRIVATE_KEY` / `GPG_PASSPHRASE`; unsigned without them |
| macOS | `.dmg` (universal) | no signing configured |

#### Extension packages

| File | Purpose |
|---|---|
| `Setup-ADM-Extension-<version>.exe` | Windows installer: writes the force-install policy for Chrome / Edge / Brave / Chromium, optionally Firefox |
| `extension.crx` | Chromium package signed with your own key (what the policy installs) |
| `extension-firefox.xpi` | Mozilla (AMO) *unlisted*-signed package |
| `update.xml` / `updates.json` | auto-update manifests (Chromium / Firefox) |
| `safari-unsigned-macos.zip` | experimental, unsigned Safari app |

The same chain locally:

```bash
npm run extension:dist        # build/ -> dist/chromium + dist/firefox
openssl genrsa -out keys/extension.pem 2048    # once; do not lose this
npm run extension:crx         # dist/chromium -> release/extension.crx
npm run extension:id          # Chromium extension ID
EXT_ID=<id> npm run extension:update-files     # update.xml + updates.json
npm run extension:lint:firefox                 # web-ext lint (informational)
```

`dist/chromium` and `dist/firefox` manifests are derived from
`build/manifest.json`: `scripts/build-extension-dist.mjs` hands each
browser only its own fields (`service_worker` / `scripts`, `update_url`,
`browser_specific_settings`). `build/` itself is left unchanged — the
Tauri bundle and the setup wizard keep using it.

#### Required secrets

| Secret | Required | What for |
|---|---|---|
| `CRX_PRIVATE_KEY` | **Yes** | Contents of `keys/extension.pem`. Without it the release job fails. |
| `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` | No | [AMO API credentials](https://addons.mozilla.org/developers/addon/api/key/). Without them the Firefox step is skipped and no `.xpi` is produced. |
| `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD` | No | Base64-encoded `.pfx`. Without them Windows installers are signed with an ephemeral self-signed certificate. |
| `GPG_PRIVATE_KEY` / `GPG_PASSPHRASE` | No | Without them the Linux AppImage ships unsigned. |

`extension.pem` **never** enters the repository (`.gitignore`). Losing it
changes the extension ID and breaks both the force-install policy and the
update chain.

The repository must be public: `update.xml` / `updates.json` are served
through `releases/latest/download` and have to be publicly reachable.

#### Per-browser limits (honest summary)

Browsers do not "double-click install" store-less extensions; that is a
security rule.

- **Firefox:** the smoothest path. An AMO *unlisted*-signed `.xpi`
  installs into any Firefox and is never listed in the store.
- **Chrome / Edge / Brave:** the installer writes a force-install policy
  to the registry. This works on **managed / enterprise** machines;
  unmanaged home machines may refuse store-less forced installs.
  Fallback: open the `chromium-unpacked` folder the installer leaves
  behind via `chrome://extensions` → Developer mode → "Load unpacked".
- **Opera / Vivaldi:** no policy is written; load `chromium-unpacked`
  with developer mode.
- **Safari:** no normal install path without an Apple signing +
  notarization certificate. The automatically generated unsigned app only
  runs with Safari → Develop → "Allow Unsigned Extensions" enabled.
- **Windows SmartScreen:** an unsigned `.exe` warns on first launch;
  removing it requires a code-signing certificate.

The Firefox target uses `strict_min_version: 140.0`. To support older
Firefox releases, lower `geckoMinVersion` in
`src-extension/extension.config.json` — but AMO signing may then be
rejected.

## Video downloads (yt-dlp)

From Settings → Video:

- **Site login** — press "Open login window", sign in, then "Save
  cookies"; cookies are only sent to matching domains.
- **Tools** — install or update yt-dlp / ffmpeg / deno from the rows
  provided. Progress arrives as events.
- **Format** — container, maximum height and a custom `-f` expression;
  the effective yt-dlp arguments are previewed under the box.

> **Licence note.** The ffmpeg binary is downloaded from BtbN's Windows
> **GPL** build. GPL terms apply to redistributing it; if you prefer LGPL
> binaries, redirect `download_url` in
> `src-tauri/src/tools.rs` to another source.

## Tray icon

From Settings → General:

- **"Close to tray"** (on by default) — closing the window hides it and
  the app keeps running in the background.
- Tray menu: Show · Hide · Pause All · Resume All · Quit.
- **Quit** cancels active downloads and saves channel states
  (`shutdown_all`).

## Testing

```bash
cd src-tauri
cargo test                        # unit + integration tests
cargo clippy --all-targets
```

Nothing in the Rust test suite touches the real network:

- **Unit tests** (`src/**/mod tests`) — channel planning,
  `Content-Disposition` parsing, category routing,
  `uniqueDestination`, yt-dlp line parsing (`DMP` / `MCFMT` /
  `Destination` / `Merger` / `ERROR`), version comparison, capture group
  matching, the adaptive throttle curve
- **`tests/engine_integration.rs`** — spins up a local HTTP server and
  verifies multi-channel writes, the `206` check, per-channel resume,
  work stealing and cancellation byte by byte
- **`tests/bridge_integration.rs`** — runs the bridge on a real socket
  with an ephemeral port; covers `Host` rejection, CORS scope, the IPv6
  loopback form and concurrent requests
- **`tests/manager_integration.rs`** — database, the `max_concurrent`
  queue limit, event publishing and the video error paths

The extension has two Node-level simulations that need no browser:

```bash
npm run test:extension   # badge state machine + media queue ordering
```

### Manual smoke test

The UI and the browser integration are outside automated coverage:

1. Load the extension in Edge → capture a file download
2. Download a video from a video page → stage text and log should appear
3. Copy a link to the clipboard → the prompt should appear
4. Show / Hide / Pause All from the tray icon
5. Quit and relaunch → per-channel resume should pick up where it left off
6. Open with an old `downloads.db` → the migration should pass silently

## Icon

`app-icon.svg` is the source; every platform size is generated from it:

```bash
npm run tauri:icon
```

---

## Architecture

The interface follows MC's layout: title bar → table → status bar; the
left menu is an overlay panel (opened with the ☰ button in the title bar)
and details open in a separate window.

```text
src/                     SolidJS UI
├── App.tsx              app shell (layout + keyboard shortcuts)
├── index.tsx            entry point
├── assets/              adm-logo.png, adm-logo-128.png
├── components/
│   ├── TitleBar.tsx             ☰ menu · logo · language switch · settings · window buttons
│   ├── Sidebar.tsx              overlay menu: actions · task filters · categories ·
│   │                            status · tools (sort/search) · settings/browser/about
│   ├── DownloadTable.tsx        grid headers + rows + drag-and-drop area
│   ├── DownloadRow.tsx          one row (checkbox, category, stage, ⋮ menu)
│   ├── SegmentBar.tsx           canvas segment bar (row + detail)
│   ├── DownloadDetailDialog.tsx detail window (info grid, connections, log)
│   ├── NewDownloadDialog.tsx    kind picker (file/video) + destination preview
│   ├── ClipboardPromptDialog.tsx prompt for clipboard-captured links
│   ├── BrowserSetupDialog.tsx   browser setup wizard
│   ├── SettingsPanel.tsx        tabbed settings (General/Types/Browsers/Video/UI)
│   ├── RowContextMenu.tsx       right-click menu + channel editor
│   ├── FileIcon.tsx             file icon by extension
│   ├── StatusBar.tsx            bridge status · unfinished · speed · disk free
│   └── AboutDialog.tsx          "About ADM" window
├── lib/
│   ├── api.ts            Tauri commands + event subscription
│   ├── store.ts          signal-based state (downloads, filter, selection, events)
│   ├── settings.ts       settings + yt-dlp format args + capture groups
│   ├── format.ts         formatting, URL validation, category table
│   ├── bulk.ts           bulk operations
│   ├── ui.ts             shell-level UI state (window, panel, menus)
│   ├── useFeedback.ts    status-bar messages + error text (split to break a cycle)
│   └── i18n/             TR/EN dictionaries + locale signal
└── styles.css            design system (flat dark theme, blue accent)

src-extension/            browser extension (TypeScript, MV3)
├── manifest.json         permissions: downloads, cookies, webRequest, contextMenus…
├── extension.config.json name, slug, geckoId, per-browser minimum versions, repo
├── src/                  background / content / popup + shared types (single source)
│                         → compiled into build/
├── _locales/{en,tr}      extension strings
├── icons/                extension icons
├── installer/windows/    Inno Setup script (force-install policy + .crx)
├── build/                compiled output (generated, not tracked) —
│                         the folder the Tauri bundle and wizard copy
├── dist/{chromium,firefox}  per-browser packages (generated, not tracked)
└── release/              .crx / .xpi / update manifests (generated, not tracked)

src-tauri/src/           Rust backend
├── lib.rs         app setup (tray, bridge, clipboard, update check, lifecycle)
├── main.rs        entry point
├── commands.rs    #[tauri::command] layer + bridge routing + tray
├── manager.rs     DashMap + broadcast: task management, queue, bulk ops
├── engine.rs      multi-channel engine (adaptive throttle, 200→single stream)
├── video.rs       yt-dlp wrapper (line parsing, stage text)
├── tools.rs       yt-dlp / ffmpeg / deno install + verification
├── bridge.rs      local HTTP bridge (origin/Host validation, CORS)
├── clipboard.rs   clipboard watcher (URL extraction, don't-ask-again)
├── capture.rs     capture groups + extension matching
├── categories.rs  7-category taxonomy (folder routing)
├── site_login.rs  Netscape cookie file read/write + state
├── update.rs      GitHub Releases check (semver comparison)
├── models.rs      DownloadItem, DownloadStatus, ChannelState, filename rules
├── settings.rs    Settings + normalize + category folders
├── db.rs          sqlx/SQLite: pool, schema, migration, CRUD
└── i18n.rs        TR/EN texts (canonical error form)
```

### Data flow

```text
engine.rs / video.rs  ──(500 ms EngineSnapshot / VideoEvent)──►  manager.rs
                                                                     │
                                       ┌─────────────────────────────┴──────────┐
                                       │                                        │
                               SqlitePool (every 2 s)                tokio broadcast
                                       │                                        │
                                       ▼                                        ▼
                                 downloads.db                   Tauri event ──► SolidJS store
                                                                                    ▲
  browser extension ──(HTTP)──► bridge.rs ──► commands.rs ──► manager.rs             │
  clipboard ──(arboard)──► clipboard.rs ──(event)────────────────────────────────────┘
```

## Database

`%LocalAppData%\ADM\downloads.db`

```sql
CREATE TABLE downloads (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    url              TEXT    NOT NULL,
    file_path        TEXT    NOT NULL,
    file_name        TEXT    NOT NULL,
    total_bytes      INTEGER NOT NULL DEFAULT 0,
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    channel_count    INTEGER NOT NULL DEFAULT 4,
    status           TEXT    NOT NULL,   -- Queued | Downloading | Paused
                                           -- | Completed | Failed | Cancelled
    created_at       TEXT    NOT NULL,
    completed_at     TEXT,
    last_updated     TEXT    NOT NULL,
    speed_mbps       REAL    NOT NULL DEFAULT 0,
    error_message    TEXT,
    channel_states   TEXT,                 -- JSON: per-channel resume
    kind             TEXT    NOT NULL DEFAULT 'file',   -- file | video
    supports_ranges  INTEGER NOT NULL DEFAULT 0,
    headers          TEXT,                 -- JSON: headers from the extension
    cookie_file      TEXT,                 -- path to the Netscape cookie file
    final_path       TEXT,                 -- path yt-dlp reported for video
    stage            TEXT    NOT NULL DEFAULT '',       -- stage text
    log              TEXT    NOT NULL DEFAULT ''        -- last ~6000 characters
);
```

Older databases are upgraded at startup with
`ALTER TABLE ... ADD COLUMN` (a `pragma table_info` check guards each
one) and existing rows are backfilled with `kind = 'file'`. The `settings`
table also holds the bridge, capture-group, video and tray preferences.

## License

MIT
