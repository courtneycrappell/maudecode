import fs from "fs/promises"
import path from "path"
import { expandHome } from "../utils.js"

const MAX_BYTES = 50 * 1024

export async function readFile(filePath: string): Promise<string> {
  filePath = expandHome(filePath)
  try {
    const buf = await fs.readFile(filePath)

    const sample = buf.slice(0, 8192)
    if (sample.includes(0)) {
      return `Error: ${filePath} appears to be a binary file and cannot be read as text.`
    }

    const truncated = buf.length > MAX_BYTES
    const text = (truncated ? buf.slice(0, MAX_BYTES) : buf).toString("utf8")
    const numbered = text
      .split("\n")
      .map((line, i) => `${String(i + 1).padStart(4, " ")}  ${line}`)
      .join("\n")
    return numbered + (truncated ? "\n[truncated at 50 KB]" : "")
  } catch (e: any) {
    return `Error reading ${filePath}: ${e.message}`
  }
}

export async function readFiles(filePaths: string[]): Promise<string> {
  const parts: string[] = []
  for (const p of filePaths) {
    parts.push(`=== ${p} ===\n${await readFile(p)}`)
  }
  return parts.join("\n\n")
}

export async function writeFile(filePath: string, content: string): Promise<string> {
  filePath = expandHome(filePath)
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, "utf8")
    return `Written: ${filePath}`
  } catch (e: any) {
    return `Error writing ${filePath}: ${e.message}`
  }
}

export async function editFile(filePath: string, oldStr: string, newStr: string): Promise<string> {
  filePath = expandHome(filePath)
  try {
    const content = await fs.readFile(filePath, "utf8")
    if (!content.includes(oldStr)) {
      return `Error: oldStr not found in ${filePath}. No changes made.`
    }
    const updated = content.replace(oldStr, newStr)
    await fs.writeFile(filePath, updated, "utf8")
    return `Edited: ${filePath}`
  } catch (e: any) {
    return `Error editing ${filePath}: ${e.message}`
  }
}
