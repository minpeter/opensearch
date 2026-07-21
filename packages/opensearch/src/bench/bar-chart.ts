import { BAR, MUTED, svg, TRACK, textEl } from "./chart-svg.ts";

export interface BarItem {
  readonly color?: string;
  readonly label: string;
  readonly value: number;
}

export interface BarChartOptions {
  readonly format?: (value: number) => string;
  readonly items: readonly BarItem[];
  readonly max?: number;
  readonly subtitle?: string;
  readonly title: string;
  readonly width?: number;
}

const BAR_ROW_H = 30;
const BAR_LABEL_W = 150;
const BAR_VALUE_W = 70;
const BAR_PAD = 24;
const BAR_HEADER = 64;

/** Horizontal bar chart, one row per item (already ordered by the caller). */
export function barChartSvg(options: BarChartOptions): string {
  const width = options.width ?? 760;
  const max = options.max ?? 1;
  const format = options.format ?? ((value) => value.toFixed(2));
  const trackX = BAR_PAD + BAR_LABEL_W;
  const trackW = width - trackX - BAR_VALUE_W - BAR_PAD;
  const height = BAR_HEADER + options.items.length * BAR_ROW_H + BAR_PAD;

  const rows = options.items.map((item, index) => {
    const y = BAR_HEADER + index * BAR_ROW_H;
    const safeMax = max > 0 ? max : 1;
    const fillW = Math.max(0, Math.min(1, item.value / safeMax)) * trackW;
    const color = item.color ?? BAR;
    return [
      textEl(BAR_PAD + BAR_LABEL_W - 8, y + 15, item.label, {
        anchor: "end",
        size: 13,
      }),
      `<rect x="${trackX}" y="${y + 4}" width="${trackW}" height="16" rx="3" fill="${TRACK}"/>`,
      `<rect x="${trackX}" y="${y + 4}" width="${fillW.toFixed(1)}" height="16" rx="3" fill="${color}"/>`,
      textEl(trackX + trackW + 8, y + 15, format(item.value), {
        fill: MUTED,
        size: 12,
      }),
    ].join("");
  });

  return svg(
    width,
    height,
    [
      textEl(BAR_PAD, 28, options.title, { size: 18, weight: 700 }),
      options.subtitle
        ? textEl(BAR_PAD, 48, options.subtitle, { fill: MUTED, size: 12 })
        : "",
      rows.join(""),
    ].join("")
  );
}
