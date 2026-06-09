import fs from "fs"
import path from "path"
import os from "os"

export interface MaudeConfig {
  model: string
  baseURL: string
  maxRounds: number
  debug: boolean
}

const DEFAULTS: MaudeConfig = {
  model: "qwen2.5-coder:7b",
  baseURL: "http://localhost:11434/v1",
  maxRounds: 10,
  debug: false,
}

export function loadConfig(): MaudeConfig {
  const configPath = path.join(os.homedir(), ".maude", "config.json")
  let fileConfig: Partial<MaudeConfig> = {}

  try {
    const raw = fs.readFileSync(configPath, "utf8")
    fileConfig = JSON.parse(raw)
  } catch {
    // no config file — use defaults
  }

  return {
    ...DEFAULTS,
    ...fileConfig,
    debug: process.env.MAUDE_DEBUG === "1" || fileConfig.debug === true,
  }
}
