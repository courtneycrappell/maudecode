import readline from "readline"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { execSync } from "child_process"
import chalk from "chalk"
import type OpenAI from "openai"
import { runAgent, type ConversationHistory, type RunAgentOptions, buildSystemPrompt } from "./agent.js"
import { getToolSummaries } from "./tools/index.js"
import { runBash } from "./tools/bash.js"
import type { MaudeConfig } from "./config.js"
import { saveSession, loadSession, listSessions, deleteSession } from "./sessions.js"
import { chatCompletionStream } from "./llm.js"
import { popUndo, clearUndo } from "./undo.js"
import { expandAtMentions } from "./at-expand.js"

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildHelp(model: string) {
  return `
Commands:
  .help              Show this message
  .tools             List all available tools
  .models            List available Ollama models
  .model             Show current model
  .model <name>      Switch model (e.g. .model qwen2.5:7b)
  .clear             Reset conversation history
  .compact           Summarize conversation to save context
  .cd <dir>          Change working directory
  .undo              Revert last file write or edit
  .retry             Resend the last message
  .remember <fact>   Append a note to CLAUDE.md in this directory
  .log               Save conversation to ~/Documents/maude-logs/
  .history           Show message count + token estimate
  .sessions          List saved sessions
  .save              Save session now
  .exit              Exit maude
  .quit              Exit maude

Shortcuts:
  !<command>         Run a shell command directly (e.g. !git status)
  @<path>            Inject a file inline (e.g. @src/agent.ts or @src/*.ts)
  \\  at line end     Continue prompt on next line

Model tips:
  qwen2.5:7b           Best for writing, email, general tasks
  qwen2.5-coder:14b    Best for coding and file work (current: ${model})
`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

function estimateTokens(history: ConversationHistory): number {
  let chars = 0
  for (const msg of history) {
    if (typeof msg.content === "string") chars += msg.content.length
    else if (Array.isArray(msg.content)) {
      for (const p of msg.content as any[]) {
        if (typeof p === "object" && p.type === "text") chars += p.text.length
      }
    }
  }
  return Math.round(chars / 4)
}

function fmtTokens(n: number): string {
  return n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`
}

async function compact(history: ConversationHistory, config: MaudeConfig, client: OpenAI): Promise<ConversationHistory> {
  const turns = history.slice(1)
  if (turns.length < 4) { console.log(chalk.dim("Nothing to compact yet.")); return history }
  process.stdout.write(chalk.dim("Compacting conversation…"))
  const summaryMessages = [
    { role: "system" as const, content: "You are a helpful assistant. Summarize conversations accurately." },
    ...turns,
    { role: "user" as const, content: "Summarize this conversation in 5-8 bullet points. Preserve: key decisions, file paths worked on, code changes made, and any open questions. Be specific and brief." },
  ]
  let summary = ""
  await chatCompletionStream(client, config.model, summaryMessages, [], false, (t) => { summary += t })
  process.stdout.write("\n")
  const compacted: ConversationHistory = [
    history[0],
    { role: "user" as const, content: `Summary of earlier conversation:\n${summary}` },
    { role: "assistant" as const, content: "Got it — I have the context from our earlier conversation and am ready to continue." },
  ]
  console.log(chalk.dim(`Compacted ${turns.length} messages → 2.`))
  return compacted
}

async function saveLog(history: ConversationHistory, model: string, cwd: string): Promise<string> {
  const now = new Date()
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const dir = path.join(os.homedir(), "Documents", "maude-logs")
  await fs.mkdir(dir, { recursive: true })
  const logPath = path.join(dir, `${stamp}.md`)
  const lines = [`# maude session log`, ``, `**Model:** ${model}`, `**Date:** ${now.toLocaleString()}`, `**Directory:** ${cwd}`, ``, `---`, ``]
  for (const msg of history.slice(1)) {
    if (msg.role === "user" && typeof msg.content === "string") lines.push(`## You`, ``, msg.content, ``)
    else if (msg.role === "assistant" && typeof msg.content === "string" && msg.content) lines.push(`## maude`, ``, msg.content, ``)
  }
  await fs.writeFile(logPath, lines.join("\n"), "utf8")
  return logPath
}

function notifyDone(): void {
  if (process.platform !== "darwin") return
  try { execSync(`osascript -e 'display notification "Response ready" with title "maude"'`, { stdio: "ignore", timeout: 2000 }) } catch {}
}

// ── Main REPL ─────────────────────────────────────────────────────────────────

export async function startRepl(config: MaudeConfig, client: OpenAI, initialHistory?: ConversationHistory): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green("maude> "),
    historySize: 100,
    terminal: true,
  })

  let currentModel = config.model
  let cwd = process.cwd()
  const modifiedFiles = new Set<string>()
  let lastUserInput: string | null = null

  const confirmFn = (message: string): Promise<boolean> =>
    new Promise((resolve) => {
      rl.question(message, (a) => resolve(a.trim().toLowerCase() === "y" || a.trim().toLowerCase() === "yes"))
    })

  let history: ConversationHistory = initialHistory ?? [{ role: "system", content: await buildSystemPrompt() }]

  // Session restore prompt
  if (!initialHistory) {
    const saved = await loadSession(cwd)
    if (saved && saved.history.length > 1) {
      const msgCount = saved.history.length - 1
      const answer = await new Promise<string>((resolve) => {
        rl.question(
          chalk.dim(`Resume last session? (${msgCount} msg${msgCount !== 1 ? "s" : ""}, last: ${formatDate(saved.savedAt)}) [Y/n] `),
          resolve
        )
      })
      if (answer.trim().toLowerCase() !== "n") {
        history = saved.history
        history[0] = { role: "system", content: await buildSystemPrompt() }
        console.log(chalk.dim(`Session restored. ${msgCount} messages in history.`))
      }
    }
  }

  console.log(chalk.dim(`maude v0.1.0 · model: ${currentModel} · .help for commands`))

  async function autosave() {
    if (history.length > 1) await saveSession(cwd, history)
  }

  // ── Send input to the agent ─────────────────────────────────────────────────
  async function sendToAgent(rawInput: string) {
    // Auto-refresh system prompt (date, CWD, CLAUDE.md)
    history[0] = { role: "system", content: await buildSystemPrompt() }

    // Expand @file mentions
    const { text: input, injected } = await expandAtMentions(rawInput)
    if (injected.length > 0) process.stdout.write(chalk.dim(`  ↳ injected: ${injected.join(", ")}\n`))

    let streamed = false
    const startTime = Date.now()

    const agentOptions: RunAgentOptions = {
      onToken: (t) => { process.stdout.write(t); streamed = true },
      confirm: confirmFn,
      onFileChange: (p) => modifiedFiles.add(p),
    }

    try {
      const { text, history: updated } = await runAgent(input, config, client, history, agentOptions)
      history = updated
      if (streamed) process.stdout.write("\n")
      else if (text) console.log(chalk.white(text))

      lastUserInput = rawInput

      // Token + context budget display
      const tokens = estimateTokens(history)
      const turns = history.length - 1
      const pct = Math.round((tokens / config.maxTokens) * 100)
      const budgetWarn = pct >= 70 ? chalk.yellow(` ⚠ ${pct}% full — try .compact`) : ""
      process.stdout.write(chalk.dim(`[~${fmtTokens(tokens)} tokens · ${turns} turns]`) + budgetWarn + "\n")

      // macOS notification for slow responses
      if (Date.now() - startTime > 10_000) notifyDone()

      await autosave()
    } catch (e: any) {
      console.error(chalk.red(`Error: ${e.message}`))
    }

    rl.prompt()
  }

  // Multiline accumulator
  let pendingLines: string[] = []

  rl.prompt()

  rl.on("line", async (line) => {
    // Multiline continuation
    if (line.endsWith("\\")) {
      pendingLines.push(line.slice(0, -1))
      rl.setPrompt(chalk.dim("...   "))
      rl.prompt()
      return
    }

    let input: string
    if (pendingLines.length > 0) {
      input = [...pendingLines, line].join("\n").trim()
      pendingLines = []
      rl.setPrompt(chalk.green("maude> "))
    } else {
      input = line.trim()
    }

    if (!input) { rl.prompt(); return }

    // ── Inline shell (!command) ───────────────────────────────────────────────
    if (input.startsWith("!")) {
      const cmd = input.slice(1).trim()
      if (cmd) await runBash(cmd, 60_000)
      else console.log(chalk.dim("Usage: !<shell command>"))
      rl.prompt()
      return
    }

    // ── Dot commands ─────────────────────────────────────────────────────────

    if (input === ".exit" || input === ".quit") { await autosave(); rl.close(); return }

    if (input === ".help") { console.log(buildHelp(currentModel)); rl.prompt(); return }

    if (input === ".tools") {
      console.log(chalk.dim("\nAvailable tools:\n") + getToolSummaries().join("\n") + "\n")
      rl.prompt(); return
    }

    if (input === ".models") {
      try {
        const models = await client.models.list()
        console.log(chalk.dim("\nAvailable models:"))
        for (const m of models.data.sort((a, b) => a.id.localeCompare(b.id))) {
          const marker = m.id === currentModel ? chalk.green("▶ ") : chalk.dim("  ")
          console.log(marker + m.id)
        }
        console.log()
      } catch (e: any) {
        console.log(chalk.red(`Could not list models: ${e.message}`))
      }
      rl.prompt(); return
    }

    if (input === ".model" || input.startsWith(".model ")) {
      const arg = input.slice(".model".length).trim()
      if (!arg) {
        console.log(chalk.dim(`Current model: ${currentModel}`))
      } else {
        currentModel = arg; config.model = arg
        history = [{ role: "system", content: await buildSystemPrompt() }]
        clearUndo()
        console.log(chalk.dim(`Switched to ${currentModel}. History cleared.`))
      }
      rl.prompt(); return
    }

    if (input === ".clear") {
      history = [{ role: "system", content: await buildSystemPrompt() }]
      clearUndo(); modifiedFiles.clear(); lastUserInput = null
      await deleteSession(cwd)
      console.log(chalk.dim("History cleared."))
      rl.prompt(); return
    }

    if (input === ".compact") { history = await compact(history, config, client); await autosave(); rl.prompt(); return }

    if (input.startsWith(".cd ")) {
      const dir = input.slice(4).trim().replace(/^~/, process.env.HOME ?? "~")
      try {
        process.chdir(dir); cwd = process.cwd()
        history[0] = { role: "system", content: await buildSystemPrompt() }
        console.log(chalk.dim(`Working directory: ${cwd}`))
      } catch (e: any) { console.log(chalk.red(`cd: ${e.message}`)) }
      rl.prompt(); return
    }

    if (input === ".undo") {
      const entry = popUndo()
      if (!entry) {
        console.log(chalk.dim("Nothing to undo."))
      } else if (entry.content === null) {
        try { await fs.unlink(entry.path); console.log(chalk.dim(`Undo: deleted ${entry.path}`)) }
        catch (e: any) { console.log(chalk.red(`Undo failed: ${e.message}`)) }
      } else {
        try { await fs.writeFile(entry.path, entry.content, "utf8"); console.log(chalk.dim(`Undo: restored ${entry.path}`)) }
        catch (e: any) { console.log(chalk.red(`Undo failed: ${e.message}`)) }
      }
      rl.prompt(); return
    }

    if (input === ".retry") {
      if (!lastUserInput) { console.log(chalk.dim("Nothing to retry.")); rl.prompt(); return }
      // Pop the last user turn from history
      const lastUserIdx = [...history.keys()].filter(i => history[i].role === "user").pop()
      if (lastUserIdx !== undefined) history = history.slice(0, lastUserIdx)
      await sendToAgent(lastUserInput)
      return
    }

    if (input.startsWith(".remember ")) {
      const fact = input.slice(".remember ".length).trim()
      if (!fact) { console.log(chalk.dim("Usage: .remember <fact>")); rl.prompt(); return }
      const claudeMdPath = path.join(cwd, "CLAUDE.md")
      try {
        let existing = ""
        try { existing = await fs.readFile(claudeMdPath, "utf8") } catch {}
        const entry = `- ${fact}\n`
        const section = "\n## Notes\n"
        if (existing.includes("## Notes")) {
          await fs.appendFile(claudeMdPath, entry, "utf8")
        } else {
          await fs.appendFile(claudeMdPath, section + entry, "utf8")
        }
        history[0] = { role: "system", content: await buildSystemPrompt() }
        console.log(chalk.dim(`Remembered in CLAUDE.md: ${fact}`))
      } catch (e: any) { console.log(chalk.red(`Could not write CLAUDE.md: ${e.message}`)) }
      rl.prompt(); return
    }

    if (input === ".log") {
      try { console.log(chalk.dim(`Saved: ${await saveLog(history, currentModel, cwd)}`)) }
      catch (e: any) { console.log(chalk.red(`Log failed: ${e.message}`)) }
      rl.prompt(); return
    }

    if (input === ".history") {
      const turns = history.length - 1
      const tokens = estimateTokens(history)
      console.log(chalk.dim(`Session: ${turns} msg${turns !== 1 ? "s" : ""} · ~${fmtTokens(tokens)} tokens`))
      rl.prompt(); return
    }

    if (input === ".save") { await autosave(); console.log(chalk.dim("Session saved.")); rl.prompt(); return }

    if (input === ".sessions") {
      const sessions = await listSessions()
      if (sessions.length === 0) { console.log(chalk.dim("No saved sessions.")); }
      else {
        console.log(chalk.dim("\nSaved sessions:"))
        for (const s of sessions) {
          const rel = s.dir.replace(os.homedir(), "~")
          console.log(chalk.dim(`  ${rel.padEnd(36)} ${String(s.messageCount).padStart(3)} msgs  ${formatDate(s.savedAt)}`))
        }
        console.log()
      }
      rl.prompt(); return
    }

    // ── Agent turn ────────────────────────────────────────────────────────────
    await sendToAgent(input)
  })

  rl.on("close", async () => {
    await autosave()
    if (modifiedFiles.size > 0) {
      console.log(chalk.dim("\nFiles modified this session:"))
      for (const f of modifiedFiles) console.log(chalk.dim(`  ${f.replace(os.homedir(), "~")}`))
    }
    console.log(chalk.dim("\nBye."))
    process.exit(0)
  })
}
