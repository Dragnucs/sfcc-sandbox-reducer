# Agent Instructions

## Project Overview

This is a CLI tool for reducing SFCC (Salesforce Commerce Cloud) catalog, inventory, and pricebook files for sandbox optimization. It uses streaming XML parsing to handle large files efficiently.

## Code Principles

### DRY (Don't Repeat Yourself)

- Extract shared logic into `lib/` utilities
- Reuse XML parsing functions from `lib/parser.js`
- Shared constants and helpers should be defined once

### KISS (Keep It Simple, Stupid)

- Prefer simple, readable code over clever solutions
- Each function should do one thing well
- Avoid unnecessary abstractions
- Use clear, descriptive variable and function names

### YAGNI (You Aren't Gonna Need It)

- Don't add features "just in case"
- Implement only what's needed for the current requirement
- Remove unused code rather than commenting it out

### LoB (Locality of Behavior)

- Keep related code close together
- Command-specific logic stays in its command file
- Avoid spreading a single behavior across multiple files
- Prefer inline handlers over distant callbacks when reasonable

### Functional Style

- Prefer pure functions without side effects
- Use `map`, `filter`, `reduce` over imperative loops
- Avoid mutating function arguments
- Return new objects/arrays instead of modifying existing ones
- Keep I/O (file operations, console output) at the edges

## Project Structure

```
├── index.js           # CLI entry point
├── commands/          # Command handlers (one file per command)
│   ├── reduce.js
│   └── download-images.js
└── lib/               # Shared utilities
    ├── cache.js       # File-based caching
    ├── config.js      # Configuration loading
    ├── parser.js      # Streaming XML parsing
    ├── reducer.js     # Main reducer orchestration
    └── writer.js      # Streaming XML writing
```

## Coding Guidelines

- Use ESM (`import`/`export`) - project uses `"type": "module"`
- Use `const` by default, `let` only when reassignment is needed
- Handle errors with try/catch and provide helpful messages
- Use descriptive console output with prefixes: `[OK]`, `[PHASE]`, `[ERROR]`
- Use `yargs` for CLI argument parsing

## XML Processing

- Use streaming SAX parser for memory efficiency
- Handle files up to 500MB+ without loading into memory
- Use high water mark (256KB chunks) for optimal I/O
- Escape XML special characters properly

## Before Finishing

Always run the linter before committing or finishing work:

```bash
npm run check
```

Ensure there are no errors. Use `npm run check:write` to auto-fix issues when possible.
