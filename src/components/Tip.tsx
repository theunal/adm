/**
 * Stilli tooltip sarmalayıcısı (Kobalte `Tooltip` üzerine ince katman).
 *
 * Native `title` özniteliğinin iki sorunu var: gecikmeli (~1 sn) gelir ve
 * işletim sisteminin açık renkli kutusuyla, koyu temayla çelişen bir görünüm
 * çizer. Kobalte erişilebilir bir tooltip sağlar; bu bileşen onu tasarım
 * sistemine bağlar ve **mevcut öğeyi sarmalamaz, onun yerine geçer**.
 *
 * ```tsx
 * <Tip label={t("tb.add")} keys="Ctrl+N" class="side-add" onClick={open}>
 *   {t("tb.add")}
 * </Tip>
 * ```
 *
 * **Neden `as` prop'u önemli:** `Tooltip.Trigger` varsayılan olarak
 * `<button>` basar. Eğer sarmalayıcı, hedef düğmenin *içine* bir düğme
 * koysaydı geçersiz HTML ve bozuk tıklama davranışı oluşurdu. Burada
 * `Tooltip.Trigger` doğrudan hedefin kendisidir: `class`, `onClick`,
 * `disabled`, `aria-*` özellikleri `{...rest}` ile ona geçer, yeni bir
 * DOM düğümü eklenmez.
 *
 * **Düğme olmayan hedefler** (dosya adı, yol, hata metni gibi `<span>` /
 * `<div>` öğeler) `target="span" | "div"` ile kullanılır. Böyle bir öğe
 * sekme sırasına girmez; klavye kullanıcısının tooltip'i görebilmesi için
 * `tabIndex={0}` otomatik eklenir.
 */
import { Show, splitProps, type JSX } from "solid-js";
import { Tooltip } from "@kobalte/core/tooltip";

/** Tooltip'in açılacağı yön. */
type TipPlacement = "top" | "bottom" | "left" | "right";

/** Sarılan öğenin türü. */
type TipTarget = "button" | "span" | "div";

interface TipProps {
  /** Gösterilecek metin. */
  label: string;
  /** Klavye kısayolu ipucu (örn. `"Ctrl+N"`). Menüdeki `accel` gibi düz
   *  literal — kısayol adları çevrilmez. */
  keys?: string;
  /** Açılma yönü (varsayılan `"top"`; ekran sınırına gelirse kendiliğinden
   *  döner). */
  placement?: TipPlacement;
  /** Sarılan öğe. Varsayılan `"button"`; metin öğeleri için `"span"` ya da
   *  `"div"` verilir ve odaklanabilir hâle gelirler. */
  target?: TipTarget;
  /** Açılma gecikmesi (ms). */
  delay?: number;
  /** Sarılan öğenin içeriği. */
  children: JSX.Element;

  // Elle yazılan olay özellikleri. İndeks imzası bunları `unknown` yapıp
  // `onClick={(e) => …}` yazımlarında parametre türünü kaybettirdiği için
  // en sık kullanılanlar burada açıkça tanımlanır.
  //
  // `onInput` / `onChange` bilinçli olarak tanımlanmadı: tipleri hedef
  // öğeye (`HTMLInputElement`) bağlı olduğu için birleşik `as` üzerinde
  // çelişiyorlar. Gerekirse çağrı noktasında elle daraltılabilir.
  onClick?: (event: MouseEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  onPointerDown?: (event: PointerEvent) => void;
  onBlur?: (event: FocusEvent) => void;
  onFocus?: (event: FocusEvent) => void;
  /** `disabled` düğmeyi kilitler; `Tip` kendisi de tooltip'i gizler. */
  disabled?: boolean;

  // Kalan tüm DOM özellikleri: `class`, `aria-*`, `data-*`, `role`, `id`…
  // Hepsi `{...rest}` ile geçirilir. 40'ın üzerinde çağrı noktası var; her
  // biri için ayrı alan tanımlamak yerine gevşek bırakıldı.
  [prop: string]: unknown;
}

export default function Tip(props: TipProps) {
  const [local, rest] = splitProps(props, [
    "label",
    "keys",
    "placement",
    "target",
    "delay",
    "children",
  ]);

  /** Kobalte `<button>` basıyor ama `type` özniteliğini eklemiyor; form
   *  olmayan bu uygulamada da doğru davranış için açıkça veriyoruz. */
  const isButton = () => (local.target ?? "button") === "button";

  // Etiket boşsa (ör. dosya yolu henüz bilinmiyor) tooltip hiç açılmasın:
  // boş bir kutu görünmesi bir hata gibi algılanır. Öğe yine basılabilir
  // kalır, yalnızca Tooltip katmanı atlanır.
  if (props.label.trim() === "") {
    if (isButton()) {
      return (
        <button type="button" {...rest}>
          {local.children}
        </button>
      );
    }
    if (local.target === "div") {
      return <div {...rest}>{local.children}</div>;
    }
    return <span {...rest}>{local.children}</span>;
  }

  return (
    <Tooltip
      placement={local.placement ?? "top"}
      openDelay={local.delay ?? 350}
      closeDelay={120}
      gutter={8}
      flip
      overflowPadding={8}
      // Kilitli düğmede tooltip anlamsız; ayrıca `disabled` düğmeler
      // odaklanamadığı için tooltip hiç açılamazdı.
      disabled={props.disabled === true}
    >
      <Tooltip.Trigger
        as={local.target ?? "button"}
        type={isButton() ? "button" : undefined}
        // Metin öğeleri sekme sırasına girmez; klavye kullanıcısı da
        // tooltip'i görebilsin. Çağıranın verdiği `tabIndex` bunu eşler.
        tabIndex={isButton() ? undefined : 0}
        {...rest}
      >
        {local.children}
      </Tooltip.Trigger>

      {/* `body`'ye portallanır: tablonun kaydırma konteyneri veya
          `overflow:hidden` bir kapsayıcı tooltip'i kırpmasın. */}
      <Tooltip.Portal>
        <Tooltip.Content class="tip">
          <span class="tip-label">{local.label}</span>
          <Show when={local.keys}>
            <kbd class="tip-key">{local.keys}</kbd>
          </Show>
          <Tooltip.Arrow class="tip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip>
  );
}
