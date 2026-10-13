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
  // Menü çubuğu girdileri — satır bağlam menüsünde de kullanılır (RowContextMenu.tsx)
  // -----------------------------------------------------------------
  "menu.item.paste_url": "Panodan Yapıştır",
  "menu.item.open_file": "Dosyayı Aç",
  "menu.item.open_folder": "Klasörü Aç",
  "menu.item.copy_url": "Adresi Panoya Kopyala",
  "menu.item.cancel_all": "Tümünü İptal Et",
  "menu.item.select_all": "Tümünü Seç",
  "menu.item.clear_history": "Listeyi Temizle",
  "menu.item.delete_record": "Kaydı Sil",
  "menu.item.delete_download": "İndirmeyi Sil",
  "menu.item.properties": "Özellikler…",
  "menu.item.detail_window": "Ayrı Pencerede Aç",
  "menu.item.settings": "Ayarlar…",
  "menu.item.browser_setup": "Tarayıcı Eklentisi…",
  "menu.item.about": "ADM Hakkında",

  // -----------------------------------------------------------------
  // Sol menü paneli (Sidebar.tsx) + başlık çubuğu düğmeleri (TitleBar.tsx)
  // -----------------------------------------------------------------
  "side.open": "Menüyü aç",
  "side.close": "Menüyü kapat",
  "side.actions": "İşlemler",
  "side.tools": "Araçlar",
  "tb.add": "İndirme ekle",
  "tb.search": "İndirmelerde ara...",

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
  "side.task.unfinished": "Bitmeyen",
  "side.nav_aria": "İndirme kategorileri",
  "side.all": "Tüm İndirmeler",
  "side.state": "Durum",
  "side.completed": "Tamamlanan",
  "side.unfinished": "Bitmeyen",
  "side.cat.video": "Video",
  "side.cat.audio": "Ses",
  "side.cat.program": "Program",
  "side.cat.archive": "Arşiv",
  "side.cat.document": "Belge",
  "side.cat.other": "Diğer Dosyalar",

  // -----------------------------------------------------------------
  // Dosya kategorileri (MC `categories::Category` — kenar çubuğu, tablo
  // alt metni ve yakalama grupları bu adları paylaşır)
  // -----------------------------------------------------------------
  "cat.image": "Resim",
  "cat.music": "Ses",
  "cat.video": "Video",
  "cat.apps": "Program",
  "cat.document": "Belge",
  "cat.compressed": "Arşiv",
  "cat.other": "Diğer",

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
  "row.channels_rich": "Kanallar: {list}",

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
  // Durum çubuğu mesajları (log paneli kaldırıldı)
  // -----------------------------------------------------------------
  "log.channels_changed": "{name} kanal sayısı {count} olarak ayarlandı",

  // -----------------------------------------------------------------
  // Sol menü başlık satırı ve ana anahtarı (Sidebar.tsx)
  // -----------------------------------------------------------------
  "side.menu": "Menü",
  "sb.speed": "Anlık hız",
  "sb.master_title": "Tüm indirmeleri duraklat / sürdür",

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
  "bulk.done.paused": "{count} indirme duraklatıldı",
  "bulk.done.resumed": "{count} indirme başlatıldı",
  "bulk.done.cleared": "{count} kayıt temizlendi",
  "bulk.done.cancelled": "{count} indirme iptal edildi",
  "bulk.none.paused": "Duraklatılacak çalışan indirme yok",
  "bulk.none.resumed": "Sürdürülebilir indirme yok",
  "bulk.none.cleared": "Temizlenecek kayıt yok",
  "bulk.none.cancelled": "İptal edilecek çalışan indirme yok",

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

  // -----------------------------------------------------------------
  // Safari — dosya kopyalama yok, sürüm sayfasından kurulum var
  // -----------------------------------------------------------------
  "wizard.safari.lead":
    "Safari uzantısı dosya kopyalanarak kurulamaz; sürüm sayfasından indirilen ayrı bir uygulama içinde gelir.",
  "wizard.safari.step1":
    "Sürüm sayfasından safari-unsigned-macos.zip dosyasını indirin.",
  "wizard.safari.step2":
    "İndirilen ADM.app dosyasını açın. İmzasız olduğu için ilk açılışta sağ tıklayıp \"Aç\" demeniz gerekebilir.",
  "wizard.safari.step3":
    "Safari ▸ Ayarlar ▸ Uzantılar bölümünde ADM'yi etkinleştirin.",
  "wizard.safari.step4":
    "Safari Geliştir ▸ İmzasız Uzantılara İzin Ver seçeneğini açın; Safari bu izni her açılışta yeniden ister.",
  "wizard.safari.download": "Sürüm sayfasını aç",
  "wizard.safari.waiting":
    "Bağlantı bekleniyor — ADM'yi Safari'de etkinleştirdikten sonra bu satır yeşile döner.",
  "wizard.close": "Kapat",

  // -----------------------------------------------------------------
  // MC portu — sol menü eylemleri (Sidebar.tsx) + başlık çubuğu ayarlar düğmesi
  // -----------------------------------------------------------------
  "tb.start_queue": "Kuyruğu Başlat",
  "tb.stop_all": "Tümünü Durdur",
  "tb.clear_done": "Bittenleri Temizle",
  "tb.settings": "Ayarlar",
  "bulk.err.action": "İşlem başarısız: {error}",

  // -----------------------------------------------------------------
  // MC portu — tablo satırı ek etiketleri (DownloadRow.tsx)
  // -----------------------------------------------------------------
  "row.kind_video": "Video",
  "row.kind_video_title": "yt-dlp ile indirilen video",
  "row.completed_sub": "Tamamlandı",

  // -----------------------------------------------------------------
  // MC portu — indirme ayrıntı penceresi (DownloadDetailDialog.tsx)
  // -----------------------------------------------------------------
  "detail.title": "İndirme Ayrıntıları",
  "detail.section.progress": "İlerleme",
  "detail.section.info": "Bilgi",
  "detail.section.connections": "Bağlantılar",
  "detail.section.log": "yt-dlp Günlüğü",
  "detail.eta": "Kalan:",
  "detail.field.url": "Adres",
  "detail.field.kind": "Tür",
  "detail.field.ranges": "Parçalı indirme",
  "detail.field.channels": "Bağlantı sayısı",
  "detail.field.added": "Eklenme",
  "detail.field.finished": "Bitiş",
  "detail.field.headers": "Ek başlıklar",
  "detail.kind.video": "Video (yt-dlp)",
  "detail.kind.file": "Dosya",
  "detail.ranges.yes": "Destekleniyor",
  "detail.ranges.no": "Desteklenmiyor",
  "detail.conn.no": "No.",
  "detail.conn.downloaded": "İndirilen",
  "detail.conn.start": "Başlangıç",
  "detail.conn.info": "Bilgi",
  "detail.conn.finished": "Bitti",
  "detail.conn.percent": "%{percent}",
  "detail.err.open": "Ayrıntı penceresi açılamadı: {error}",
  "detail.log.empty": "Henüz yt-dlp çıktısı yok.",
  "detail.close_on_finish": "İndirme bitince bu pencereyi kapat",
  "detail.open": "Dosyayı Aç",
  "detail.show_in_folder": "Klasörde Göster",

  // -----------------------------------------------------------------
  // MC portu — yeni indirme penceresi (NewDownloadDialog.tsx)
  // -----------------------------------------------------------------
  "add.kind": "İndirme türü",
  "add.kind_file": "Dosya",
  "add.kind_video": "Video (yt-dlp)",
  "add.kind_file_hint": "Doğrudan bağlantı; çok kanallı motorla indirilir.",
  "add.kind_video_hint":
    "Video sayfası; yt-dlp ile indirilir. YouTube gibi siteler için gereklidir.",
  "add.channels_field": "Bağlantı sayısı",
  "add.channels_note": "Yalnızca dosya indirmelerinde kullanılır.",

  // -----------------------------------------------------------------
  // MC portu — pano sorması (ClipboardPromptDialog.tsx)
  // -----------------------------------------------------------------
  "clip.title": "Panoda bağlantı bulundu",
  "clip.body": "Panodaki {count} bağlantı indirilsin mi?",
  "clip.body_one": "Panodaki bağlantı indirilsin mi?",
  "clip.url_hint": "{url}",
  "clip.download_video": "Videoyu İndir (yt-dlp)",
  "clip.download_file": "Dosya Olarak İndir",
  "clip.ignore": "Yoksay",
  "clip.remember": "Bir daha sorma (bu oturumda)",

  // -----------------------------------------------------------------
  // MC portu — harici araç kurulumu (tools.rs olayları)
  // -----------------------------------------------------------------
  "tool.working": "Hazırlanıyor…",
  "tool.installed": "Kuruldu ({version})",
  "tool.failed": "Kurulum başarısız: {error}",

  // -----------------------------------------------------------------
  // MC portu — ayarlar sekmeleri (SettingsPanel.tsx)
  // -----------------------------------------------------------------
  "settings.tab.general": "Genel",
  "settings.tab.types": "Dosya Türleri",
  "settings.tab.browsers": "Tarayıcılar",
  "settings.tab.video": "Video",
  "settings.tab.interface": "Arayüz",
  "settings.section.behaviour": "Davranışlar",
  "settings.section.tray": "Tepsi simgesi ve başlangıç",
  "settings.section.updates": "Güncellemeler",
  "settings.max_concurrent": "Eşzamanlı indirme",
  "settings.max_concurrent_hint":
    "Aynı anda çalışabilecek indirme sayısı. Kalan indirmeler kuyrukta bekler.",
  "settings.concurrent_value": "{count} indirme",
  "settings.auto_start": "Yeni indirmeler hemen başlasın",
  "settings.auto_start_hint":
    "Kapalıysa yeni indirmeler kuyrukta bekler; araç çubuğundan “Kuyruğu Başlat” ile başlatılır.",
  "settings.notify": "Tamamlanınca bildirim göster",
  "settings.notify_hint": "İndirme bittiğinde Windows bildirimi gösterilir.",
  "settings.show_detail": "İndirme başlarken ayrıntı penceresini aç",
  "settings.show_detail_hint":
    "IDM tarzı küçük bir pencere açılır; ilerleme, hız ve kanal yüzdeleri orada izlenir. Elle açmak için satır bağlam menüsünden “Ayrı Pencerede Aç” seçin.",
  "settings.auto_close_detail": "Ayrıntı penceresini tamamlanınca kapat",
  "settings.auto_close_detail_hint":
    "Ayrıntı penceresindeki “bitince kapat” kutusunun varsayılanı budur.",
  "settings.watch_clipboard": "Panoyu izle",
  "settings.watch_clipboard_hint":
    "Panoya kopyalanan uygun bağlantılar için soru sorulur.",
  "settings.organize": "Kategori alt klasörlerine ayır",
  "settings.organize_hint":
    "Dosyalar genel konum yerine kategori klasörüne (video/ses/diğer) yazılır.",
  "settings.start_in_tray": "Tepsi simgesinde başlat",
  "settings.start_in_tray_hint":
    "Uygulama pencere açmadan yalnızca tepsi simgesiyle başlar.",
  "settings.close_to_tray": "Kapatınca arka planda kal",
  "settings.close_to_tray_hint":
    "Pencere kapatıldığında uygulama çalışmaya devam eder; çıkmak için tepsi menüsünü kullanın.",
  "settings.autostart": "Oturum açılışında çalıştır",
  "settings.autostart_hint": "Windows oturum açıldığında ADM kendiliğinden başlar.",
  "settings.check_updates": "Açılışta güncelleme denetle",
  "settings.check_updates_hint": "Yeni sürüm varsa bildirilir.",
  "settings.check_now": "Şimdi denetle",
  "settings.check_now_title": "Güncellemeyi hemen denetle",
  "settings.checking": "Denetleniyor…",
  "settings.update_current": "Sürüm {version} — güncel.",
  "settings.update_available": "Yeni sürüm: {version}",
  "settings.update_error": "Denetlenemedi: {error}",
  "settings.update_last": "Son denetim: {time}",
  "settings.update_never": "Henüz denetlenmedi",
  "settings.update_download": "Güncellemeyi indir",
  "settings.types_intro":
    "Tarayıcıdan ve panodan yalnızca aşağıdaki uzantılar yakalanır. Hiçbir grup seçilmezse yakalama kapanır.",
  "settings.types_groups": "Hazır gruplar",
  "settings.types_custom": "Özel uzantılar",
  "settings.types_custom_hint":
    "Virgülle ayrılmış uzantılar (örn. torrent, parquet). Nokta gerekmez.",
  "settings.types_custom_placeholder": "torrent, parquet",
  "settings.types_preview": "Etkin uzantılar ({count})",
  "settings.types_preview_empty": "Hiç uzantı seçilmedi — yakalama kapalı.",
  "settings.browsers_intro":
    "ADM, tarayıcıdaki indirmeleri yerel köprü üzerinden devralır. Eklenti kurulu değilse indirmeler tarayıcıda kalır.",
  "settings.bridge_port": "Köprü portu",
  "settings.bridge_port_hint":
    "Değişiklikten sonra ADM yeniden başlatılmalıdır. Varsayılan: 48213.",
  "settings.bridge_running": "127.0.0.1:{port} adresinde dinliyor",
  "settings.bridge_stopped": "Köprü çalışmıyor",
  "settings.bridge_browsers": "Bağlı tarayıcılar: {browsers}",
  "settings.bridge_no_browser": "Henüz tarayıcı bağlanmadı",
  "settings.plugin_folder": "Eklenti klasörü",
  "settings.plugin_folder_hint":
    "Eklenti dosyaları bu klasöre kopyalanır; tarayıcıya bu klasör gösterilir.",
  "settings.wizard_open": "Kurulum sihirbazını aç",
  "settings.browser_ready": "Eklenti dosyaları hazır",
  "settings.browser_missing": "Eklenti dosyaları henüz kopyalanmadı",
  "settings.video_intro":
    "Video indirmeleri yt-dlp ile yapılır. Araçlar eksikse indirme başlamadan kurulabilir.",
  "settings.site_login": "Site girişi",
  "settings.site_login_hint":
    "Yaş kısıtlı veya üyelere özel videolar için hesapla oturum açın; çerezler yt-dlp'ye verilir.",
  "settings.site_login_open": "Giriş penceresini aç",
  "settings.site_login_save": "Çerezleri kaydet ve kapat",
  "settings.site_login_clear": "Çerezleri sil",
  "settings.site_login_none": "Kayıtlı çerez yok.",
  "settings.site_login_count": "{count} çerez kayıtlı",
  "settings.site_login_domains": "Siteler: {domains}",
  "settings.site_login_saved": "Çerezler kaydedildi ({count})",
  "settings.tools": "Harici araçlar",
  "settings.tools_hint":
    "yt-dlp, ffmpeg ve deno GitHub'dan indirilip ADM klasörüne kurulur.",
  "settings.tool_install": "Kur",
  "settings.tool_reinstall": "Güncelle",
  "settings.tool_installed": "Kurulu",
  "settings.tool_missing": "Kurulu değil",
  "settings.tools_checking": "Kontrol ediliyor…",
  "settings.tool_version": "sürüm {version}",
  "settings.ytdlp_path": "Özel yt-dlp yolu",
  "settings.ytdlp_path_hint":
    "Boş bırakılırsa PATH ve ADM araçlar klasörü kullanılır.",
  "settings.ytdlp_path_placeholder": "C:\\araçlar\\yt-dlp.exe",
  "settings.video_format": "Biçim seçici",
  "settings.video_format_hint":
    "Boş bırakılırsa aşağıdaki çözünürlük ve kapsayıcı kullanılır. Örn. `bv*+ba/b`.",
  "settings.video_container": "Kapsayıcı",
  "settings.video_max_height": "Azami çözünürlük",
  "settings.format_preview": "Etkin argümanlar",
  "settings.height.best": "En iyi",
  "settings.height.audio_m4a": "Yalnızca ses (m4a)",
  "settings.height.audio_mp3": "Yalnızca ses (mp3)",
  "settings.height.p": "{height}p",
  "settings.container.mp4": "MP4",
  "settings.container.mkv": "MKV",
  "settings.container.webm": "WebM",
  "settings.container.original": "Özgün biçim",
  "settings.section.dock": "Alt panel",
  "settings.dock_graph": "Hız grafiği açık başlasın",
  "settings.dock_graph_hint": "Durum çubuğundaki ▾ düğmesiyle de açılabilir.",
  "settings.dock_log": "Olay günlüğü açık başlasın",
  "settings.dock_log_hint": "Son 300 olay bellekte tutulur.",
  "settings.section.about": "Uygulama",
  "settings.about_version": "Sürüm {version}",
  "settings.about_hint": "Rust + Tauri 2 + SolidJS · SQLite (WAL) · TR/EN",

  // -----------------------------------------------------------------
  // MC portu — depo günlük satırları
  // -----------------------------------------------------------------
  "log.bridge_connection": "Tarayıcı bağlantısı: {browser}",
  "log.browser_files_ready": "Eklenti dosyaları hazır: {path}",
  "log.tool_installed": "{tool} kuruldu (sürüm {version})",
  "log.update_available": "Yeni sürüm mevcut: {version}",
  "log.update_current": "Sürüm {version} güncel",
  "log.update_failed": "Güncelleme denetlenemedi: {error}",
};

/**
 * Sözlük tipleri.
 *
 * `Dict`, `tr.ts`'in çıkarılan tipidir: `en.ts` bu tipi uygularsa eksik ya da
 * fazla anahtar derleme hatası verir.
 */
export type Template = string | { one: string; other: string };
export type Dict = typeof tr;
