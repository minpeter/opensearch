const ARXIV_ENTRY_REGEX = /<entry\b[\s\S]*?<\/entry>/g;
const ARXIV_ID_REGEX = /<id\b[^>]*>([\s\S]*?)<\/id>/;
const ARXIV_SUMMARY_REGEX = /<summary\b[^>]*>([\s\S]*?)<\/summary>/;
const ARXIV_TITLE_REGEX = /<title\b[^>]*>([\s\S]*?)<\/title>/;
const XML_SPACE_REGEX = /\s+/g;
const XML_ENTITIES = {
  "&amp;": "&",
  "&apos;": "'",
  "&gt;": ">",
  "&lt;": "<",
  "&quot;": '"',
} as const;

export function parseArxivEntries(xml: string): string[] {
  return [...xml.matchAll(ARXIV_ENTRY_REGEX)]
    .map(([entry]) => {
      const title = xmlElementText(entry, ARXIV_TITLE_REGEX);
      const id = xmlElementText(entry, ARXIV_ID_REGEX);
      const summary = xmlElementText(entry, ARXIV_SUMMARY_REGEX);
      if (!title) {
        return "";
      }
      const summarySuffix = summary ? `: ${summary}` : "";
      return `- [${title}](${id})${summarySuffix}`;
    })
    .filter(Boolean);
}

function xmlElementText(xml: string, pattern: RegExp): string {
  const match = xml.match(pattern);
  return decodeXmlText(match?.[1] ?? "");
}

function decodeXmlText(text: string): string {
  return Object.entries(XML_ENTITIES)
    .reduce(
      (decoded, [entity, replacement]) =>
        decoded.replaceAll(entity, replacement),
      text
    )
    .replace(XML_SPACE_REGEX, " ")
    .trim();
}
