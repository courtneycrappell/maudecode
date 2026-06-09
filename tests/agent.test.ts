import { describe, it, expect, vi, beforeEach } from "vitest"
import type OpenAI from "openai"

// Mock the LLM module
vi.mock("../src/llm.js", () => ({
  chatCompletion: vi.fn(),
}))

// Mock the tools module
vi.mock("../src/tools/index.js", () => ({
  getToolSchemas: () => [],
  dispatchTool: vi.fn().mockResolvedValue("tool result"),
}))

import { runAgent } from "../src/agent.js"
import { chatCompletion } from "../src/llm.js"
import { dispatchTool } from "../src/tools/index.js"

const mockClient = {} as OpenAI
const mockConfig = { model: "test-model", baseURL: "http://localhost", maxRounds: 5, debug: false }

beforeEach(() => {
  vi.clearAllMocks()
})

describe("runAgent", () => {
  it("returns text when finish_reason is stop", async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Hello!" } }],
    } as any)

    const result = await runAgent("hi", mockConfig, mockClient)
    expect(result).toBe("Hello!")
  })

  it("dispatches a tool call and loops", async () => {
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "read_file", arguments: '{"path":"foo.txt"}' },
            }],
          },
        }],
      } as any)
      .mockResolvedValueOnce({
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Done." } }],
      } as any)

    const result = await runAgent("read foo.txt", mockConfig, mockClient)
    expect(dispatchTool).toHaveBeenCalledWith("read_file", { path: "foo.txt" })
    expect(result).toBe("Done.")
  })

  it("sends tool error result back to LLM and continues", async () => {
    vi.mocked(dispatchTool).mockResolvedValueOnce("Error: file not found")

    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_2",
              type: "function",
              function: { name: "read_file", arguments: '{"path":"missing.txt"}' },
            }],
          },
        }],
      } as any)
      .mockResolvedValueOnce({
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: "File missing." } }],
      } as any)

    const result = await runAgent("read missing.txt", mockConfig, mockClient)
    expect(result).toBe("File missing.")
  })
})
