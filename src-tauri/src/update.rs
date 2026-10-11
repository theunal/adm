//! Güncelleme denetimi — MC `UpdateChecker` portu.
//!
//! GitHub Releases'dan son sürümü çeker, semver karşılaştırması yapar ve
//! yeni sürümü olayla bildirir. "Atlanan sürüm" ve son kontrol zamanı
//! ayarlar tablosunda tutulur.

use std::time::Duration;

use serde::Deserialize;

use crate::i18n;

/// GitHub deposu (`sahip/ad`).
pub const REPO: &str = "theunal/adm";

/// Sürüm sayfası.
pub fn release_page() -> String {
    format!("https://github.com/{REPO}/releases/latest")
}

/// Uygulamanın mevcut sürümü (tauri.conf.json ile aynı tutulur).
pub fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Ağdan okunan sürüm bilgisi.
#[derive(Debug, Clone)]
pub struct ReleaseInfo {
    pub version: String,
    pub page_url: String,
    pub dmg_url: Option<String>,
    pub notes: String,
}

/// GitHub API yanıtından ihtiyaç duyulan alanlar.
#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    body: Option<String>,
    assets: Option<Vec<GitHubAsset>>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

/// `a`, `b`'den yeni mi? (semver-karşı benzeri sayısal karşılaştırma)
pub fn is_newer(a: &str, b: &str) -> bool {
    let parse = |s: &str| -> Vec<u32> {
        // Etiketler `v` ile başlayabilir (`v1.2.3`); sayısal parçalara
        // ayrıştırmadan önce atılır, aksi halde ilk parça 0 okunurdu.
        s.trim_start_matches(['v', 'V'])
            .split('.')
            .map(|part| {
                part.chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .parse()
                    .unwrap_or(0)
            })
            .collect()
    };
    let pa = parse(a);
    let pb = parse(b);
    for i in 0..pa.len().max(pb.len()) {
        let x = pa.get(i).copied().unwrap_or(0);
        let y = pb.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false
}

/// GitHub'tan son sürümü çeker.
pub async fn check_latest() -> anyhow::Result<ReleaseInfo> {
    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()?;
    let response = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", format!("ADM/{}", current_version()))
        .send()
        .await
        .map_err(|e| anyhow::anyhow!(i18n::t("err.update_check_failed", &[&e.to_string()])))?;

    if !response.status().is_success() {
        anyhow::bail!(i18n::t(
            "err.update_http",
            &[&response.status().as_u16().to_string()]
        ));
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| anyhow::anyhow!(i18n::t("err.update_parse_failed", &[&e.to_string()])))?;

    let version = release
        .tag_name
        .strip_prefix('v')
        .unwrap_or(&release.tag_name)
        .to_string();

    let dmg_url = release
        .assets
        .unwrap_or_default()
        .into_iter()
        .find(|a| {
            let name = a.name.to_ascii_lowercase();
            name.ends_with(".exe") || name.ends_with(".msi")
        })
        .map(|a| a.browser_download_url);

    Ok(ReleaseInfo {
        version,
        page_url: release.html_url,
        dmg_url,
        notes: release.body.unwrap_or_default().trim().to_string(),
    })
}

/// Denetim sonucu (durum çubuğu / ayarlar için).
#[derive(Debug, Clone)]
pub enum CheckOutcome {
    /// Yeni sürüm var (veya yok).
    Update(Option<ReleaseInfo>),
    /// Denetim başarısız.
    Error(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn surum_karsilastirma() {
        assert!(is_newer("0.3.0", "0.2.0"));
        assert!(is_newer("1.10", "1.9"));
        assert!(!is_newer("0.2.0", "0.3.0"));
        assert!(!is_newer("0.2.0", "0.2.0"));
        // Sayısal olmayan ekleri yok sayar.
        assert!(is_newer("v1.0.0", "0.9.9"));
    }

    #[test]
    fn mevcut_surum_okunur() {
        assert!(!current_version().is_empty());
    }
}
