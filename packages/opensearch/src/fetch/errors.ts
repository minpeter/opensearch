export class NoFetchProviderError extends Error {
  readonly url: string;

  constructor(url: string) {
    super(
      "No fetch provider is available for this runtime. The edge build " +
        "(@minpeter/opensearch) fetches pages through API providers only — " +
        "configure one (EXA_API_KEY, TINYFISH_API_KEY, or FIRECRAWL_API_KEY), " +
        "or import @minpeter/opensearch/node for the local page-fetch " +
        "pipeline."
    );
    this.name = "NoFetchProviderError";
    this.url = url;
  }
}
