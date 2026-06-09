import fs from "fs/promises"
import path from "path"
import { expandHome } from "../utils.js"

const MAX_BYTES = 50 * 1024

export async function readFile(filePath: string): Promise<string> {
  filePath = expandHome(filePath)
  try {
    const buf = await fs.readFile(filePath)

    // Detect binary: look for null bytes in the first 8 KB
    const sample = buf.slice(0, 8192)
    if (sample.includes(0)) {
      return `Error: ${filePath} appears to be a binary file and cannot be read as text.`
    }

    const text = buf.toString("utf8")
    if (buf.length > MAX_BYTES) {
      return text.slice(0, MAX_BYTES) + "\n[truncated at 50 KB]"
    }
    return text
  } catch (e: any) {
    return `Error reading ${filePath}: ${e.message}`
  }
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
