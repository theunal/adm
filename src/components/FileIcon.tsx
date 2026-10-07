/**
 * Dosya türü ikonu — tablonun "Dosya Adı" sütununda.
 *
 * Simge kütüphanesi yerine uzantının ilk üç harfi kullanılır: dış bağımlılık
 * eklemeden IDM'in liste görünümüne benzer bir tarz verir. Renk, `format.ts`
 * içindeki kategoriyle eşleşir.
 */
import { categoryOf, iconLabel } from "../lib/format";

interface Props {
  /** Görünecek dosya adı. */
  name: string;
}

export default function FileIcon(props: Props) {
  return (
    <span class={`file-icon file-icon-${categoryOf(props.name)}`} aria-hidden="true">
      {iconLabel(props.name)}
    </span>
  );
}