import { describe, it, expect } from "vitest"
import { findFiles, grepFiles } from "../../src/tools/search.js"

describe("findFiles", () => {
  it("finds CLAUDE.md in the project root", async () => {
    const result = await findFiles("CLAUDE.md", ".")
    expect(result).toMatch(/CLAUDE\.md/)
  })
})

describe("grepFiles", () => {
  it("finds matches in src", async () => {
    const result = await grepFiles("maude", "src")
    expect(result).toMatch(/maude/)
  })
})

describe("sanitize", () => {
  it("rejects dangerous patterns in findFiles", async () => {
    const result = await findFiles("*.ts; rm -rf /", ".")
    expect(result).toMatch(/Error/)
  })

  it("rejects dangerous patterns in grepFiles", async () => {
    const result = await grepFiles("pattern | cat /etc/passwd", ".")
    expect(result).toMatch(/Error/)
  })
})
