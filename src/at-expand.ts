import { execSync } from "child_process"
import { statSync } from "fs"
import { expandHome } from "./utils.js"
import { readFile } from "./tools/file.js"

// Only allow safe path characters + glob wildcards in @ patterns
const SAFE_AT = /^[a-zA-Z0-9/._\-~*?[\]]+$/

function expandGlob(pattern: string): string[] {
  if (!SAFE_AT.test(pattern)) return []
  const expanded = expandHome(pattern)

  // Check if it's a literal existing path first (no glob chars)
  if (!/[*?[\]]/.test(pattern)) {
    try { statSync(expanded); return [expanded] } catch { return [] }
  }

  // Shell-expand the glob
  try {
    const out = execSync(
      `bash -c 'for f in ${expanded}; do [ -e "$f" ] && printf "%s\\n" "$f"; done' 2>/dev/null`,
      { timeout: 3000, encoding: "utf8" }
    ).trim()
    return out ? out.split("\n").filter(Boolean) : []
  } catch {
    return []
  }
}

// Replace @path or @glob tokens in a prompt with the file contents.
// Email-style foo@bar.com is not matched (requires preceding non-word char).
export async function expandAtMentions(input: string): Promise<{ text: string; injected: string[] }> {
  const atPattern = /(?<![a-zA-Z0-9])@([\S]+)/g
  const matches = [...input.matchAll(atPattern)]
  if (matches.length === 0) return { text: input, injected: [] }

  let result = input
  const injected: string[] = []
  // Process right-to-left so string indices stay valid
  for (const match of [...matches].reverse()) {
    const paths = expandGlob(match[1])
    if (paths.length === 0) continue

    const parts: string[] = []
    for (const p of paths) {
      const content = await readFile(p)
      parts.push(`<file path="${p}">\n${content}\n</file>`)
      injected.push(p)
    }
    const start = match.index!
    result = result.slice(0, start) + "\n" + parts.join("\n\n") + "\n" + result.slice(start + match[0].length)
  }
  return { text: result.trim(), injected }
}
