export function selectorMatches(body: string, selector: string): boolean {
  if (selector.startsWith("#")) {
    return attributeSelectorMatches(body, "id", selector.slice(1));
  }
  if (selector.startsWith(".")) {
    return classSelectorMatches(body, selector.slice(1));
  }
  return new RegExp(`<${escapeRegex(selector)}(?:\\s|>|/)`, "i").test(body);
}

function classSelectorMatches(body: string, className: string): boolean {
  const regex = new RegExp(
    `class=["'][^"']*(?:^|\\s)${escapeRegex(className)}(?:\\s|$)[^"']*["']`,
    "i"
  );
  return regex.test(body);
}

function attributeSelectorMatches(
  body: string,
  attribute: string,
  value: string
): boolean {
  const regex = new RegExp(
    `${escapeRegex(attribute)}=["']${escapeRegex(value)}["']`,
    "i"
  );
  return regex.test(body);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
