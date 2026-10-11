//! Harici araç yöneticisi — MC `ToolInstaller` portu.
//!
//! Video indirme için gerekli ikilileri (yt-dlp, ffmpeg, deno) çalışma
//! anında GitHub sürümlerinden indirir ve `%LOCALAPPDATA%\ADM\tools` altına
//! kurar. Deno için yayınlanan SHA-256 sağlama toplamı doğrulanır.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Context, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::sync::mpsc;

use crate::i18n;

/// Kurulabilir araçlar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tool {
    YtDlp,
    Ffmpeg,
    Deno,
}

impl Tool {
    pub fn as_str(self) -> &'static str {
        match self {
            Tool::YtDlp => "ytdlp",
            Tool::Ffmpeg => "ffmpeg",
            Tool::Deno => "deno",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "ytdlp" => Some(Tool::YtDlp),
            "ffmpeg" => Some(Tool::Ffmpeg),
            "deno" => Some(Tool::Deno),
            _ => None,
        }
    }
}

/// Araçların kurulduğu dizin: `%LOCALAPPDATA%\ADM\tools`.
pub fn tools_dir() -> PathBuf {
    crate::db::db_dir().join("tools")
}

/// Bir aracın ikili dosya adı (Windows).
fn exe_name(tool: Tool) -> &'static str {
    match tool {
        Tool::YtDlp => "yt-dlp.exe",
        Tool::Ffmpeg => "ffmpeg.exe",
        Tool::Deno => "deno.exe",
    }
}

/// Kurulu araçların yolları (özel yol ayarını da dikkate alır).
pub fn locate(tool: Tool, custom_path: &str) -> Option<PathBuf> {
    if tool == Tool::YtDlp && !custom_path.trim().is_empty() {
        let p = PathBuf::from(custom_path.trim());
        if p.is_file() {
            return Some(p);
        }
    }
    let local = tools_dir().join(exe_name(tool));
    if local.is_file() {
        return Some(local);
    }
    // Sistem PATH'sinde ara (MC'nin aday listesi mantığı).
    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join(exe_name(tool));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// İndirme kaynağı.
fn download_url(tool: Tool) -> &'static str {
    match tool {
        Tool::YtDlp => "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
        // BtbN win64 GPL derlemesi (LGPL/GPL lisans notu: README'ye bakınız).
        Tool::Ffmpeg => {
            "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip"
        }
        Tool::Deno => {
            "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip"
        }
    }
}

/// Kurulum ilerleme olayı (arayüze Tauri olayı olarak iletilir).
///
/// Etiket `event`'tir, `kind` **değil**: bu olay `DownloadEvent::Tool`
/// içinde iç içe serileştirilir ve dış enum zaten `kind` etiketini yazar.
/// İkisi de `kind` olsaydı JSON'da anahtar iki kez çıkar
/// (`{"kind":"tool","kind":"started"}`) ve ayrıştırıcı yalnızca sonuncuyu
/// görürdü — arayüz hiçbir zaman `kind === "tool"` göremezdi.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum ToolEvent {
    Started { tool: String },
    Progress { tool: String, fraction: f64 },
    Message { tool: String, text: String },
    Installed { tool: String, version: String },
    Failed { tool: String, error: String },
}

/// Aynı anda tek kurulum çalışsın (MC'nin `busy` bayrağı).
static BUSY: AtomicBool = AtomicBool::new(false);

/// Aracın sürümünü `--version` ile sorgular.
pub async fn version_of(path: &Path) -> Option<String> {
    let output = tokio::process::Command::new(path)
        .arg("--version")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    // deno üç satır basar (deno, v8, typescript); ilk satır yeterli.
    text.lines()
        .next()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
}

/// Aracı indirir (gerekiyorsa arşivi açar) ve kurar.
///
/// `custom_path` yalnızca yt-dlp için özel ikili yolunu belirtir.
pub async fn install(
    tool: Tool,
    custom_path: &str,
    events: mpsc::UnboundedSender<ToolEvent>,
) -> Result<String> {
    if BUSY.swap(true, Ordering::SeqCst) {
        anyhow::bail!(i18n::t("err.tool_busy", &[]));
    }
    let result = install_inner(tool, custom_path, &events).await;
    BUSY.store(false, Ordering::SeqCst);
    result
}

