/**
 * Ayarlar ekranı — MC `SettingsView` portu, **sekmeli** düzen.
 *
 * Beş sekme:
 *
 * 1. **Genel** — konumlar, kategoriye ayırma, bağlantı/eşzamanlılık, davranış
 *    anahtarları, tepsi ve başlangıç, güncellemeler.
 * 2. **Dosya Türleri** — yakalama grupları + özel uzantılar ve etkin liste.
 * 3. **Tarayıcılar** — köprü portu/durumu, eklenti klasörü, kurulum sihirbazı.
 * 4. **Video** — site girişi çerezleri, yt-dlp/ffmpeg/deno kurulumu, biçim
 *    seçicileri ve etkin argüman önizlemesi.
 * 5. **Arayüz** — dil ve alt panel (ADM ekstrası).
 *
 * **Yazma politikası:** her denetim `updateSettings({ ... })` ile yalnızca
 * değişen alanı yamalar; Rust tarafı kısmi JSON'u mevcut ayarların üzerine
 * uygular (`commands::merge_settings`). Kaydırıcılar ve metin alanları
 * **bırakıldığında** yazar — her tuş vuruşunda IPC + veritabanı yazımı
 * yapmak gereksiz olurdu; yerel sinyal anlık geri bildirimi sağlar.
 */
import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
} from "solid-js";
import {
  checkForUpdate,
  clearSiteCookies,
  installTool,
  openPluginFolder,
  openSiteLogin,
  pickFolder,
  prepareBrowserFiles,
  saveSiteLoginCookies,
  siteLoginStatus,
  toolStatus,
  browserList,
  type BrowserId,
  type SiteLoginStatus,
  type ToolId,
  type ToolStatus,
} from "../lib/api";
import {
  CAPTURE_GROUPS,
  CHANNEL_PRESETS,
  MAX_CHANNELS,
  MIN_CHANNELS,
  VIDEO_CONTAINERS,
  VIDEO_MAX_HEIGHTS,
  captureExtensions,
  formatArguments,
  heightLabelKey,
  heightParams,
  settings,
  updateSettings,
  type CaptureGroup,
} from "../lib/settings";
import { formatDateTime, formatNumber } from "../lib/format";
import { t, type Locale } from "../lib/i18n";
import { openBrowserSetup, setSettingsOpen } from "../lib/ui";
import { bridge, toolMessage, toolProgress, toolRevision, updateInfo } from "../lib/store";
import { errorText, pushFeedback } from "../lib/useFeedback";
import Tip from "./Tip";

/** Sekme kimlikleri. */
type TabId = "general" | "types" | "browsers" | "video" | "interface";

/** Sekme sırası ve sözlük anahtarları. */
const TABS: { id: TabId; key: string }[] = [
  { id: "general", key: "settings.tab.general" },
  { id: "types", key: "settings.tab.types" },
  { id: "browsers", key: "settings.tab.browsers" },
  { id: "video", key: "settings.tab.video" },
  { id: "interface", key: "settings.tab.interface" },
];

/** Dil seçenekleri. */
const LANGS: Locale[] = ["tr", "en"];

/** Konum satırları: sözlük anahtarı ve `Settings` alanı. */
type DirField = "videoDir" | "audioDir" | "otherDir";

interface DirRow {
  key: DirField;
  label: string;
  hint: string;
}

/** Kurulum sırasında gösterilen araç sırası. */
const TOOLS: ToolId[] = ["ytdlp", "ffmpeg", "deno"];

/** Tarayıcı kimliği → görünen ad. */
const BROWSER_LABEL: Record<BrowserId, string> = {
  chrome: "Google Chrome",
  edge: "Microsoft Edge",
  brave: "Brave",
  firefox: "Mozilla Firefox",
};

/** Tarayıcı kimliği → eklenti klasöründe kullanılan ad. */
const FALLBACK_BROWSERS: BrowserId[] = ["chrome", "edge", "brave", "firefox"];

