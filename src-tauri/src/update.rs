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
    fn surum_karsilastirma_parca_sayisi_farkli() {
        // Eksik parçalar 0 sayılır: `1.2` ile `1.2.0` aynı sürümdür.
        assert!(!is_newer("1.2", "1.2.0"));
        assert!(!is_newer("1.2.0", "1.2"));
        // Uzun sürüm daha büyük olabilir.
        assert!(is_newer("1.2.1", "1.2"));
        assert!(!is_newer("1.2", "1.2.1"));
    }

    #[test]
    fn surum_karsilastirma_etiket_ve_eki_yoksayar() {
        // `v`/`V` öneki iki tarafta da atılır.
        assert!(!is_newer("v1.0.0", "V1.0.0"));
        assert!(is_newer("V2.0.0", "v1.9.9"));

        // Sürüm sonundaki sözel ek (`-beta`) sayısal karşılaştırmayı bozmaz.
        assert!(!is_newer("1.0.0-beta", "1.0.0"));
        assert!(!is_newer("1.0.0", "1.0.0-beta"));
        assert!(is_newer("1.0.1-rc", "1.0.0"));

        // MC'nin `isNewer` portu noktalı ön sürüm ekini **dördüncü sayı**
        // olarak okur (`1.0.0-beta.1` → [1,0,0,1]); bu MC ile birebir aynı
        // davranıştır, burada belgelenir ki yanlışlıkla "düzeltilmesin".
        assert!(is_newer("1.0.0-beta.1", "1.0.0"));
    }

    #[test]
    fn surum_karsilastirma_cok_haneli_parcalar() {
        // Sözlü sıralama değil sayısal sıralama: "10" > "9".
        assert!(is_newer("0.2.10", "0.2.9"));
        assert!(is_newer("10.0.0", "2.0.0"));
        assert!(!is_newer("2.0.0", "10.0.0"));
    }

    #[test]
    fn surum_karsilastirma_bozuk_girdide_panik_vermez() {
        // Boş ve sayı içermeyen girdiler 0 kabul edilir.
        assert!(!is_newer("", ""));
        assert!(!is_newer("boş", "boş"));
        assert!(is_newer("1.0", ""));
    }

    #[test]
    fn mevcut_surum_okunur() {
        let v = current_version();
        assert!(!v.is_empty());
        // `Cargo.toml` sürümü sayısal parçalarla başlamalı.
        assert!(
            v.chars().next().is_some_and(|c| c.is_ascii_digit()),
            "sürüm sayıyla başlamalı: {v}"
        );
    }

    #[test]
    fn surum_sayfasi_dogru_adresi_kurar() {
        assert_eq!(
            release_page(),
            "https://github.com/theunal/adm/releases/latest"
        );
    }
}
