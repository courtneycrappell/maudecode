import readline from "readline"
import chalk from "chalk"
import type OpenAI from "openai"
import { runAgent, type ConversationHistory, buildSystemPrompt } from "./agent.js"
import { getToolSummaries } from "./tools/index.js"
import type { MaudeConfig } from "./config.js"
import { saveSession, loadSession, listSessions, deleteSession } from "./sessions.js"
import { chatCompletionStream } from "./llm.js"

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
  .history           Show number of messages in current session
  .sessions          List saved sessions
  .save              Save session now
  .exit              Exit maude
  .quit              Exit maude

Model tips:
  qwen2.5:7b           Best for writing, email, general tasks
  qwen2.5-coder:14b    Best for coding and file work (current: ${model})

Just type your request and press Enter.
`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

async function compact(history: ConversationHistory, config: MaudeConfig, client: OpenAI): Promise<ConversationHistory> {
  const turns = history.slice(1) // skip system
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

  const systemMsg = history[0]
  const compacted: ConversationHistory = [
    systemMsg,
    { role: "user" as const, content: `Here is a summary of our earlier conversation:\n${summary}` },
    { role: "assistant" as const, content: "Got it — I have the context from our earlier conversation and am ready to continue." },
  ]
  console.log(chalk.dim(`Compacted ${turns.length} messages → 2. Context freed up.`))
  return compacted
}

export async function startRepl(config: MaudeConfig, client: OpenAI, initialHistory?: ConversationHistory): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green("maude> "),
  })

  let currentModel = config.model
  let cwd = process.cwd()

  // Confirm callback uses readline.question so it integrates cleanly
  const confirmFn = (message: string): Promise<boolean> =>
    new Promise((resolve) => {
      rl.question(message, (answer) => {
        const a = answer.trim().toLowerCase()
        resolve(a === "y" || a === "yes")
      })
    })

  let history: ConversationHistory = initialHistory ?? [{ role: "system", content: await buildSystemPrompt() }]

  // Session restore prompt (if no initial history was passed in)
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
        // Refresh system prompt in case CWD or date changed
        history[0] = { role: "system", content: await buildSystemPrompt() }
        console.log(chalk.dim(`Session restored. ${msgCount} messages in history.`))
      }
    }
  }

  console.log(chalk.dim(`maude v0.1.0 · model: ${currentModel} · .help for commands`))

  // Auto-save after every response
  async function autosave() {
    if (history.length > 1) await saveSession(cwd, history)
  }

  rl.prompt()

  rl.on("line", async (line) => {
    const input = line.trim()

    if (!input) {
      rl.prompt()
      return
    }

    if (input === ".exit" || input === ".quit") {
      await autosave()
      rl.close()
      return
    }

    if (input === ".help") {
      console.log(buildHelp(currentModel))
      rl.prompt()
      return
    }

    if (input === ".tools") {
      console.log(chalk.dim("\nAvailable tools:\n") + getToolSummaries().join("\n") + "\n")
      rl.prompt()
      return
    }

    if (input === ".model" || input.startsWith(".model ")) {
      const arg = input.slice(".model".length).trim()
      if (!arg) {
        console.log(chalk.dim(`Current model: ${currentModel}`))
      } else {
        currentModel = arg
        config.model = arg
        history = [{ role: "system", content: await buildSystemPrompt() }]
        console.log(chalk.dim(`Switched to ${currentModel}. History cleared.`))
      }
      rl.prompt()
      return
    }

    if (input === ".clear") {
      history = [{ role: "system", content: await buildSystemPrompt() }]
      await deleteSession(cwd)
      console.log(chalk.dim("Conversation history cleared."))
      rl.prompt()
      return
    }

    if (input === ".compact") {
      history = await compact(history, config, client)
      await autosave()
      rl.prompt()
      return
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
      rl.prompt()
      return
    }

    if (input === ".history") {
      const turns = history.length - 1
      console.log(chalk.dim(`Session: ${turns} message${turns !== 1 ? "s" : ""} in history.`))
      rl.prompt()
      return
    }

    if (input === ".save") {
      await autosave()
      console.log(chalk.dim(`Session saved.`))
      rl.prompt()
      return
    }

    if (input === ".sessions") {
      const sessions = await listSessions()
      if (sessions.length === 0) {
        console.log(chalk.dim("No saved sessions."))
      } else {
        console.log(chalk.dim("\nSaved sessions:"))
        for (const s of sessions) {
          console.log(chalk.dim(`  ${s.dir.padEnd(40)} ${s.messageCount} msgs  ${formatDate(s.savedAt)}`))
        }
        console.log()
      }
      rl.prompt()
      return
    }

    let streamed = false
    try {
      const { text, history: updated } = await runAgent(
        input, config, client, history,
        (token) => { process.stdout.write(token); streamed = true },
        confirmFn
      )
      history = updated
      if (streamed) process.stdout.write("\n")
      else if (text) console.log(chalk.white(text))
      await autosave()
    } catch (e: any) {
      console.error(chalk.red(`Error: ${e.message}`))
    }

    rl.prompt()
  })

  rl.on("close", async () => {
    await autosave()
    console.log(chalk.dim("\nBye."))
    process.exit(0)
  })
}
