import { exec } from "child_process"
import { runBash } from "./bash.js"
import { expandHome } from "../utils.js"

export async function listDir(dir = "."): Promise<string> {
  return runBash(`ls -la "${expandHome(dir)}" 2>/dev/null`)
}

export async function openFile(filePath: string): Promise<string> {
  return runBash(`open "${expandHome(filePath)}" 2>&1`)
}

export async function readClipboard(): Promise<string> {
  return runBash("pbpaste")
}

export async function writeClipboard(content: string): Promise<string> {
  return new Promise((resolve) => {
    const child = exec("pbcopy", (err) => {
      resolve(err ? `Error copying to clipboard: ${err.message}` : "Copied to clipboard.")
    })
    child.stdin?.write(content)
    child.stdin?.end()
  })
}
