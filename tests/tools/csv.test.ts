import { describe, it, expect, afterAll } from "vitest"
import { readCsv } from "../../src/tools/csv.js"
import fs from "fs/promises"
import os from "os"
import path from "path"

const TMP = path.join(os.tmpdir(), "maude-csv-test.csv")

afterAll(() => fs.unlink(TMP).catch(() => {}))

describe("readCsv", () => {
  it("parses headers, row count, and preview", async () => {
    await fs.writeFile(TMP, "Name,Score\nAlice,95\nBob,82\n")
    const result = await readCsv(TMP)
    expect(result).toContain("Columns (2): Name, Score")
    expect(result).toContain("Total rows: 2")
    expect(result).toContain("Alice")
    expect(result).toContain("95")
  })

  it("handles quoted fields with commas", async () => {
    await fs.writeFile(TMP, 'Name,Note\n"Smith, Bob","Good student"\n')
    const result = await readCsv(TMP)
    expect(result).toContain("Smith, Bob")
  })

  it("returns error for missing file", async () => {
    const result = await readCsv("/tmp/does-not-exist-maude-xyz.csv")
    expect(result).toMatch(/Error reading/)
  })

  it("expands ~ in path", async () => {
    // Just check it doesn't throw with ~; will fail to read but returns error string
    const result = await readCsv("~/does-not-exist-maude-xyz.csv")
    expect(result).toMatch(/Error reading/)
    expect(result).not.toContain("~") // ~ was expanded
  })
})
