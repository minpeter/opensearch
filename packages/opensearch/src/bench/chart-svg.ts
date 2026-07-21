export const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
export const INK = "#111827";
export const MUTED = "#6b7280";
export const TRACK = "#e5e7eb";
export const BAR = "#3b82f6";
export const BG = "#ffffff";

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function svg(width: number, height: number, body: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">`,
    `<rect width="${width}" height="${height}" fill="${BG}"/>`,
    body,
    "</svg>",
  ].join("");
}

export function textEl(
  x: number,
  y: number,
  content: string,
  opts: { size?: number; fill?: string; weight?: number; anchor?: string } = {}
): string {
  const size = opts.size ?? 13;
  const fill = opts.fill ?? INK;
  const weight = opts.weight ?? 400;
  const anchor = opts.anchor ?? "start";
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(content)}</text>`;
}
