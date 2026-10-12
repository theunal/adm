#!/usr/bin/env bash
# Release'a hangi dosyalarin girdigini dogrular.
#
# Eski desen (`bundle/**/*`) Tauri'nin biraktigi AppImage yukunu (usr/, data/,
# ~200 .so) ve macOS .app paketini de release'a yukluyordu; ilk yayinda 461
# varlik olustu ve GitHub'in ikincil hiz siniri yari yolda kesildi.
#
# Betik, olcusu gercege yakin bir bundle agaci kurup ESKI ve YENI desenlerin
# kac dosya sectigini sayar. `**` burada @actions/glob'un ozyinelemeli
# anlaminda ele alinir (find ile modellenir). Asil soru: yeni desen kurulum
# dosyalarini KACIRMAMALI.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
R=$(mktemp -d)
T="$R/src-tauri/target"
mkdir -p "$T"

# --- gercege yakin bir Tauri bundle agaci -------------------------------
mkdir -p "$T/release/bundle/appimage/usr/lib" \
         "$T/release/bundle/appimage/data" \
         "$T/release/bundle/deb/DEBIAN" \
         "$T/release/bundle/nsis" \
         "$T/release/bundle/msi" \
         "$T/release/bundle/macos/ADM.app/Contents/MacOS" \
         "$T/release/bundle/macos/ADM.app/Contents/Resources" \
         "$T/release/bundle/dmg" \
         "$T/universal-apple-darwin/release/bundle/dmg"

# kurulum dosyalari (bunlarin hepsi release'a gitmeli)
touch "$T/release/bundle/appimage/ADM_0.3.0_amd64.AppImage" \
      "$T/release/bundle/deb/ADM_0.3.0_amd64.deb" \
      "$T/release/bundle/nsis/ADM_Setup_0.3.0_x64.exe" \
      "$T/release/bundle/msi/ADM_0.3.0_x64_en-US.msi" \
      "$T/release/bundle/dmg/ADM_0.3.0_aarch64.dmg" \
      "$T/universal-apple-darwin/release/bundle/dmg/ADM_0.3.0_universal.dmg"

# AppImage yuku (release'a gitmemesi gereken cop)
for i in $(seq 1 60); do touch "$T/release/bundle/appimage/usr/lib/libfake$i.so"; done
touch "$T/release/bundle/appimage/AppRun" \
      "$T/release/bundle/appimage/ADM.desktop" \
      "$T/release/bundle/appimage/.DirIcon" \
      "$T/release/bundle/appimage/adm.png" \
      "$T/release/bundle/deb/DEBIAN/control"
mkdir -p "$T/release/bundle/deb/opt/adm"
touch "$T/release/bundle/deb/opt/adm/unrelated.txt"
# macOS .app paket icindekiler
for i in $(seq 1 20); do touch "$T/release/bundle/macos/ADM.app/Contents/MacOS/helper$i"; done
touch "$T/release/bundle/macos/ADM.app/Contents/Info.plist"

# --- desenleri modelle --------------------------------------------------
# ESKI: src-tauri/target/release/bundle/**/*  +  src-tauri/target/*/release/bundle/**/*
OLD_LIST=$(
  { find "$T/release/bundle" -type f
    find "$T" -mindepth 1 -maxdepth 1 -type d ! -name release -exec find {}/release/bundle -type f \;
  } 2>/dev/null | sed "s|^$R/||" | sort -u
)
OLD=$(printf '%s\n' "$OLD_LIST" | grep -c . )

# YENI: hedef klasor bundle/ altinda olup belirli uzantida olmali
NEW_LIST=$(
  find "$T" -type f -path '*/bundle/*' \
    \( -name '*.exe' -o -name '*.msi' -o -name '*.deb' -o -name '*.AppImage' -o -name '*.dmg' \) \
    | sed "s|^$R/||" | sort -u
)
NEW=$(printf '%s\n' "$NEW_LIST" | grep -c . )

echo "agacta toplam dosya  : $(find "$R" -type f | wc -l)"
echo "ESKI desen secilen   : $OLD"
echo "YENI desen secilen   : $NEW"
echo
echo "yeni desenin sectigi dosyalar:"
printf '%s\n' "$NEW_LIST" | while IFS= read -r f; do echo "  $f"; done

fails=0
ok() { if [ "$2" = "$3" ]; then echo "  gecti  $1"; else echo "  KALDI  $1 (beklenen=$2 gelen=$3)"; fails=$((fails+1)); fi }
echo
ok "yeni desen tam 6 kurulum dosyasi"  "6"  "$NEW"
ok "yeni desen .so copunu birakmiyor"  "0"  "$(printf '%s\n' "$NEW_LIST" | grep -c '\.so$')"
ok "yeni desen .app icindekini birakmiyor" "0" "$(printf '%s\n' "$NEW_LIST" | grep -c '\.app/')"
# 5 farkli uzanti: .AppImage .deb .dmg .msi .exe  (.dmg iki yerde uretiliyor:
# bundle/dmg ve universal-apple-darwin/release/bundle/dmg)
ok "5 kurulum uzantisi temsil ediliyor" "5" "$(printf '%s\n' "$NEW_LIST" | sed 's/.*\.//' | sort -u | wc -l)"

rm -rf "$R"
echo
if [ "$fails" -eq 0 ]; then echo "4/4 gecti"; else echo "$fails KALDI"; fi
exit "$fails"
