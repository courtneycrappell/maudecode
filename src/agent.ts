import chalk from "chalk"
import type OpenAI from "openai"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js"
import { chatCompletionStream } from "./llm.js"
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
- Only use tools when they are genuinely needed. For writing, brainstorming, answering questions, drafting text, or explaining things — respond directly without calling any tool.
- Only write or save files when explicitly asked ("save this", "write to a file", "create a file"). Never auto-save.
- When asked to draft an email or write text: output it directly in your reply. Do not save or send it unless asked.
- Never use run_bash just to output text — use your own words instead.`
}

type EmbeddedCall = { name: string; args: Record<string, string> }

function tryParseEmbeddedToolCalls(content: string): EmbeddedCall[] {
  const candidates: string[] = []

  const fenceBlocks = [...content.matchAll(/```(?:json|tool_call)?\n?([\s\S]*?)```/g)].map(m => m[1].trim())
  candidates.push(...fenceBlocks)

  const stripped = content.replace(/```(?:json|tool_call)?\n?/g, "").replace(/```/g, "").trim()
  candidates.push(stripped)

  const firstBracket = stripped.search(/[[{]/)
  if (firstBracket > 0) candidates.push(stripped.slice(firstBracket))

  const lines = stripped.split("\n").map(l => l.trim()).filter(l => l.startsWith("{") || l.startsWith("["))
  if (lines.length > 1) candidates.push(...lines)

  const normaliseName = (item: any): string | undefined =>
    typeof item?.name === "string" ? item.name : typeof item?.function_name === "string" ? item.function_name : undefined

  const isToolCall = (item: any) => normaliseName(item) && item?.arguments && typeof item.arguments === "object"
  const toCall = (item: any): EmbeddedCall => ({ name: normaliseName(item)!, args: item.arguments as Record<string, string> })

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
  history?: ConversationHistory,
  onToken?: (token: string) => void
): Promise<{ text: string; history: ConversationHistory }> {
  const base = history ? trimHistory(history) : [{ role: "system" as const, content: buildSystemPrompt() }]
  const messages: ChatCompletionMessageParam[] = [...base, { role: "user", content: userMessage }]

  for (let round = 0; round < config.maxRounds; round++) {
    // Buffer if response starts with JSON (embedded tool call format).
    // Only stream live for prose responses so raw JSON never leaks to the terminal.
    let firstToken = true
    let looksLikeJson = false
    const tokenRouter = (token: string) => {
      if (firstToken) {
        firstToken = false
        looksLikeJson = token.trimStart().startsWith("{") || token.trimStart().startsWith("[")
      }
      if (!looksLikeJson) onToken?.(token)
    }

    const streamed = await chatCompletionStream(
      client, config.model, messages, getToolSchemas(), config.debug,
      tokenRouter
    )

    const { content, finish_reason, tool_calls } = streamed

    if (finish_reason === "tool_calls" && tool_calls && tool_calls.length > 0) {
      // Proper tool_calls format
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: tool_calls.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      })

      for (const tc of tool_calls) {
        let args: Record<string, string>
        try { args = JSON.parse(tc.arguments) }
        catch { args = {} }

        process.stdout.write(chalk.cyan(`⚙ ${tc.name} `) + chalk.dim(JSON.stringify(args)) + "\n")
        const result = await dispatchTool(tc.name, args)
        const preview = result.length > 120 ? result.slice(0, 120) + "…" : result
        process.stdout.write(chalk.dim(`  → ${preview}\n`))

        messages.push({ role: "tool", tool_call_id: tc.id, content: result })
      }
    } else {
      // Possibly embedded tool calls in content
      messages.push({ role: "assistant", content })

      const embedded = tryParseEmbeddedToolCalls(content)
      if (embedded.length > 0) {
        // Content was already streamed — if it looks like JSON, that's unfortunate but harmless.
        // Execute the tools and loop.
        const results: string[] = []
        for (const call of embedded) {
          process.stdout.write(chalk.cyan(`⚙ ${call.name} `) + chalk.dim(JSON.stringify(call.args)) + "\n")
          const result = await dispatchTool(call.name, call.args)
          const preview = result.length > 120 ? result.slice(0, 120) + "…" : result
          process.stdout.write(chalk.dim(`  → ${preview}\n`))
          results.push(`Tool \`${call.name}\` result:\n${result}`)
        }
        messages.push({ role: "user", content: results.join("\n\n") })
      } else {
        return { text: content, history: messages }
      }
    }
  }

  return { text: `[max rounds reached — increase maxRounds in ~/.maude/config.json]`, history: messages }
}
