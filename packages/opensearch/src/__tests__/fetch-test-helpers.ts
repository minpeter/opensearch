import type { getDocumentProxy } from "unpdf";
import { vi } from "vitest";

export const H1_TAG_REGEX = /<h1>/;
export const P_TAG_REGEX = /<p>/;
export const DIV_TAG_REGEX = /<div>/;
export const MD_IMAGE_REGEX = /!\[.*?\]\(.*?\)/;
export const IMG_TAG_REGEX = /<img/;
export const JINA_URL_REGEX = /r\.jina\.ai/;

type MockPdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

export function createMockPdfDocument(): MockPdfDocument {
  return Object.create(null) as MockPdfDocument;
}

export const ARTICLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>Test Article</title></head>
<body>
  <article>
    <h1>Test Heading</h1>
    <p>This is a test paragraph with some <strong>bold text</strong> and a <a href="https://example.com">link</a>.</p>
    <p>Second paragraph with more content to ensure Readability extracts it.</p>
    <img src="test.jpg" alt="test image">
    <p>Third paragraph. This is enough content for Readability to parse.</p>
  </article>
</body>
</html>`;

export function createMockResponse(
  body: string,
  contentType = "text/html"
): Response {
  return new Response(body, {
    headers: { "Content-Type": contentType },
    status: 200,
  });
}

export function stubHtmlFetch(html = ARTICLE_HTML) {
  const mockFetch = vi.fn().mockResolvedValue(createMockResponse(html));
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}
