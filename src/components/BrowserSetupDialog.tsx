/**
 * Tarayıcı eklentisi kurulum sihirbazı — MC `ExtensionSetupWizard` portu.
 *
 * Sihirbaz tarayıcı başına **adım adım** yönlendirir:
 *
 * 1. **Hazırla** — eklenti dosyaları `%LOCALAPPDATA%\ADM\Browser Plugins\<Tarayıcı>`
 *    altına kopyalanır (`prepare_browser_files`).
 * 2. **Aç** — tarayıcının uzantı yönetimi sayfası açılır
 *    (`open_browser_extensions_page`).
 * 3. **Yükle** — "Paketlenmemiş öğe yükle" ile 1. adımdaki klasör seçilir;
 *    klasör düğmesiyle dosya yöneticisinde açılabilir (`open_plugin_folder`).
 * 4. **Bağlan** — köprüye ilk istek geldiğinde adım kendiliğinden tamamlanır
 *    (`bridge_status` + `download://event` üzerindeki `bridgeConnection`).
 *
 * Firefox'ta 2. adım `about:debugging#/runtime/this-firefox` olur ve
 * "Geçici eklenti yükle" ile klasördeki `manifest.json` seçilir.
 *
 * Köprü çalışmıyorsa sihirbaz bunu en başta söyler: kullanıcı boşuna
 * eklenti kurmasın.
 */
import { createMemo, createResource, For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  bridgeStatus,
  browserList,
  openBrowserExtensionsPage,
  openPluginFolder,
  prepareBrowserFiles,
  type BridgeStatus,
  type BrowserId,
} from "../lib/api";
import { closeBrowserSetup, browserSetupBrowser } from "../lib/ui";
import { t } from "../lib/i18n";
import { errorText, pushFeedback } from "../lib/useFeedback";

/** Sihirbaz adımları (sırayla). */
const STEPS = ["prepare", "open", "load", "connect"] as const;
type Step = (typeof STEPS)[number];

/** Tarayıcı listesi alınamazsa gösterilen varsayılan sıra. */
const FALLBACK_BROWSERS: BrowserId[] = ["chrome", "edge", "brave", "firefox"];

/** Adımın sözlük anahtarı. */
function stepTitle(step: Step): string {
  return t(`wizard.step.${step}`);
}

/** Tarayıcının görünen adı (marka yazımıyla). */
function browserLabel(browser: BrowserId): string {
  switch (browser) {
    case "chrome":
      return "Chrome";
    case "edge":
      return "Edge";
    case "brave":
      return "Brave";
    case "firefox":
      return "Firefox";
  }
}