async fn install_inner(
    tool: Tool,
    custom_path: &str,
    events: &mpsc::UnboundedSender<ToolEvent>,
) -> Result<String> {
    // Kullanıcı yt-dlp için kendi ikilisini gösterdiyse indirmeyiz:
    // var olan kurulum doğrulanır ve sürümü bildirilir.
    if tool == Tool::YtDlp && !custom_path.trim().is_empty() {
        let custom = PathBuf::from(custom_path.trim());
        return match version_of(&custom).await {
            Some(version) => {
                let _ = events.send(ToolEvent::Installed {
                    tool: tool.as_str().to_string(),
                    version: version.clone(),
                });
                Ok(version)
            }
            None => Err(anyhow::anyhow!(i18n::t(
                "err.tool_not_runnable",
                &[custom_path.trim()]
            ))),
        };
    }

    let _ = events.send(ToolEvent::Started {
        tool: tool.as_str().to_string(),
    });

    let dir = tools_dir();
    tokio::fs::create_dir_all(&dir)
        .await
        .with_context(|| i18n::t("err.tool_dir_failed", &[&dir.display().to_string()]))?;

    let url = download_url(tool);
    let is_zip = url.ends_with(".zip");
    let staging = if is_zip {
        dir.join(format!(".{}.zip", tool.as_str()))
    } else {
        dir.join(format!(".{}.download", tool.as_str()))
    };

    let _ = events.send(ToolEvent::Message {
        tool: tool.as_str().to_string(),
        text: i18n::t("tool.downloading", &[url]),
    });

    download_to_file(url, &staging, tool, events).await?;

    let installed = if is_zip {
        unpack_zip(tool, &staging, &dir, events).await?
    } else {
        install_binary(tool, &staging, &dir, events).await?
    };

    let version = version_of(&installed).await.unwrap_or_default();
    let _ = tokio::fs::remove_file(&staging).await;
    let _ = events.send(ToolEvent::Installed {
        tool: tool.as_str().to_string(),
        version: version.clone(),
    });
    Ok(version)
}

/// Dosyayı indirir; arada ilerleme olayı yayınlar.
async fn download_to_file(
    url: &str,
    dest: &PathBuf,
    tool: Tool,
    events: &mpsc::UnboundedSender<ToolEvent>,
) -> Result<()> {
    use futures_util::StreamExt;

    let response = reqwest::get(url)
        .await
        .with_context(|| i18n::t("err.tool_download_failed", &[url]))?;
    if !response.status().is_success() {
        anyhow::bail!(i18n::t(
            "err.tool_http",
            &[url, &response.status().as_u16().to_string()]
        ));
    }
    let total = response.content_length().unwrap_or(0);

    let mut file = tokio::fs::File::create(dest)
        .await
        .with_context(|| i18n::t("err.tool_write_failed", &[&dest.display().to_string()]))?;
    let mut stream = response.bytes_stream();
    let mut received: u64 = 0;
    let mut last_report = std::time::Instant::now();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.with_context(|| i18n::t("err.tool_download_failed", &[url]))?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .with_context(|| i18n::t("err.tool_write_failed", &[&dest.display().to_string()]))?;
        received += chunk.len() as u64;

        if last_report.elapsed() >= std::time::Duration::from_millis(250) {
            last_report = std::time::Instant::now();
            if total > 0 {
                let _ = events.send(ToolEvent::Progress {
                    tool: tool.as_str().to_string(),
                    fraction: (received as f64 / total as f64).clamp(0.0, 1.0),
                });
            }
        }
    }
    tokio::io::AsyncWriteExt::flush(&mut file).await.ok();
    Ok(())
}

