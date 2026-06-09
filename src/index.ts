#!/usr/bin/env node
import { program } from "commander"
import chalk from "chalk"
import { loadConfig } from "./config.js"
import { createClient, healthCheck } from "./llm.js"
import { runAgent } from "./agent.js"
import { startRepl } from "./repl.js"

program
  .name("maude")
  .description("Local-first coding assistant powered by Ollama")
  .option("-m, --model <model>", "Ollama model to use")
  .argument("[prompt]", "One-shot prompt (omit to start REPL)")
  .action(async (prompt: string | undefined, opts: { model?: string }) => {
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
      const result = await runAgent(prompt, config, client)
      console.log(result)
    } else {
      await startRepl(config, client)
    }
  })

program.parse()
