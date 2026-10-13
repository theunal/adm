# AGENTS.md

Guidance for AI agents (and new contributors) working in this repository.

ADM is a multi-channel desktop download manager: **Rust + Tauri 2**
backend, **SolidJS** frontend, plus an MV3 browser extension that bridges
the browser into the app. Windows is the primary target; Linux/macOS
installers and an experimental Safari extension also ship.

## Language policy

| Surface | Language |
|---|---|
| Source comments, commit messages | **Turkish** |
| UI strings, log lines, error messages | **Turkish + English** — every user-visible string lives in `src/lib/i18n/` (UI) and `src-tauri/src/i18n.rs` (backend) |
| README.md, AGENTS.md | **English** |

Enums persisted in SQLite (`status`, `kind`, category ids) stay in
**English** and are translated on read. Error messages are stored in a
canonical form (`?adm:key?arg0?arg1`) so old rows re-render in the
currently selected language.

**Adding a string means touching three places:** `src/lib/i18n/en.ts`,
`src/lib/i18n/tr.ts`, and — if the backend produces it —
`src-tauri/src/i18n.rs`. `i18n.rs` uses a single `(key, tr, en)` table, so
both languages are structurally required there.

## Commands

| Command | What it does |
|---|---|
| `npm install` | install JS dependencies |
| `npm run tauri:dev` | run the app (starts Vite, then Tauri) |
| `npm run tauri:build` | produce installers |
| `npm run tauri:icon` | regenerate all icon sizes from `app-icon.svg` |
| `npm run typecheck` | `tsc --noEmit` for **both** the UI and `src-extension/` |
| `npm run build` | typecheck + Vite build + `extension:build` |
| `npm run extension:build` | `src-extension/src/*.ts` → `build/` (+ static assets) |
| `npm run extension:watch` | full build, then watch mode |
| `npm run extension:dist` | `build/` → `dist/chromium` + `dist/firefox` |
| `npm run extension:crx` | `dist/chromium` → `release/extension.crx` (needs `keys/extension.pem`) |
| `npm run extension:id` | print the Chromium extension ID from the key |
| `EXT_ID=<id> npm run extension:update-files` | write `update.xml` + `updates.json` |
| `npm run extension:lint:firefox` | `web-ext lint` on the Firefox package (informational) |
| `npm run test:extension` | badge state machine + media queue simulations (no browser needed) |
| `cargo test` | Rust unit + integration tests (in `src-tauri/`, no network) |
| `cargo clippy --all-targets` | lint the Rust code |

## Layout

| Path | Contents |
|---|---|
| `src/` | SolidJS UI — `components/` for views, `lib/` for state/api/i18n, `styles.css` for the design system |
| `src-extension/` | MV3 extension — TypeScript in `src/`, compiled to `build/`, packaged into `dist/` and `release/` |
| `src-tauri/src/` | Rust backend — `engine.rs` (download engine), `manager.rs` (tasks/queue), `bridge.rs` (local HTTP), `db.rs` (SQLite), `commands.rs` (`#[tauri::command]` + tray) |
| `src-tauri/tests/` | integration tests: `engine_`, `bridge_`, `manager_integration.rs` |
| `scripts/` | Node build/verify scripts for the extension and the release workflow |
| `.github/workflows/release.yml` | the only workflow; tag `v*` triggers everything |

## Hard rules

These are not style preferences — breaking them breaks the product.

1. **`src-extension/build/` is generated.** Never edit it by hand and
   never commit it (it is in `.gitignore`). Run `npm run extension:build`.
   Sources live in `src-extension/src/*.ts`; static assets
   (`manifest.json`, `popup.html`, `popup.css`, `icons/`, `_locales/`) are
   copied by `scripts/copy-extension-assets.mjs`.
2. **`keys/extension.pem` never enters the repository.** Losing or
   publishing it changes the Chromium extension ID and breaks both the
   force-install policy and the auto-update chain. It is supplied in CI
   through the `CRX_PRIVATE_KEY` secret.
