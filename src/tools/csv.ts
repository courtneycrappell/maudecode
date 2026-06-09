import fs from "fs/promises"
import { expandHome } from "../utils.js"

const MAX_ROWS = 50

export async function readCsv(filePath: string, maxRows = MAX_ROWS): Promise<string> {
  filePath = expandHome(filePath)
  try {
    const raw = await fs.readFile(filePath, "utf8")
    const lines = raw.split(/\r?\n/).filter(l => l.trim() !== "")
    if (lines.length === 0) return "File is empty."

    const header = lines[0]
    const cols = parseCsvLine(header)
    const dataLines = lines.slice(1)
    const preview = dataLines.slice(0, maxRows)

    const rows = preview.map((line, i) => {
      const vals = parseCsvLine(line)
      return cols.map((col, j) => `  ${col}: ${vals[j] ?? ""}`)
        .join("\n")
        .slice(0, 300) // cap each row to avoid flooding
    })

    const summary = [
      `File: ${filePath}`,
      `Columns (${cols.length}): ${cols.join(", ")}`,
      `Total rows: ${dataLines.length}`,
      `Showing first ${preview.length} rows:`,
      "",
      ...rows.map((r, i) => `--- Row ${i + 1} ---\n${r}`),
    ]

    if (dataLines.length > maxRows) {
      summary.push(`\n[${dataLines.length - maxRows} more rows not shown]`)
    }

    return summary.join("\n")
  } catch (e: any) {
    return `Error reading CSV ${filePath}: ${e.message}`
  }
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim())
      current = ""
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}
