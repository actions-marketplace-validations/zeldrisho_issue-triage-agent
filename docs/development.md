# Development

Use Vite+ and the latest Node.js LTS. Vite+ uses the pinned pnpm package manager.

```bash
vp install            # Install dependencies
vp check              # Check formatting, lint, and types
vp run build          # Compile TypeScript to lib/
vp run bundle         # Bundle for GitHub Action (dist/main.mjs)
vp test               # Run tests
vp test --coverage    # Run tests with coverage
vp run test:watch     # Watch mode
vp run dev            # TypeScript watch mode
```

Tests and reusable fixtures live in `tests/`. Run a single test file with `vp test tests/classifier.test.ts`.

The Oxlint plugins under `tools/oxlint/` are loaded directly as TypeScript by Node. Their relative imports use `.ts` extensions: changing them to `.js` fails because no corresponding JavaScript files exist. Application imports use `.js` for the compiled ESM output.

The Action runs the generated, tracked `dist/` bundle. After changing runtime source, regenerate it with `vp run bundle`; `vp run build` only emits to `lib/`. Vite+ Pack bundles runtime dependencies and generates `dist/licenses.txt`.

See the [user guide](../README.md) for configuration and usage.

## Architecture

The GitHub Action entry point routes issue events to the triage pipeline and comment events to a separate follow-up handler.

```text
issues event
  → loadConfig()    — Fetch repository configuration via GitHub API
  → shouldExclude() — Check exclude rules
  → sanitize        — Prepare the issue title and body for prompts
  → classify        — LLM classifies the issue (category + priority)
  → label           — Map classification to repository labels via GitHub API
  → duplicate       — Search similar issues; LLM checks candidates
  → reply           — Draft and post a contextual comment via LLM

issue_comment event
  → handleComment() — Process eligible follow-up comments
```

Enabled features determine which pipeline steps run. Provider implementations sit behind `LLMProvider` in `src/llm/provider.ts`; `src/llm/factory.ts` selects the provider.

### Design decisions

- **Stateless:** no database; configuration is read from the repository.
- **Error-resilient:** pipeline steps isolate their errors, so a classification failure does not block the reply. Configuration loading must succeed before the pipeline can run.
- **Security-first:** input sanitization handles zero-width characters, control characters, and length limits; prompts mark issue and comment content as untrusted data.
