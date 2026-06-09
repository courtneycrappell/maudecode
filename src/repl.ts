import readline from "readline"
import chalk from "chalk"
import type OpenAI from "openai"
import { runAgent } from "./agent.js"
import type { MaudeConfig } from "./config.js"

const HELP = `
Commands:
  .help   Show this message
  .exit   Exit maude
  .quit   Exit maude

Just type your request and press Enter.
`

export async function startRepl(config: MaudeConfig, client: OpenAI): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green("maude> "),
  })

  console.log(chalk.dim(`maude v0.1.0 · model: ${config.model} · .help for commands`))

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

    process.stdout.write(chalk.dim("thinking…\n"))

    try {
      const result = await runAgent(input, config, client)
      console.log(chalk.white(result))
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
