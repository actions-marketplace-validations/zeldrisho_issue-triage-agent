# Agent Instructions

## Toolchain

- Use npm with `package-lock.json`; install dependencies with `npm ci`.
- Match CI's Node.js 20 or 22; Node.js 20 must be at least 20.18.1.

## Commands

| Task | Command |
| --- | --- |
| Test one file | `npm test -- test/classifier.test.ts` |
| Test one case | `npm test -- test/classifier.test.ts -t 'parses valid JSON response'` |
| Typecheck source | `npx tsc --noEmit` |
| Test with coverage (CI) | `npm test -- --coverage` |
| Compile to `lib/` (CI) | `npm run build` |
| Bundle Action to `dist/` | `npm run bundle` |

## Rules

- Use Conventional Commits.
- Use `.js` extensions in relative TypeScript imports, matching the existing ESM code.
- Put tests in `test/*.test.ts`; reusable event payloads belong in `test/fixtures/`.
- Keep LLM integrations behind `LLMProvider` in `src/llm/provider.ts` and provider selection in `src/llm/factory.ts`.
- Preserve per-step error isolation in `src/pipeline.ts`; one failed step must not block later steps.
- Preserve input sanitization and prompt boundaries that treat issue/comment content as untrusted data.
- Treat `dist/` as generated, tracked Action runtime files; regenerate the bundle with `npm run bundle`, not manual edits.
- Source changes intended for the published Action need a refreshed `dist/` bundle; `npm run build` only emits to `lib/`.
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
