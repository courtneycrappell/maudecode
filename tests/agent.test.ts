import { describe, it, expect, vi, beforeEach } from "vitest"
import type OpenAI from "openai"

vi.mock("../src/llm.js", () => ({
  chatCompletionStream: vi.fn(),
}))

vi.mock("../src/tools/index.js", () => ({
  getToolSchemas: () => [],
  dispatchTool: vi.fn().mockResolvedValue("tool result"),
}))

import { runAgent } from "../src/agent.js"
import { chatCompletionStream } from "../src/llm.js"
import { dispatchTool } from "../src/tools/index.js"

const mockClient = {} as OpenAI
const mockConfig = { model: "test-model", baseURL: "http://localhost", maxRounds: 5, debug: false }

beforeEach(() => {
  vi.clearAllMocks()
})

describe("runAgent", () => {
  it("returns text when finish_reason is stop", async () => {
    vi.mocked(chatCompletionStream).mockImplementationOnce(async (_c, _m, _msgs, _t, _d, onToken) => {
      onToken("Hello!")
      return { content: "Hello!", finish_reason: "stop" }
    })

    const { text } = await runAgent("hi", mockConfig, mockClient)
    expect(text).toBe("Hello!")
  })

  it("dispatches a tool call and loops", async () => {
    vi.mocked(chatCompletionStream)
      .mockResolvedValueOnce({
        content: "",
        finish_reason: "tool_calls",
        tool_calls: [{ id: "call_1", name: "read_file", arguments: '{"path":"foo.txt"}' }],
      })
      .mockImplementationOnce(async (_c, _m, _msgs, _t, _d, onToken) => {
        onToken("Done.")
        return { content: "Done.", finish_reason: "stop" }
      })

    const { text } = await runAgent("read foo.txt", mockConfig, mockClient)
    expect(dispatchTool).toHaveBeenCalledWith("read_file", { path: "foo.txt" })
    expect(text).toBe("Done.")
  })

  it("sends tool error result back to LLM and continues", async () => {
    vi.mocked(dispatchTool).mockResolvedValueOnce("Error: file not found")

    vi.mocked(chatCompletionStream)
      .mockResolvedValueOnce({
        content: "",
        finish_reason: "tool_calls",
        tool_calls: [{ id: "call_2", name: "read_file", arguments: '{"path":"missing.txt"}' }],
      })
      .mockImplementationOnce(async (_c, _m, _msgs, _t, _d, onToken) => {
        onToken("File missing.")
        return { content: "File missing.", finish_reason: "stop" }
      })

    const { text } = await runAgent("read missing.txt", mockConfig, mockClient)
    expect(text).toBe("File missing.")
  })
})
