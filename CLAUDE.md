# Maude Node

A local-first alternative to Claude Code. Runs entirely on-device using a locally-running LLM via Ollama — no Anthropic API calls required.

## Session context (started 2026-06-09)

This project was designed in a prior Claude Code session. The plan was drafted and is ready to implement.

## What we're building

A Node.js/TypeScript CLI called `maude` that behaves like Claude Code but uses a local LLM (Ollama) instead of the Anthropic API.

**Core features:**
- Interactive REPL (`maude> ` prompt)
- File read / write / edit tools
- Bash/shell execution tool
- Agentic tool-use loop (LLM calls tools, loops until done)

## Architecture

```
maude-node/
├── src/
│   ├── index.ts          # CLI entry point (commander)
│   ├── repl.ts           # Interactive REPL loop
│   ├── agent.ts          # Agent loop: tool dispatch + conversation history
│   ├── llm.ts            # Ollama client (OpenAI-compatible endpoint)
│   ├── config.ts         # Model selection, defaults, ~/.maude/config.json
│   └── tools/
│       ├── index.ts      # Tool registry + JSON schema definitions
│       ├── file.ts       # readFile, writeFile, editFile
│       ├── bash.ts       # runBash (with timeout + safety prompt)
│       └── search.ts     # grepFiles, findFiles
├── package.json
├── tsconfig.json
└── CLAUDE.md             # this file
```

## Key tech decisions

| Concern | Choice | Reason |
|---|---|---|
| Local LLM backend | **Ollama** | Most popular on Mac, easy install, OpenAI-compatible API |
| LLM client | **`openai` npm package** → `localhost:11434/v1` | Reuse tool-calling SDK; Ollama mirrors OpenAI's API |
| CLI framework | **`commander`** | Lightweight, standard |
| Terminal UX | **`chalk`** + **`ora`** | Colors + spinners |
| REPL | **Node `readline`** (built-in) | No extra deps |
| Runtime | **`tsx`** for dev, `esbuild` for prod bundle | Skip compile step in dev |

## Recommended Ollama models (tool-use capable)

- `llama3.1` (general purpose, solid tool use)
- `qwen2.5-coder:7b` (best for coding tasks)

Pull one before starting: `ollama pull qwen2.5-coder:7b`

## Agent loop logic (`src/agent.ts`)

```
while true:
  call LLM with messages + tools
  if response has tool_calls:
    for each tool call:
      execute tool, append result to messages
    loop (max 10 rounds)
  else:
    yield text to user, break
```

## Tools to implement

| Name | Description |
|---|---|
| `read_file` | Read file at path |
| `write_file` | Write/create file |
| `edit_file` | String replace within file (old→new) |
| `run_bash` | Execute shell command, capture stdout/stderr |
| `find_files` | `find` with pattern |
| `grep_files` | `grep -r` with pattern |

## CLI usage (target)

```bash
maude                          # launch interactive REPL
maude "do X"                   # one-shot prompt
maude --model qwen2.5-coder "review this file"
```

## Prerequisites

- Ollama installed: `brew install ollama`
- Model pulled: `ollama pull qwen2.5-coder:7b`
- Node.js 18+

## Status

- [ ] Scaffold project (package.json, tsconfig.json)
- [ ] `src/llm.ts` — Ollama client
- [ ] `src/tools/` — all 6 tools
- [ ] `src/agent.ts` — agent loop
- [ ] `src/repl.ts` — interactive REPL
- [ ] `src/index.ts` — CLI entry point
- [ ] End-to-end test: read a file, edit a file, run bash
