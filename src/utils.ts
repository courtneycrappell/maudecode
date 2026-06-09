import os from "os"

export function expandHome(filePath: string): string {
  if (!filePath) return filePath
  if (filePath === "~") return os.homedir()
  if (filePath.startsWith("~/")) return os.homedir() + filePath.slice(1)
  return filePath
}
