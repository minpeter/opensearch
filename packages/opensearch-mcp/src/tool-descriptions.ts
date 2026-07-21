export const codeSearchDescription = `Search public source code and code documentation across GitHub, grep.app, Sourcegraph, and Exa Code.

Use it for real implementation examples, symbol and API usage, repository paths, line-numbered snippets, or code patterns. Prefer it over web_search when the answer should come from source code. Narrow results by repository, path, language, regular expression, or provider.`;

export const webSearchDescription = `Search the web and return ranked search results with titles, URLs, highlights, and source labels.

Use it for current facts, docs, news, people, companies, and other web questions.
Follow promising URLs with web_fetch when you need full markdown content.`;

export const webFetchDescription = `Read one or more webpages as clean markdown with source metadata.

Use it after web_search when a result needs full-page content, or call it directly with known URLs.`;
