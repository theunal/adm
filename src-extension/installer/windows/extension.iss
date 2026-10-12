; ADM tarayıcı eklentisi için Inno Setup betiği.
;
; Parametreler workflow'dan /D ile verilir:
;   /DAppName=...  /DAppVersion=1.0.0  /DExtId=<chromium-id>  /DUpdateUrl=https://.../update.xml
;
; Elle derleme:
;   ISCC.exe /DAppName=ADM /DAppVersion=1.0.0 /DExtId=<id> ^
;            /DUpdateUrl=https://github.com/<owner>/<repo>/releases/latest/download/update.xml ^
;            src-extension\installer\windows\extension.iss
;
; NOT: Bu dosya bilerek ASCII tutulur (BOM'suz UTF-8 her yerde güvenli okunur).
; Görünen ad /DAppName ile gelir; aşağıdaki varsayılan yalnızca elle derleme
; içindir. Parametreler `src-extension/extension.config.json` içinden okunur.
;
; Yol kuralları: dosya `src-extension/installer/windows/` altında olduğu için
; `..\..\` = `src-extension/`.

#ifndef AppName
  #define AppName "ADM"
#endif
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef ExtId
  #error ExtId tanimli degil (/DExtId=...)
#endif
#ifndef UpdateUrl
  #error UpdateUrl tanimli degil (/DUpdateUrl=...)
#endif

; Chromium politika listesindeki sıra numarası (1..N arası serbest, listede
; benzersiz olmalı). Değer "id;guncelleme-adresi" biçimindedir.
#define PolicySlot "77"
#define ForceValue ExtId + ";" + UpdateUrl

[Setup]
; Tauri uygulamasının NSIS kurulumundan AYRI bir AppId: iki ürün birbirinin
; kurulumunu tanımasın ve kaldırma kayıtları çakışmasın.
AppId={{B88C6191-0E4D-4683-8C88-05DEE6A22B72}
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={autopf}\{#AppName} Extension
DisableProgramGroupPage=yes
; Politika anahtarları HKLM'ye yazıldığı için yönetici gerekir.
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\installer-out
OutputBaseFilename=Setup-ADM-Extension-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#AppName} Extension

[Files]
; İmzalı CRX (Chrome/Edge/Brave zorunlu kurulum politikası bunu kurar)
Source: "..\..\release\extension.crx"; DestDir: "{app}"; Flags: ignoreversion
; Politikayı uygulayamayan tarayıcılar için paketlenmemiş kopya
; (Opera, Vivaldi ve yönetilmeyen makinelerdeki Chrome/Edge yedek yolu)
Source: "..\..\dist\chromium\*"; DestDir: "{app}\chromium-unpacked"; Flags: ignoreversion recursesubdirs createallsubdirs
#ifexist "..\..\release\extension-firefox.xpi"
Source: "..\..\release\extension-firefox.xpi"; DestDir: "{app}"; Flags: ignoreversion
#endif

[Registry]
; Chrome, Edge, Brave ve genel Chromium için "zorunlu kurulum" politikası.
; Değerin ikinci parçası (update.xml) otomatik güncellemenin adresidir.
Root: HKLM; Subkey: "SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist"; ValueType: string; ValueName: "{#PolicySlot}"; ValueData: "{#ForceValue}"; Flags: uninsdeletevalue
Root: HKLM; Subkey: "SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist"; ValueType: string; ValueName: "{#PolicySlot}"; ValueData: "{#ForceValue}"; Flags: uninsdeletevalue
Root: HKLM; Subkey: "SOFTWARE\Policies\BraveSoftware\Brave\ExtensionInstallForcelist"; ValueType: string; ValueName: "{#PolicySlot}"; ValueData: "{#ForceValue}"; Flags: uninsdeletevalue
Root: HKLM; Subkey: "SOFTWARE\Policies\Chromium\ExtensionInstallForcelist"; ValueType: string; ValueName: "{#PolicySlot}"; ValueData: "{#ForceValue}"; Flags: uninsdeletevalue

#ifexist "..\..\release\extension-firefox.xpi"
[Tasks]
Name: "firefox"; Description: "Firefox'a da ekle (Firefox'ta onay penceresi açılır)"; Check: FirefoxInstalled

[Run]
Filename: "{code:GetFirefoxPath}"; Parameters: """{app}\extension-firefox.xpi"""; Tasks: firefox; Check: FirefoxInstalled; Flags: nowait skipifdoesntexist
#endif

[Code]
function GetFirefoxPath(Param: String): String;
var
  P: String;
begin
  if RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe', '', P) then
    Result := P
  else
    Result := '';
end;

function FirefoxInstalled: Boolean;
begin
  Result := GetFirefoxPath('') <> '';
end;
