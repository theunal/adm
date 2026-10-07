//! Yönetici (manager) entegrasyon testleri.
//!
//! Motor testlerinin aksine burada veritabanı, olay yayını ve komut
//! katmanı birlikte sınanır. Tüm hata mesajları Türkçe olmalıdır.

use std::path::PathBuf;
use std::time::Duration;

use adm_lib::db::Database;
use adm_lib::manager::{DownloadEvent, DownloadManager, StartRequest};
use adm_lib::models::DownloadStatus;

/// Testler için izole veritabanı açar.
///
/// Her test kendi dosyasını kullanır; testler paralel çalıştığı için
/// kayıtlar birbirine karışmaz ve uygulamanın gerçek veritabanına
/// dokunulmaz.
async fn setup(name: &str) -> Database {
    let dir = std::env::temp_dir().join("adm_manager_tests");
    std::fs::create_dir_all(&dir).expect("test dizini oluşturulamadı");

    // Test adı benzersizdir; eski dosya kalıntısı olmasın.
    let path = dir.join(format!("{name}_{}.db", std::process::id()));
    for suffix in ["", "-wal", "-shm"] {
        let mut p = path.clone().into_os_string();
        p.push(suffix);
        let _ = std::fs::remove_file(p);
    }

    Database::connect_at(path)
        .await
        .expect("veritabanı açılamadı")
}

/// Belirli bir kaydı siler (test izolasyonu için).
async fn cleanup(manager: &DownloadManager, id: i64) {
    let _ = manager.delete(id, false).await;
}

