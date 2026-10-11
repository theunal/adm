//! Video indirme — MC `VideoDownloader` portu.
//!
//! yt-dlp'yi bir alt süreç olarak çalıştırır; ilerleme, faz bilgisi ve
//! hata satırlarını kanallarla dışarıya verir.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::i18n;
use crate::models::file_name_from_url;
use crate::tools;

/// yt-dlp ilerleme olayı (ayrıştırılmış).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoProgress {
    pub downloaded: i64,
    pub total: i64,
    pub speed: f64,
}

/// Bir çıktı satırı işlendiğinde yayınlanan olay.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum VideoEvent {
    /// İlerleme (`DMP|` satırı).
    Progress(VideoProgress),
    /// Kısa faz metni ("Downloading video…" vb.).
    Stage(String),
    /// Ham yt-dlp satırı (günlük için, son ~6000 karakter).
    Log(String),
    /// `after_move:filepath` ile gelen final yol.
    FinalPath(PathBuf),
    /// Süreç bitti: `Ok(Some(path))` / `Ok(None)` / `Err(hata)`.
    Finished(Result<Option<PathBuf>, String>),
}

/// Video sitelerinin host listesi (deno sorusu için YouTube tespiti).
fn is_youtube(url: &str) -> bool {
    let host = url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(url)
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    ["youtube.com", "youtu.be", "youtube-nocookie.com"]
        .iter()
        .any(|h| host == *h || host.ends_with(&format!(".{h}")))
}

/// YouTube'un oturumlu istemci reddi (yt-dlp#17389).
pub fn is_signed_in_client_failure(message: &str) -> bool {
    message
        .to_ascii_lowercase()
        .contains("page needs to be reloaded")
}

/// yt-dlp'nin ortam değişkenleri: yardımcı araçları PATH önüne ekler.
fn environment() -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = std::env::vars().collect();
    let extra: Vec<PathBuf> = vec![
        tools::tools_dir(),
        PathBuf::from("C:\\Program Files\\ffmpeg\\bin"),
    ];
    let existing = env
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("PATH"))
        .map(|(_, v)| v.clone())
        .unwrap_or_default();
    let mut joined = extra
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(";");
    if !existing.is_empty() {
        joined.push(';');
        joined.push_str(&existing);
    }
    env.retain(|(k, _)| !k.eq_ignore_ascii_case("PATH"));
    env.push(("PATH".to_string(), joined));
    env.push(("PYTHONIOENCODING".to_string(), "utf-8".to_string()));
    env
}

/// Uzantıdan gelen çerez dosyası ile site girişi çerez dosyasını birleştirir
/// (MC `mergedCookieFile`). Host eşleşmiyorsa site çerezleri eklenmez.
pub fn merged_cookie_file(
    item_cookie_file: Option<&str>,
    target_host: Option<&str>,
) -> Option<PathBuf> {
    let item = item_cookie_file.map(PathBuf::from).filter(|p| p.is_file());

    let host = target_host.unwrap_or("").to_ascii_lowercase();
    let site_matches = site_login_domains()
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{d}")));
    let site = if site_matches {
        crate::site_login::cookie_file_path()
    } else {
        None
    };

    match (item, site) {
        (None, None) => None,
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (Some(a), Some(b)) => {
            let body_a = std::fs::read_to_string(&a).unwrap_or_default();
            let body_b = std::fs::read_to_string(&b).unwrap_or_default();
            let tmp = std::env::temp_dir().join(format!("adm-cookies-{}.txt", std::process::id()));
            if std::fs::write(&tmp, format!("{body_b}\n{body_a}\n")).is_ok() {
                Some(tmp)
            } else {
                Some(a)
            }
        }
    }
}

/// Site girişi çerez dosyasındaki domain'ler.
fn site_login_domains() -> Vec<String> {
    crate::site_login::cookie_domains()
}

