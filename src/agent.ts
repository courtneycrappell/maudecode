import chalk from "chalk"
import type OpenAI from "openai"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js"
import { chatCompletion } from "./llm.js"
import { getToolSchemas, dispatchTool } from "./tools/index.js"
import type { MaudeConfig } from "./config.js"

const SYSTEM_PROMPT = `You are maude, a local coding assistant. Use tools to read, write, and run code. Be concise.

When the user asks to find or locate a file they created, use find_files. NEVER use dir "~" directly — it times out. Instead search these specific directories one at a time: ~/Desktop, ~/Documents, ~/Downloads, "~/Library/Mobile Documents" (iCloud), "~/Library/CloudStorage/OneDrive-UniversityofMissouri" (work OneDrive).
Use find_files to locate files by name or extension. Use grep_files only to search inside file contents.
Call one tool at a time. Do not output lists of tool calls — call one, wait for the result, then call the next.`

type EmbeddedCall = { name: string; args: Record<string, string> }

// Some models (e.g. qwen2.5-coder) output tool calls as JSON text in the content
// field instead of using the proper tool_calls API format. Detect and handle both
// single-call and array-of-calls formats, with optional leading explanation text.
function tryParseEmbeddedToolCalls(content: string): EmbeddedCall[] {
  // Strip ALL code fence markers so embedded ```json blocks become plain JSON
  const stripped = content.replace(/```(?:json)?\n?/g, "").replace(/```/g, "").trim()
  const candidates = [stripped]
  // Also try from the first [ or { in case model prepended prose
  const firstBracket = stripped.search(/[[{]/)
  if (firstBracket > 0) candidates.push(stripped.slice(firstBracket))

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      // Normalise: accept both "name" and "function_name" as the tool name field
      const normaliseName = (item: any): string | undefined =>
        typeof item?.name === "string" ? item.name : typeof item?.function_name === "string" ? item.function_name : undefined

      // Array of tool calls
      if (Array.isArray(parsed)) {
        const calls = parsed.filter(
          (item) => normaliseName(item) && item?.arguments && typeof item.arguments === "object"
        )
        if (calls.length > 0) return calls.map((c) => ({ name: normaliseName(c)!, args: c.arguments as Record<string, string> }))
      }
      // Single tool call
      const toolName = normaliseName(parsed)
      if (toolName && parsed.arguments && typeof parsed.arguments === "object") {
        return [{ name: toolName, args: parsed.arguments as Record<string, string> }]
      }
    } catch {
      // not valid JSON
    }
  }
  return []
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
      const embedded = tryParseEmbeddedToolCalls(content)
      if (embedded.length > 0) {
        const results: string[] = []
        for (const call of embedded) {
          process.stdout.write(chalk.cyan(`⚙ ${call.name} `) + chalk.dim(JSON.stringify(call.args)) + "\n")
          const result = await dispatchTool(call.name, call.args)
          const preview = result.length > 120 ? result.slice(0, 120) + "…" : result
          process.stdout.write(chalk.dim(`  → ${preview}\n`))
          results.push(`Tool \`${call.name}\` result:\n${result}`)
        }
        // Models that use this format don't understand role:"tool" — send results as user message
        messages.push({ role: "user", content: results.join("\n\n") })
      } else {
        return content
      }
    }
  }

  return `[max rounds reached — increase maxRounds in ~/.maude/config.json]`
}
