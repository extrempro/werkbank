import { cssObject, drawBadge, type BadgeStyle } from "./badges";

/** Ein Abzeichen (nur Gestaltung, für Screenreader verborgen; Name und Stufe stehen daneben). */
export function BadgeView({
  style,
  level,
  size,
  glyph,
}: {
  style: BadgeStyle;
  level: number;
  size: number;
  glyph: string;
}) {
  const badge = drawBadge(style, level, size, glyph);
  return (
    <span className="erfolg-badge" style={cssObject(badge.wrap)} aria-hidden="true">
      {badge.layers.map((layer, index) => (
        <span key={index} style={cssObject(layer.css)}>
          {layer.text ?? ""}
        </span>
      ))}
    </span>
  );
}
