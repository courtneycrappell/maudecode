import fs from "fs/promises"
import path from "path"
import readline from "readline"
import { execSync } from "child_process"
import chalk from "chalk"
import type OpenAI from "openai"
import { runAgent } from "./agent.js"
import type { MaudeConfig } from "./config.js"

async function safeRead(filePath: string, maxChars = 3000): Promise<string | null> {
  try {
    const s = await fs.readFile(filePath, "utf8")
    return s.length > maxChars ? s.slice(0, maxChars) + "\n[truncated]" : s
  } catch {
    return null
  }
}

async function gatherProjectInfo(cwd: string): Promise<string> {
  const parts: string[] = []

  // Root file listing
  try {
    const ls = execSync(`ls -1 "${cwd}" 2>/dev/null`, { encoding: "utf8" }).trim()
    parts.push(`Root files:\n${ls}`)
  } catch {}

  // Key config files
  for (const name of ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "Makefile", "composer.json"]) {
    const c = await safeRead(path.join(cwd, name))
    if (c) parts.push(`${name}:\n${c}`)
  }

  // README
  for (const name of ["README.md", "README.txt", "README"]) {
    const c = await safeRead(path.join(cwd, name), 1500)
    if (c) { parts.push(`${name}:\n${c}`); break }
  }

  // Git log
  try {
    const log = execSync(`git -C "${cwd}" log --oneline -10 2>/dev/null`, { encoding: "utf8" }).trim()
    if (log) parts.push(`Recent commits:\n${log}`)
  } catch {}

  // Source directory structure (one level deep)
  for (const srcDir of ["src", "lib", "app", "pkg"]) {
    try {
      const tree = execSync(`ls -1 "${path.join(cwd, srcDir)}" 2>/dev/null`, { encoding: "utf8" }).trim()
      if (tree) { parts.push(`${srcDir}/:\n${tree}`); break }
    } catch {}
  }

  return parts.join("\n\n---\n\n")
}

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(prompt, ans => { rl.close(); resolve(ans) }))
}

export async function runInit(cwd: string, config: MaudeConfig, client: OpenAI): Promise<void> {
  const claudeMdPath = path.join(cwd, "CLAUDE.md")

  let exists = false
  try { await fs.access(claudeMdPath); exists = true } catch {}

  if (exists) {
    const ans = await ask(chalk.yellow("CLAUDE.md already exists. Overwrite? [y/N] "))
    if (ans.trim().toLowerCase() !== "y") { console.log(chalk.dim("Aborted.")); return }
  }

  console.log(chalk.dim("Analyzing project…"))
  const info = await gatherProjectInfo(cwd)

  const initPrompt = `Analyze this project and write a CLAUDE.md file.

CLAUDE.md is automatically read by an AI coding assistant before each session. It should contain project-specific context that helps the assistant be immediately useful.

Write a CLAUDE.md with these sections (only if relevant):
1. One-line project description
2. How to run/build/test (exact commands)
3. Key source files and what they do
4. Architecture or design decisions worth knowing
5. Gotchas, quirks, things to watch out for

Rules:
- Under 60 lines total
- Use markdown headers (##) and bullets
- Be specific — no generic advice
- Omit sections that don't apply

Project information:
${info}

Reply with ONLY the CLAUDE.md content. No preamble, no explanation.`

  process.stdout.write(chalk.dim("Generating CLAUDE.md…\n"))
  const { text } = await runAgent(initPrompt, config, client, undefined, {
    onToken: (t) => process.stdout.write(t),
  })
  process.stdout.write("\n")

  await fs.writeFile(claudeMdPath, text.trim() + "\n", "utf8")
  console.log(chalk.green(`✓ Wrote CLAUDE.md → ${claudeMdPath}`))
}
