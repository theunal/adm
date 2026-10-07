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
  "app.root_missing": "Arayüz başlatılamadı",

  // -----------------------------------------------------------------
  // Başlık çubuğu (TitleBar.tsx)
  // -----------------------------------------------------------------
  "title.brand_sub": "Gelişmiş İndirme Yöneticisi",
  "title.lang.label": "Dil",
  "title.win.close": "Kapat",
  "title.win.maximize": "Büyüt / Küçült",
  "title.win.maximize_aria": "Büyüt veya küçült",
  "title.win.minimize": "Küçült",
  "title.window": "ADM — Gelişmiş İndirme Yöneticisi",

  // -----------------------------------------------------------------
  // Menü çubuğu (MenuBar.tsx)
  // -----------------------------------------------------------------
  "menu.file": "Dosya",
  "menu.downloads": "İndirmeler",
  "menu.tasks": "Görevler",
  "menu.options": "Seçenekler",
  "menu.help": "Yardım",
  "menu.item.add_url": "URL Ekle",
  "menu.item.open_file": "Dosyayı Aç",
  "menu.item.open_folder": "Klasörü Aç",
  "menu.item.copy_url": "Adresi Panoya Kopyala",
  "menu.item.pause_all": "Tümünü Duraklat",
  "menu.item.resume_all": "Tümünü Sürdür",
  "menu.item.cancel_all": "Tümünü İptal Et",
  "menu.item.select_all": "Tümünü Seç",
  "menu.item.clear_history": "Listeyi Temizle",
  "menu.item.delete_record": "Kaydı Sil",
  "menu.item.delete_download": "İndirmeyi Sil",
  "menu.item.properties": "Özellikler…",
  "menu.item.speed_graph": "Hız Grafiği",
  "menu.item.event_log": "Olay Günlüğü",
  "menu.item.settings": "Ayarlar…",
  "menu.item.about": "ADM Hakkında",
  "menu.item.exit": "Çıkış",

  // -----------------------------------------------------------------
  // Araç çubuğu (Toolbar.tsx)
  // -----------------------------------------------------------------
  "tb.add": "URL Ekle",
  "tb.add_title": "Yeni indirme başlat (Ctrl+N)",
  "tb.pause_all": "Duraklat",
  "tb.pause_all_title": "Tüm indirmeleri duraklat",
  "tb.resume_all": "Sürdür",
  "tb.resume_all_title": "Tüm indirmeleri sürdür",
  "tb.cancel_all": "İptal",
  "tb.cancel_all_title": "Tüm indirmeleri iptal et",
  "tb.delete": "Sil",
  "tb.delete_title": "Seçili indirmeleri sil",
  "tb.clear": "Listeyi Temizle",
  "tb.clear_title": "Tamamlanan, başarısız ve iptal edilen kayıtları sil",
  "tb.graph": "Grafik",
  "tb.graph_title": "Hız grafiğini aç/kapat",
  "tb.log": "Günlük",
  "tb.log_title": "Olay günlüğünü aç/kapat",
  "tb.selection": "seçili",

  // -----------------------------------------------------------------
  // Kenar çubuğu (Sidebar.tsx)
  // -----------------------------------------------------------------
  "side.new": "Yeni İndirme",
  "side.tasks": "Görevler",
  "side.categories": "Kategoriler",
  "side.task.downloading": "İndiriliyor",
  "side.task.queued": "Sırada",
  "side.task.paused": "Duraklatılan",
  "side.task.completed": "Tamamlanan",
  "side.task.failed": "Başarısız",
  "side.task.cancelled": "İptal Edilen",
  "side.task.all": "Tüm İndirmeler",
  "side.cat.video": "Video",
  "side.cat.audio": "Ses",
  "side.cat.program": "Program",
  "side.cat.archive": "Arşiv",
  "side.cat.document": "Belge",
  "side.cat.other": "Diğer Dosyalar",

  // -----------------------------------------------------------------
  // Yeni indirme formu (NewDownloadForm.tsx)
  // -----------------------------------------------------------------
  "form.browse": "Gözat",
  "form.channels_hint": "{count} kanal",
  "form.db_hint": "İndirme geçmişi kaydediliyor",
  "form.db_title": "Kayıtların tutulduğu konum: {path}",
  "form.err.default_dir": "Varsayılan klasör okunamadı: {error}",
  "form.err.start": "İndirme başlatılamadı: {error}",
  "form.submit": "Ekle",
  "form.submitting": "Ekleniyor…",
  "form.url_placeholder": "https://sunucu/dosya.bin",
  "form.warn.bad_scheme": "URL http:// veya https:// ile başlamalı",
  "form.warn.no_url": "Önce bir URL girin",
  "add.url_title": "Bağlantı adresi (yapıştırın)",
  "add.save_to": "Kayıt",
  "add.channels": "Bağlantı",

  // -----------------------------------------------------------------
  // Tablo başlıkları (DownloadTable.tsx)
  // -----------------------------------------------------------------
  "col.idx": "#",
  "col.name": "Dosya Adı",
  "col.size": "Boyut",
  "col.progress": "İlerleme",
  "col.speed": "Hız",
  "col.eta": "Kalan",
  "col.channels": "Kanal",
  "col.status": "Durum",
  "col.actions": "İşlemler",

  // -----------------------------------------------------------------
  // Tablo satırı (DownloadRow.tsx)
  // -----------------------------------------------------------------
  "row.aria": "İndirme listesi",
  "row.progress_aria": "İndirme ilerlemesi",
  "row.size_unknown": "Boyut bilinmiyor",
  "row.selected": "{count} kayıt seçildi",
  "row.hint": "Çift tık: dosyayı aç · Sağ tık: işlemler · Shift/Ctrl ile çoklu seçim",

  // -----------------------------------------------------------------
  // Satır eylemleri (DownloadRow.tsx)
  // -----------------------------------------------------------------
  "act.pause": "Duraklat",
  "act.pause_title": "İndirmeyi duraklat",
  "act.resume": "Sürdür",
  "act.resume_title": "Kaldığı yerden sürdür",
  "act.cancel": "İptal",
  "act.cancel_title": "İndirmeyi iptal et",
  "act.delete": "Sil",
  "act.delete_title": "Kaydı ve dosyayı sil",
  "act.delete_record": "Kaydı sil",
  "act.delete_record_title": "Kaydı sil, dosyayı koru",
  "act.open": "Aç",
  "act.open_title": "Dosyayı aç",
  "act.folder": "Konum",
  "act.folder_title": "Klasörü aç",
  "act.channels": "Kanallar",
  "act.channels_title": "Kanal sayısını değiştir",
  "act.busy_title": "İşlem sürüyor",
  "act.failed": "{action} başarısız: {error}",
  "act.channels_apply": "Uygula",
  "act.channels_cancel": "Vazgeç",
  "act.channels_label": "Kanal sayısı:",
  "act.channels_note":
    "Çalışan bir indirmede kanal sayısı değişince indirme duraklatılıp yeni sayıyla sürdürülür.",

  // -----------------------------------------------------------------
  // Liste üstü ve boş durum (DownloadTable.tsx)
  // -----------------------------------------------------------------
  "list.clear": "Listeyi Temizle",
  "list.clear_title": "Tamamlanan, başarısız ve iptal edilen kayıtları sil",
  "list.empty_title": "Bu görünümde indirme yok",
  "list.empty_hint": "Soldaki kenar çubuğundan başka bir görev veya kategori seçin.",
  "list.err.clear": "Kayıtlar temizlenemedi: {error}",
  "list.failed_hint": "{count} başarısız • {bytes} yarım",
  "list.failed_hint_title": "Başarısız kayıtların indirdiği miktar",

  // -----------------------------------------------------------------
  // Diyaloglar
  // -----------------------------------------------------------------
  "dialog.confirm_title": "Onay",
  "dialog.save_title": "İndirilecek dosyayı seç",
  "dialog.delete_file.title": "İndirmeyi sil",
  "dialog.delete_file.body": "\"{name}\" kaydı ve indirilen dosya silinsin mi?",
  "dialog.delete_record.title": "Kaydı sil",
  "dialog.delete_record.body": "\"{name}\" kaydı silinsin mi? Dosya korunur.",
  "dialog.bulk_delete.title": "Toplu silme",
  "dialog.bulk_delete.body": "{count} kayıt silinsin mi?",
  "dialog.copied": "Adres panoya kopyalandı",

  // Özellikler penceresi
  "props.title": "İndirme Özellikleri",
  "props.file": "Dosya",
  "props.path": "Konum",
  "props.url": "Adres",
  "props.size": "Boyut",
  "props.status": "Durum",
  "props.channels": "Kanal sayısı",
  "props.created": "Eklenme",
  "props.finished": "Bitiş",
  "props.close": "Kapat",

  // Hakkında
  "about.title": "ADM Hakkında",
  "about.desc": "Çok kanallı gelişmiş indirme yöneticisi",
  "about.tech": "Rust + Tauri 2 + SolidJS",
  "about.ok": "Tamam",

  // -----------------------------------------------------------------
  // Hız grafiği (SpeedGraph.tsx)
  // -----------------------------------------------------------------
  "graph.title": "Hız Grafiği",
  "graph.empty": "Henüz hız verisi yok.",
  "graph.axis_speed": "MB/s",
  "graph.axis_time": "Zaman",
  "graph.peak": "Tepe hız",
  "graph.average": "Ortalama hız",
  "graph.now": "Anlık",
  "graph.samples": "Örnek",

  // -----------------------------------------------------------------
  // Log paneli (LogPanel.tsx) ve grafik (Sparkline.tsx)
  // -----------------------------------------------------------------
  "log.aria": "Olay günlüğü",
  "log.title": "Olay Günlüğü",
  "log.clear": "Temizle",
  "log.empty": "Henüz olay yok.",
  "log.to_bottom": "En alta git",
  "spark.empty_title": "Hız geçmişi oluşuyor",

  // -----------------------------------------------------------------
  // Durum çubuğu (StatusBar.tsx)
  // -----------------------------------------------------------------
  "sb.disk_free": "Disk boş",
  "sb.speed": "Anlık hız",
  "sb.active": "Aktif",
  "sb.downloaded": "İndirilen",
  "sb.time": "Toplam süre",
  "sb.ready": "Hazır",

  // -----------------------------------------------------------------
  // Ayarlar (SettingsPanel.tsx)
  // -----------------------------------------------------------------
  "settings.channels_hint":
    "Bu sayı yeni indirmelerde varsayılan olarak kullanılır. Çalışan bir indirmenin kanal sayısını tablodaki “Kanallar” düğmesinden değiştirebilirsin.",
  "settings.channels_label": "Varsayılan kanal sayısı",
  "settings.dir.audio": "Ses dosyaları",
  "settings.dir.audio_hint": "mp3, flac, wav, aac, m4a ve diğer ses uzantıları",
  "settings.dir.default": "Genel konum",
  "settings.dir.default_hint":
    "Eşleşmeyen dosyalar ve aşağıda boş bırakılan kategoriler buraya iner. Boşaltılamaz.",
  "settings.dir.inherit": "Genel konuma düşsün",
  "settings.dir.other": "Diğer dosyalar",
  "settings.dir.other_hint":
    "Arşivler, kurulum dosyaları, belgeler ve disk görüntüleri (zip, exe, iso, pdf…)",
  "settings.dir.reset": "Bu kategoriyi sıfırla",
  "settings.dir.video": "Video dosyaları",
  "settings.dir.video_hint": "mp4, mkv, avi, mov, webm ve diğer video uzantıları",
  "settings.err.channels": "Kanal sayısı kaydedilemedi: {error}",
  "settings.err.lang": "Dil kaydedilemedi: {error}",
  "settings.err.pick": "Klasör seçilemedi: {error}",
  "settings.err.save": "Ayar kaydedilemedi: {error}",
  "settings.folders_intro":
    "Dosya uzantısına göre konum belirlenir. Boş bırakılan kategoriler genel konuma düşer.",
  "settings.lang_hint":
    "Dil tercihiniz kaydedilir ve uygulamayı yeniden açtığınızda da korunur.",
  "settings.pick_folder": "{target} için klasör seç",
  "settings.section.channels": "Kanallar",
  "settings.section.folders": "İndirme konumları",
  "settings.section.language": "Dil",

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
  "bulk.deleted": "{count} kayıt silindi",

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