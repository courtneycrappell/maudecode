import chalk from "chalk"
import fs from "fs/promises"
import path from "path"
import type OpenAI from "openai"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js"
import { chatCompletionStream } from "./llm.js"
import { getToolSchemas, dispatchTool } from "./tools/index.js"
import { expandHome } from "./utils.js"
import type { MaudeConfig } from "./config.js"

export type ConfirmFn = (prompt: string) => Promise<boolean>

export interface RunAgentOptions {
  onToken?: (token: string) => void
  confirm?: ConfirmFn
  onFileChange?: (path: string) => void
}

const DANGEROUS_PATTERNS = [
  /\brm\s+-[rRfF]*[rR][fF]*/,
  /\brm\s+-[rRfF]*[rR]/,
  /\bsudo\s+rm\b/,
  /\bdd\s+if=/,
  /\bmkfs\b/,
  />\s*\/dev\//,
  /\bDROP\s+(TABLE|DATABASE)\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
]

function isDangerous(command: string): boolean {
  return DANGEROUS_PATTERNS.some(p => p.test(command))
}

async function readClaudeMd(cwd: string): Promise<string> {
  for (const name of ["CLAUDE.md", "claude.md", ".claude.md"]) {
    try {
      const content = await fs.readFile(path.join(cwd, name), "utf8")
      return `\n\n## Project Instructions (${name})\n${content}`
    } catch { /* not found */ }
  }
  return ""
}

export async function buildSystemPrompt(): Promise<string> {
  const cwd = process.cwd()
  const now = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
  const claudeMd = await readClaudeMd(cwd)
  return `You are maude, a personal coding and operations assistant for Courtney Crappell, Dean of the UMKC Conservatory of Music and Dance. Be concise and direct.

CRITICAL RULES — follow these exactly:
1. NEVER call write_file, open_file, or run_bash unless Courtney explicitly asks you to save, create, open, or run something. Drafting text, writing an email, brainstorming, or answering a question does NOT require any tool call — just reply with the text.
2. When asked to draft an email or write any text: reply with the draft directly in your message. Do not save it to a file, do not open it, do not send it.
3. Only use tools when they are genuinely necessary: read_file to read a file, find_files to locate files, git_* for git info, etc.

User: Courtney Crappell (cjchgy), Dean of UMKC Conservatory of Music and Dance
Current working directory: ${cwd}
Today's date: ${now}

File search rules:
- Use find_files to locate files by name or extension. Use grep_files only to search inside file contents.
- NEVER search dir "~" directly — it times out. Search specific dirs one at a time: ~/Desktop, ~/Documents, ~/Downloads, "~/Library/Mobile Documents" (iCloud Drive), "~/Library/CloudStorage/OneDrive-UniversityofMissouri" (work OneDrive). For work files, try OneDrive first.
- Use list_dir to explore what's in a folder before diving deeper.

Tool use rules:
- Call one tool at a time. Wait for the result before deciding what to do next.
- Do not output JSON tool calls as text — call them properly via the API.
- read_files can read multiple files at once — use it when you need several files.
- git_add then git_commit to stage and commit changes. git_push to push.
- read_clipboard to read what the user copied; write_clipboard to copy output for them.${claudeMd}`
}

function showEditPreview(toolPath: string, oldStr: string, newStr: string): void {
  const truncLine = (s: string) => s.length > 100 ? s.slice(0, 100) + "…" : s
  const oldLines = oldStr.split("\n")
  const newLines = newStr.split("\n")
  const MAX_LINES = 8

  process.stdout.write(chalk.dim(`  Edit: ${toolPath}\n  `) + chalk.dim("─".repeat(56)) + "\n")
  for (const line of oldLines.slice(0, MAX_LINES)) {
    process.stdout.write(chalk.red(`  - ${truncLine(line)}\n`))
  }
  if (oldLines.length > MAX_LINES) process.stdout.write(chalk.dim(`  - [${oldLines.length - MAX_LINES} more lines]\n`))
  for (const line of newLines.slice(0, MAX_LINES)) {
    process.stdout.write(chalk.green(`  + ${truncLine(line)}\n`))
  }
  if (newLines.length > MAX_LINES) process.stdout.write(chalk.dim(`  + [${newLines.length - MAX_LINES} more lines]\n`))
  process.stdout.write(chalk.dim("  ") + chalk.dim("─".repeat(56)) + "\n")
}

async function executeToolCall(
  name: string,
  args: Record<string, any>,
  confirm?: ConfirmFn,
  onFileChange?: (path: string) => void
): Promise<string> {
  // Dangerous bash check
  if (name === "run_bash" && args.command && isDangerous(args.command) && confirm) {
    process.stdout.write(chalk.yellow(`⚠ Dangerous command: ${args.command}\n`))
    const ok = await confirm(chalk.yellow("  Run it? [y/N] "))
    if (!ok) return "User denied: command was blocked."
  }

  // Diff preview for edit_file
  if (name === "edit_file" && args.path && args.old_str !== undefined && args.new_str !== undefined && confirm) {
    showEditPreview(args.path, args.old_str, args.new_str)
    const ok = await confirm(chalk.yellow("  Apply this edit? [Y/n] "))
    if (!ok) return "User cancelled edit. Do not retry — ask the user what they would like to change instead."
  }

  // Write-file overwrite warning
  if (name === "write_file" && args.path && confirm) {
    const fullPath = expandHome(args.path)
    let exists = false
    try { await fs.access(fullPath); exists = true } catch { /* new file */ }
    if (exists) {
      process.stdout.write(chalk.yellow(`⚠ Will overwrite: ${args.path}\n`))
      const ok = await confirm(chalk.yellow("  Overwrite this file? [Y/n] "))
      if (!ok) return "User cancelled. File was not overwritten."
    }
  }

  process.stdout.write(chalk.cyan(`⚙ ${name} `) + chalk.dim(JSON.stringify(args)) + "\n")
  const result = await dispatchTool(name, args)
  const preview = result.length > 120 ? result.slice(0, 120) + "…" : result
  process.stdout.write(chalk.dim(`  → ${preview}\n`))

  // Track file modifications
  if ((name === "write_file" || name === "edit_file") && args.path && !result.startsWith("Error")) {
    onFileChange?.(expandHome(args.path))
  }

  return result
}

type EmbeddedCall = { name: string; args: Record<string, any> }

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
  const toCall = (item: any): EmbeddedCall => ({ name: normaliseName(item)!, args: item.arguments as Record<string, any> })

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
  options: RunAgentOptions = {}
): Promise<{ text: string; history: ConversationHistory }> {
  const { onToken, confirm, onFileChange } = options
  const base = history ? trimHistory(history) : [{ role: "system" as const, content: await buildSystemPrompt() }]
  const messages: ChatCompletionMessageParam[] = [...base, { role: "user", content: userMessage }]

  for (let round = 0; round < config.maxRounds; round++) {
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
        let args: Record<string, any>
        try { args = JSON.parse(tc.arguments) }
        catch { args = {} }

        const result = await executeToolCall(tc.name, args, confirm, onFileChange)
        messages.push({ role: "tool", tool_call_id: tc.id, content: result })
      }
    } else {
      messages.push({ role: "assistant", content })

      const embedded = tryParseEmbeddedToolCalls(content)
      if (embedded.length > 0) {
        const results: string[] = []
        for (const call of embedded) {
          const result = await executeToolCall(call.name, call.args, confirm, onFileChange)
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
