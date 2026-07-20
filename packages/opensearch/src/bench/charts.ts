import { BAR, escapeXml, MUTED, svg, TRACK, textEl } from "./chart-svg.ts";
import { groupByTier, TIER_COLORS, type TierAssignment } from "./tiers.ts";

export interface ScatterPoint {
  readonly color?: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

export interface ScatterOptions {
  readonly height?: number;
  readonly points: readonly ScatterPoint[];
  readonly subtitle?: string;
  readonly title: string;
  readonly width?: number;
  readonly xLabel: string;
  readonly xMax: number;
  readonly yLabel: string;
  readonly yMax: number;
}

const PLOT_PAD_L = 56;
const PLOT_PAD_R = 24;
const PLOT_PAD_T = 64;
const PLOT_PAD_B = 48;

const SCATTER_LABEL_FLIP_PX = 90;

function scatterPoint(
  point: ScatterPoint,
  plotL: number,
  plotR: number,
  plotB: number,
  plotW: number,
  plotH: number,
  xMax: number,
  yMax: number
): string {
  const safeX = xMax > 0 ? xMax : 1;
  const safeY = yMax > 0 ? yMax : 1;
  const cx = plotL + Math.min(1, point.x / safeX) * plotW;
  const cy = plotB - Math.min(1, point.y / safeY) * plotH;
  const color = point.color ?? BAR;
  // Flip the label to the left of the dot when it would overflow the right edge.
  const flip = cx > plotR - SCATTER_LABEL_FLIP_PX;
  const labelX = flip ? cx - 8 : cx + 8;
  const anchor = flip ? "end" : "start";
  return [
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="${color}" fill-opacity="0.85"/>`,
    textEl(labelX, cy + 4, point.label, { anchor, size: 11 }),
  ].join("");
}

/** Scatter plot, e.g. latency (x) vs quality (y). */
export function scatterSvg(options: ScatterOptions): string {
  const width = options.width ?? 760;
  const height = options.height ?? 460;
  const plotL = PLOT_PAD_L;
  const plotR = width - PLOT_PAD_R;
  const plotT = PLOT_PAD_T;
  const plotB = height - PLOT_PAD_B;
  const plotW = plotR - plotL;
  const plotH = plotB - plotT;

  const axes = [
    `<line x1="${plotL}" y1="${plotT}" x2="${plotL}" y2="${plotB}" stroke="${TRACK}" stroke-width="1.5"/>`,
    `<line x1="${plotL}" y1="${plotB}" x2="${plotR}" y2="${plotB}" stroke="${TRACK}" stroke-width="1.5"/>`,
    textEl((plotL + plotR) / 2, height - 14, options.xLabel, {
      anchor: "middle",
      fill: MUTED,
      size: 12,
    }),
    `<text x="16" y="${(plotT + plotB) / 2}" font-size="12" fill="${MUTED}" text-anchor="middle" transform="rotate(-90 16 ${(plotT + plotB) / 2})">${escapeXml(options.yLabel)}</text>`,
  ].join("");

  const dots = options.points
    .map((point) =>
      scatterPoint(
        point,
        plotL,
        plotR,
        plotB,
        plotW,
        plotH,
        options.xMax,
        options.yMax
      )
    )
    .join("");

  return svg(
    width,
    height,
    [
      textEl(PLOT_PAD_L - 32, 28, options.title, { size: 18, weight: 700 }),
      options.subtitle
        ? textEl(PLOT_PAD_L - 32, 48, options.subtitle, {
            fill: MUTED,
            size: 12,
          })
        : "",
      axes,
      dots,
    ].join("")
  );
}

const TIER_ROW_MIN_H = 56;
const TIER_LABEL_W = 64;
const TIER_CHIP_W = 150;
const TIER_CHIP_H = 40;
const TIER_CHIP_GAP = 8;
const TIER_PAD = 16;

function chip(x: number, y: number, member: TierAssignment): string {
  return [
    `<rect x="${x}" y="${y}" width="${TIER_CHIP_W}" height="${TIER_CHIP_H}" rx="6" fill="#f3f4f6" stroke="${TRACK}"/>`,
    textEl(x + 10, y + 18, member.engine, { size: 13, weight: 600 }),
    textEl(x + 10, y + 33, `score ${member.tierScore.toFixed(2)}`, {
      fill: MUTED,
      size: 11,
    }),
  ].join("");
}

/** Classic tier-list visual: one colored band per tier, members as chips. */
export function tierListSvg(
  assignments: readonly TierAssignment[],
  options: { title?: string; subtitle?: string; width?: number } = {}
): string {
  const width = options.width ?? 760;
  const groups = groupByTier(assignments);
  const chipAreaW = width - TIER_LABEL_W - TIER_PAD * 2;
  const perRow = Math.max(
    1,
    Math.floor((chipAreaW + TIER_CHIP_GAP) / (TIER_CHIP_W + TIER_CHIP_GAP))
  );

  let cursorY = 72;
  const bands = groups.map(({ tier, members }) => {
    const rowCount = Math.max(1, Math.ceil(members.length / perRow));
    const bandH = Math.max(
      TIER_ROW_MIN_H,
      rowCount * (TIER_CHIP_H + TIER_CHIP_GAP) + TIER_CHIP_GAP
    );
    const top = cursorY;
    cursorY += bandH + 4;

    const chips = members.map((member, index) => {
      const col = index % perRow;
      const row = Math.floor(index / perRow);
      const x = TIER_LABEL_W + TIER_PAD + col * (TIER_CHIP_W + TIER_CHIP_GAP);
      const y = top + TIER_CHIP_GAP + row * (TIER_CHIP_H + TIER_CHIP_GAP);
      return chip(x, y, member);
    });

    return [
      `<rect x="0" y="${top}" width="${TIER_LABEL_W}" height="${bandH}" fill="${TIER_COLORS[tier]}"/>`,
      textEl(TIER_LABEL_W / 2, top + bandH / 2 + 8, tier, {
        anchor: "middle",
        fill: "#ffffff",
        size: 24,
        weight: 800,
      }),
      `<rect x="${TIER_LABEL_W}" y="${top}" width="${width - TIER_LABEL_W}" height="${bandH}" fill="#fafafa" stroke="${TRACK}"/>`,
      chips.join(""),
    ].join("");
  });

  const height = cursorY + TIER_PAD;
  return svg(
    width,
    height,
    [
      textEl(TIER_PAD, 30, options.title ?? "Provider tier list", {
        size: 18,
        weight: 700,
      }),
      options.subtitle
        ? textEl(TIER_PAD, 50, options.subtitle, { fill: MUTED, size: 12 })
        : "",
      bands.join(""),
    ].join("")
  );
}
