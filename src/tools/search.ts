import { runBash } from "./bash.js"
import { expandHome } from "../utils.js"

const DANGEROUS = /[;|&$`()]/

function sanitize(str: string, label: string): void {
  if (DANGEROUS.test(str)) {
    throw new Error(`Unsafe characters in ${label}: "${str}"`)
  }
}

export async function findFiles(pattern: string, dir = "."): Promise<string> {
  try {
    if (!pattern || pattern.trim() === "") return "Error: pattern must not be empty"
    sanitize(pattern, "pattern")
    sanitize(dir, "dir")
    const expanded = expandHome(dir)
    return runBash(`find "${expanded}" -maxdepth 8 -name "${pattern}" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null`, 30_000)
  } catch (e: any) {
    return `Error: ${e.message}`
  }
}

export async function grepFiles(pattern: string, dir = ".", flags = "-r"): Promise<string> {
  try {
    sanitize(pattern, "pattern")
    sanitize(dir, "dir")
    const expanded = expandHome(dir)
    return runBash(`grep ${flags} --exclude-dir=node_modules --exclude-dir=.git "${pattern}" "${expanded}" 2>/dev/null`)
  } catch (e: any) {
    return `Error: ${e.message}`
  }
}