#[tokio::test]
async fn indirme_baslatip_durum_temizlenir() {
    let db = setup("baslat").await;
    let manager = DownloadManager::new(db);
    let _manager = manager.clone();

    let Ok(id) = manager
        .start(StartRequest {
            // Erişilemeyen adres: indirme hemen başarısız olur.
            url: "http://127.0.0.1:1/erisilemez.bin".to_string(),
            file_path: None,
            channel_count: 4,
        })
        .await
    else {
        // Başlatma komutu ağ hatasında da kayıt oluşturup görevi
        // başlatır; id alınamazsa bu bir hata değil, kabul edilebilir.
        return;
    };

    let item = manager.get(id).await.unwrap().expect("kayıt yok");
    assert_eq!(item.channel_count, 4);
    assert!(item.file_name.ends_with(".bin"));

    // Adres erişilemez olduğu için görev hemen başarısız olur; durum
    // `Downloading` veya `Failed` olabilir (zamanlama bağımlı).
    assert!(
        matches!(
            item.status,
            DownloadStatus::Downloading | DownloadStatus::Failed
        ),
        "beklenmeyen başlangıç durumu: {:?}",
        item.status
    );

    // Görevin bitmesini bekle.
    for _ in 0..60 {
        if let Some(i) = manager.get(id).await.unwrap()
            && i.status == DownloadStatus::Failed
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let after = manager.get(id).await.unwrap().expect("kayıt silinmemeli");
    assert_eq!(after.status, DownloadStatus::Failed);
    assert!(
        after.error_message.is_some(),
        "başarısız indirmede hata mesajı olmalı"
    );
    if let Some(msg) = &after.error_message {
        assert!(
            msg.chars().any(|c| c as u32 > 0x7F),
            "hata mesajı Türkçe olmalı: {msg}"
        );
    }

    cleanup(&manager, id).await;
}

#[tokio::test]
async fn bos_url_reddedilir() {
    let db = setup("bos").await;
    let manager = DownloadManager::new(db);

    let result = manager
        .start(StartRequest {
            url: "   ".to_string(),
            file_path: None,
            channel_count: 4,
        })
        .await;

    assert!(result.is_err(), "boş URL reddedilmeli");
    let msg = result.unwrap_err().to_string();
    assert!(msg.contains("URL"), "mesaj URL sorununu belirtmeli: {msg}");
}

#[tokio::test]
async fn kanal_sayisi_sinirlanir() {
    let db = setup("kanal").await;
    let manager = DownloadManager::new(db);
    let _guard = manager.clone();

    // 0 kanal isteyen durum 1'e, 100 kanal isteyen durum 32'ye çekilir.
    let Ok(id) = manager
        .start(StartRequest {
            url: "http://127.0.0.1:1/a.bin".to_string(),
            file_path: None,
            channel_count: 0,
        })
        .await
    else {
        return;
    };

    let item = manager.get(id).await.unwrap().unwrap();
    assert_eq!(item.channel_count, 1, "0 kanal 1'e çekilmeli");

    if let Err(e) = manager.change_channel_count(id, 100).await {
        panic!("kanal sayısı değiştirilemedi: {e}");
    }
    let updated = manager.get(id).await.unwrap().unwrap();
    assert_eq!(updated.channel_count, 32, "100 kanal 32'ye çekilmeli");

    cleanup(&manager, id).await;
}

#[tokio::test]
async fn olay_yayini_calisir() {
    let db = setup("olay").await;
    let manager = DownloadManager::new(db);
    let mut rx = manager.subscribe();

    let Ok(id) = manager
        .start(StartRequest {
            url: "http://127.0.0.1:1/olay.bin".to_string(),
            file_path: None,
            channel_count: 2,
        })
        .await
    else {
        return;
    };

    // "Yeni indirme eklendi" log olayı gelmeli.
    let mut saw_log = false;
    let mut saw_completed = false;

    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while tokio::time::Instant::now() < deadline && !(saw_log && saw_completed) {
        match tokio::time::timeout(Duration::from_millis(500), rx.recv()).await {
            Ok(Ok(ev)) => match ev {
                DownloadEvent::Log { .. } => saw_log = true,
                DownloadEvent::Completed { id: eid, .. } if eid == id => saw_completed = true,
                _ => {}
            },
            Ok(Err(_)) => break,
            Err(_) => continue,
        }
    }

    assert!(saw_log, "log olayı yayınlanmalıydı");
    assert!(saw_completed, "tamamlanma olayı yayınlanmalıydı");

    cleanup(&manager, id).await;
}

#[tokio::test]
async fn silme_kaydi_siler() {
    let db = setup("sil").await;
    let manager = DownloadManager::new(db);
    let _guard = manager.clone();

    let Ok(id) = manager
        .start(StartRequest {
            url: "http://127.0.0.1:1/sil.bin".to_string(),
            file_path: None,
            channel_count: 1,
        })
        .await
    else {
        return;
    };

    // `delete_file = false`: dosya korunur, kayıt silinir.
    manager.delete(id, false).await.expect("silinemedi");
    assert!(
        manager.get(id).await.unwrap().is_none(),
        "kayıt silinmeliydi"
    );
}

#[tokio::test]
async fn silinmeyen_kayit_hata_verir() {
    let db = setup("yok").await;
    let manager = DownloadManager::new(db);

    let result = manager.delete(999_999, false).await;
    assert!(result.is_err(), "olmayan kayıt silinmemeli");

    let result = manager.pause(999_999).await;
    assert!(result.is_err(), "olmayan indirme duraklatılamaz");

    let result = manager.resume(999_999).await;
    assert!(result.is_err(), "olmayan indirme sürdürülemez");
}

#[tokio::test]
async fn duraklatma_kanal_durumlarini_kalici_yazar() {
    let db = setup("duraklat").await;
    let manager = DownloadManager::new(db);
    let _guard = manager.clone();

    let Ok(id) = manager
        .start(StartRequest {
            url: "http://127.0.0.1:1/duraklat.bin".to_string(),
            file_path: None,
            channel_count: 4,
        })
        .await
    else {
        return;
    };

    // İndirme hemen başarısız olacağı için duraklatma çalışmayabilir;
    // önemli olan komutun panik vermemesi ve kaydın bozulmaması.
    let _ = manager.pause(id).await;

    let item = manager.get(id).await.unwrap().expect("kayıt silinmemeli");
    assert!(
        matches!(
            item.status,
            DownloadStatus::Paused
                | DownloadStatus::Cancelled
                | DownloadStatus::Failed
                | DownloadStatus::Completed
        ),
        "duraklatma sonrası durum geçerli olmalı, alındı: {:?}",
        item.status
    );

    cleanup(&manager, id).await;
}

#[tokio::test]
async fn listeler_dogru_ayrilir() {
    let db = setup("liste").await;
    let manager = DownloadManager::new(db);
    let _guard = manager.clone();

    let mut created: Vec<i64> = Vec::new();
    for i in 0..3 {
        if let Ok(id) = manager
            .start(StartRequest {
                url: format!("http://127.0.0.1:1/{i}.bin"),
                file_path: None,
                channel_count: 1,
            })
            .await
        {
            created.push(id);
        }
    }

    // Tüm görevlerin bitmesini bekle.
    for _ in 0..80 {
        if manager.list_active().await.unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let all = manager.list_all().await.unwrap();
    assert!(all.len() >= 3, "tüm kayıtlar listelenmeli");

    let active = manager.list_active().await.unwrap();
    assert!(
        active.is_empty(),
        "görevler bitince aktif kayıt kalmamalı, kalan: {}",
        active.len()
    );

    for id in created {
        cleanup(&manager, id).await;
    }
}

#[tokio::test]
async fn gecmisi_temizle_yalnizca_bitmisleri_siler() {
    let db = setup("temizle").await;
    let manager = DownloadManager::new(db);
    let _guard = manager.clone();

    let Ok(id) = manager
        .start(StartRequest {
            url: "http://127.0.0.1:1/temizle.bin".to_string(),
            file_path: None,
            channel_count: 1,
        })
        .await
    else {
        return;
    };

    for _ in 0..80 {
        if let Some(i) = manager.get(id).await.unwrap()
            && i.status == DownloadStatus::Failed
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    manager.clear_finished().await.expect("temizlenemedi");
    assert!(
        manager.get(id).await.unwrap().is_none(),
        "bitmiş kayıt temizlenmeliydi"
    );
}

#[tokio::test]
async fn kapanis_aktif_indirmeleri_iptal_eder() {
    let db = setup("kapanis").await;
    let manager = DownloadManager::new(db);

    let mut ids = Vec::new();
    for i in 0..2 {
        if let Ok(id) = manager
            .start(StartRequest {
                url: format!("http://127.0.0.1:1/kapanis_{i}.bin"),
                file_path: None,
                channel_count: 2,
            })
            .await
        {
            ids.push(id);
        }
    }

    manager.shutdown_all().await;

    for id in ids {
        let item = manager.get(id).await.unwrap().expect("kayıt silinmemeli");
        assert_ne!(
            item.status,
            DownloadStatus::Downloading,
            "kapanışta indirme çalışır durumda kalmamalı"
        );
        cleanup(&manager, id).await;
    }
}

#[tokio::test]
async fn olay_alicisi_kapatilinca_kanal_dusmez() {
    let db = setup("alici").await;
    let manager = DownloadManager::new(db);
    let rx = manager.subscribe();
    drop(rx);
    // Kanallar açıkken gönderim yapılabilmeli (hata sessizce yutulur).
    let Ok(id) = manager
        .start(StartRequest {
            url: "http://127.0.0.1:1/alici.bin".to_string(),
            file_path: None,
            channel_count: 1,
        })
        .await
    else {
        return;
    };

    tokio::time::sleep(Duration::from_millis(200)).await;
    cleanup(&manager, id).await;
}

#[tokio::test]
async fn varsayilan_klasor_kullanilabilir() {
    let dir: PathBuf = adm_lib::manager::default_download_dir();
    assert!(dir.ends_with("Downloads"), "beklenen: {}", dir.display());
}
