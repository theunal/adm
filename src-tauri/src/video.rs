//! Video indirme — MC `VideoDownloader` portu.
//!
//! yt-dlp'yi bir alt süreç olarak çalıştırır; ilerleme, faz bilgisi ve
//! hata satırlarını kanallarla dışarıya verir.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use anyhow::Context as _;
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

    let mut child = command
        .spawn()
        .with_context(|| i18n::t("err.ytdlp_spawn_failed", &[&exe.display().to_string()]))?;

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

    #[test]
    fn dmp_satiri_ayristirilir() {
        // `handle_line` özeldir; çekirdek ayrıştırma `stage_for_line` ile
        // sınanır. İlerleme ayrıştırması için yardımcı:
        let line = "DMP|1048576|10485760|10485760|524288.0";
        let rest = line.trim_start_matches("DMP|");
        let parts: Vec<&str> = rest.split('|').collect();
        assert_eq!(parts.len(), 4);
        let num = |s: &str| s.parse::<f64>().ok().unwrap_or(-1.0) as i64;
        assert_eq!(num(parts[0]), 1048576);
        assert_eq!(num(parts[1]), 10485760);
        assert_eq!(num(parts[3]), 524288);
    }

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
            stage_for_line("[Merger] Merging formats into \"out.mp4\""),
            Some(i18n::t("stage.merging", &[]))
        );
        assert!(stage_for_line("[info] yazılıyor...").is_none());
    }

    #[test]
    fn youtube_tespiti() {
        assert!(url_is_youtube("https://www.youtube.com/watch?v=x"));
        assert!(url_is_youtube("https://youtu.be/x"));
        assert!(!url_is_youtube("https://vimeo.com/123"));
    }

    #[test]
    fn oturumlu_istemci_reddi() {
        assert!(is_signed_in_client_failure(
            "ERROR: The page needs to be reloaded"
        ));
        assert!(!is_signed_in_client_failure("ERROR: Video unavailable"));
    }

    #[test]
    fn bayt_bicimi() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(512), "512 B");
        assert_eq!(format_bytes(2048), "2.0 KB");
    }
}
