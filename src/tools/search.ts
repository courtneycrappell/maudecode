import { runBash } from "./bash.js"

const DANGEROUS = /[;|&$`()]/

function sanitize(str: string, label: string): void {
  if (DANGEROUS.test(str)) {
    throw new Error(`Unsafe characters in ${label}: "${str}"`)
  }
}

export async function findFiles(pattern: string, dir = "."): Promise<string> {
  try {
    sanitize(pattern, "pattern")
    sanitize(dir, "dir")
    return runBash(`find ${dir} -name "${pattern}" 2>/dev/null`)
  } catch (e: any) {
    return `Error: ${e.message}`
  }
}

export async function grepFiles(pattern: string, dir = ".", flags = "-r"): Promise<string> {
  try {
    sanitize(pattern, "pattern")
    sanitize(dir, "dir")
    return runBash(`grep ${flags} "${pattern}" ${dir} 2>/dev/null`)
  } catch (e: any) {
    return `Error: ${e.message}`
  }
}
