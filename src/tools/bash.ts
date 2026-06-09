import { exec } from "child_process"

export async function runBash(command: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve) => {
    const child = exec(command, { timeout: timeoutMs }, (err, stdout, stderr) => {
      const exitCode = err?.code ?? (err ? 1 : 0)
      const timedOut = (err as any)?.killed === true || exitCode === null

      resolve(
        `stdout:\n${stdout}` +
        `stderr:\n${stderr}` +
        `exit: ${timedOut ? 124 : exitCode}`
      )
    })

    // Belt-and-suspenders kill on timeout
    setTimeout(() => {
      child.kill("SIGTERM")
    }, timeoutMs)
  })
}
