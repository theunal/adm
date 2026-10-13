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
import {
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
  onCleanup,
  onMount,
} from "solid-js";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  bridgeStatus,
  browserList,
  installExtension,
  openPluginFolder,
  openReleasePage,
  type BridgeStatus,
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
  const [busy, setBusy] = createSignal(false);
  /** Köprüye bağlanmış tarayıcı adları (canlı). */
  const [connected, setConnected] = createSignal<string[]>([]);

  const [status, { refetch: refetchStatus }] = createResource<BridgeStatus>(() =>
    bridgeStatus(),
  );
  const [browsers] = createResource<WizardBrowser[]>(() => browserList());

  /** Açılışta hangi tarayıcı seçiliyse onunla başla. */
  const initial = browserSetupBrowser();
  if (initial) setBrowser(initial);

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
   * Tek düğmeli kurulum — dosyaları hazırla, uzantı sayfasını aç, klasörü
   * göster (hepsi Rust tarafında, `install_extension`).
   *
   * Hata durumunda kullanıcıya mesaj gösterilir; klasör zaten açıldıysa
   * (tarayıcı bulunamadığında Rust klasörü yine açar) yol ekranda kalır.
   */
  async function doInstall() {
    const target = browser();
    if (target === "safari") return;
    setBusy(true);
    try {
      const path = await installExtension(target);
      setFolder(path);
      pushFeedback("success", t("wizard.prepared"));
    } catch (error) {
      pushFeedback("error", errorText(error));
    } finally {
      setBusy(false);
    }
  }

  /** Klasörü yeniden seçili göster (kurulum sonrası kaybolursa). */
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
                {/* Tek düğmeli kurulum: dosyaları hazırla + uzantı sayfasını
                    aç + klasörü seçili göster (Rust tarafında). */}
                <p>{t("wizard.install_hint", { browser: browserLabel(browser()) })}</p>
                <button
                  type="button"
                  class="btn btn-primary"
                  disabled={busy()}
                  onClick={doInstall}
                >
                  {busy() ? t("wizard.working") : t("wizard.install")}
                </button>

                {/* Hazırlanan klasör — kurulum sonrası gösterilir. */}
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