3. **The `background` manifest field intentionally carries both
   `service_worker` and `scripts`** pointing at the same file. Chromium
   reads `service_worker`; Firefox does not support it and only starts
   the script listed under `scripts`
   ([bug 1573659](https://bugzil.la/1573659)). Removing either field
   silently disables the extension in one browser family. Do not
   "deduplicate" it.
4. **`build/manifest.json` keeps `strict_min_version: 115.0`** — that is
   the development value. The packaged Firefox target is derived by
   `scripts/build-extension-dist.mjs` from
   `src-extension/extension.config.json` (`geckoMinVersion: 140.0`),
   because AMO requires `data_collection_permissions` on new submissions.
5. **TLS certificate validation stays on.** The backend uses `reqwest` +
   `rustls` with default full verification. Never add
   `danger_accept_invalid_certs` (the WPF predecessor shipped with
   validation disabled; that bug must not come back).
6. **`Range` requests require a `206` with a verified `Content-Range`.**
   A `200` answer means the server ignored the range: the engine falls
   back to a single stream instead of writing the whole file at the range
   offset (which silently corrupts it).
7. **Database migrations are additive only.** New columns are appended to
   `ADDED_COLUMNS` in `src-tauri/src/db.rs` and applied with
   `ALTER TABLE ... ADD COLUMN` guarded by a `pragma table_info` check.
   Never edit or reorder an already-shipped migration entry.
8. **Never glob whole bundle directories into a release upload.** Only
   `*.exe`, `*.msi`, `*.deb`, `*.AppImage`, `*.dmg` are released.
   Uploading `bundle/**/*` once shipped 461 assets (unpacked AppImage
   payload + `.app` bundle) and tripped GitHub's secondary rate limit.

## Verification before claiming work is done

Run in this order and fix failures before reporting:

```bash
npm run typecheck          # UI + extension types
npm run test:extension     # badge machine + media queue
npm run extension:build    # regenerates build/ (verify no diff is expected)
cd src-tauri
cargo test
cargo clippy --all-targets
```

`cargo test` needs no network: `engine_integration.rs` and
`bridge_integration.rs` spin up local HTTP servers on ephemeral ports,
`manager_integration.rs` uses a temporary SQLite file.

## Gotchas

- **Bridge port** defaults to `48213` (`settings.server_port`). Tests
  bind port `0` to get an ephemeral port; `Host` validation must be
  checked against the *actual* listening port, not the configured one, or
  every request is rejected with 403.
- **`tauri dev` needs `src-extension/build/` to exist.** The setup wizard
  reads that folder; on a fresh clone run `npm run extension:build` first
  or the wizard reports "extension files not found".
- **`js-yaml` is not a declared dependency.** `scripts/verify-release-workflow.mjs`
  imports it, but it currently resolves only because `web-ext` →
  `addons-linter` → `eslint` → `@eslint/eslintrc` hoists it. If that chain
  ever changes, add `npm i -D js-yaml` rather than rewriting the script.
- **`.refs/`, `.kilo/`, `.workbuddy-ai/` are gitignored local directories.**
  `.refs/mc-download-manager/` holds the upstream Swift project used as
  the porting reference. Do not reference them from committed files and
  do not commit anything inside them.
- **Settings not yet wired to behaviour:** `notify_on_complete`,
  `show_detail_on_start`, `autostart`, `start_in_tray`. They persist and
  render in the UI but nothing consumes them — `RuntimeState` stores
  `start_in_tray` and `commands::starts_in_tray()` exists, yet no startup
  path calls it. Do not "fix" this silently; it is a known gap documented
  in the README.
- **`close_to_tray` is wired and works** (`WindowEvent::CloseRequested`
  calls `prevent_close()` + `window.hide()`). Don't confuse it with
  `start_in_tray`.
- **Version numbers live in three files** — `package.json`,
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`. The release
  workflow syncs all three from the tag; locally, keep them consistent by
  hand.
- **Extension version is separate** from the app version: the extension
  manifest carries its own `version`, overridden in CI by `EXT_VERSION`.
- **The Inno Setup script is deliberately ASCII-only** (BOM-less UTF-8 is
  safe everywhere) and takes `/DAppName`, `/DAppVersion`, `/DExtId`,
  `/DUpdateUrl` from the workflow. `ExtId` is mandatory — the script
  `#error`s without it.
- **`src-tauri/src/categories.rs` fixes the taxonomy at exactly 7
  categories** (`Category::all()` returns `[Category; 7]`). Adding one
  means touching the enum, `as_str` / `parse` / `label_key` /
  `folder_label`, the sidebar, and the i18n dictionaries together.
- **ffmpeg comes from BtbN's GPL build.** GPL terms apply to
  redistribution; switching to LGPL means redirecting `download_url` in
  `src-tauri/src/tools.rs`. Deno downloads are verified against their
  published `.sha256sum`.
- **`npm run extension:dist` deletes and recreates `src-extension/dist/`.**
  Run `extension:build` before it; it errors out if `build/` is missing.
