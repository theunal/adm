/**
 * Türkçe sözlük — çeviri kaynağı.
 *
 * Bu dosya tek doğruluk kaynağıdır: `en.ts` bu tipi (`Dict = typeof tr`)
 * kullanarak **her anahtarı ve her iki dili de** tanımlamak zorundadır.
 * Eksik anahtar `tsc --noEmit` sırasında hata verir (`npm run build`).
 *
 * Değer türleri:
 * - `string` → tek biçimli metin.
 * - `{ one, other }` → çoğul biçimi (`Intl.PluralRules` seçer; TR'de
 *   `one`/`other` aynı metni taşısa da yapı iki dil için de simetriktir).
 *
 * Yer tutucular: `{ad}` biçiminde, `t(key, { ad: ... })` ile doldurulur.
 */
export const tr = {
  // -----------------------------------------------------------------
  // Uygulama kabuğu (App.tsx)
  // -----------------------------------------------------------------
  "app.init_failed": "Uygulama başlatılamadı: {error}",
  "app.loading": "Kayıtlar yükleniyor…",
  "app.root_missing": "Kök öğe (#root) bulunamadı",
  "app.stat.speed": "anlık hız",
  "app.stat.total_downloaded": "toplam indirildi",
  "app.tab.active": "Aktif İndirmeler",
  "app.tab.history": "Geçmiş",
  "app.log.hide": "Günlüğü gizle",
  "app.log.show": "Günlüğü göster",

  // -----------------------------------------------------------------
  // Başlık çubuğu (TitleBar.tsx)
  // -----------------------------------------------------------------
  "title.brand_sub": "Gelişmiş İndirme Yöneticisi",
  "title.idle": "Boşta",
  "title.lang.label": "Dil",
  "title.summary.active": "aktif",
  "title.summary.downloaded": "indirildi",
  "title.summary.speed": "hız",
  "title.win.close": "Kapat",
  "title.win.maximize": "Büyüt / Küçült",
  "title.win.maximize_aria": "Büyüt veya küçült",
  "title.win.minimize": "Küçült",
  "title.window": "ADM — Gelişmiş İndirme Yöneticisi",

  // -----------------------------------------------------------------
  // Yeni indirme formu (NewDownloadForm.tsx)
  // -----------------------------------------------------------------
  "form.browse": "Gözat",
  "form.channels_hint": "{count} kanal",
  "form.channels_label": "Kanal sayısı",
  "form.db_hint": "SQLite kayıtları etkin",
  "form.db_title": "Veritabanı: {path}",
  "form.err.default_dir": "Varsayılan klasör okunamadı: {error}",
  "form.err.pick": "Konum seçilemedi: {error}",
  "form.err.start": "İndirme başlatılamadı: {error}",
  "form.path_label": "Kayıt konumu",
  "form.submit": "İndirmeyi Ekle",
  "form.submitting": "Ekleniyor…",
  "form.title": "Yeni İndirme",
  "form.url_label": "Bağlantı adresi",
  "form.url_placeholder": "https://sunucu/dosya.bin",
  "form.warn.bad_scheme": "URL http:// veya https:// ile başlamalı",
  "form.warn.no_url": "Önce bir URL girin",

  // -----------------------------------------------------------------
  // Liste (DownloadList.tsx)
  // -----------------------------------------------------------------
  "list.clear": "Geçmişi temizle",
  "list.clear_title": "Tamamlanmış, başarısız ve iptal edilmiş kayıtları sil",
  "list.empty.active_hint": "Soldaki formu doldurup yeni bir indirme başlatın.",
  "list.empty.active_title": "Aktif indirme yok",
  "list.empty.history_hint": "Tamamlanan indirmeler burada listelenir.",
  "list.empty.history_title": "Geçmiş boş",
  "list.err.clear": "Kayıtlar temizlenemedi: {error}",
  "list.failed_hint": "{count} başarısız • {bytes} yarım",
  "list.failed_hint_title": "Başarısız kayıtların indirdiği miktar",
  "list.title.active": "Aktif İndirmeler",
  "list.title.history": "Geçmiş",

  // -----------------------------------------------------------------
  // Kart (DownloadCard.tsx)
  // -----------------------------------------------------------------
  "card.action.cancel": "İptal",
  "card.action.channel_change": "Kanal sayısı değişikliği",
  "card.action.delete": "Silme",
  "card.action.delete_record": "Kayıt silme",
  "card.action.failed": "{action} başarısız: {error}",
  "card.action.open_file": "Dosya açma",
  "card.action.open_folder": "Klasör açma",
  "card.action.pause": "Duraklatma",
  "card.action.resume": "Sürdürme",
  "card.busy_title": "İşlem sürüyor",
  "card.btn.cancel": "İptal",
  "card.btn.cancel_title": "İndirmeyi iptal et",
  "card.btn.channels": "Kanallar",
  "card.btn.channels_title": "Kanal sayısını değiştir",
  "card.btn.delete": "Sil",
  "card.btn.delete_title": "Kaydı ve dosyayı sil",
  "card.btn.del_record": "Kaydı sil",
  "card.btn.del_record_title": "Kaydı sil, dosyayı koru",
  "card.btn.folder": "Konum",
  "card.btn.folder_title": "Klasörü aç",
  "card.btn.open": "Aç",
  "card.btn.open_title": "Dosyayı aç",
  "card.btn.pause": "Duraklat",
  "card.btn.pause_title": "İndirmeyi duraklat",
  "card.btn.resume": "Sürdür",
  "card.btn.resume_title": "Kaldığı yerden sürdür",
  "card.channels.apply": "Uygula",
  "card.channels.cancel": "Vazgeç",
  "card.channels.label": "Kanal sayısı:",
  "card.channels.note":
    "Çalışan bir indirmede kanal sayısı değişince indirme duraklatılıp yeni sayıyla sürdürülür.",
  "card.channels_title": "Kanal bazlı ilerleme",
  "card.metric.added_at": "eklendi",
  "card.metric.channels": "kanal",
  "card.metric.downloaded": "indirildi",
  "card.metric.eta": "kalan",
  "card.metric.finished_at": "bitti",
  "card.metric.in_status": "durumda",
  "card.metric.speed": "hız",
  "card.progress_aria": "İndirme ilerlemesi",
  "card.size_unknown": "Boyut bilinmiyor",

  // -----------------------------------------------------------------
  // Diyaloglar (DownloadCard.tsx -> api.ts)
  // -----------------------------------------------------------------
  "dialog.delete_file.body": "\"{name}\" kaydı ve indirilen dosya silinsin mi?",
  "dialog.delete_file.title": "İndirmeyi sil",
  "dialog.delete_record.body": "\"{name}\" kaydı silinsin mi? Dosya korunur.",
  "dialog.delete_record.title": "Kaydı sil",
  "dialog.save_title": "İndirilecek dosyayı seç",
  "dialog.confirm_title": "Onay",

  // -----------------------------------------------------------------
  // Log paneli (LogPanel.tsx) ve grafik (Sparkline.tsx)
  // -----------------------------------------------------------------
  "log.aria": "Olay günlüğü",
  "log.clear": "Temizle",
  "log.empty": "Henüz olay yok.",
  "log.title": "Olay Günlüğü",
  "log.to_bottom": "En alta git",
  "spark.empty_title": "Hız geçmişi oluşuyor",

  // -----------------------------------------------------------------
  // Depo (store.ts)
  // -----------------------------------------------------------------
  "error.unknown": "Bilinmeyen hata",
  "log.list_refresh_failed": "Liste yenilenemedi: {error}",
  "log.records_load_failed": "Kayıtlar yüklenemedi: {error}",
  "log.records_loaded": {
    one: "{count} kayıt yüklendi",
    other: "{count} kayıt yüklendi",
  },
  "log.status_line": "{name}: {status}",

  // -----------------------------------------------------------------
  // Biçimlendirme (format.ts)
  // -----------------------------------------------------------------
  "dur.days_hours": "{days}g {hours}s",
  "dur.hours_minutes": "{hours}s {minutes}dk",
  "dur.minutes_seconds": "{minutes}dk {seconds}sn",
  "dur.one_second": "1sn",
  "dur.seconds_only": "{seconds}sn",
  "status.Cancelled": "İptal Edildi",
  "status.Completed": "Tamamlandı",
  "status.Downloading": "İndiriliyor",
  "status.Failed": "Başarısız",
  "status.Paused": "Duraklatıldı",
  "status.Queued": "Sırada",
};

/**
 * Sözlük tipleri.
 *
 * `Dict`, `tr.ts`'in çıkarılan tipidir: `en.ts` bu tipi uygularsa eksik ya da
 * fazla anahtar derleme hatası verir.
 */
export type Template = string | { one: string; other: string };
export type Dict = typeof tr;