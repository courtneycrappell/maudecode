import readline from "readline"
import chalk from "chalk"
import type OpenAI from "openai"
import { runAgent, type ConversationHistory, buildSystemPrompt } from "./agent.js"
import { getToolSummaries } from "./tools/index.js"
import type { MaudeConfig } from "./config.js"

function buildHelp(model: string) {
  return `
Commands:
  .help            Show this message
  .tools           List all available tools
  .model           Show current model
  .model <name>    Switch model (e.g. .model qwen2.5:7b)
  .clear           Reset conversation history
  .history         Show number of messages in current session
  .exit            Exit maude
  .quit            Exit maude

Model tips:
  qwen2.5:7b           Best for writing, email, general tasks
  qwen2.5-coder:14b    Best for coding and file work (current: ${model})

Just type your request and press Enter.
`
}

export async function startRepl(config: MaudeConfig, client: OpenAI): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green("maude> "),
  })

  let currentModel = config.model
  console.log(chalk.dim(`maude v0.1.0 · model: ${currentModel} · .help for commands`))

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
        history = [{ role: "system", content: buildSystemPrompt() }]
        console.log(chalk.dim(`Switched to ${currentModel}. History cleared.`))
      }
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

    let streamed = false
    try {
      const { text, history: updated } = await runAgent(
        input, config, client, history,
        (token) => { process.stdout.write(token); streamed = true }
      )
      history = updated
      if (streamed) process.stdout.write("\n")
      else if (text) console.log(chalk.white(text))
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
