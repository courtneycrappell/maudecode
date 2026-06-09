import chalk from "chalk"
import type OpenAI from "openai"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js"
import { chatCompletion } from "./llm.js"
import { getToolSchemas, dispatchTool } from "./tools/index.js"
import type { MaudeConfig } from "./config.js"

const SYSTEM_PROMPT = "You are maude, a local coding assistant. Use tools to read, write, and run code. Be concise."

// Some models (e.g. qwen2.5-coder) output tool calls as JSON text in the content
// field instead of using the proper tool_calls API format. Detect and handle both.
function tryParseEmbeddedToolCall(content: string): { name: string; args: Record<string, string> } | null {
  const stripped = content.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
  try {
    const parsed = JSON.parse(stripped)
    if (typeof parsed.name === "string" && parsed.arguments && typeof parsed.arguments === "object") {
      return { name: parsed.name, args: parsed.arguments as Record<string, string> }
    }
  } catch {
    // not a tool call JSON
  }
  return null
}

export async function runAgent(userMessage: string, config: MaudeConfig, client: OpenAI): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ]

  for (let round = 0; round < config.maxRounds; round++) {
    const response = await chatCompletion(client, config.model, messages, getToolSchemas(), config.debug)
    const choice = response.choices[0]

    messages.push(choice.message as ChatCompletionMessageParam)

    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        const name = toolCall.function.name
        const args = JSON.parse(toolCall.function.arguments) as Record<string, string>

        process.stdout.write(chalk.cyan(`⚙ ${name} `) + chalk.dim(JSON.stringify(args)) + "\n")

        const result = await dispatchTool(name, args)

        const preview = result.length > 120 ? result.slice(0, 120) + "…" : result
        process.stdout.write(chalk.dim(`  → ${preview}\n`))

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        })
      }
    } else {
      const content = choice.message.content ?? ""
      const embedded = tryParseEmbeddedToolCall(content)
      if (embedded) {
        process.stdout.write(chalk.cyan(`⚙ ${embedded.name} `) + chalk.dim(JSON.stringify(embedded.args)) + "\n")
        const result = await dispatchTool(embedded.name, embedded.args)
        const preview = result.length > 120 ? result.slice(0, 120) + "…" : result
        process.stdout.write(chalk.dim(`  → ${preview}\n`))
        // Models that use this format don't understand role:"tool" — send result as user message
        messages.push({ role: "user", content: `Tool \`${embedded.name}\` result:\n${result}` })
      } else {
        return content
      }
    }
  }

  return `[max rounds reached — increase maxRounds in ~/.maude/config.json]`
}
