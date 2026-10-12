#!/usr/bin/env bash
# Safari bundle kimligi guard'ini dogrular.
# Gercek log'da olculen iki senaryoyu yeniden uretir:
#   A) kirim (parent=com.unal.adm.ADM, child=com.unal.adm.browserextension.Extension)
#   B) duzeltme sonrasi (child parent'in altinda)
set -uo pipefail
cd "$(dirname "$0")"

extract() { # $1 = pbxproj yolu
  grep -oE 'PRODUCT_BUNDLE_IDENTIFIER = "?[A-Za-z0-9.-]+"?;' "$1" \
    | sed -E 's/.*= "?([A-Za-z0-9.-]+)"?;.*/\1/' | sort -u
}

mk_pbx() { # $1 yol, $2 app id, $3 ext id
  cat > "$1" <<EOF
				PRODUCT_BUNDLE_IDENTIFIER = "$2";
				PRODUCT_BUNDLE_IDENTIFIER = $3;
EOF
}

fails=0
total=0
run() { # $1 ad, $2 beklenen
  local name="$1" want="$2"; shift 2
  total=$((total+1))
  if [[ "$1" == "$want" ]]; then echo "  gecti  $name"
  else echo "  KALDI  $name (beklenen='$want', gelen='$1')"; fails=$((fails+1)); fi
}

W=$(mktemp -d)

echo "Senaryo A - eski kirim yapisinda tespit ediliyor mu?"
mk_pbx "$W/a.pbxproj" "com.unal.adm.ADM" "com.unal.adm.browserextension.Extension"
ids=$(extract "$W/a.pbxproj")
APP=$(printf '%s\n' "$ids" | grep -v '\.Extension$' | head -n1)
EXT=$(printf '%s\n' "$ids" | grep '\.Extension$' | head -n1)
run "app id okundu"      "com.unal.adm.ADM"  "$APP"
run "ext id okundu"      "com.unal.adm.browserextension.Extension" "$EXT"
if [[ "$EXT" != "$APP".* ]]; then run "uyumsuzluk YAKALANDI" "ok" "ok"
else run "uyumsuzluk YAKALANDI" "ok" "yakalanamadi"; fi

echo "Senaryo B - duzeltme sonrasi geciyor mu?"
mk_pbx "$W/b.pbxproj" "com.unal.adm.ADM" "com.unal.adm.ADM.Extension"
ids=$(extract "$W/b.pbxproj")
APP=$(printf '%s\n' "$ids" | grep -v '\.Extension$' | head -n1)
EXT=$(printf '%s\n' "$ids" | grep '\.Extension$' | head -n1)
if [[ "$EXT" == "$APP".* ]]; then run "uyumlu kabul edildi" "ok" "ok"
else run "uyumlu kabul edildi" "ok" "uyumsuz bulundu"; fi

echo "Senaryo C - adimsiz (quote'suz) pbx girdisi de okunuyor mu?"
mk_pbx "$W/c.pbxproj" "com.unal.adm.ADM" "com.unal.adm.ADM.Extension"
ids=$(extract "$W/c.pbxproj")
run "2 kimlik" "2" "$(printf '%s\n' "$ids" | grep -c .)"

echo "Senaryo D - uygulamanin bekledigi yeni deger uretiliyor mu?"
SLUG=ADM
APP_ID="com.unal.adm.$SLUG"
run "flag degeri" "com.unal.adm.ADM" "$APP_ID"
run "beklenen child" "com.unal.adm.ADM.Extension" "$APP_ID.Extension"
if [[ "com.unal.adm.ADM.Extension" == "com.unal.adm.ADM".* ]]; then
  run "parent child'i onekliyor" "ok" "ok"; else run "parent child'i onekliyor" "ok" "hayir"; fi

rm -rf "$W"
echo
if [ "$fails" -eq 0 ]; then echo "$total/$total gecti"; else echo "$((total-fails))/$total gecti, $fails KALDI"; fi
exit "$fails"
