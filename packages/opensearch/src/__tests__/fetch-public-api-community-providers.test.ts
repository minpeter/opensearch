import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchViaPublicApi } from "../fetch/public-api.ts";

const okJsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchViaPublicApi community provider routes", () => {
  it("routes dev.to tag pages through the articles API", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okJsonResponse([
        {
          public_reactions_count: 5,
          reading_time_minutes: 3,
          tag_list: ["ai", "web"],
          title: "Dev article",
          url: "https://dev.to/a",
          user: { name: "Author" },
        },
      ])
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi("https://dev.to/t/ai");

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://dev.to/api/articles?tag=ai&per_page=5"
    );
    expect(result?.content).toContain("Dev article");
  });

  it("routes Lobsters tag pages through tag JSON", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okJsonResponse([
        {
          comment_count: 2,
          score: 9,
          tags: ["programming"],
          title: "Lobsters story",
          url: "https://example.com/lobsters",
        },
      ])
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi("https://lobste.rs/t/programming");

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://lobste.rs/t/programming.json"
    );
    expect(result?.content).toContain("9 points");
  });

  it("routes V2EX hot pages through the hot topics API", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okJsonResponse([
        {
          member: { username: "v2user" },
          replies: 7,
          title: "V2EX topic",
          url: "https://www.v2ex.com/t/1",
        },
      ])
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi("https://www.v2ex.com/hot");

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://www.v2ex.com/api/topics/hot.json"
    );
    expect(result?.content).toContain("V2EX topic");
  });

  it("routes Naver Finance item pages through siseJson", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("['날짜','시가','고가']\n['20260618',1,2]", {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://finance.naver.com/item/main.naver?code=005930"
    );

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://api.finance.naver.com/siseJson.naver?symbol=005930&requestType=0&timeframe=minute&count=5"
    );
    expect(result?.content).toContain("20260618");
  });

  it("returns null when community provider APIs are empty", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okJsonResponse([]));
    vi.stubGlobal("fetch", mockFetch);

    expect(await fetchViaPublicApi("https://dev.to/t/empty")).toBeNull();
  });
});
