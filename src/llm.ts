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