/// yt-dlp çıktı satırından kullanıcıya gösterilen faz metni çıkarır
/// (MC `stage(for:)`).
pub fn stage_for_line(line: &str) -> Option<String> {
    if line.starts_with("[download] Destination:") {
        let name = line.trim_start_matches("[download] Destination:").trim();
        let lower = name.to_ascii_lowercase();
        // yt-dlp ara dosyaları `<ad>.f<formatid>.<uzantı>` şeklindedir.
        if audio_intermediate().is_match(&lower) {
            return Some(i18n::t("stage.downloading_audio", &[]));
        }
        if video_intermediate().is_match(&lower) {
            return Some(i18n::t("stage.downloading_video", &[]));
        }
        return Some(i18n::t("stage.downloading", &[]));
    }
    if line.starts_with("[Merger]") {
        return Some(i18n::t("stage.merging", &[]));
    }
    if line.starts_with("[VideoRemuxer]") || line.starts_with("[VideoConvertor]") {
        return Some(i18n::t("stage.converting", &[]));
    }
    if line.starts_with("[ExtractAudio]") {
        return Some(i18n::t("stage.extracting_audio", &[]));
    }
    if line.starts_with("MCFMT|") {
        let p: Vec<&str> = line.split('|').collect();
        if p.len() >= 6 {
            let mut parts: Vec<String> = Vec::new();
            if p[1] != "NA" && !p[1].is_empty() {
                parts.push(p[1].to_string());
            }
            if p[2] != "NA" {
                parts.push(p[2].to_uppercase());
            }
            if p[3] != "NA" && p[3] != "none" {
                parts.push(p[3].split('.').next().unwrap_or(p[3]).to_string());
            }
            if let Ok(n) = p[5].parse::<f64>()
                && n > 0.0
            {
                parts.push(format!("~{}", format_bytes(n as i64)));
            }
            return Some(i18n::t("stage.selected", &[&parts.join(" · ")]));
        }
        return None;
    }
    if line.contains("has already been downloaded") {
        return Some(i18n::t("stage.already_downloaded", &[]));
    }
    None
}

/// Ara dosya adları: ses (`<ad>.f<formatid>.<uzantı>`).
static AUDIO_INTERMEDIATE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
/// Ara dosya adları: video.
static VIDEO_INTERMEDIATE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();

fn audio_intermediate() -> &'static regex::Regex {
    AUDIO_INTERMEDIATE.get_or_init(|| {
        regex::Regex::new(r"\.f[0-9]+[-a-z0-9]*\.(m4a|webm|opus|mp3|aac|ogg)$").unwrap()
    })
}

fn video_intermediate() -> &'static regex::Regex {
    VIDEO_INTERMEDIATE
        .get_or_init(|| regex::Regex::new(r"\.f[0-9]+[-a-z0-9]*\.[a-z0-9]+$").unwrap())
}

/// Bayt sayısını okunur biçime çevirir (MC `Fmt.size`).
pub fn format_bytes(bytes: i64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes.max(0) as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{} {}", bytes.max(0), UNITS[0])
    } else {
        format!("{:.1} {}", value, UNITS[unit])
    }
}

/// yt-dlp komut satırı argümanlarını üretir (MC'nin `run` portu).
#[derive(Debug, Clone)]
pub struct VideoRequest {
    pub url: String,
    pub output_dir: PathBuf,
    pub format_args: Vec<String>,
    pub headers: Vec<(String, String)>,
    pub cookie_file: Option<String>,
    pub use_cookies: bool,
    pub custom_ytdlp_path: String,
}