export default function SettingsPanel() {
  /** Etkin sekme. */
  const [tab, setTab] = createSignal<TabId>("general");

  /** Ayar yazımı sırasında denetimleri kilitler. */
  const [saving, setSaving] = createSignal(false);

  /** Kurulumu süren araçlar (düğme kilidi). */
  const [installing, setInstalling] = createSignal<Record<string, boolean>>({});

  /** Güncelleme denetimi sürüyor mu? */
  const [checking, setChecking] = createSignal(false);

  /** Yazma hatasını yalnızca ilgili işlem gösterir. */
  async function guard(action: () => Promise<void>, failKey: string) {
    setSaving(true);
    try {
      await action();
    } catch (e) {
      pushFeedback("error", t(failKey, { error: errorText(e) }));
    } finally {
      setSaving(false);
    }
  }

  /** Tek bir ayar alanını yazar. */
  function save(patch: Parameters<typeof updateSettings>[0], failKey = "settings.err.save") {
    void guard(() => updateSettings(patch), failKey);
  }

  return (
    <div class="settings-panel">
      <div class="settings-head">
        <h2 class="settings-head-title">{t("menu.item.settings")}</h2>
        <Tip
          class="settings-close"
          label={t("props.close")}
          aria-label={t("props.close")}
          onClick={() => setSettingsOpen(false)}
        >
          {t("props.close")}
        </Tip>
      </div>

      <div class="settings-tabs" role="tablist" aria-label={t("menu.item.settings")}>
        <For each={TABS}>
          {(item) => (
            <button
              type="button"
              role="tab"
              class={`settings-tab${tab() === item.id ? " settings-tab-active" : ""}`}
              aria-selected={tab() === item.id}
              onClick={() => setTab(item.id)}
            >
              {t(item.key)}
            </button>
          )}
        </For>
      </div>

      <div class="settings-body">
        <Show when={tab() === "general"}>
          <GeneralTab saving={saving} save={save} guard={guard} checking={checking} setChecking={setChecking} />
        </Show>
        <Show when={tab() === "types"}>
          <TypesTab saving={saving} save={save} />
        </Show>
        <Show when={tab() === "browsers"}>
          <BrowsersTab saving={saving} save={save} guard={guard} />
        </Show>
        <Show when={tab() === "video"}>
          <VideoTab
            saving={saving}
            save={save}
            guard={guard}
            installing={installing}
            setInstalling={setInstalling}
          />
        </Show>
        <Show when={tab() === "interface"}>
          <InterfaceTab saving={saving} guard={guard} />
        </Show>
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------
   Ortak denetimler
   ----------------------------------------------------------------- */

interface TabProps {
  saving: () => boolean;
  save: (
    patch: Parameters<typeof updateSettings>[0],
    failKey?: string,
  ) => void;
  guard: (action: () => Promise<void>, failKey: string) => Promise<void>;
}

/** Anahtar satırı (onay kutusu + etiket + ipucu). */
function Toggle(props: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div class="settings-toggle-row">
      <label class="settings-toggle" for={props.id}>
        <input
          id={props.id}
          type="checkbox"
          checked={props.checked}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.currentTarget.checked)}
        />
        <span class="settings-toggle-label">{props.label}</span>
      </label>
      <p class="settings-hint">{props.hint}</p>
    </div>
  );
}

/**
 * Kaydırıcı + önayarlar.
 *
 * Yerel sinyal sürüklerken anlık değeri gösterir; kalıcı yazım **bırakınca**
 * (`onChange`) yapılır. Böylece her adımda veritabanına yazılmaz.
 */
