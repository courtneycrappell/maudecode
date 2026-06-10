import { runBash } from "./bash.js"
import { expandHome } from "../utils.js"

const DANGEROUS = /[;|&$`()]/

function sanitize(str: string, label: string): void {
  if (DANGEROUS.test(str)) throw new Error(`Unsafe characters in ${label}: "${str}"`)
}

export async function findFiles(pattern: string, dir = "."): Promise<string> {
  try {
    if (!pattern || pattern.trim() === "") return "Error: pattern must not be empty"
    sanitize(pattern, "pattern")
    sanitize(dir, "dir")
    const expanded = expandHome(dir)
    return runBash(
      `find "${expanded}" -maxdepth 8 -type f -name "${pattern}" ` +
      `-not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/__pycache__/*" ` +
      `2>/dev/null | head -100`,
      30_000
    )
  } catch (e: any) {
    return `Error: ${e.message}`
  }
}

export async function grepFiles(pattern: string, dir = ".", flags = "-r"): Promise<string> {
  try {
    sanitize(pattern, "pattern")
    sanitize(dir, "dir")
    const expanded = expandHome(dir)
    // -n for line numbers, -H for filenames, limit output to 200 lines
    return runBash(
      `grep -rn -H ${flags !== "-r" ? flags : ""} ` +
      `--include="*.ts" --include="*.js" --include="*.py" --include="*.md" ` +
      `--include="*.json" --include="*.txt" --include="*.sh" --include="*.yaml" --include="*.yml" ` +
      `--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=__pycache__ ` +
      `"${pattern}" "${expanded}" 2>/dev/null | head -200`,
      30_000
    )
  } catch (e: any) {
    return `Error: ${e.message}`
  }
}
