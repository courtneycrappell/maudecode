import { describe, it, expect, vi, afterEach } from "vitest"
import { fetchUrl } from "../../src/tools/web.js"

afterEach(() => vi.restoreAllMocks())

describe("fetchUrl", () => {
  it("returns error for unreachable host", async () => {
    const result = await fetchUrl("http://localhost:19999/no-such-server")
    expect(result).toMatch(/Error fetching/)
  })

  it("returns error string on HTTP 404", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: { get: () => "text/html" },
    })
    vi.stubGlobal("fetch", mockFetch)
    const result = await fetchUrl("https://example.com/no-such-page")
    expect(result).toContain("404")
  })

  it("strips HTML tags from response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      text: async () => "<html><body><h1>Hello</h1><p>World</p></body></html>",
    })
    vi.stubGlobal("fetch", mockFetch)
    const result = await fetchUrl("https://example.com")
    expect(result).toContain("Hello")
    expect(result).toContain("World")
    expect(result).not.toContain("<h1>")
  })
})
