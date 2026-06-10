import { spawn } from "child_process"

export async function runBash(command: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", command], { stdio: ["ignore", "pipe", "pipe"] })

    let stdout = ""
    let stderr = ""
    let timedOut = false

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      process.stdout.write(text)   // stream live
    })

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, timeoutMs)

    child.on("close", (code) => {
      clearTimeout(timer)
      resolve(
        `stdout:\n${stdout}` +
        `stderr:\n${stderr}` +
        `exit: ${timedOut ? 124 : (code ?? 0)}`
      )
    })
  })
}
