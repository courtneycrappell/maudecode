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