/// yt-dlp'yi çalıştırır; olaylar `events` kanalına akar.
///
/// Alt süreç "drop" ile birlikte sonlandırılır (`kill_on_drop`); duraklatma
/// ve iptal bu mekanizmayla çalışır (MC `terminate`).
pub async fn run(
    req: VideoRequest,
    events: mpsc::UnboundedSender<VideoEvent>,
) -> anyhow::Result<()> {
    let Some(exe) = tools::locate(tools::Tool::YtDlp, &req.custom_ytdlp_path) else {
        anyhow::bail!(i18n::t("err.ytdlp_missing", &[]));
    };

    let target_host = req
        .url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(&req.url)
        .split(['/', '?', '#'])
        .next()
        .map(|s| s.to_string());

    let cookie_file = if req.use_cookies {
        merged_cookie_file(req.cookie_file.as_deref(), target_host.as_deref())
    } else {
        None
    };
    let output_name = video_output_name(&req.url);

    let mut args: Vec<String> = vec![
        "--newline".into(),
        "--no-playlist".into(),
        "--no-colors".into(),
        "--progress".into(),
        "--no-simulate".into(),
        "--no-mtime".into(),
        "--no-quiet".into(),
        "-N".into(),
        "4".into(),
        "-o".into(),
        req.output_dir.join(&output_name).to_string_lossy().to_string(),
        "--progress-template".into(),
        "download:DMP|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s".into(),
        "--print".into(),
        "after_move:filepath".into(),
        "--print".into(),
        "before_dl:MCFMT|%(resolution)s|%(ext)s|%(vcodec)s|%(acodec)s|%(filesize_approx)s|%(format_id)s|%(duration)s".into(),
    ];
    args.extend(req.format_args.iter().cloned());

    if let Some(ff) = tools::locate(tools::Tool::Ffmpeg, "") {
        args.push("--ffmpeg-location".into());
        args.push(ff.to_string_lossy().to_string());
    }
    for (k, v) in &req.headers {
        if k.eq_ignore_ascii_case("User-Agent") && !v.is_empty() {
            args.push("--user-agent".into());
            args.push(v.clone());
        }
        if k.eq_ignore_ascii_case("Referer") && !v.is_empty() {
            args.push("--referer".into());
            args.push(v.clone());
        }
    }
    if let Some(cf) = &cookie_file {
        args.push("--cookies".into());
        args.push(cf.to_string_lossy().to_string());
    }
    if let Some(deno) = tools::locate(tools::Tool::Deno, "") {
        args.push("--js-runtimes".into());
        args.push(format!("deno:{}", deno.to_string_lossy()));
    }
    args.push(req.url.clone());

    let mut command = Command::new(&exe);
    command
        .args(&args)
        .envs(environment())
        .current_dir(&req.output_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => {
            // Alt süreç başlatılamadıysa olay **mutlaka** yayınlanmalıdır:
            // aksi halde yönetici kanalın sessizce kapandığını görür ve
            // indirmeyi yanlışlıkla "tamamlandı" sayardı.
            let msg = i18n::t("err.ytdlp_spawn_failed", &[&exe.display().to_string()]);
            let _ = events.send(VideoEvent::Finished(Err(msg.clone())));
            return Err(anyhow::Error::new(e).context(msg));
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Son hata satırı: süreç başarısız çıkınca raporlanır (MC davranışı).
    let last_error: Arc<std::sync::Mutex<Option<String>>> = Arc::new(std::sync::Mutex::new(None));

    // Satırları iki ayrı görevde oku (MC'nin çift boru drenajı).
    let out_events = events.clone();
    let out_errors = Arc::clone(&last_error);
    let out_task = tokio::spawn(async move {
        if let Some(stdout) = stdout {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                handle_line(&line, false, &out_events, &out_errors);
            }
        }
    });

    let err_events = events.clone();
    let err_errors = Arc::clone(&last_error);
    let err_task = tokio::spawn(async move {
        if let Some(stderr) = stderr {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                handle_line(&line, true, &err_events, &err_errors);
            }
        }
    });

    let status = child.wait().await;

    // Boruların tamamen boşalmasını bekle (kısa süre).
    let _ = tokio::time::timeout(std::time::Duration::from_secs(3), out_task).await;
    let _ = tokio::time::timeout(std::time::Duration::from_secs(3), err_task).await;

    // MC davranışı: hata yalnızca süreç başarısız çıkınca raporlanır
    // (yt-dlp bazı `ERROR:` satırlarından sonra kendiliğinden devam eder).
    let last_error_text = last_error.lock().unwrap_or_else(|e| e.into_inner()).take();

    match status {
        Ok(s) if s.success() => {
            let _ = events.send(VideoEvent::Finished(Ok(None)));
        }
        Ok(s) => {
            let message = last_error_text.unwrap_or_else(|| {
                i18n::t(
                    "err.ytdlp_exit_code",
                    &[&s.code().unwrap_or(-1).to_string()],
                )
            });
            let _ = events.send(VideoEvent::Finished(Err(message)));
        }
        Err(e) => {
            let _ = events.send(VideoEvent::Finished(Err(i18n::t(
                "err.ytdlp_wait_failed",
                &[&e.to_string()],
            ))));
        }
    }

    // Kullanılan geçici çerez dosyasını temizle.
    if let Some(cf) = &cookie_file
        && cf
            .parent()
            .map(|p| p == std::env::temp_dir())
            .unwrap_or(false)
    {
        let _ = tokio::fs::remove_file(cf).await;
    }
    Ok(())
}

