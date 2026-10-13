/**
 * Menü açma düğmesi — sol menü kapalıyken gövdenin sol üst köşesinde yüzer.
 *
 * Aç/kapa düğmesi "menünün köşesinde" ilkesiyle iki parçadan oluşur:
 * - **kapalıyken** bu bileşen: içerik alanının sol üst köşesinde duran ☰
 * - **açıkken** panelin kendi başlık satırındaki ✕ (`Sidebar.tsx` → `.side-close`)
 *
 * Her ikisi de `sideOpen` sinyalini çevirir; kapatma ayrıca dış tıklama,
 * `Escape` ve `Ctrl+M` ile de yapılır (`App.tsx`).
 */
import Tip from "./Tip";
import { setSideOpen, sideOpen } from "../lib/ui";
import { t } from "../lib/i18n";

export default function MenuToggle() {
  return (
    <Tip
      label={sideOpen() ? t("side.close") : t("side.open")}
      keys="Ctrl+M"
      class="menu-fab"
      aria-pressed={sideOpen()}
      onClick={() => setSideOpen(!sideOpen())}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          d="M2.5 4 h11 M2.5 8 h11 M2.5 12 h11"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
        />
      </svg>
    </Tip>
  );
}
