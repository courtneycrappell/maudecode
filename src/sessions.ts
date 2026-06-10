import fs from "fs/promises"
import path from "path"
import os from "os"
import crypto from "crypto"
import type { ConversationHistory } from "./agent.js"

const SESSIONS_DIR = path.join(os.homedir(), ".maude", "sessions")

interface SessionFile {
  dir: string
  savedAt: string
  history: ConversationHistory
}

function sessionPath(dir: string): string {
  const hash = crypto.createHash("md5").update(dir).digest("hex").slice(0, 8)
  const safeName = dir.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40)
  return path.join(SESSIONS_DIR, `${safeName}_${hash}.json`)
}

export async function saveSession(dir: string, history: ConversationHistory): Promise<void> {
  if (history.length <= 1) return // nothing beyond system message
  await fs.mkdir(SESSIONS_DIR, { recursive: true })
  const file: SessionFile = { dir, savedAt: new Date().toISOString(), history }
  await fs.writeFile(sessionPath(dir), JSON.stringify(file, null, 2), "utf8")
}

export async function loadSession(dir: string): Promise<{ history: ConversationHistory; savedAt: string } | null> {
  try {
    const raw = await fs.readFile(sessionPath(dir), "utf8")
    const file: SessionFile = JSON.parse(raw)
    return { history: file.history, savedAt: file.savedAt }
  } catch {
    return null
  }
}

export async function deleteSession(dir: string): Promise<void> {
  try { await fs.unlink(sessionPath(dir)) } catch { /* no session */ }
}

export async function listSessions(): Promise<Array<{ dir: string; savedAt: string; messageCount: number }>> {
  try {
    const files = await fs.readdir(SESSIONS_DIR)
    const results = []
    for (const f of files) {
      if (!f.endsWith(".json")) continue
      try {
        const raw = await fs.readFile(path.join(SESSIONS_DIR, f), "utf8")
        const data: SessionFile = JSON.parse(raw)
        results.push({ dir: data.dir, savedAt: data.savedAt, messageCount: data.history.length - 1 })
      } catch { /* skip */ }
    }
    return results.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  } catch {
    return []
  }
}
