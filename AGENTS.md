# Agent Instructions

## Toolchain

- Use Vite+ with `pnpm-lock.yaml`; install dependencies with `vp install`.
- Use `fd` to find files.

## Commands

| Task | Command |
| --- | --- |
| Test one file | `vp test test/classifier.test.ts` |
| Test one case | `vp test test/classifier.test.ts -t 'parses valid JSON response'` |
| Typecheck source | `vp exec tsc --noEmit` |
| Test with coverage (CI) | `vp test --coverage` |
| Compile to `lib/` (CI) | `vp run build` |
| Bundle Action to `dist/` | `vp run bundle` |

## Rules

- Use Conventional Commits.
- Use `.js` extensions in relative TypeScript imports, matching the existing ESM code.
- Put tests in `test/*.test.ts`; reusable event payloads belong in `test/fixtures/`.
- Keep LLM integrations behind `LLMProvider` in `src/llm/provider.ts` and provider selection in `src/llm/factory.ts`.
- Preserve per-step error isolation in `src/pipeline.ts`; one failed step must not block later steps.
- Preserve input sanitization and prompt boundaries that treat issue/comment content as untrusted data.
- Treat `dist/` as generated, tracked Action runtime files; regenerate the bundle with `vp run bundle`, not manual edits.
- Source changes intended for the published Action need a refreshed `dist/` bundle; `vp run build` only emits to `lib/`.
- Keep Action input/output changes aligned across `action.yml`, `src/main.ts`, and `README.md`.
- Keep configuration changes aligned across `src/config/schema.ts`, `src/config/loader.ts`, and `README.md`.

## References

| Need | File |
| --- | --- |
| Setup and development | `README.md#development` |
| Architecture | `README.md#architecture` |
| Configuration contract | `README.md#configuration`, `src/config/schema.ts` |
| Action interface and runtime | `action.yml` |
| CI checks | `.github/workflows/ci.yml` |
| Input sanitization and prompt safety | `src/sanitizer.ts`, `src/prompts/` |
