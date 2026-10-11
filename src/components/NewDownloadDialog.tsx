/**
 * "Yeni İndirme" penceresi — araç çubuğundaki **URL Ekle** düğmesi, menüdeki
 * `Dosya ▸ URL Ekle` ve `Ctrl+N` ile açılır.
 *
 * Adres alanı kenar çubuğundan buraya taşındı; kenar çubuğu yalnızca görev ve
 * kategori filtrelerini taşır. Pencere açılır açılmaz girdi odaklanır, `Enter`
 * ile gönderilir, `Escape` ile kapanır.
 *
 * **Doğrulama** `checkDownloadUrl()` ile yapılır ve tek kaynaktan gelir: aynı
 * sonuç hem `Ekle` düğmesini hem hedef klasör önizlemesini yönetir. Hata
 * mesajı yalnızca odaktan çıkıldığında ya da gönderim denendiğinde görünür;
 * pencereyi açtıktan hemen sonra "adres girin" diye bağırmak gürültü olurdu.
 */
import { Show, createEffect, createMemo, createSignal, onMount } from "solid-js";
import {
  databasePath,
  resolveTargetPath,
  startDownload,
} from "../lib/api";
import { errorText, pushFeedback } from "../lib/useFeedback";
import { MAX_CHANNELS, MIN_CHANNELS, settings } from "../lib/settings";
import { addDialogOpen, setAddDialogOpen } from "../lib/ui";
import { checkDownloadUrl } from "../lib/format";
import { t } from "../lib/i18n";

export default function NewDownloadDialog() {
  const [url, setUrl] = createSignal("");
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

  onMount(async () => {
    try {
      setDbPath(await databasePath());
    } catch {
      // Tanı bilgisi opsiyoneldir.
    }
  });

  // Pencere açıldığında girdi hazır olsun (her açılışta yeniden odaklan).
  createEffect(() => {
    if (addDialogOpen()) input?.focus();
  });

  // Adres geçerli olduğu sürece hedef klasörü Rust tarafında çözdür.
  // Geçersiz girdide istek hiç gönderilmez — böylece önizleme ile hata
  // mesajı aynı kurallı görünür.
  createEffect(() => {
    const value = url().trim();
    if (!check().ok) {
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
    setUrl("");
    setTarget("");
    setTouched(false);
    setAddDialogOpen(false);
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
      const count = Math.min(
        MAX_CHANNELS,
        Math.max(MIN_CHANNELS, settings.defaultChannelCount),
      );
      await startDownload({
        url: url().trim(),
        filePath: null,
        channelCount: count,
      });

      // Kapanmadan önce alanları sıfırla ki bir sonraki açılışta önceki
      // adres kalmasın.
      setUrl("");
      setTarget("");
      setTouched(false);
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

              <div class="add-meta">
                <Show when={target()}>
                  <div class="add-meta-row">
                    <span class="add-meta-key">{t("add.save_to")}</span>
                    <span class="add-meta-value" title={target()}>
                      {target()}
                    </span>
                  </div>
                </Show>

                <div class="add-meta-row">
                  <span class="add-meta-key">{t("add.channels")}</span>
                  <span class="add-meta-value">
                    {t("form.channels_hint", {
                      count: settings.defaultChannelCount,
                    })}
                  </span>
                </div>

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