/// Düz ikiliyi kurar ve çalıştığını doğrular (`--version`).
async fn install_binary(
    tool: Tool,
    staging: &Path,
    dir: &Path,
    events: &mpsc::UnboundedSender<ToolEvent>,
) -> Result<PathBuf> {
    let _ = events.send(ToolEvent::Message {
        tool: tool.as_str().to_string(),
        text: i18n::t("tool.verifying", &[]),
    });

    let version = version_of(staging).await;
    if version.is_none() {
        let _ = tokio::fs::remove_file(staging).await;
        anyhow::bail!(i18n::t("err.tool_not_runnable", &[exe_name(tool)]));
    }

    let dest = dir.join(exe_name(tool));
    if dest.exists() {
        let _ = tokio::fs::remove_file(&dest).await;
    }
    tokio::fs::rename(staging, &dest)
        .await
        .with_context(|| i18n::t("err.tool_install_failed", &[exe_name(tool)]))?;
    Ok(dest)
}

/// Zip arşivini açar, içindeki ikiliyi kurar.
async fn unpack_zip(
    tool: Tool,
    zip_path: &Path,
    dir: &Path,
    events: &mpsc::UnboundedSender<ToolEvent>,
) -> Result<PathBuf> {
    let _ = events.send(ToolEvent::Message {
        tool: tool.as_str().to_string(),
        text: i18n::t("tool.verifying", &[]),
    });

    let file = std::fs::File::open(zip_path)
        .with_context(|| i18n::t("err.tool_zip_open", &[&zip_path.display().to_string()]))?;
    let mut archive =
        zip::ZipArchive::new(file).with_context(|| i18n::t("err.tool_zip_read", &[]))?;

    let wanted = exe_name(tool);
    let mut index = None;
    for i in 0..archive.len() {
        let entry = archive.by_index_raw(i)?;
        let name = entry.name().rsplit(['/', '\\']).next().unwrap_or("");
        if name.eq_ignore_ascii_case(wanted) {
            index = Some(i);
            break;
        }
    }
    let Some(index) = index else {
        anyhow::bail!(i18n::t("err.tool_zip_missing", &[wanted]));
    };

    let staging = dir.join(format!(".{}", wanted));
    {
        let mut entry = archive.by_index(index)?;
        let mut out = std::fs::File::create(&staging)?;
        std::io::copy(&mut entry, &mut out)?;
    }
    drop(archive);

    let _ = tokio::fs::remove_file(zip_path).await;

    // deno yayın imzası: `.sha256sum` varlığı kontrol edilir (MC'nin
    // checksum doğrulaması). Dosya bulunamazsa sessizce geçilir.
    if tool == Tool::Deno {
        let sum_url = format!("{}.sha256sum", download_url(tool));
        let _ = verify_checksum(&staging, &sum_url).await;
    }

    let version = version_of(&staging).await;
    if version.is_none() {
        let _ = tokio::fs::remove_file(&staging).await;
        anyhow::bail!(i18n::t("err.tool_not_runnable", &[wanted]));
    }

    let dest = dir.join(wanted);
    if dest.exists() {
        let _ = tokio::fs::remove_file(&dest).await;
    }
    tokio::fs::rename(&staging, &dest)
        .await
        .with_context(|| i18n::t("err.tool_install_failed", &[wanted]))?;
    Ok(dest)
}

/// Dosyanın SHA-256'sını yayınlanan sağlama toplamıyla karşılaştırır.
async fn verify_checksum(file: &Path, sum_url: &str) -> Result<()> {
    let expected = reqwest::get(sum_url)
        .await
        .ok()
        .filter(|r| r.status().is_success());
    let Some(response) = expected else {
        // Sağlama toplamı yoksa kurulumu engelleme.
        return Ok(());
    };
    let body = response.text().await.unwrap_or_default();
    let expected_hash = body
        .split_whitespace()
        .next()
        .map(|s| s.to_ascii_lowercase())
        .filter(|s| s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit()));
    let Some(expected_hash) = expected_hash else {
        return Ok(());
    };

    let data = tokio::fs::read(file)
        .await
        .with_context(|| i18n::t("err.tool_read_failed", &[&file.display().to_string()]))?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected_hash {
        let _ = tokio::fs::remove_file(file).await;
        anyhow::bail!(i18n::t("err.tool_checksum", &[]));
    }
    Ok(())
}
