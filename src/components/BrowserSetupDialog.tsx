/**
 * Tarayıcı eklentisi kurulum sihirbazı — **tek düğmeli** akış.
 *
 * Adım adım yönlendirme yerine tek bir "Eklentiyi Yükle" düğmesi vardır.
 * Düğmeye basıldığında Rust tarafı (`extension::install_extension`) üç işi
 * sırayla yapar:
 *
 * 1. eklenti dosyalarını `%LOCALAPPDATA%\ADM\Browser Plugins\<Tarayıcı>`
 *    altına kopyalar,
 * 2. tarayıcı **ikilisini** uzantı sayfasıyla (`brave://extensions`,
 *    `chrome://extensions`, `edge://extensions`, Firefox'da
 *    `about:debugging`) başlatır — `brave://` şeması OS'ta kayıtlı bir
 *    protokol olmadığı için ikiliyi doğrudan çalıştırmak gerekir,
 * 3. hazırlanan klasörü dosya yöneticisinde **seçili** gösterir.
 *
 * Kullanıcının tek yapması gereken, açılan uzantı sayfasında
 * **"Paketlenmemiş öğe yükle"** düğmesine basıp bu klasörü seçmektir.
 * Uzantı köprüye ilk isteği attığında "Bağlandı" durumu kendiliğinden yanar
 * (`bridge_status` + `download://event` üzerindeki `bridgeConnection`).
 *
 * **Safari** bu akışın dışındadır: uzantı `.appex` olduğu için dosya
 * kopyalanarak kurulamaz, sürüm sayfasından indirilen ayrı bir `.app`
 * içinde gelir. Safari seçiliyken düğme yerine yönlendirme listesi gösterilir.
 * Safari yalnızca macOS'ta listelendiğinden bu dal Windows'ta görülemez.
 *
 * Köprü çalışmıyorsa sihirbaz bunu en başta söyler: kullanıcı boşuna
 * eklenti kurmasın.
 */
import { createMemo, createResource, createSignal, For, Show, createEffect, onCleanup, onMount } from "solid-js";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  bridgeStatus,
  browserList,
  browserPresence,
  installExtensionCrx,
  installExtensionFolder,
  openPluginFolder,
  openReleasePage,
  revealFile,
  type BridgeStatus,
  type BrowserPresence,
  type CrxOutcome,
  type WizardBrowser,
} from "../lib/api";
import { closeBrowserSetup, browserSetupBrowser } from "../lib/ui";
import { t } from "../lib/i18n";
import { errorText, pushFeedback } from "../lib/useFeedback";
import Tip from "./Tip";

/** Tarayıcı listesi alınamazsa gösterilen varsayılan sıra (macOS dışı). */
const FALLBACK_BROWSERS: WizardBrowser[] = ["chrome", "edge", "brave", "firefox"];

/** Tarayıcının görünen adı (marka yazımıyla). */
function browserLabel(browser: WizardBrowser): string {
  switch (browser) {
    case "chrome":
      return "Chrome";
    case "edge":
      return "Edge";
    case "brave":
      return "Brave";
    case "firefox":
      return "Firefox";
    case "safari":
      return "Safari";
  }
}

