import chalk from "chalk"
import type OpenAI from "openai"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js"
import { chatCompletion } from "./llm.js"
import { getToolSchemas, dispatchTool } from "./tools/index.js"
import type { MaudeConfig } from "./config.js"

export function buildSystemPrompt(): string {
  const cwd = process.cwd()
  const now = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
  return `You are maude, a personal coding and operations assistant for Courtney Crappell, Dean of the UMKC Conservatory of Music and Dance. Use tools to read, write, run code, and manage files. Be concise and direct.

User: Courtney Crappell (cjchgy), Dean of UMKC Conservatory of Music and Dance
Current working directory: ${cwd}
Today's date: ${now}

File search rules:
- Use find_files to locate files by name or extension. Use grep_files only to search inside file contents.
- NEVER search dir "~" directly — it times out. Search specific dirs one at a time: ~/Desktop, ~/Documents, ~/Downloads, "~/Library/Mobile Documents" (iCloud Drive), "~/Library/CloudStorage/OneDrive-UniversityofMissouri" (work OneDrive). For work files, try OneDrive first.
- Use list_dir to explore what's in a folder before diving deeper.

General rules:
- Call one tool at a time. Wait for the result, then decide next step.
- Do not output JSON tool calls as text — call them properly.
- Only write or save files when explicitly asked. Never auto-save summaries or results unless instructed.
- When asked to draft an email: show the draft as text in your reply. Only save to a file if asked. Never attempt to send via shell (mail, sendmail, etc.).`
}

type EmbeddedCall = { name: string; args: Record<string, string> }

// Some models (e.g. qwen2.5-coder) output tool calls as JSON text in the content
// field instead of using the proper tool_calls API format. Detect and handle both
// single-call and array-of-calls formats, with optional leading explanation text.
function tryParseEmbeddedToolCalls(content: string): EmbeddedCall[] {
  const candidates: string[] = []

  // Extract each fenced block individually (model may output multiple ```json blocks)
  const fenceBlocks = [...content.matchAll(/```(?:json|tool_call)?\n?([\s\S]*?)```/g)].map(m => m[1].trim())
  candidates.push(...fenceBlocks)

  // Also try the whole content with fences stripped
  const stripped = content.replace(/```(?:json|tool_call)?\n?/g, "").replace(/```/g, "").trim()
  candidates.push(stripped)

  // Also try from the first [ or { in case model prepended prose
  const firstBracket = stripped.search(/[[{]/)
  if (firstBracket > 0) candidates.push(stripped.slice(firstBracket))

  // Also try each line individually (NDJSON: model outputs one JSON object per line)
  const lines = stripped.split("\n").map(l => l.trim()).filter(l => l.startsWith("{") || l.startsWith("["))
  if (lines.length > 1) candidates.push(...lines)

  // Normalise: accept both "name" and "function_name" as the tool name field
  const normaliseName = (item: any): string | undefined =>
    typeof item?.name === "string" ? item.name : typeof item?.function_name === "string" ? item.function_name : undefined

  const isToolCall = (item: any) => normaliseName(item) && item?.arguments && typeof item.arguments === "object"
  const toCall = (item: any): EmbeddedCall => ({ name: normaliseName(item)!, args: item.arguments as Record<string, string> })

  // Some models emit literal newlines/tabs inside JSON string values (invalid JSON).
  // Fix by escaping control chars inside string literals only.
  function repairJson(s: string): string {
    let out = ""; let inStr = false; let esc = false
    for (const ch of s) {
      if (esc) { out += ch; esc = false; continue }
      if (ch === "\\") { out += ch; esc = true; continue }
      if (ch === '"') { inStr = !inStr; out += ch; continue }
      if (inStr && ch === "\n") { out += "\\n"; continue }
      if (inStr && ch === "\r") { out += "\\r"; continue }
      if (inStr && ch === "\t") { out += "\\t"; continue }
      out += ch
    }
    return out
  }

  const seen = new Set<string>()
  const results: EmbeddedCall[] = []

  const addCall = (call: EmbeddedCall) => {
    const key = `${call.name}:${JSON.stringify(call.args)}`
    if (!seen.has(key)) { seen.add(key); results.push(call) }
  }

  for (const candidate of candidates) {
    for (const attempt of [candidate, repairJson(candidate)]) {
      try {
        const parsed = JSON.parse(attempt)
        if (Array.isArray(parsed)) {
          const calls = parsed.filter(isToolCall)
          if (calls.length > 0) { calls.forEach(c => addCall(toCall(c))); break }
        }
        if (isToolCall(parsed)) { addCall(toCall(parsed)); break }
      } catch {
        // not valid JSON
      }
    }
  }
  return results
}

export type ConversationHistory = ChatCompletionMessageParam[]

// Keep system message + last 40 messages to prevent context overflow in long REPL sessions
function trimHistory(history: ConversationHistory): ConversationHistory {
  const MAX_MESSAGES = 40
  const [system, ...rest] = history
  if (rest.length <= MAX_MESSAGES) return history
  return [system, ...rest.slice(rest.length - MAX_MESSAGES)]
}

export async function runAgent(
  userMessage: string,
  config: MaudeConfig,
  client: OpenAI,
  history?: ConversationHistory
): Promise<{ text: string; history: ConversationHistory }> {
  const base = history ? trimHistory(history) : [{ role: "system" as const, content: buildSystemPrompt() }]
  const messages: ChatCompletionMessageParam[] = [...base, { role: "user", content: userMessage }]

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
        return { text: content, history: messages }
      }
    }
  }

  return { text: `[max rounds reached — increase maxRounds in ~/.maude/config.json]`, history: messages }
}
