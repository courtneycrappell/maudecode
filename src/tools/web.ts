const MAX_CHARS = 20_000

export async function fetchUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "maude/0.1 (local assistant)" },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return `HTTP ${res.status} ${res.statusText} for ${url}`

    const ct = res.headers.get("content-type") ?? ""
    if (ct.includes("application/json")) {
      const text = await res.text()
      return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + "\n[truncated]" : text
    }

    const html = await res.text()
    // Strip tags and collapse whitespace for readability
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{2,}/g, " ")
      .trim()

    return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + "\n[truncated]" : text
  } catch (e: any) {
    return `Error fetching ${url}: ${e.message}`
  }
}
