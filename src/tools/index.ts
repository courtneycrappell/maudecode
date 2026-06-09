import type { ChatCompletionTool } from "openai/resources/chat/completions.js"
import { readFile, writeFile, editFile } from "./file.js"
import { runBash } from "./bash.js"
import { findFiles, grepFiles } from "./search.js"

interface ToolEntry {
  schema: ChatCompletionTool
  handler: (args: Record<string, string>) => Promise<string>
}

const TOOLS: ToolEntry[] = [
  {
    schema: {
      type: "function",
      function: {
        name: "read_file",
        description: "Read the contents of a file at the given path.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to read" },
          },
          required: ["path"],
        },
      },
    },
    handler: ({ path }) => readFile(path),
  },
  {
    schema: {
      type: "function",
      function: {
        name: "write_file",
        description: "Write or create a file with the given content.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to write" },
            content: { type: "string", description: "Content to write" },
          },
          required: ["path", "content"],
        },
      },
    },
    handler: ({ path, content }) => writeFile(path, content),
  },
  {
    schema: {
      type: "function",
      function: {
        name: "edit_file",
        description: "Replace the first occurrence of old_str with new_str in a file.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to edit" },
            old_str: { type: "string", description: "Exact string to replace" },
            new_str: { type: "string", description: "Replacement string" },
          },
          required: ["path", "old_str", "new_str"],
        },
      },
    },
    handler: ({ path, old_str, new_str }) => editFile(path, old_str, new_str),
  },
  {
    schema: {
      type: "function",
      function: {
        name: "run_bash",
        description: "Execute a shell command and return stdout, stderr, and exit code.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "Shell command to run" },
          },
          required: ["command"],
        },
      },
    },
    handler: ({ command }) => runBash(command),
  },
  {
    schema: {
      type: "function",
      function: {
        name: "find_files",
        description: "Locate files by filename or extension. Use this when the user wants to find a file by name or type (e.g. '*.xlsx', 'resume*'). Search ~ or ~/Documents when looking for user files. Do NOT use this to search file contents.",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Filename pattern (e.g. *.xlsx, report*.pdf, marcus*)" },
            dir: { type: "string", description: "Directory to search (use ~ or ~/Documents for user files; default: .)" },
          },
          required: ["pattern"],
        },
      },
    },
    handler: ({ pattern, dir }) => findFiles(pattern, dir),
  },
  {
    schema: {
      type: "function",
      function: {
        name: "grep_files",
        description: "Search inside file contents for a text pattern. Use this only when you need to find text within files, not to locate files by name.",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Text pattern to search for inside files" },
            dir: { type: "string", description: "Directory to search (default: .)" },
            flags: { type: "string", description: "grep flags (default: -r)" },
          },
          required: ["pattern"],
        },
      },
    },
    handler: ({ pattern, dir, flags }) => grepFiles(pattern, dir, flags),
  },
]

export function getToolSchemas(): ChatCompletionTool[] {
  return TOOLS.map((t) => t.schema)
}

export async function dispatchTool(name: string, args: Record<string, string>): Promise<string> {
  const tool = TOOLS.find((t) => t.schema.function.name === name)
  if (!tool) return `Unknown tool: ${name}`
  try {
    return await tool.handler(args)
  } catch (e: any) {
    return `Tool error: ${e.message}`
  }
}
