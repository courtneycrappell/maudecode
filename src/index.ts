#!/usr/bin/env node
import fs from "fs/promises"
import { program } from "commander"
import chalk from "chalk"
import { loadConfig } from "./config.js"
import { createClient, healthCheck } from "./llm.js"
import { runAgent } from "./agent.js"
import { startRepl } from "./repl.js"
import { loadSession } from "./sessions.js"
import { expandHome } from "./utils.js"
import { runInit } from "./init.js"
import { expandAtMentions } from "./at-expand.js"

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    process.stdin.on("data", c => chunks.push(c))
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").trim()))
  })
}

async function preloadFiles(paths: string[]): Promise<string> {
  const parts: string[] = []
  for (const f of paths) {
    try {
      const raw = await fs.readFile(expandHome(f), "utf8")
      const numbered = raw.split("\n").map((l, i) => `${String(i + 1).padStart(4, " ")}  ${l}`).join("\n")
      parts.push(`<file path="${f}">\n${numbered}\n</file>`)
    } catch (e: any) {
      process.stderr.write(chalk.yellow(`Warning: could not read ${f}: ${e.message}\n`))
    }
  }
  return parts.join("\n\n")
}

program
  .name("maude")
  .description("Local-first coding assistant powered by Ollama")
  .option("-m, --model <model>", "Ollama model to use")
  .option("-c, --continue", "Resume last saved session for this directory")
  .option("-f, --files <files>", "Comma-separated files to preload: -f src/a.ts,src/b.ts")
  .argument("[prompt]", "One-shot prompt (omit to start REPL)")
  .action(async (prompt: string | undefined, opts: { model?: string; continue?: boolean; files?: string }) => {
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

    // Read piped stdin
    let stdinContent = ""
    if (!process.stdin.isTTY) stdinContent = await readStdin()

    // Preload files into context prefix
    let fileContext = ""
    if (opts.files) {
      const fileList = opts.files.split(",").map(f => f.trim()).filter(Boolean)
      fileContext = await preloadFiles(fileList)
      if (fileContext) console.log(chalk.dim(`Preloaded: ${fileList.join(", ")}`))
    }

    // Combine stdin + file context + prompt
    const parts = [fileContext, stdinContent, prompt].filter(Boolean)
    const effectivePrompt = parts.join("\n\n") || undefined

    if (effectivePrompt) {
      // One-shot mode (also covers piped input)
      const { text: expanded } = await expandAtMentions(effectivePrompt)
      let streamed = false
      const { text } = await runAgent(expanded, config, client, undefined, {
        onToken: (t) => { process.stdout.write(t); streamed = true },
      })
      if (streamed) process.stdout.write("\n")
      else console.log(text)
    } else {
      // REPL mode
      let initialHistory
      if (opts.continue) {
        const saved = await loadSession(process.cwd())
        if (saved && saved.history.length > 1) {
          initialHistory = saved.history
          console.log(chalk.dim(`Resuming: ${saved.history.length - 1} messages from ${new Date(saved.savedAt).toLocaleString()}`))
        } else {
          console.log(chalk.dim("No saved session for this directory."))
        }
      }
      await startRepl(config, client, initialHistory)
    }
  })

program
  .command("init")
  .description("Analyze this project and generate CLAUDE.md")
  .action(async () => {
    const config = loadConfig()
    const client = createClient(config.baseURL)
    const ok = await healthCheck(client)
    if (!ok) {
      console.error(chalk.red("Ollama is not running. Start it with: ollama serve"))
      process.exit(1)
    }
    await runInit(process.cwd(), config, client)
  })

program.parse()
