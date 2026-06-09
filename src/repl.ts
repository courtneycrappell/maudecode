import readline from "readline"
import chalk from "chalk"
import type OpenAI from "openai"
import { runAgent, type ConversationHistory } from "./agent.js"
import { buildSystemPrompt } from "./agent.js"
import type { MaudeConfig } from "./config.js"

const HELP = `
Commands:
  .help     Show this message
  .clear    Reset conversation history
  .history  Show number of messages in current session
  .exit     Exit maude
  .quit     Exit maude

Just type your request and press Enter.
`

export async function startRepl(config: MaudeConfig, client: OpenAI): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green("maude> "),
  })

  console.log(chalk.dim(`maude v0.1.0 · model: ${config.model} · .help for commands`))

  let history: ConversationHistory = [{ role: "system", content: buildSystemPrompt() }]

  rl.prompt()

  rl.on("line", async (line) => {
    const input = line.trim()

    if (!input) {
      rl.prompt()
      return
    }

    if (input === ".exit" || input === ".quit") {
      rl.close()
      return
    }

    if (input === ".help") {
      console.log(HELP)
      rl.prompt()
      return
    }

    if (input === ".clear") {
      history = [{ role: "system", content: buildSystemPrompt() }]
      console.log(chalk.dim("Conversation history cleared."))
      rl.prompt()
      return
    }

    if (input === ".history") {
      const turns = history.length - 1 // exclude system message
      console.log(chalk.dim(`Session: ${turns} message${turns !== 1 ? "s" : ""} in history.`))
      rl.prompt()
      return
    }

    process.stdout.write(chalk.dim("thinking…\n"))

    try {
      const { text, history: updated } = await runAgent(input, config, client, history)
      history = updated
      console.log(chalk.white(text))
    } catch (e: any) {
      console.error(chalk.red(`Error: ${e.message}`))
    }

    rl.prompt()
  })

  rl.on("close", () => {
    console.log(chalk.dim("\nBye."))
    process.exit(0)
  })
}
