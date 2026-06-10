interface UndoEntry {
  path: string
  content: string | null  // null = file was newly created (undo = delete)
}

const stack: UndoEntry[] = []
const MAX = 20

export function pushUndo(path: string, content: string | null): void {
  stack.push({ path, content })
  if (stack.length > MAX) stack.shift()
}

export function popUndo(): UndoEntry | undefined {
  return stack.pop()
}

export function peekUndo(): UndoEntry | undefined {
  return stack[stack.length - 1]
}

export function clearUndo(): void {
  stack.length = 0
}