function Slider(props: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  presets?: number[];
  display?: (value: number) => string;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [local, setLocal] = createSignal(props.value);

  // Dışarıdan gelen değer değişirse (başka sekmeden yazım) yerel kopya tazelenir.
  createEffect(() => setLocal(props.value));

  const shown = () => props.display?.(local()) ?? String(local());

  return (
    <div class="field">
      <label for={props.id}>
        {props.label}
        <span class="field-hint">{shown()}</span>
      </label>
      <div class="slider-row">
        <input
          id={props.id}
          type="range"
          class="slider"
          min={props.min}
          max={props.max}
          step="1"
          value={local()}
          disabled={props.disabled}
          onInput={(e) => setLocal(Number(e.currentTarget.value))}
          onChange={(e) => props.onCommit(Number(e.currentTarget.value))}
        />
        <Show when={props.presets}>
          <div class="slider-presets">
            <For each={props.presets}>
              {(n) => (
                <button
                  type="button"
                  class={`preset ${local() === n ? "preset-active" : ""}`}
                  disabled={props.disabled}
                  onClick={() => {
                    setLocal(n);
                    props.onCommit(n);
                  }}
                >
                  {n}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
      <p class="settings-hint">{props.hint}</p>
    </div>
  );
}

/**
 * Metin alanı.
 *
 * Yazım `onChange` (odak kaybı / Enter) ile yapılır; her tuş vuruşunda
 * ayarları kaydetmek gereksiz IPC trafiği yaratırdı.
 */
function TextField(props: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onCommit: (value: string) => void;
}) {
  const [local, setLocal] = createSignal(props.value);
  createEffect(() => setLocal(props.value));

  return (
    <div class="settings-field">
      <label for={props.id}>{props.label}</label>
      <input
        id={props.id}
        type="text"
        class="input"
        spellcheck={false}
        autocomplete="off"
        placeholder={props.placeholder}
        value={local()}
        disabled={props.disabled}
        onInput={(e) => setLocal(e.currentTarget.value)}
        onChange={(e) => props.onCommit(e.currentTarget.value)}
      />
      <Show when={props.hint}>
        <p class="settings-hint">{props.hint}</p>
      </Show>
    </div>
  );
}

/* -----------------------------------------------------------------
   Sekme: Genel
   ----------------------------------------------------------------- */

function GeneralTab(props: TabProps & {
  checking: () => boolean;
  setChecking: (value: boolean) => void;
}) {
  const { save, saving } = props;

  /** Konum satırları. */
  const rows: DirRow[] = [
    { key: "videoDir", label: "settings.dir.video", hint: "settings.dir.video_hint" },
    { key: "audioDir", label: "settings.dir.audio", hint: "settings.dir.audio_hint" },
    { key: "otherDir", label: "settings.dir.other", hint: "settings.dir.other_hint" },
  ];

  /** Ayar alanını yol metnine çevirir (boşsa ""). */
  const dirValue = (field: DirField) => settings[field] ?? "";

  /** Kategori satırı için hedef klasör seçtirir. */
  async function chooseDir(row: DirRow) {
    const current = dirValue(row.key);
    await props.guard(async () => {
      const picked = await pickFolder(
        t("settings.pick_folder", { target: t(row.label) }),
        current || settings.defaultDir || undefined,
      );
      if (picked) await updateSettings({ [row.key]: picked });
    }, "settings.err.pick");
  }

  /** Genel hedef zorunludur: sıfırlamak yerine klasör seçilir. */
  async function chooseDefaultDir() {
    await props.guard(async () => {
      const picked = await pickFolder(
        t("settings.pick_folder", { target: t("settings.dir.default") }),
        settings.defaultDir || undefined,
      );
      if (picked) await updateSettings({ defaultDir: picked });
    }, "settings.err.pick");
  }

  // Güncelleme sonucu gelince "denetleniyor" durumu kalkar.
  createEffect(() => {
    if (updateInfo()) props.setChecking(false);
  });

  return (
    <>
      {/* -------------------------------------------------------------
          Konumlar
      ------------------------------------------------------------- */}
      <section class="settings-section">
        <h2 class="section-title">{t("settings.section.folders")}</h2>
        <p class="settings-hint">{t("settings.folders_intro")}</p>

        <div class="settings-field">
          <label for="set-dir-default">{t("settings.dir.default")}</label>
          <div class="path-row">
            <input
              id="set-dir-default"
              type="text"
              class="input input-path"
              spellcheck={false}
              value={settings.defaultDir}
              disabled={saving()}
              onChange={(e) => save({ defaultDir: e.currentTarget.value })}
            />
            <button
              type="button"
              class="btn btn-ghost"
              disabled={saving()}
              onClick={() => void chooseDefaultDir()}
            >
              {t("form.browse")}
            </button>
          </div>
          <p class="settings-hint">{t("settings.dir.default_hint")}</p>
        </div>

        <For each={rows}>
          {(row) => (
            <div class="settings-field">
              <label for={`set-${row.key}`}>{t(row.label)}</label>
              <div class="path-row">
                <input
                  id={`set-${row.key}`}
                  type="text"
                  class="input input-path"
                  spellcheck={false}
                  placeholder={t("settings.dir.inherit")}
                  value={dirValue(row.key)}
                  disabled={saving()}
                  onChange={(e) => save({ [row.key]: e.currentTarget.value })}
                />
                <button
                  type="button"
                  class="btn btn-ghost"
                  disabled={saving()}
                  onClick={() => void chooseDir(row)}
                >
                  {t("form.browse")}
                </button>
                <Show when={settings[row.key]}>
                  <Tip
                    class="btn btn-ghost btn-icon"
                    label={t("settings.dir.reset")}
                    aria-label={t("settings.dir.reset")}
                    disabled={saving()}
                    onClick={() => save({ [row.key]: null })}
                  >
                    ↺
                  </Tip>
                </Show>
              </div>
              <p class="settings-hint">{t(row.hint)}</p>
            </div>
          )}
        </For>

        <Toggle
          id="set-organize"
          label={t("settings.organize")}
          hint={t("settings.organize_hint")}
          checked={settings.organizeByCategory}
          disabled={saving()}
          onChange={(v) => save({ organizeByCategory: v })}
        />
      </section>

      {/* -------------------------------------------------------------
          Bağlantı ve eşzamanlılık
      ------------------------------------------------------------- */}
      <section class="settings-section">
        <h2 class="section-title">{t("settings.section.channels")}</h2>

        <Slider
          id="set-channels"
          label={t("settings.channels_label")}
          hint={t("settings.channels_hint")}
          value={settings.defaultChannelCount}
          min={MIN_CHANNELS}
          max={MAX_CHANNELS}
          presets={CHANNEL_PRESETS}
          display={(v) => t("form.channels_hint", { count: v })}
          disabled={saving()}
          onCommit={(v) => save({ defaultChannelCount: v }, "settings.err.channels")}
        />

        <Slider
          id="set-concurrent"
          label={t("settings.max_concurrent")}
          hint={t("settings.max_concurrent_hint")}
          value={settings.maxConcurrent}
          min={1}
          max={10}
          display={(v) => t("settings.concurrent_value", { count: v })}
          disabled={saving()}
          onCommit={(v) => save({ maxConcurrent: v })}
        />
      </section>

      {/* -------------------------------------------------------------
          Davranışlar
      ------------------------------------------------------------- */}
      <section class="settings-section">
        <h2 class="section-title">{t("settings.section.behaviour")}</h2>
        <Toggle
          id="set-autostart-dl"
          label={t("settings.auto_start")}
          hint={t("settings.auto_start_hint")}
          checked={settings.autoStart}
          disabled={saving()}
          onChange={(v) => save({ autoStart: v })}
        />
        <Toggle
          id="set-notify"
          label={t("settings.notify")}
          hint={t("settings.notify_hint")}
          checked={settings.notifyOnComplete}
          disabled={saving()}
          onChange={(v) => save({ notifyOnComplete: v })}
        />
        <Toggle
          id="set-show-detail"
          label={t("settings.show_detail")}
          hint={t("settings.show_detail_hint")}
          checked={settings.showDetailOnStart}
          disabled={saving()}
          onChange={(v) => save({ showDetailOnStart: v })}
        />
        <Toggle
          id="set-auto-close"
          label={t("settings.auto_close_detail")}
          hint={t("settings.auto_close_detail_hint")}
          checked={settings.autoCloseDetail}
          disabled={saving()}
          onChange={(v) => save({ autoCloseDetail: v })}
        />
        <Toggle
          id="set-watch-clipboard"
          label={t("settings.watch_clipboard")}
          hint={t("settings.watch_clipboard_hint")}
          checked={settings.watchClipboard}
          disabled={saving()}
          onChange={(v) => save({ watchClipboard: v })}
        />
      </section>

      {/* -------------------------------------------------------------
          Tepsi ve başlangıç
      ------------------------------------------------------------- */}
      <section class="settings-section">
        <h2 class="section-title">{t("settings.section.tray")}</h2>
        <Toggle
          id="set-start-tray"
          label={t("settings.start_in_tray")}
          hint={t("settings.start_in_tray_hint")}
          checked={settings.startInTray}
          disabled={saving()}
          onChange={(v) => save({ startInTray: v })}
        />
        <Toggle
          id="set-close-tray"
          label={t("settings.close_to_tray")}
          hint={t("settings.close_to_tray_hint")}
          checked={settings.closeToTray}
          disabled={saving()}
          onChange={(v) => save({ closeToTray: v })}
        />
        <Toggle
          id="set-autostart"
          label={t("settings.autostart")}
          hint={t("settings.autostart_hint")}
          checked={settings.autostart}
          disabled={saving()}
          onChange={(v) => save({ autostart: v })}
        />
      </section>

      {/* -------------------------------------------------------------
          Güncellemeler
      ------------------------------------------------------------- */}
      <section class="settings-section">
        <h2 class="section-title">{t("settings.section.updates")}</h2>
        <Toggle
          id="set-check-updates"
          label={t("settings.check_updates")}
          hint={t("settings.check_updates_hint")}
          checked={settings.checkForUpdates}
          disabled={saving()}
          onChange={(v) => save({ checkForUpdates: v })}
        />

        <div class="settings-row settings-row-wrap">
          <Tip
            class="btn"
            label={t("settings.check_now_title")}
            disabled={props.checking()}
            onClick={() => {
              props.setChecking(true);
              void checkForUpdate().catch((e: unknown) => {
                props.setChecking(false);
                pushFeedback("error", t("settings.update_error", { error: errorText(e) }));
              });
            }}
          >
            {props.checking() ? t("settings.checking") : t("settings.check_now")}
          </Tip>
          <UpdateStatus />
        </div>
      </section>
    </>
  );
}

/** Güncelleme denetiminin sonucu (özet satırı). */
function UpdateStatus() {
  const info = createMemo(() => updateInfo());

  const lastCheck = createMemo(() => {
    const stamp = settings.lastUpdateCheck;
    return stamp ? t("settings.update_last", { time: formatDateTime(stamp) }) : t("settings.update_never");
  });

  return (
    <div class="settings-status">
      <Show
        when={info()}
        fallback={<span class="settings-hint">{lastCheck()}</span>}
      >
        {(value) => (
          <Show
            when={!value().error}
            fallback={
              <span class="settings-bad">
                {t("settings.update_error", { error: value().error ?? "" })}
              </span>
            }
          >
            <Show
              when={value().latest}
              fallback={
                <span class="settings-ok">
                  {t("settings.update_current", { version: value().current })}
                </span>
              }
            >
              <span class="settings-warn">
                {t("settings.update_available", { version: value().latest ?? "" })}
              </span>
              <Show when={value().pageUrl}>
                <a
                  class="settings-link"
                  href={value().pageUrl ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("settings.update_download")}
                </a>
              </Show>
            </Show>
          </Show>
        )}
      </Show>
    </div>
  );
}

/* -----------------------------------------------------------------
   Sekme: Dosya Türleri
   ----------------------------------------------------------------- */

function TypesTab(props: { saving: () => boolean; save: TabProps["save"] }) {
  const { save, saving } = props;

  /** Etkin uzantı listesi (gruplar + özel). */
  const extensions = createMemo(() => captureExtensions(settings));

  function toggleGroup(group: CaptureGroup) {
    const current = settings.captureGroupIds;
    const next = current.includes(group)
      ? current.filter((g) => g !== group)
      : [...current, group];
    save({ captureGroupIds: next });
  }

  return (
    <>
      <section class="settings-section">
        <h2 class="section-title">{t("settings.tab.types")}</h2>
        <p class="settings-hint">{t("settings.types_intro")}</p>

        <h3 class="settings-subtitle">{t("settings.types_groups")}</h3>
        <div class="capture-grid">
          <For each={CAPTURE_GROUPS}>
            {(group) => (
              <label class="capture-chip" classList={{ "capture-chip-on": settings.captureGroupIds.includes(group) }}>
                <input
                  type="checkbox"
                  checked={settings.captureGroupIds.includes(group)}
                  disabled={saving()}
                  onChange={() => toggleGroup(group)}
                />
                <span>{t(`cat.${group}`)}</span>
              </label>
            )}
          </For>
        </div>

        <TextField
          id="set-custom-ext"
          label={t("settings.types_custom")}
          hint={t("settings.types_custom_hint")}
          placeholder={t("settings.types_custom_placeholder")}
          value={settings.customExtensions}
          disabled={saving()}
          onCommit={(v) => save({ customExtensions: v })}
        />
      </section>

      <section class="settings-section">
        <h2 class="section-title">
          {t("settings.types_preview", { count: extensions().length })}
        </h2>
        <Show
          when={extensions().length > 0}
          fallback={<p class="settings-hint">{t("settings.types_preview_empty")}</p>}
        >
          <div class="ext-list">
            <For each={extensions()}>
              {(ext) => <span class="ext-chip">{ext}</span>}
            </For>
          </div>
        </Show>
      </section>
    </>
  );
}

/* -----------------------------------------------------------------
   Sekme: Tarayıcılar
   ----------------------------------------------------------------- */

function BrowsersTab(props: TabProps) {
  const { save, saving, guard } = props;

  const [browsers] = createResource<BrowserId[]>(() => browserListSafe());

  /** Eklenti dosyalarının hazırlandığı klasörler (tarayıcı → yol). */
  const [folders, setFolders] = createSignal<Record<string, string>>({});

  async function prepare(browser: BrowserId) {
    await guard(async () => {
      const dir = await prepareBrowserFiles(browser);
      setFolders((prev) => ({ ...prev, [browser]: dir }));
      pushFeedback("success", t("log.browser_files_ready", { path: dir }));
    }, "settings.err.save");
  }

  async function openFolder(browser: BrowserId) {
    await guard(() => openPluginFolder(browser), "settings.err.save");
  }

  const connected = createMemo(() => bridge().browsers);

  return (
    <>
      <section class="settings-section">
        <h2 class="section-title">{t("settings.tab.browsers")}</h2>
        <p class="settings-hint">{t("settings.browsers_intro")}</p>

        <div class="settings-status settings-status-lg">
          <span class={`bridge-dot ${bridge().running ? "bridge-dot-on" : "bridge-dot-off"}`} />
          <span class={bridge().running ? "settings-ok" : "settings-bad"}>
            {bridge().running
              ? t("settings.bridge_running", { port: bridge().port })
              : t("settings.bridge_stopped")}
          </span>
        </div>
        <p class="settings-hint">
          {connected().length > 0
            ? t("settings.bridge_browsers", { browsers: connected().join(", ") })
            : t("settings.bridge_no_browser")}
        </p>

        <TextField
          id="set-port"
          label={t("settings.bridge_port")}
          hint={t("settings.bridge_port_hint")}
          value={String(settings.serverPort)}
          disabled={saving()}
          onCommit={(v) => {
            const port = Number.parseInt(v, 10);
            save({ serverPort: Number.isFinite(port) ? port : settings.serverPort });
          }}
        />
      </section>

      <section class="settings-section">
        <h2 class="section-title">{t("settings.plugin_folder")}</h2>
        <p class="settings-hint">{t("settings.plugin_folder_hint")}</p>

        <For each={browsers() ?? FALLBACK_BROWSERS}>
          {(browser) => (
            <div class="browser-row">
              <span class="browser-name">{BROWSER_LABEL[browser]}</span>
              <Tip
                target="span"
                class="settings-hint browser-path"
                label={folders()[browser] ?? ""}
              >
                {folders()[browser]
                  ? t("settings.browser_ready")
                  : t("settings.browser_missing")}
              </Tip>
              <span class="browser-actions">
                <button
                  type="button"
                  class="btn btn-ghost"
                  disabled={saving()}
                  onClick={() => void prepare(browser)}
                >
                  {t("wizard.action.prepare")}
                </button>
                <Show when={folders()[browser]}>
                  <button
                    type="button"
                    class="btn btn-ghost"
                    onClick={() => void openFolder(browser)}
                  >
                    {t("wizard.action.open_folder")}
                  </button>
                </Show>
                <button
                  type="button"
                  class="btn btn-ghost"
                  onClick={() => openBrowserSetup(browser)}
                >
                  {t("settings.wizard_open")}
                </button>
              </span>
            </div>
          )}
        </For>
      </section>
    </>
  );
}

/* -----------------------------------------------------------------
   Sekme: Video
   ----------------------------------------------------------------- */

function VideoTab(props: TabProps & {
  installing: () => Record<string, boolean>;
  setInstalling: (value: Record<string, boolean>) => void;
}) {
  const { save, saving, guard } = props;

  /** Kurulu araçlar; `toolRevision` bir kurulum bitince kaynağı tazeler. */
  const [tools, { refetch: refetchTools }] = createResource<ToolStatus[]>(() => {
    toolRevision();
    return toolStatusSafe();
  });

  /** Kayıtlı çerez dosyasının durumu. */
  const [login, { refetch: refetchLogin }] = createResource<SiteLoginStatus>(() =>
    siteLoginStatusSafe(),
  );

  /** Etkin yt-dlp argümanları (önizleme). */
  const args = createMemo(() => formatArguments(settings));

  async function install(tool: ToolId) {
    props.setInstalling({ ...props.installing(), [tool]: true });
    try {
      await installTool(tool);
      void refetchTools();
    } catch (e) {
      pushFeedback("error", t("tool.failed", { error: errorText(e) }));
    } finally {
      props.setInstalling({ ...props.installing(), [tool]: false });
    }
  }

  async function openLogin() {
    await guard(() => openSiteLogin(), "settings.err.save");
  }

  async function saveCookies() {
    await guard(async () => {
      const count = await saveSiteLoginCookies();
      void refetchLogin();
      pushFeedback("success", t("settings.site_login_saved", { count }));
    }, "settings.err.save");
  }

  async function clearCookies() {
    await guard(async () => {
      await clearSiteCookies();
      void refetchLogin();
    }, "settings.err.save");
  }

  const statusOf = (tool: string) => tools()?.find((s) => s.tool === tool);

  return (
    <>
      {/* -------------------------------------------------------------
          Site girişi
      ------------------------------------------------------------- */}
      <section class="settings-section">
        <h2 class="section-title">{t("settings.site_login")}</h2>
        <p class="settings-hint">{t("settings.site_login_hint")}</p>

        <div class="settings-status">
          <Show
            when={(login()?.cookieCount ?? 0) > 0}
            fallback={<span class="settings-hint">{t("settings.site_login_none")}</span>}
          >
            <span class="settings-ok">
              {t("settings.site_login_count", { count: login()?.cookieCount ?? 0 })}
            </span>
            <Show when={(login()?.domains.length ?? 0) > 0}>
              <span class="settings-hint">
                {t("settings.site_login_domains", {
                  domains: (login()?.domains ?? []).join(", "),
                })}
              </span>
            </Show>
          </Show>
        </div>

        <div class="settings-row settings-row-wrap">
          <button type="button" class="btn" disabled={saving()} onClick={() => void openLogin()}>
            {t("settings.site_login_open")}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            disabled={saving()}
            onClick={() => void saveCookies()}
          >
            {t("settings.site_login_save")}
          </button>
          <Show when={(login()?.cookieCount ?? 0) > 0}>
            <button
              type="button"
              class="btn btn-ghost"
              disabled={saving()}
              onClick={() => void clearCookies()}
            >
              {t("settings.site_login_clear")}
            </button>
          </Show>
        </div>
      </section>

      {/* -------------------------------------------------------------
          Harici araçlar
      ------------------------------------------------------------- */}
      <section class="settings-section">
        <h2 class="section-title">{t("settings.tools")}</h2>
        <p class="settings-hint">{t("settings.tools_hint")}</p>

        <For each={TOOLS}>
          {(tool) => {
            const status = () => statusOf(tool);
            const busy = () => props.installing()[tool] === true;
            const fraction = () => toolProgress[tool];

            return (
              <div class="tool-row">
                <span class="tool-name">{tool}</span>
                <span class="tool-state">
                  <Show
                    when={status()?.installed}
                    fallback={<span class="settings-bad">{t("settings.tool_missing")}</span>}
                  >
                    <span class="settings-ok">
                      {t("settings.tool_installed")}
                      <Show when={status()?.version}>
                        {" · "}
                        {t("settings.tool_version", { version: status()?.version ?? "" })}
                      </Show>
                    </span>
                  </Show>
                </span>
                <Tip
                  target="span"
                  class="tool-note settings-hint"
                  label={toolMessage[tool] ?? ""}
                >
                  <Show when={busy() && fraction() !== undefined}>
                    {formatNumber(Math.round(fraction() * 100))}%
                  </Show>
                  <Show when={!busy() && toolMessage[tool]}>{toolMessage[tool]}</Show>
                </Tip>
                <button
                  type="button"
                  class="btn btn-ghost"
                  disabled={busy() || saving()}
                  onClick={() => void install(tool)}
                >
                  {busy()
                    ? t("tool.working")
                    : status()?.installed
                      ? t("settings.tool_reinstall")
                      : t("settings.tool_install")}
                </button>
              </div>
            );
          }}
        </For>

        <TextField
          id="set-ytdlp-path"
          label={t("settings.ytdlp_path")}
          hint={t("settings.ytdlp_path_hint")}
          placeholder={t("settings.ytdlp_path_placeholder")}
          value={settings.ytdlpPath}
          disabled={saving()}
          onCommit={(v) => save({ ytdlpPath: v })}
        />
      </section>

      {/* -------------------------------------------------------------
          Biçim seçicileri
      ------------------------------------------------------------- */}
      <section class="settings-section">
        <h2 class="section-title">{t("settings.tab.video")}</h2>

        <div class="settings-field">
          <label for="set-container">{t("settings.video_container")}</label>
          <select
            id="set-container"
            class="input"
            value={settings.videoContainer}
            disabled={saving()}
            onChange={(e) => save({ videoContainer: e.currentTarget.value })}
          >
            <For each={VIDEO_CONTAINERS}>
              {(value) => (
                <option value={value} selected={settings.videoContainer === value}>
                  {t(`settings.container.${value}`)}
                </option>
              )}
            </For>
          </select>
        </div>

        <div class="settings-field">
          <label for="set-height">{t("settings.video_max_height")}</label>
          <select
            id="set-height"
            class="input"
            value={String(settings.videoMaxHeight)}
            disabled={saving()}
            onChange={(e) => save({ videoMaxHeight: Number(e.currentTarget.value) })}
          >
            <For each={VIDEO_MAX_HEIGHTS}>
              {(height) => (
                <option value={height} selected={settings.videoMaxHeight === height}>
                  {t(heightLabelKey(height), heightParams(height))}
                </option>
              )}
            </For>
          </select>
        </div>

        <TextField
          id="set-format"
          label={t("settings.video_format")}
          hint={t("settings.video_format_hint")}
          value={settings.videoFormat}
          disabled={saving()}
          onCommit={(v) => save({ videoFormat: v })}
        />

        <div class="settings-field">
          <label>{t("settings.format_preview")}</label>
          <pre class="format-preview">{args().join(" ")}</pre>
        </div>
      </section>
    </>
  );
}

/* -----------------------------------------------------------------
   Sekme: Arayüz
   ----------------------------------------------------------------- */

function InterfaceTab(props: Pick<TabProps, "saving" | "guard">) {
  const { guard } = props;

  return (
    <>
      <section class="settings-section">
        <h2 class="section-title">{t("settings.section.language")}</h2>
        <div class="settings-row">
          <div class="lang-switch lang-switch-lg" role="group" aria-label={t("title.lang.label")}>
            <For each={LANGS}>
              {(code) => (
                <button
                  type="button"
                  class={`lang-opt ${settings.lang === code ? "lang-opt-active" : ""}`}
                  aria-pressed={settings.lang === code}
                  disabled={props.saving()}
                  onClick={() =>
                    void guard(() => updateSettings({ lang: code }), "settings.err.lang")
                  }
                >
                  {code.toUpperCase()}
                </button>
              )}
            </For>
          </div>
          <p class="settings-hint">{t("settings.lang_hint")}</p>
        </div>
      </section>

      <section class="settings-section">
        <h2 class="section-title">{t("settings.section.about")}</h2>
        <p class="settings-hint">{t("settings.about_hint")}</p>
      </section>
    </>
  );
}

/* -----------------------------------------------------------------
   Komut sarmalayıcıları — hata durumunda güvenli varsayılan döner
   ----------------------------------------------------------------- */

/** Tarayıcı listesi; hata olursa boş liste (varsayılana düşülür). */
async function browserListSafe(): Promise<BrowserId[]> {
  try {
    const list = await browserList();
    // Safari dosya kopyalanarak kurulmaz, bu bölüm ise yalnızca kopyalanan
    // paketlerle ilgilenir. Safari'yi sihirbaz yönetir; burada gösterilirse
    // "Dosyaları hazırla" düğmesi `err.unknown` ile geri dönerdi.
    return list.filter((b): b is BrowserId => b !== "safari");
  } catch {
    return [];
  }
}

/** Araç durumu; hata olursa boş liste (hepsi "kurulu değil" görünür). */
async function toolStatusSafe(): Promise<ToolStatus[]> {
  try {
    return await toolStatus();
  } catch {
    return [];
  }
}

/** Site girişi durumu; hata olursa sıfır değerler. */
async function siteLoginStatusSafe(): Promise<SiteLoginStatus> {
  try {
    return await siteLoginStatus();
  } catch {
    return { cookieCount: 0, savedAt: null, domains: [] };
  }
}
