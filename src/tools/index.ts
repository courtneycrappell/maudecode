import type { ChatCompletionTool } from "openai/resources/chat/completions.js"
import { readFile, writeFile, editFile } from "./file.js"
import { runBash } from "./bash.js"
import { findFiles, grepFiles } from "./search.js"
import { listDir, openFile } from "./system.js"
import { readCsv } from "./csv.js"
import { fetchUrl } from "./web.js"
import { gitStatus, gitDiff, gitLog } from "./git.js"

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
  {
    schema: {
      type: "function",
      function: {
        name: "list_dir",
        description: "List the contents of a directory (ls -la). Use to explore what's in a folder before reading or searching deeper.",
        parameters: {
          type: "object",
          properties: {
            dir: { type: "string", description: "Directory path to list (default: current directory)" },
          },
          required: [],
        },
      },
    },
    handler: ({ dir }) => listDir(dir),
  },
  {
    schema: {
      type: "function",
      function: {
        name: "open_file",
        description: "Open a file with its default macOS application (e.g. Excel for .xlsx, Preview for .pdf). Use when the user wants to view or open a file.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to open" },
          },
          required: ["path"],
        },
      },
    },
    handler: ({ path }) => openFile(path),
  },
  {
    schema: {
      type: "function",
      function: {
        name: "read_csv",
        description: "Read a CSV file and return column names, row count, and a preview of the first rows. Use for spreadsheet-like data files.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the CSV file" },
            max_rows: { type: "string", description: "Max rows to preview (default: 50)" },
          },
          required: ["path"],
        },
      },
    },
    handler: ({ path, max_rows }) => readCsv(path, max_rows ? parseInt(max_rows, 10) : undefined),
  },
  {
    schema: {
      type: "function",
      function: {
        name: "fetch_url",
        description: "Fetch the text content of a web page or URL. Strips HTML tags. Use for research, looking up documentation, or reading online resources.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "Full URL to fetch (must start with http:// or https://)" },
          },
          required: ["url"],
        },
      },
    },
    handler: ({ url }) => fetchUrl(url),
  },
  {
    schema: {
      type: "function",
      function: {
        name: "git_status",
        description: "Show git working tree status (modified, staged, untracked files).",
        parameters: {
          type: "object",
          properties: {
            dir: { type: "string", description: "Repository directory (default: current directory)" },
          },
          required: [],
        },
      },
    },
    handler: ({ dir }) => gitStatus(dir),
  },
  {
    schema: {
      type: "function",
      function: {
        name: "git_diff",
        description: "Show git diff of uncommitted changes, or diff against a ref (branch, commit, HEAD~1, etc.).",
        parameters: {
          type: "object",
          properties: {
            dir: { type: "string", description: "Repository directory (default: current directory)" },
            ref: { type: "string", description: "Optional ref to diff against (e.g. HEAD~1, main)" },
          },
          required: [],
        },
      },
    },
    handler: ({ dir, ref }) => gitDiff(dir, ref),
  },
  {
    schema: {
      type: "function",
      function: {
        name: "git_log",
        description: "Show recent git commit history (one line per commit).",
        parameters: {
          type: "object",
          properties: {
            dir: { type: "string", description: "Repository directory (default: current directory)" },
            n: { type: "string", description: "Number of commits to show (default: 10)" },
          },
          required: [],
        },
      },
    },
    handler: ({ dir, n }) => gitLog(dir, n ? parseInt(n, 10) : undefined),
  },
]

export function getToolSchemas(): ChatCompletionTool[] {
  return TOOLS.map((t) => t.schema)
}

export function getToolSummaries(): string[] {
  return TOOLS.map((t) => {
    const fn = t.schema.function
    return `  ${fn.name.padEnd(14)} ${fn.description}`
  })
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
