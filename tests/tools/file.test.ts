import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { readFile, writeFile, editFile } from "../../src/tools/file.js"

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "maude-test-"))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe("readFile", () => {
  it("reads a file successfully with line numbers", async () => {
    const p = path.join(tmpDir, "hello.txt")
    await fs.writeFile(p, "hello world", "utf8")
    const result = await readFile(p)
    expect(result).toMatch(/^\s+1\s+hello world/)
  })

  it("returns error string for missing file", async () => {
    const result = await readFile(path.join(tmpDir, "nope.txt"))
    expect(result).toMatch(/Error reading/)
  })

  it("truncates files larger than 50 KB", async () => {
    const p = path.join(tmpDir, "big.txt")
    await fs.writeFile(p, "x".repeat(60 * 1024), "utf8")
    const result = await readFile(p)
    expect(result).toMatch(/\[truncated at 50 KB\]/)
  })
})

describe("writeFile", () => {
  it("creates a file", async () => {
    const p = path.join(tmpDir, "out.txt")
    const result = await writeFile(p, "content")
    expect(result).toMatch(/Written/)
    expect(await fs.readFile(p, "utf8")).toBe("content")
  })

  it("creates nested directories", async () => {
    const p = path.join(tmpDir, "a", "b", "c.txt")
    await writeFile(p, "nested")
    expect(await fs.readFile(p, "utf8")).toBe("nested")
  })
})

describe("editFile", () => {
  it("replaces first occurrence of oldStr", async () => {
    const p = path.join(tmpDir, "edit.txt")
    await fs.writeFile(p, "hello world hello", "utf8")
    const result = await editFile(p, "hello", "bye")
    expect(result).toMatch(/Edited/)
    expect(await fs.readFile(p, "utf8")).toBe("bye world hello")
  })

  it("returns error if oldStr not found", async () => {
    const p = path.join(tmpDir, "edit.txt")
    await fs.writeFile(p, "hello world", "utf8")
    const result = await editFile(p, "missing", "replacement")
    expect(result).toMatch(/not found/)
  })
})
