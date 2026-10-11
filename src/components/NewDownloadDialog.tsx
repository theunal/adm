/**
 * "Yeni İndirme" penceresi — araç çubuğundaki **URL Ekle** düğmesi, menüdeki
 * `Dosya ▸ URL Ekle` ve `Ctrl+N` ile açılır.
 *
 * MC `AddDownloadView` portu: adres alanının üstünde **tür seçimi**
 * (Dosya / Video) ve dosya türünde **bağlantı sayısı** bulunur. Video
 * seçildiğinde indirmeyi yt-dlp yürütür; bağlantı sayısı ve hedef yol
 * önizlemesi anlamını yitirdiği için gizlenir.
 *
 * Pencere açılır açılmaz girdi odaklanır, `Enter` ile gönderilir, `Escape`
 * ile kapanır.
 *
 * **Doğrulama** `checkDownloadUrl()` ile yapılır ve tek kaynaktan gelir: aynı
 * sonuç hem `Ekle` düğmesini hem hedef klasör önizlemesini yönetir. Hata
 * mesajı yalnızca odaktan çıkıldığında ya da gönderim denendiğinde görünür;
 * pencereyi açtıktan hemen sonra "adres girin" diye bağırmak gürültü olurdu.
 */
import { For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js";
import {
  databasePath,
  resolveTargetPath,
  startDownload,
} from "../lib/api";
import { errorText, pushFeedback } from "../lib/useFeedback";
import { CHANNEL_PRESETS, MAX_CHANNELS, MIN_CHANNELS, settings } from "../lib/settings";
import { addDialogOpen, setAddDialogOpen } from "../lib/ui";
import { checkDownloadUrl, type DownloadKind } from "../lib/format";
import { t } from "../lib/i18n";

/** Tür seçicisinin sırası. */
const KINDS: { id: DownloadKind; label: string; hint: string }[] = [
  { id: "file", label: "add.kind_file", hint: "add.kind_file_hint" },
  { id: "video", label: "add.kind_video", hint: "add.kind_video_hint" },
];

export default function NewDownloadDialog() {
  const [url, setUrl] = createSignal("");
  const [kind, setKind] = createSignal<DownloadKind>("file");
  const [channels, setChannels] = createSignal(settings.defaultChannelCount);
  const [submitting, setSubmitting] = createSignal(false);
  const [dbPath, setDbPath] = createSignal("");
  /** Yazılan adrese göre çözümlenen hedef klasör önizlemesi. */
  const [target, setTarget] = createSignal("");
  /**
   * Kullanıcı alana dokundu mu?
   *
   * `false` iken hata mesajı hiç gösterilmez. Odak kaybı (`onBlur`) veya
   * gönderim denemesiyle `true` olur; kapatılırken sıfırlanır.
   */
  const [touched, setTouched] = createSignal(false);

  let input: HTMLInputElement | undefined;

  /** Adresin denetim sonucu. */
  const check = createMemo(() => checkDownloadUrl(url()));

  /** Görüntülenecek hata metni (`null` ise gösterilecek mesaj yok). */
  const message = createMemo(() => {
    if (!touched()) return null;
    const result = check();
    return result.ok ? null : t(`form.err_url.${result.reason}`);
  });

  /** Etkin türün ipucu metni. */
  const kindHint = createMemo(
    () => KINDS.find((k) => k.id === kind())?.hint ?? "add.kind_file_hint",
  );

  /** Dosya indirmeleri mi? (bağlantı sayısı ve hedef önizlemesi yalnızca o zaman) */
  const isFile = createMemo(() => kind() === "file");

  onMount(async () => {
    try {
      setDbPath(await databasePath());
    } catch {
      // Tanı bilgisi opsiyoneldir.
    }
  });

  // Pencere açıldığında girdi hazır olsun (her açılışta yeniden odaklan);
  // bağlantı sayısı da ayarlardaki güncel varsayılana döner.
  createEffect(() => {
    if (addDialogOpen()) {
      input?.focus();
      setChannels(settings.defaultChannelCount);
    }
  });

  // Adres geçerli olduğu sürece hedef klasörü Rust tarafında çözdür.
  // Geçersiz girdide istek hiç gönderilmez — böylece önizleme ile hata
  // mesajı aynı kurallı görünür. Video indirmelerinde dosya adını yt-dlp
  // belirlediği için önizleme yanıltıcı olurdu; o yüzden sorulmaz.
  createEffect(() => {
    const value = url().trim();
    if (!check().ok || !isFile()) {
      setTarget("");
      return;
    }
    let cancelled = false;
    void resolveTargetPath(value)
      .then((path) => {
        if (!cancelled) setTarget(path);
      })
      .catch(() => {
        if (!cancelled) setTarget("");
      });
    return () => {
      cancelled = true;
    };
  });

  /** Pencereyi kapatır ve girdiyi temizler. */
  function close() {
    if (submitting()) return;
    reset();
    setAddDialogOpen(false);
  }

  /** Formu ilk durumuna döndürür. */
  function reset() {
    setUrl("");
    setKind("file");
    setTarget("");
    setTouched(false);
  }

  /** Formu gönderir. */
  async function submit(event: Event) {
    event.preventDefault();
    if (submitting()) return;

    // Adres geçersizse gönderilmez; yalnızca hata mesajı görünür olur.
    if (!check().ok) {
      setTouched(true);
      input?.focus();
      return;
    }

    setSubmitting(true);
    try {
      // Konum boş gönderiliyor: Rust, uzantıya göre ayarlardaki hedefi çözer.
      const count = Math.min(MAX_CHANNELS, Math.max(MIN_CHANNELS, channels()));
      await startDownload({
        url: url().trim(),
        filePath: null,
        channelCount: count,
        kind: kind(),
      });

      // Kapanmadan önce alanları sıfırla ki bir sonraki açılışta önceki
      // adres kalmasın.
      reset();
      setAddDialogOpen(false);
    } catch (e) {
      pushFeedback("error", t("form.err.start", { error: errorText(e) }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Show when={addDialogOpen()}>
      <div
        class="modal-backdrop"
        onClick={close}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
      >
        <div
          class="modal modal-wide"
          role="dialog"
          aria-modal="true"
          aria-label={t("form.title")}
          onClick={(e) => e.stopPropagation()}
        >
          <div class="modal-title">
            <span class="modal-title-text">{t("form.title")}</span>
            <button
              type="button"
              class="dock-close"
              aria-label={t("title.win.close")}
              onClick={close}
            >
              ✕
            </button>
          </div>

          {/* `form` özniteliği sayesinde alt taraftaki "Ekle" düğmesi bu
              forma bağlanır; adres alanında Enter da gönderir. */}
          <div class="modal-body">
            <form id="dl-form" class="add-dialog" onSubmit={submit} noValidate>
              {/* Tür seçimi (MC `AddDownloadView` segmented control) */}
              <div class="field">
                <label>{t("add.kind")}</label>
                <div class="kind-switch" role="radiogroup" aria-label={t("add.kind")}>
                  <For each={KINDS}>
                    {(item) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={kind() === item.id}
                        class={`kind-opt ${kind() === item.id ? "kind-opt-active" : ""}`}
                        disabled={submitting()}
                        onClick={() => setKind(item.id)}
                      >
                        {t(item.label)}
                      </button>
                    )}
                  </For>
                </div>
                <p class="settings-hint">{t(kindHint())}</p>
              </div>

              <div class="field">
                <label for="dl-url">{t("form.url_label")}</label>
                <input
                  ref={input}
                  id="dl-url"
                  type="url"
                  inputmode="url"
                  class={`input ${message() ? "input-invalid" : ""}`}
                  placeholder={t("form.url_placeholder")}
                  autocomplete="off"
                  spellcheck={false}
                  value={url()}
                  disabled={submitting()}
                  aria-invalid={message() ? "true" : "false"}
                  aria-describedby={message() ? "dl-url-error" : undefined}
                  onInput={(e) => setUrl(e.currentTarget.value)}
                  onBlur={() => setTouched(true)}
                />

                <Show when={message()}>
                  <p class="field-error" id="dl-url-error" role="alert">
                    {message()}
                  </p>
                </Show>
              </div>

              {/* Bağlantı sayısı — yalnızca dosya indirmelerinde anlamlı */}
              <Show when={isFile()}>
                <div class="field">
                  <label for="dl-channels">
                    {t("add.channels_field")}
                    <span class="field-hint">{t("form.channels_hint", { count: channels() })}</span>
                  </label>
                  <div class="slider-row">
                    <input
                      id="dl-channels"
                      type="range"
                      class="slider"
                      min={MIN_CHANNELS}
                      max={MAX_CHANNELS}
                      step="1"
                      value={channels()}
                      disabled={submitting()}
                      onInput={(e) => setChannels(Number(e.currentTarget.value))}
                    />
                    <div class="slider-presets">
                      <For each={CHANNEL_PRESETS}>
                        {(n) => (
                          <button
                            type="button"
                            class={`preset ${channels() === n ? "preset-active" : ""}`}
                            disabled={submitting()}
                            onClick={() => setChannels(n)}
                          >
                            {n}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                  <p class="settings-hint">{t("add.channels_note")}</p>
                </div>
              </Show>

              <div class="add-meta">
                <Show when={target()}>
                  <div class="add-meta-row">
                    <span class="add-meta-key">{t("add.save_to")}</span>
                    <span class="add-meta-value" title={target()}>
                      {target()}
                    </span>
                  </div>
                </Show>

                <Show when={dbPath()}>
                  <div class="add-meta-row">
                    <span
                      class="add-meta-value"
                      title={t("form.db_title", { path: dbPath() })}
                    >
                      {t("form.db_hint")}
                    </span>
                  </div>
                </Show>
              </div>
            </form>
          </div>

          <div class="modal-actions">
            <button type="button" class="btn" disabled={submitting()} onClick={close}>
              {t("form.cancel")}
            </button>
            <button
              type="submit"
              form="dl-form"
              class="btn btn-primary"
              disabled={submitting() || !check().ok}
            >
              {submitting() ? t("form.submitting") : t("form.submit")}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
