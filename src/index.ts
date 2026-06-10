#!/usr/bin/env node
import { program } from "commander"
import chalk from "chalk"
import { loadConfig } from "./config.js"
import { createClient, healthCheck } from "./llm.js"
import { runAgent } from "./agent.js"
import { startRepl } from "./repl.js"
import { loadSession } from "./sessions.js"

program
  .name("maude")
  .description("Local-first coding assistant powered by Ollama")
  .option("-m, --model <model>", "Ollama model to use")
  .option("-c, --continue", "Resume last saved session for this directory")
  .argument("[prompt]", "One-shot prompt (omit to start REPL)")
  .action(async (prompt: string | undefined, opts: { model?: string; continue?: boolean }) => {
    const config = {
      ...loadConfig(),
      ...(opts.model ? { model: opts.model } : {}),
    }

    const client = createClient(config.baseURL)
    const ok = await healthCheck(client)

    if (!ok) {
      console.error(chalk.red("Ollama is not running. Start it with: ollama serve"))
      process.exit(1)
    }

    if (prompt) {
      let streamed = false
      const { text } = await runAgent(prompt, config, client, undefined, {
        onToken: (token) => { process.stdout.write(token); streamed = true },
      })
      if (streamed) process.stdout.write("\n")
      else console.log(text)
    } else {
      let initialHistory
      if (opts.continue) {
        const saved = await loadSession(process.cwd())
        if (saved && saved.history.length > 1) {
          initialHistory = saved.history
          const msgCount = saved.history.length - 1
          console.log(chalk.dim(`Resuming session: ${msgCount} messages from ${new Date(saved.savedAt).toLocaleString()}`))
        } else {
          console.log(chalk.dim("No saved session found for this directory."))
        }
      }
      await startRepl(config, client, initialHistory)
    }
  })

program.parse()
