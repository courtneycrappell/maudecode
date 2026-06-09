import { runBash } from "./bash.js"
import { expandHome } from "../utils.js"

export async function listDir(dir = "."): Promise<string> {
  return runBash(`ls -la "${expandHome(dir)}" 2>/dev/null`)
}

export async function openFile(filePath: string): Promise<string> {
  return runBash(`open "${expandHome(filePath)}" 2>&1`)
}
