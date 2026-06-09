import { describe, it, expect } from "vitest"
import { runBash } from "../../src/tools/bash.js"

describe("runBash", () => {
  it("captures stdout", async () => {
    const result = await runBash("echo hello")
    expect(result).toMatch(/stdout:\nhello/)
  })

  it("captures non-zero exit code", async () => {
    const result = await runBash("exit 1", 5000)
    expect(result).toMatch(/exit: 1/)
  })

  it("times out and returns exit 124", async () => {
    const result = await runBash("sleep 30", 200)
    expect(result).toMatch(/exit: 124/)
  }, 3000)
})
