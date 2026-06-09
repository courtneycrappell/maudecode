import OpenAI from "openai"
import chalk from "chalk"
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions.js"

export function createClient(baseURL: string): OpenAI {
  return new OpenAI({ apiKey: "ollama", baseURL })
}

export async function healthCheck(client: OpenAI): Promise<boolean> {
  try {
    await client.models.list()
    return true
  } catch {
    return false
  }
}

export async function chatCompletion(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[],
  debug: boolean
) {
  if (debug) {
    process.stderr.write(chalk.dim(`[debug] request: ${JSON.stringify({ model, messages, tools }, null, 2)}\n`))
  }

  const response = await client.chat.completions.create({
    model,
    messages,
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: tools.length > 0 ? "auto" : undefined,
  })

  if (debug) {
    process.stderr.write(chalk.dim(`[debug] response: ${JSON.stringify(response, null, 2)}\n`))
  }

  return response
}

export type StreamedResult = {
  content: string
  finish_reason: string | null
  tool_calls?: Array<{ id: string; name: string; arguments: string }>
}

// Streaming completion — prints text tokens live as they arrive.
// Returns the accumulated content + tool calls once the stream ends.
export async function chatCompletionStream(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[],
  debug: boolean,
  onToken: (token: string) => void
): Promise<StreamedResult> {
  if (debug) {
    process.stderr.write(chalk.dim(`[debug] stream request: ${JSON.stringify({ model, messages }, null, 2)}\n`))
  }

  const stream = await client.chat.completions.create({
    model,
    messages,
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: tools.length > 0 ? "auto" : undefined,
    stream: true,
  })

  let content = ""
  let finish_reason: string | null = null
  const toolCallAccum: Record<number, { id: string; name: string; arguments: string }> = {}

  for await (const chunk of stream) {
    const choice = chunk.choices[0]
    if (!choice) continue

    if (choice.finish_reason) finish_reason = choice.finish_reason

    const delta = choice.delta
    if (delta.content) {
      onToken(delta.content)
      content += delta.content
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index
        if (!toolCallAccum[idx]) {
          toolCallAccum[idx] = { id: "", name: "", arguments: "" }
        }
        if (tc.id) toolCallAccum[idx].id = tc.id
        if (tc.function?.name) toolCallAccum[idx].name += tc.function.name
        if (tc.function?.arguments) toolCallAccum[idx].arguments += tc.function.arguments
      }
    }
  }

  const tool_calls = Object.values(toolCallAccum).filter(t => t.name)

  if (debug) {
    process.stderr.write(chalk.dim(`[debug] stream result: finish=${finish_reason} content_len=${content.length} tool_calls=${tool_calls.length}\n`))
  }

  return { content, finish_reason, tool_calls: tool_calls.length > 0 ? tool_calls : undefined }
}
