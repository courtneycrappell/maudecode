import { runBash } from "./bash.js"
import { expandHome } from "../utils.js"

export async function gitStatus(dir = "."): Promise<string> {
  return runBash(`git -C "${expandHome(dir)}" status --short 2>&1`)
}

export async function gitDiff(dir = ".", ref = ""): Promise<string> {
  const refArg = ref ? ` ${ref}` : ""
  return runBash(`git -C "${expandHome(dir)}" diff${refArg} 2>&1`, 15_000)
}

export async function gitLog(dir = ".", n = 10): Promise<string> {
  return runBash(`git -C "${expandHome(dir)}" log --oneline -${n} 2>&1`)
}

export async function gitAdd(dir = ".", paths = "."): Promise<string> {
  const pathList = paths.split(",").map(p => `"${p.trim()}"`).join(" ")
  return runBash(`git -C "${expandHome(dir)}" add ${pathList} 2>&1`)
}

export async function gitCommit(dir = ".", message: string): Promise<string> {
  if (!message?.trim()) return "Error: commit message is required"
  return runBash(`git -C "${expandHome(dir)}" commit -m ${JSON.stringify(message)} 2>&1`)
}

export async function gitPush(dir = ".", remote = "origin", branch = ""): Promise<string> {
  const branchArg = branch ? ` ${branch}` : ""
  return runBash(`git -C "${expandHome(dir)}" push ${remote}${branchArg} 2>&1`, 30_000)
}