/// Video dosyası için çıktı adı şablonu (MC: `%(title).150B [%(id)s].%(ext)s`).
fn video_output_name(url: &str) -> String {
    // yt-dlp şablonu doğrudan geçirilir; `file_name_from_url` yalnızca
    // başlık çıkmazsa listede gösterilecek yedek addır.
    let _ = file_name_from_url(url);
    "%(title).150B [%(id)s].%(ext)s".to_string()
}

/// Bir yt-dlp satırını ayrıştırır ve olayları yayınlar.
fn handle_line(
    line: &str,
    is_error: bool,
    events: &mpsc::UnboundedSender<VideoEvent>,
    last_error: &std::sync::Mutex<Option<String>>,
) {
    let line = line.trim();
    if line.is_empty() {
        return;
    }

    if let Some(rest) = line.strip_prefix("DMP|") {
        let parts: Vec<&str> = rest.split('|').collect();
        if parts.len() >= 4 {
            let num = |s: &str| s.parse::<f64>().ok().unwrap_or(-1.0) as i64;
            let downloaded = num(parts[0]).max(0);
            let mut total = num(parts[1]);
            if total <= 0 {
                total = num(parts[2]);
            }
            let speed = parts[3].parse::<f64>().unwrap_or(0.0).max(0.0);
            let _ = events.send(VideoEvent::Progress(VideoProgress {
                downloaded,
                total,
                speed,
            }));
            return;
        }
    }

    if let Some(stage) = stage_for_line(line) {
        let _ = events.send(VideoEvent::Stage(stage));
    }

    // `after_move:filepath` çıktısı: tek başına bir dosya yolu.
    if (line.starts_with('/') || (line.len() > 2 && line.as_bytes().get(1) == Some(&b':')))
        && Path::new(line).is_file()
    {
        let _ = events.send(VideoEvent::FinalPath(PathBuf::from(line)));
    }

    // Hata satırı (stderr): yt-dlp `ERROR:` önekiyle başlar.
    if is_error
        && line.starts_with("ERROR")
        && let Ok(mut slot) = last_error.lock()
    {
        *slot = Some(line.to_string());
    }

    let _ = events.send(VideoEvent::Log(line.to_string()));
}