export default function BrowserSetupDialog() {
  const [browser, setBrowser] = createSignal<BrowserId>("chrome");
  const [folder, setFolder] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  /** Kullanıcı hangi adımı görüyor (0..=3). */
  const [step, setStep] = createSignal(0);
  /** Köprüye bağlanmış tarayıcı adları (canlı). */
  const [connected, setConnected] = createSignal<string[]>([]);

  const [status, { refetch: refetchStatus }] = createResource<BridgeStatus>(() =>
    bridgeStatus(),
  );
  const [browsers] = createResource<BrowserId[]>(() => browserList());

  /** Açılışta hangi tarayıcı seçiliyse onunla başla. */
  const initial = browserSetupBrowser();
  if (initial) setBrowser(initial);

  /** Bağlantı kurulan tarayıcı bu sihirbazın tarayıcısı mı? */
  const isConnected = createMemo(() => {
    const wanted = browser().toLowerCase();
    return connected().some((b) => b.toLowerCase() === wanted);
  });

  // Bağlantı olayını dinle: köprüye ilk istek geldiğinde "Bağlan" adımı
  // kendiliğinden tamamlanır.
  let unlisten: UnlistenFn | null = null;
  onMount(async () => {
    unlisten = await listen<{ kind: string; browser?: string }>(
      "download://event",
      (event) => {
        if (event.payload.kind !== "bridgeConnection" || !event.payload.browser) return;
        const name = event.payload.browser;
        setConnected((prev) => (prev.includes(name) ? prev : [...prev, name]));
      },
    );
    // Sihirbaz açıldığında durum tazelenir (önceden bağlanmış olabilir).
    const snapshot = await bridgeStatus().catch(() => null);
    if (snapshot) setConnected(snapshot.browsers);
  });
  onCleanup(() => unlisten?.());

  /** 1. adım — eklenti dosyalarını kopyala. */
  async function doPrepare() {
    setBusy(true);
    try {
      const path = await prepareBrowserFiles(browser());
      setFolder(path);
      setStep(1);
      pushFeedback("success", t("wizard.prepared"));
    } catch (error) {
      pushFeedback("error", errorText(error));
    } finally {
      setBusy(false);
    }
  }

  /** 2. adım — uzantı sayfasını aç. */
  async function doOpenPage() {
    try {
      await openBrowserExtensionsPage(browser());
      setStep(2);
    } catch (error) {
      pushFeedback("error", errorText(error));
    }
  }

  /** 3. adım — klasörü göster, "Bağlan" adımına geç. */
  async function doOpenFolder() {
    try {
      await openPluginFolder(browser());
      setStep(3);
    } catch (error) {
      pushFeedback("error", errorText(error));
    }
  }

  /** Adım tamamlanma durumu (gösterge için). */
  function stepDone(index: number): boolean {
    if (index === 3) return isConnected();
    return step() > index;
  }

  return (
    <Show when={browserSetupBrowser()}>
      <div
        class="modal-backdrop"
        onClick={closeBrowserSetup}
        onKeyDown={(e) => {
          if (e.key === "Escape") closeBrowserSetup();
        }}
      >
        <div
          class="modal modal-wide"
          role="dialog"
          aria-modal="true"
          aria-label={t("wizard.title")}
          onClick={(e) => e.stopPropagation()}
        >
          <div class="modal-title">
            <span class="modal-title-text">{t("wizard.title")}</span>
            <button
              type="button"
              class="dock-close"
              aria-label={t("title.win.close")}
              onClick={closeBrowserSetup}
            >
              ✕
            </button>
          </div>

          <div class="modal-body">
            {/* Köprü çalışmıyor mu? Eklenti kurmadan önce bunu söyle. */}
            <Show when={status() && !status()!.running}>
              <div class="wizard-warn">{t("wizard.bridge_off")}</div>
            </Show>
            <Show when={status()?.running}>
              <div class="wizard-bridge">
                {t("wizard.bridge_on", { port: status()!.port })}
              </div>
            </Show>

            {/* Tarayıcı seçimi */}
            <div class="wizard-browsers">
              <For each={browsers() ?? FALLBACK_BROWSERS}>
                {(id) => (
                  <button
                    type="button"
                    class={`wizard-browser${browser() === id ? " active" : ""}`}
                    disabled={busy()}
                    onClick={() => {
                      setBrowser(id);
                      // Tarayıcı değişince akış baştan başlar: dosyalar
                      // tarayıcı başına ayrı klasöre kopyalanır.
                      setFolder(null);
                      setStep(0);
                    }}
                  >
                    {browserLabel(id)}
                    <Show when={connected().some((b) => b.toLowerCase() === id)}>
                      <span class="wizard-dot" aria-hidden="true" />
                    </Show>
                  </button>
                )}
              </For>
            </div>

            {/* Adım göstergesi */}
            <ol class="wizard-steps">
              <For each={STEPS}>
                {(item, index) => (
                  <li
                    class={`wizard-step${step() === index() ? " current" : ""}${
                      stepDone(index()) ? " done" : ""
                    }`}
                  >
                    <span class="wizard-step-no">
                      {stepDone(index()) ? "✓" : index() + 1}
                    </span>
                    <span class="wizard-step-text">{stepTitle(item)}</span>
                  </li>
                )}
              </For>
            </ol>

            {/* Geçerli adımın açıklaması */}
            <div class="wizard-body">
              <Show when={step() === 0}>
                <p>{t("wizard.hint.prepare", { browser: browserLabel(browser()) })}</p>
                <button
                  type="button"
                  class="btn btn-primary"
                  disabled={busy()}
                  onClick={doPrepare}
                >
                  {busy() ? t("wizard.working") : t("wizard.action.prepare")}
                </button>
              </Show>

              <Show when={step() === 1}>
                <p>
                  {browser() === "firefox"
                    ? t("wizard.hint.open_firefox")
                    : t("wizard.hint.open")}
                </p>
                <button
                  type="button"
                  class="btn btn-primary"
                  onClick={doOpenPage}
                >
                  {browser() === "firefox"
                    ? t("wizard.action.open_firefox")
                    : t("wizard.action.open")}
                </button>
              </Show>

              <Show when={step() === 2}>
                <p>
                  {browser() === "firefox"
                    ? t("wizard.hint.load_firefox")
                    : t("wizard.hint.load")}
                </p>
                <div class="wizard-path">
                  <code title={folder() ?? ""}>{folder() ?? "—"}</code>
                  <button type="button" class="btn" onClick={doOpenFolder}>
                    {t("wizard.action.open_folder")}
                  </button>
                </div>
              </Show>

              <Show when={step() === 3}>
                <Show
                  when={isConnected()}
                  fallback={
                    <>
                      <p>{t("wizard.hint.connect")}</p>
                      <button
                        type="button"
                        class="btn"
                        onClick={() => void refetchStatus()}
                      >
                        {t("wizard.action.recheck")}
                      </button>
                    </>
                  }
                >
                  <p class="wizard-ok">
                    {t("wizard.connected", { browser: browserLabel(browser()) })}
                  </p>
                </Show>
              </Show>
            </div>
          </div>

          <div class="modal-actions">
            <button
              type="button"
              class="btn btn-primary"
              onClick={closeBrowserSetup}
            >
              {t("wizard.close")}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
