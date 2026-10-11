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
  "menu.item.browser_setup": "Tarayıcı Eklentisi…",
  "menu.item.about": "ADM Hakkında",
  "menu.item.exit": "Çıkış",

  // -----------------------------------------------------------------
  // Araç çubuğu (Toolbar.tsx)
  // -----------------------------------------------------------------
  "tb.add": "İndirme ekle",
  "tb.add_title": "Yeni indirme başlat (Ctrl+N)",
  "tb.search": "İndirmelerde ara...",
  "tb.graph": "Grafik",
  "tb.graph_title": "Hız grafiğini aç/kapat",
  "tb.log": "Günlük",
  "tb.log_title": "Olay günlüğünü aç/kapat",

  // -----------------------------------------------------------------
  // Kenar çubuğu (Sidebar.tsx)
  // -----------------------------------------------------------------
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
  // Yeni indirme penceresi (NewDownloadDialog.tsx)
  // -----------------------------------------------------------------
  "form.browse": "Gözat",
  "form.cancel": "Vazgeç",
  "form.channels_hint": "{count} kanal",
  "form.db_hint": "İndirme geçmişi kaydediliyor",
  "form.db_title": "Kayıtların tutulduğu konum: {path}",
  "form.err.start": "İndirme başlatılamadı: {error}",
  "form.err_url.empty": "Önce bir bağlantı adresi girin",
  "form.err_url.scheme": "Yalnızca http:// veya https:// adresleri desteklenir",
  "form.err_url.syntax": "Geçerli bir adres girin (örn. https://sunucu/dosya.bin)",
  "form.submit": "Ekle",
  "form.submitting": "Ekleniyor…",
  "form.title": "Yeni İndirme",
  "form.url_label": "Bağlantı adresi",
  "form.url_placeholder": "https://sunucu/dosya.bin",
  "add.save_to": "Kayıt",
  "add.channels": "Bağlantı",

  // -----------------------------------------------------------------
  // Tablo başlıkları (DownloadTable.tsx)
  // -----------------------------------------------------------------
  "col.idx": "#",
  "col.name": "Dosya Adı",
  "col.size": "Boyut",
  "col.speed": "Hız",
  "col.eta": "Kalan",
  "col.status": "Durum",
  "col.date": "Ekleme",

  // -----------------------------------------------------------------
  // Sıralama ölçütleri (Toolbar.tsx)
  // -----------------------------------------------------------------
  "sort.status": "Duruma göre",
  "sort.newest": "En yeni",
  "sort.oldest": "En eski",
  "sort.name": "Ada göre",
  "sort.size": "Boyuta göre",
  "sort.progress": "İlerlemeye göre",

  // -----------------------------------------------------------------
  // Tablo satırı (DownloadRow.tsx)
  // -----------------------------------------------------------------
  "row.aria": "İndirme listesi",
  "row.progress_aria": "İndirme ilerlemesi",
  "row.size_unknown": "Boyut bilinmiyor",
  "row.select_aria": "{name} kaydını seç",
  "row.select_title": "Kaydı seç (Shift/Ctrl ile çoklu)",
  "row.more_title": "İşlemler",
  "row.channels_title": "{count} kanal",

  // -----------------------------------------------------------------
  // Satır eylemleri (DownloadRow.tsx)
  // -----------------------------------------------------------------
  "act.pause": "Duraklat",
  "act.resume": "Sürdür",
  "act.cancel": "İptal",
  "act.delete": "Sil",
  "act.delete_record": "Kaydı sil",
  "act.open": "Aç",
  "act.folder": "Konum",
  "act.channels": "Kanallar",
  "act.failed": "{action} başarısız: {error}",
  "act.channels_label": "Kanal sayısı:",
  "act.channels_note":
    "Çalışan bir indirmede kanal sayısı değişince indirme duraklatılıp yeni sayıyla sürdürülür.",

  // -----------------------------------------------------------------
  // Liste üstü ve boş durum (DownloadTable.tsx)
  // -----------------------------------------------------------------
  "list.clear": "Listeyi Temizle",
  "list.clear_title": "Tamamlanan, başarısız ve iptal edilen kayıtları sil",
  "list.drop_title": "URL'yi sürükleyip bırakın",
  "list.drop_hint": "Ya da araç çubuğundaki İndirme ekle düğmesini kullanın",
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
  "log.channels_changed": "{name} kanal sayısı {count} olarak ayarlandı",
  "spark.empty_title": "Hız geçmişi oluşuyor",

  // -----------------------------------------------------------------
  // Durum çubuğu (StatusBar.tsx)
  // -----------------------------------------------------------------
  "sb.disk_free": "Disk boş",
  "sb.speed": "Anlık hız",
  "sb.on": "AÇIK",
  "sb.off": "KAPALI",
  "sb.master_title": "Tüm indirmeleri duraklat / sürdür",
  "sb.free": "boş",
  "sb.quality_title": "Ölçülen bağlantı hızına göre kalite kademesi",
  "sb.quality.ok": "YÜKSEK",
  "sb.quality.warn": "ORTA",
  "sb.quality.idle": "DÜŞÜK",
  "sb.selected_many": "{count} kayıt seçili",
  "sb.dock_show": "Hız grafiğini aç",
  "sb.dock_hide": "Alt paneli kapat",

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

  // -----------------------------------------------------------------
  // Tarayıcı eklentisi kurulum sihirbazı (BrowserSetupDialog.tsx)
  // -----------------------------------------------------------------
  "wizard.title": "Tarayıcı eklentisi kurulumu",
  "wizard.step.prepare": "Dosyaları hazırla",
  "wizard.step.open": "Uzantı sayfasını aç",
  "wizard.step.load": "Eklentiyi yükle",
  "wizard.step.connect": "Bağlantıyı doğrula",
  "wizard.bridge_off":
    "Tarayıcı köprüsü çalışmıyor. Ayarlar ▸ Tarayıcılar bölümünden portu denetleyin; köprü açık olmadan eklenti indirmeleri iletemez.",
  "wizard.bridge_on": "Köprü 127.0.0.1:{port} adresinde dinliyor.",
  "wizard.hint.prepare":
    "{browser} için eklenti dosyaları ADM klasörüne kopyalanacak. Bu klasörü birazdan tarayıcıya göstereceksiniz.",
  "wizard.hint.open":
    "Açılan sayfada sağ üstteki “Geliştirici modu”nu açın, ardından “Paketlenmemiş öğe yükle” düğmesine basın.",
  "wizard.hint.open_firefox":
    "Açılan sayfada “Geçici Eklenti Yükle…” düğmesine basın.",
  "wizard.hint.load":
    "Dosya seçme penceresinde aşağıdaki klasörü seçip içindeki manifest.json dosyasını onaylayın. Klasörü önce buradan açabilirsiniz.",
  "wizard.hint.load_firefox":
    "Aşağıdaki klasörü açın ve içindeki manifest.json dosyasını seçin.",
  "wizard.hint.connect":
    "Eklenti yüklendi. Tarayıcıdan bir indirme başlattığınızda ADM bağlantıyı burada gösterecek.",
  "wizard.action.prepare": "Dosyaları hazırla",
  "wizard.action.open": "Uzantı sayfasını aç",
  "wizard.action.open_firefox": "about:debugging sayfasını aç",
  "wizard.action.open_folder": "Klasörü aç",
  "wizard.action.recheck": "Bağlantıyı yeniden denetle",
  "wizard.working": "Hazırlanıyor…",
  "wizard.prepared": "Eklenti dosyaları hazırlandı",
  "wizard.connected": "{browser} bağlandı",
  "wizard.close": "Kapat",
};

/**
 * Sözlük tipleri.
 *
 * `Dict`, `tr.ts`'in çıkarılan tipidir: `en.ts` bu tipi uygularsa eksik ya da
 * fazla anahtar derleme hatası verir.
 */
export type Template = string | { one: string; other: string };
export type Dict = typeof tr;