/// YouTube adresi mi? (deno sorusu için dışarıya açılır).
pub fn url_is_youtube(url: &str) -> bool {
    is_youtube(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Bir satırı `handle_line`'a verir ve üretilen olayları döner.
    fn satiri_isle(line: &str, is_error: bool) -> (Vec<VideoEvent>, Option<String>) {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let last_error = std::sync::Mutex::new(None);
        handle_line(line, is_error, &tx, &last_error);
        drop(tx);

        let mut events = Vec::new();
        while let Ok(ev) = rx.try_recv() {
            events.push(ev);
        }
        (events, last_error.into_inner().unwrap_or(None))
    }

    /// Olaylar arasından ilerleme olayını bulur.
    fn ilerleme(events: &[VideoEvent]) -> Option<VideoProgress> {
        events.iter().find_map(|e| match e {
            VideoEvent::Progress(p) => Some(p.clone()),
            _ => None,
        })
    }

    /// Olaylar arasından faz metnini bulur.
    fn faz(events: &[VideoEvent]) -> Option<String> {
        events.iter().find_map(|e| match e {
            VideoEvent::Stage(s) => Some(s.clone()),
            _ => None,
        })
    }

    // -----------------------------------------------------------------
    // DMP| ilerleme satırı
    // -----------------------------------------------------------------

    #[test]
    fn dmp_satiri_ilerleme_olayi_uretir() {
        // `--progress-template` alan sırası:
        // downloaded_bytes | total_bytes | total_bytes_estimate | speed
        let (events, err) = satiri_isle("DMP|1048576|10485760|10485760|524288.0", false);
        let p = ilerleme(&events).expect("ilerleme olayı beklenirdi");
        assert_eq!(p.downloaded, 1_048_576);
        assert_eq!(p.total, 10_485_760);
        assert_eq!(p.speed, 524_288.0);
        assert!(err.is_none());

        // MC de `DMP|` satırından sonra hemen döner: ilerleme satırları
        // günlüğe **yazılmaz**, aksi halde 6000 karakterlik pencereyi
        // saniyede birkaç satır doldururdu.
        assert!(
            !events.iter().any(|e| matches!(e, VideoEvent::Log(_))),
            "ilerleme satırı günlüğe düşmemeli"
        );
    }

    #[test]
    fn dmp_toplam_yoksa_tahmine_duser() {
        // Canlı akışta `total_bytes` -1 gelir; `total_bytes_estimate`
        // kullanılmalı (MC aynı geri düşüşü yapar).
        let (events, _) = satiri_isle("DMP|2048|-1|8192|1024.0", false);
        let p = ilerleme(&events).unwrap();
        assert_eq!(p.downloaded, 2048);
        assert_eq!(p.total, 8192, "tahmin toplamı kullanılmalı");
    }

    #[test]
    fn dmp_bozuk_alanlar_isaretci_degerini_korur() {
        // Ayrıştırılamayan sayısal alanlar -1 işaretçisine düşer (MC
        // `Int64(Double(s) ?? -1)`); `downloaded` ve `speed` sıfıra
        // kırpılır, `total` ise -1 kalır ve **yönetici katmanında**
        // (`p.total.max(0) as u64`) sıfıra çevrilir.
        let (events, _) = satiri_isle("DMP|NA|NA|NA|NA", false);
        let p = ilerleme(&events).expect("ilerleme olayı yine üretilmeli");
        assert_eq!(p.downloaded, 0, "indirilen negatif olamaz");
        assert_eq!(p.speed, 0.0, "hız negatif olamaz");
        assert_eq!(p.total, -1, "toplam işaretçi değeri MC ile aynı");
    }

    #[test]
    fn dmp_eksik_alanli_satir_ilerleme_uretmez() {
        // Dört alandan azı ilerleme sayılmaz; satır yine günlüğe düşer.
        let (events, _) = satiri_isle("DMP|1024|2048", false);
        assert!(ilerleme(&events).is_none(), "eksik satır ilerleme olmamalı");
        assert!(
            events
                .iter()
                .any(|e| matches!(e, VideoEvent::Log(_))),
            "satır günlüğe düşmeli"
        );
    }

    // -----------------------------------------------------------------
    // MCFMT| biçim seçimi satırı
    // -----------------------------------------------------------------

    #[test]
    fn mc_fmt_satiri_cozunurluk_ve_kodek_gosterir() {
        // before_dl:MCFMT|resolution|ext|vcodec|acodec|filesize_approx|format_id|duration
        // MC sırası: çözünürlük · UZANTI · kodek(kök) · ~boyut
        let (events, _) = satiri_isle(
            "MCFMT|1920x1080|mp4|avc1.640028|mp4a.40.2|104857600|137|212",
            false,
        );
        let stage = faz(&events).expect("faz metni beklenirdi");
        assert!(stage.contains("1920x1080"), "çözünürlük görünmeli: {stage}");
        assert!(stage.contains("MP4"), "uzantı büyük harfle: {stage}");
        // Kodek yalnızca noktadan önceki köküyle yazılır.
        assert!(stage.contains("avc1"), "kodek kökü gösterilmeli: {stage}");
        assert!(
            !stage.contains("avc1.640028"),
            "kodek profili gösterilmemeli: {stage}"
        );
        assert!(stage.contains("~100.0 MB"), "yaklaşık boyut: {stage}");
        // Ayraç MC ile aynı.
        assert!(stage.contains(" · "), "ayraç ` · ` olmalı: {stage}");
    }

    #[test]
    fn mc_fmt_eksik_alanlari_atlar() {
        // `NA` alanları metne eklenmez; boyut bilinmiyorsa atlanır.
        let (events, _) = satiri_isle("MCFMT|NA|webm|vp9|none|NA|251|0", false);
        let stage = faz(&events).expect("faz metni beklenirdi");
        assert!(!stage.contains("NA"), "`NA` gösterilmemeli: {stage}");
        assert!(!stage.contains("none"), "`none` gösterilmemeli: {stage}");
        assert!(stage.contains("WEBM"), "uzantı gösterilmeli: {stage}");
        assert!(stage.contains("vp9"), "kodek gösterilmeli: {stage}");
        assert!(!stage.contains('~'), "boyut yoksa yaklaşık değer eklenmez");
        // Yalnızca iki alan kaldığı için ayraç bir kez olur.
        assert_eq!(stage.matches(" · ").count(), 1, "fazla: {stage}");
    }

    #[test]
    fn mc_fmt_eksik_satir_faz_uretmez() {
        let (events, _) = satiri_isle("MCFMT|1920x1080", false);
        assert!(faz(&events).is_none(), "altı alandan azsa faz yok");
    }

    // -----------------------------------------------------------------
    // Destination / Merger / ExtractAudio satırları
    // -----------------------------------------------------------------

    #[test]
    fn faz_metni_algilanir() {
        assert_eq!(
            stage_for_line("[download] Destination: Video.f137.mp4"),
            Some(i18n::t("stage.downloading_video", &[]))
        );
        assert_eq!(
            stage_for_line("[download] Destination: Audio.f140.m4a"),
            Some(i18n::t("stage.downloading_audio", &[]))
        );
        assert_eq!(
            stage_for_line("[download] Destination: tek_dosya.mp4"),
            Some(i18n::t("stage.downloading", &[]))
        );
        assert_eq!(
            stage_for_line("[Merger] Merging formats into \"out.mp4\""),
            Some(i18n::t("stage.merging", &[]))
        );
        assert_eq!(
            stage_for_line("[ExtractAudio] Destination: ses.mp3"),
            Some(i18n::t("stage.extracting_audio", &[]))
        );
        assert_eq!(
            stage_for_line("[VideoRemuxer] Remuxing video from webm to mp4"),
            Some(i18n::t("stage.converting", &[]))
        );
        assert_eq!(
            stage_for_line("[download] out.mp4 has already been downloaded"),
            Some(i18n::t("stage.already_downloaded", &[]))
        );
        assert!(stage_for_line("[info] yazılıyor...").is_none());
    }

    #[test]
    fn merger_satiri_faz_olayi_yayinlar() {
        let (events, _) = satiri_isle("[Merger] Merging formats into \"x.mp4\"", false);
        assert_eq!(faz(&events), Some(i18n::t("stage.merging", &[])));
    }

    // -----------------------------------------------------------------
    // Hata satırları
    // -----------------------------------------------------------------

    #[test]
    fn stderr_hata_satiri_kaydedilir() {
        let (events, err) = satiri_isle("ERROR: Video unavailable", true);
        assert_eq!(err.as_deref(), Some("ERROR: Video unavailable"));
        // Hata satırı da günlüğe düşer.
        assert!(
            events
                .iter()
                .any(|e| matches!(e, VideoEvent::Log(l) if l.starts_with("ERROR")))
        );
    }

    #[test]
    fn stdout_hata_satiri_kaydedilmez() {
        // yt-dlp bazı `ERROR:` satırlarından sonra kendiliğinden devam eder;
        // bu yüzden yalnızca stderr'deki hatalar "son hata" sayılır.
        let (_, err) = satiri_isle("ERROR: oynatma listesi atlandı", false);
        assert!(err.is_none(), "stdout hatası son hata olmamalı");
    }

    #[test]
    fn son_hata_son_yazilanla_guncellenir() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let last_error = std::sync::Mutex::new(None);
        handle_line("ERROR: birinci", true, &tx, &last_error);
        handle_line("ERROR: ikinci", true, &tx, &last_error);
        drop(tx);
        while rx.try_recv().is_ok() {}
        assert_eq!(
            last_error.into_inner().unwrap().as_deref(),
            Some("ERROR: ikinci")
        );
    }

    #[test]
    fn bos_satir_yoksayilir() {
        let (events, err) = satiri_isle("   ", false);
        assert!(events.is_empty(), "boş satır olay üretmemeli");
        assert!(err.is_none());
    }

    // -----------------------------------------------------------------
    // Final yol
    // -----------------------------------------------------------------

    #[test]
    fn var_olan_dosya_yolu_final_yol_olur() {
        let dir = std::env::temp_dir().join(format!("adm_video_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("cikti.mp4");
        std::fs::write(&file, b"x").unwrap();

        let (events, _) = satiri_isle(&file.to_string_lossy(), false);
        let yol = events.iter().find_map(|e| match e {
            VideoEvent::FinalPath(p) => Some(p.clone()),
            _ => None,
        });
        assert_eq!(yol.as_deref(), Some(file.as_path()), "final yol tanınmalı");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn olmayan_dosya_yolu_final_yol_sayilmaz() {
        // yt-dlp günlüğünde yol benzeri metinler olabilir; var olmayan
        // dosya `after_move:filepath` çıktısı olamaz.
        let (events, _) = satiri_isle("C:/yok/boyle/bir/dosya.mp4", false);
        assert!(
            !events
                .iter()
                .any(|e| matches!(e, VideoEvent::FinalPath(_))),
            "var olmayan dosya final yol olmamalı"
        );
    }

    // -----------------------------------------------------------------
    // Yardımcılar
    // -----------------------------------------------------------------

    #[test]
    fn youtube_tespiti() {
        assert!(url_is_youtube("https://www.youtube.com/watch?v=x"));
        assert!(url_is_youtube("https://youtu.be/x"));
        assert!(url_is_youtube("https://m.youtube.com/watch?v=x"));
        assert!(url_is_youtube("https://www.youtube-nocookie.com/embed/x"));
        assert!(!url_is_youtube("https://vimeo.com/123"));
        // Alan adı taklidi (suffix kontrolü) reddedilmeli.
        assert!(!url_is_youtube("https://notyoutube.com/watch?v=x"));
    }

    #[test]
    fn oturumlu_istemci_reddi() {
        assert!(is_signed_in_client_failure(
            "ERROR: The page needs to be reloaded"
        ));
        // Büyük/küçük harf farkı önemsiz.
        assert!(is_signed_in_client_failure(
            "error: THE PAGE NEEDS TO BE RELOADED"
        ));
        assert!(!is_signed_in_client_failure("ERROR: Video unavailable"));
    }

    #[test]
    fn bayt_bicimi() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(512), "512 B");
        assert_eq!(format_bytes(1024), "1.0 KB");
        assert_eq!(format_bytes(2048), "2.0 KB");
        assert_eq!(format_bytes(1024 * 1024), "1.0 MB");
        // Negatif (bozuk) değer 0 sayılır.
        assert_eq!(format_bytes(-5), "0 B");
    }

    #[test]
    fn cikti_adi_sablonu_mc_ile_ayni() {
        // MC: `%(title).150B [%(id)s].%(ext)s`
        assert_eq!(
            video_output_name("https://x.tld/video"),
            "%(title).150B [%(id)s].%(ext)s"
        );
    }

    #[test]
    fn ytdlp_yoksa_video_akisi_hata_verir() {
        // Bu ortamda yt-dlp kuruluysa senaryo sınanamaz; sessizce atlanır.
        if tools::locate(tools::Tool::YtDlp, "").is_some() {
            return;
        }

        let (tx, mut rx) = mpsc::unbounded_channel();
        let request = VideoRequest {
            url: "https://x.tld/video".into(),
            output_dir: std::env::temp_dir(),
            format_args: Vec::new(),
            headers: Vec::new(),
            cookie_file: None,
            use_cookies: false,
            custom_ytdlp_path: String::new(),
        };

        let rt = tokio::runtime::Runtime::new().expect("tokio çalışma zamanı kurulamadı");
        let result = rt.block_on(run(request, tx));

        let err = result.expect_err("yt-dlp yokken çalıştırma hata vermeli");
        assert!(
            err.to_string().contains("yt-dlp"),
            "hata yt-dlp'yi anmalı: {err}"
        );
        // Alt süreç başlamadığı için hiçbir olay yayınlanmamalı.
        assert!(rx.try_recv().is_err(), "başarısız çalıştırma olay üretmemeli");
    }

    #[test]
    fn calistirilamayan_ytdlp_hata_olayi_yayinlar() {
        // Var olan ama yürütülebilir olmayan bir dosya: `locate` bulur,
        // `spawn` başarısız olur. Bu durumda olay **mutlaka** yayınlanmalıdır,
        // aksi halde yönetici kanalın sessizce kapandığını görüp indirmeyi
        // "tamamlandı" sayardı.
        let dir = std::env::temp_dir().join(format!("adm_video_broken_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sahte = dir.join("yt-dlp.exe");
        std::fs::write(&sahte, b"yurutulebilir degil\n").unwrap();

        let (tx, mut rx) = mpsc::unbounded_channel();
        let request = VideoRequest {
            url: "https://x.tld/video".into(),
            output_dir: dir.clone(),
            format_args: Vec::new(),
            headers: Vec::new(),
            cookie_file: None,
            use_cookies: false,
            custom_ytdlp_path: sahte.to_string_lossy().to_string(),
        };

        let rt = tokio::runtime::Runtime::new().expect("tokio çalışma zamanı kurulamadı");
        let _ = rt.block_on(run(request, tx));

        let olay = rx
            .try_recv()
            .expect("başlatılamayan süreç için olay beklenirdi");
        match olay {
            VideoEvent::Finished(Err(msg)) => {
                assert!(!msg.is_empty(), "hata mesajı boş olmamalı");
                assert!(
                    msg.contains("yt-dlp"),
                    "mesaj yt-dlp'yi anmalı: {msg}"
                );
            }
            other => panic!("`Finished(Err)` beklenirdi, alınan: {other:?}"),
        }

        let _ = std::fs::remove_dir_all(&dir);
    }
}
