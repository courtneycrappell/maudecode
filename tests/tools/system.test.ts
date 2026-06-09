import { describe, it, expect } from "vitest"
import { listDir } from "../../src/tools/system.js"

describe("listDir", () => {
  it("lists current directory contents", async () => {
    const result = await listDir(".")
    expect(result).toContain("stdout:")
    expect(result).toContain("package.json")
  })

  it("returns error for non-existent directory", async () => {
    const result = await listDir("/tmp/does-not-exist-maude-test-xyz")
    // ls returns non-zero but we get stdout/stderr/exit back
    expect(result).toContain("exit:")
  })

  it("expands ~ to home directory", async () => {
    const result = await listDir("~")
    expect(result).toContain("stdout:")
    // Home dir should have some well-known entries
    expect(result).toMatch(/Desktop|Documents|Downloads/)
  })
})
