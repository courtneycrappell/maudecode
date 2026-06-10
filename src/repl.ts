import readline from "readline"
import fs from "fs/promises"
import path from "path"
import os from "os"
import chalk from "chalk"
import type OpenAI from "openai"
import { runAgent, type ConversationHistory, type RunAgentOptions, buildSystemPrompt } from "./agent.js"
import { getToolSummaries } from "./tools/index.js"
import type { MaudeConfig } from "./config.js"
import { saveSession, loadSession, listSessions, deleteSession } from "./sessions.js"
import { chatCompletionStream } from "./llm.js"
import { popUndo, clearUndo } from "./undo.js"

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildHelp(model: string) {
  return `
Commands:
  .help              Show this message
  .tools             List all available tools
  .model             Show current model
  .model <name>      Switch model (e.g. .model qwen2.5:7b)
  .clear             Reset conversation history
  .compact           Summarize conversation to save context
  .cd <dir>          Change working directory
  .undo              Revert the last file write or edit
  .log               Save conversation to ~/Documents/maude-logs/
  .history           Show number of messages in current session
  .sessions          List saved sessions
  .save              Save session now
  .exit              Exit maude
  .quit              Exit maude

Multiline: end a line with \\ to continue on the next line.

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
  if (turns.length < 4) {
    console.log(chalk.dim("Nothing to compact yet."))
    return history
  }
  process.stdout.write(chalk.dim("Compacting conversation…"))
  const summaryPrompt = "Summarize this conversation in 5-8 bullet points. Preserve: key decisions, file paths worked on, code changes made, and any open questions. Be specific and brief."
  const compactMessages = [
    { role: "system" as const, content: "You are a helpful assistant. Summarize conversations accurately." },
    ...turns,
    { role: "user" as const, content: summaryPrompt },
  ]
  let summary = ""
  await chatCompletionStream(client, config.model, compactMessages, [], false, (t) => { summary += t })
  process.stdout.write("\n")
  const compacted: ConversationHistory = [
    history[0],
    { role: "user" as const, content: `Here is a summary of our earlier conversation:\n${summary}` },
    { role: "assistant" as const, content: "Got it — I have the context from our earlier conversation and am ready to continue." },
  ]
  console.log(chalk.dim(`Compacted ${turns.length} messages → 2. Context freed up.`))
  return compacted
}

async function saveLog(history: ConversationHistory, model: string, cwd: string): Promise<string> {
  const now = new Date()
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const dir = path.join(os.homedir(), "Documents", "maude-logs")
  await fs.mkdir(dir, { recursive: true })
  const logPath = path.join(dir, `${stamp}.md`)

  const lines = [
    `# maude session log`,
    ``,
    `**Model:** ${model}`,
    `**Date:** ${now.toLocaleString()}`,
    `**Directory:** ${cwd}`,
    ``,
    `---`,
    ``,
  ]
  for (const msg of history.slice(1)) {
    if (msg.role === "user" && typeof msg.content === "string") {
      lines.push(`## You`, ``, msg.content, ``)
    } else if (msg.role === "assistant" && typeof msg.content === "string" && msg.content) {
      lines.push(`## maude`, ``, msg.content, ``)
    }
  }
  await fs.writeFile(logPath, lines.join("\n"), "utf8")
  return logPath
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

  const confirmFn = (message: string): Promise<boolean> =>
    new Promise((resolve) => {
      rl.question(message, (answer) => {
        const a = answer.trim().toLowerCase()
        resolve(a === "y" || a === "yes")
      })
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

  // Multiline input accumulator
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

    // ── Dot commands ───────────────────────────────────────────────────────

    if (input === ".exit" || input === ".quit") {
      await autosave()
      rl.close()
      return
    }

    if (input === ".help") { console.log(buildHelp(currentModel)); rl.prompt(); return }

    if (input === ".tools") {
      console.log(chalk.dim("\nAvailable tools:\n") + getToolSummaries().join("\n") + "\n")
      rl.prompt(); return
    }

    if (input === ".model" || input.startsWith(".model ")) {
      const arg = input.slice(".model".length).trim()
      if (!arg) {
        console.log(chalk.dim(`Current model: ${currentModel}`))
      } else {
        currentModel = arg
        config.model = arg
        history = [{ role: "system", content: await buildSystemPrompt() }]
        clearUndo()
        console.log(chalk.dim(`Switched to ${currentModel}. History cleared.`))
      }
      rl.prompt(); return
    }

    if (input === ".clear") {
      history = [{ role: "system", content: await buildSystemPrompt() }]
      clearUndo()
      modifiedFiles.clear()
      await deleteSession(cwd)
      console.log(chalk.dim("Conversation history cleared."))
      rl.prompt(); return
    }

    if (input === ".compact") {
      history = await compact(history, config, client)
      await autosave()
      rl.prompt(); return
    }

    if (input.startsWith(".cd ")) {
      const dir = input.slice(4).trim().replace(/^~/, process.env.HOME ?? "~")
      try {
        process.chdir(dir)
        cwd = process.cwd()
        history[0] = { role: "system", content: await buildSystemPrompt() }
        console.log(chalk.dim(`Working directory: ${cwd}`))
      } catch (e: any) {
        console.log(chalk.red(`cd: ${e.message}`))
      }
      rl.prompt(); return
    }

    if (input === ".undo") {
      const entry = popUndo()
      if (!entry) {
        console.log(chalk.dim("Nothing to undo."))
      } else if (entry.content === null) {
        try {
          await fs.unlink(entry.path)
          console.log(chalk.dim(`Undo: deleted ${entry.path}`))
        } catch (e: any) {
          console.log(chalk.red(`Undo failed: ${e.message}`))
        }
      } else {
        try {
          await fs.writeFile(entry.path, entry.content, "utf8")
          console.log(chalk.dim(`Undo: restored ${entry.path}`))
        } catch (e: any) {
          console.log(chalk.red(`Undo failed: ${e.message}`))
        }
      }
      rl.prompt(); return
    }

    if (input === ".log") {
      try {
        const logPath = await saveLog(history, currentModel, cwd)
        console.log(chalk.dim(`Saved: ${logPath}`))
      } catch (e: any) {
        console.log(chalk.red(`Log failed: ${e.message}`))
      }
      rl.prompt(); return
    }

    if (input === ".history") {
      const turns = history.length - 1
      const tokens = estimateTokens(history)
      console.log(chalk.dim(`Session: ${turns} message${turns !== 1 ? "s" : ""} · ~${fmtTokens(tokens)} tokens`))
      rl.prompt(); return
    }

    if (input === ".save") {
      await autosave()
      console.log(chalk.dim("Session saved."))
      rl.prompt(); return
    }

    if (input === ".sessions") {
      const sessions = await listSessions()
      if (sessions.length === 0) {
        console.log(chalk.dim("No saved sessions."))
      } else {
        console.log(chalk.dim("\nSaved sessions:"))
        for (const s of sessions) {
          const rel = s.dir.replace(os.homedir(), "~")
          console.log(chalk.dim(`  ${rel.padEnd(36)} ${String(s.messageCount).padStart(3)} msgs  ${formatDate(s.savedAt)}`))
        }
        console.log()
      }
      rl.prompt(); return
    }

    // ── Agent turn ─────────────────────────────────────────────────────────

    // Refresh system prompt (updates date + CWD for each turn)
    history[0] = { role: "system", content: await buildSystemPrompt() }

    let streamed = false
    const agentOptions: RunAgentOptions = {
      onToken: (token) => { process.stdout.write(token); streamed = true },
      confirm: confirmFn,
      onFileChange: (p) => modifiedFiles.add(p),
    }

    try {
      const { text, history: updated } = await runAgent(input, config, client, history, agentOptions)
      history = updated
      if (streamed) process.stdout.write("\n")
      else if (text) console.log(chalk.white(text))

      // Token usage hint
      const tokens = estimateTokens(history)
      const turns = history.length - 1
      process.stdout.write(chalk.dim(`[~${fmtTokens(tokens)} tokens · ${turns} turns]\n`))

      await autosave()
    } catch (e: any) {
      console.error(chalk.red(`Error: ${e.message}`))
    }

    rl.prompt()
  })

  rl.on("close", async () => {
    await autosave()
    if (modifiedFiles.size > 0) {
      console.log(chalk.dim(`\nFiles modified this session:`))
      for (const f of modifiedFiles) {
        console.log(chalk.dim(`  ${f.replace(os.homedir(), "~")}`))
      }
    }
    console.log(chalk.dim("\nBye."))
    process.exit(0)
  })
}