export default function BrowserSetupDialog() {
  const [browser, setBrowser] = createSignal<WizardBrowser>("chrome");
  const [folder, setFolder] = createSignal<string | null>(null);
  const [crxPath, setCrxPath] = createSignal<string | null>(null);
  /** Geliştirici modu açma denemesinin sonucu (`.crx` akışı). */
  const [devMode, setDevMode] = createSignal<CrxOutcome["developerMode"] | null>(null);
  const [busy, setBusy] = createSignal(false);
  /** Köprüye bağlanmış tarayıcı adları (canlı). */
  const [connected, setConnected] = createSignal<string[]>([]);

  const [status, { refetch: refetchStatus }] = createResource<BridgeStatus>(() =>
    bridgeStatus(),
  );
  const [browsers] = createResource<WizardBrowser[]>(() => browserList());
  /** Kurulu tarayıcılar (kurulu olmayanlar listede devre dışı). */
  const [presence] = createResource<BrowserPresence[]>(() => browserPresence());

  /** Açılışta hangi tarayıcı seçiliyse onunla başla. */
  const initial = browserSetupBrowser();
  if (initial) setBrowser(initial);

  /**
   * Tarayıcı kurulu mu? Bilgi gelmediyse (`undefined`) **etkin** sayılır:
   * kullanıcıyı bilgisizce kilitlememek için yalnızca kesin "kurulu değil"
   * bilgisinde devre dışı yapılır.
   */
  function isInstalled(id: WizardBrowser): boolean {
    const entry = presence()?.find((b) => b.id === id);
    return entry ? entry.installed : true;
  }

  /** Kurulu tarayıcı listesi (bilgi yoksa tümü). */
  const available = createMemo<WizardBrowser[]>(
    () => browsers()?.filter((id) => isInstalled(id)) ?? FALLBACK_BROWSERS,
  );

  /** Seçili tarayıcı kurulu değilse ilk kurulu tarayıcıya geç. */
  createEffect(() => {
    const list = available();
    if (list.length > 0 && !list.includes(browser())) {
      setBrowser(list[0]);
    }
  });

  /**
   * Safari mi seçili?
   *
   * Dosya kopyalama adımları bu tarayıcıda anlamsızdır; sihirbaz onların
   * yerine yönlendirme listesi gösterir.
   */
  const isSafari = createMemo(() => browser() === "safari");

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

  /**
   * `.crx` akışlı kurulum — indir, geliştirici modunu aç, uzantı sayfasını
   * aç, `.crx`'yi seçili göster (hepsi Rust tarafında).
   *
   * Hata durumunda kullanıcıya mesaj gösterilir; `.crx` zaten görünür
   * durumdaysa (ör. dosya yöneticisi açılamadı) yol ekranda kalır.
   */
  async function doInstall() {
    const target = browser();
    if (target === "safari") return;
    setBusy(true);
    try {
      const outcome = await installExtensionCrx(target);
      setCrxPath(outcome.crxPath);
      setDevMode(outcome.developerMode);
      pushFeedback("success", t("wizard.crx_ready"));
    } catch (error) {
      pushFeedback("error", errorText(error));
    } finally {
      setBusy(false);
    }
  }

  /** `.crx` dosyasını yeniden seçili göster (sürüklerken kaybolursa). */
  async function doRevealCrx() {
    const path = crxPath();
    if (!path) return;
    try {
      await revealFile(path);
    } catch (error) {
      pushFeedback("error", errorText(error));
    }
  }

  /** Yedek akış: klasörü hazırla ve uzantı sayfasını aç (paketlenmemiş). */
  async function doFallback() {
    const target = browser();
    if (target === "safari") return;
    setBusy(true);
    try {
      const path = await installExtensionFolder(target);
      setFolder(path);
      pushFeedback("success", t("wizard.prepared"));
    } catch (error) {
      pushFeedback("error", errorText(error));
    } finally {
      setBusy(false);
    }
  }

  /** Klasörü yeniden seçili göster (yedek akıştan sonra kaybolursa). */
  async function doOpenFolder() {
    const target = browser();
    if (target === "safari") return;
    try {
      await openPluginFolder(target);
    } catch (error) {
      pushFeedback("error", errorText(error));
    }
  }

  /** Safari — sürüm sayfasını aç (`safari-unsigned-macos.zip` oradadır). */
  async function doOpenRelease() {
    try {
      await openReleasePage();
    } catch (error) {
      pushFeedback("error", errorText(error));
    }
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

            {/* Tarayıcı seçimi — kurulu olmayanlar devre dışı. Kullanıcı
                istemeden kurulu olmayan bir tarayıcı seçip hata almasın. */}
            <div class="wizard-browsers">
              <For each={browsers() ?? FALLBACK_BROWSERS}>
                {(id) => {
                  const installed = () => isInstalled(id);
                  return (
                    <Tip
                      label={installed() ? browserLabel(id) : t("wizard.not_installed", { browser: browserLabel(id) })}
                      class={`wizard-browser${browser() === id ? " active" : ""}${installed() ? "" : " wizard-browser-off"}`}
                      disabled={!installed()}
                      onClick={() => {
                        setBrowser(id);
                        // Tarayıcı değişince akış baştan başlar: her akış
                        // kendi `.crx` klasörüne/klasörüne bakar.
                        setFolder(null);
                        setCrxPath(null);
                        setDevMode(null);
                      }}
                    >
                      {browserLabel(id)}
                      <Show when={connected().some((b) => b.toLowerCase() === id)}>
                        <span class="wizard-dot" aria-hidden="true" />
                      </Show>
                    </Tip>
                  );
                }}
              </For>
            </div>

            {/* Geçerli adımın açıklaması */}
            <div class="wizard-body">
              <Show
                when={!isSafari()}
                fallback={
                  <>
                    <p>{t("wizard.safari.lead")}</p>
                    <ol>
                      <li>{t("wizard.safari.step1")}</li>
                      <li>{t("wizard.safari.step2")}</li>
                      <li>{t("wizard.safari.step3")}</li>
                      <li>{t("wizard.safari.step4")}</li>
                    </ol>
                    <button
                      type="button"
                      class="btn btn-primary"
                      onClick={doOpenRelease}
                    >
                      {t("wizard.safari.download")}
                    </button>

                    {/* Doğrulama, diğer tarayıcılarla aynı köprü mantığıyla
                        yürür: Safari de aynı MV3 kodunu çalıştırır ve köprüye
                        `safari` adıyla bağlanır. */}
                    <Show
                      when={isConnected()}
                      fallback={
                        <>
                          <p>{t("wizard.safari.waiting")}</p>
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
                  </>
                }
              >
                {/* `.crx` akışı: indir → geliştirici modunu aç → sayfayı aç →
                    `.crx`'yi seçili göster (Rust tarafında). Kullanıcı tek
                    yapar: dosyayı sayfaya sürükler ve "Uzantı ekle" onayını
                    verir. */}
                <p>{t("wizard.install_hint", { browser: browserLabel(browser()) })}</p>
                <button
                  type="button"
                  class="btn btn-primary"
                  disabled={busy()}
                  onClick={doInstall}
                >
                  {busy() ? t("wizard.working") : t("wizard.install")}
                </button>

                {/* Geliştirici modu açılamadıysa (tarayıcı açık) uyar. Kurulum
                    bu yüzden durmaz — kullanıcı yine de ilerleyebilir. */}
                <Show when={devMode() === "browserClosed"}>
                  <div class="wizard-warn">
                    {t("wizard.dev_mode_browser_open")}
                  </div>
                </Show>

                {/* İndirilen `.crx` — sürüklenecek dosya. */}
                <Show when={crxPath()}>
                  {(path) => (
                    <div class="wizard-path">
                      <Tip target="span" label={path()}>
                        <code>{path()}</code>
                      </Tip>
                      <button type="button" class="btn" onClick={doRevealCrx}>
                        {t("wizard.action.show_file")}
                      </button>
                    </div>
                  )}
                </Show>

                {/* Yedek akış: `.crx` sürükle-bırak çalışmazsa klasörle kur. */}
                <Show when={crxPath()}>
                  <p class="wizard-fallback">
                    <button type="button" class="btn btn-ghost" onClick={doFallback}>
                      {t("wizard.fallback_load_unpacked")}
                    </button>
                  </p>
                </Show>

                {/* Yedek akışın klasörü — kurulum sonrası gösterilir. */}
                <Show when={folder()}>
                  {(path) => (
                    <div class="wizard-path">
                      <Tip target="span" label={path()}>
                        <code>{path()}</code>
                      </Tip>
                      <button type="button" class="btn" onClick={doOpenFolder}>
                        {t("wizard.action.open_folder")}
                      </button>
                    </div>
                  )}
                </Show>

                {/* Bağlantı durumu — uzantı köprüye ilk isteği atınca yanar. */}
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
