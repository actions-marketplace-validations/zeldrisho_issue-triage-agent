# Agent Instructions

## Toolchain

- Use Vite+ with `pnpm-lock.yaml`; install dependencies with `vp install`.
- Use `fd` to find files.

## Commands

| Task | Command |
| --- | --- |
| Test one file | `vp test tests/classifier.test.ts` |
| Test one case | `vp test tests/classifier.test.ts -t 'parses valid JSON response'` |
| Typecheck source | `vp exec tsc --noEmit` |
| Test with coverage (CI) | `vp test --coverage` |
| Compile to `lib/` (CI) | `vp run build` |
| Bundle Action to `dist/` | `vp run bundle` |

## Rules

- Use Conventional Commits.
- Use `.js` extensions in relative TypeScript imports, except `tools/oxlint/` plugins, which Node loads directly from `.ts` files.
- Put tests in `tests/*.test.ts`; reusable event payloads belong in `tests/fixtures/`.
- Keep LLM integrations behind `LLMProvider` in `src/llm/provider.ts` and provider selection in `src/llm/factory.ts`.
- Preserve per-step error isolation in `src/pipeline.ts`; one failed step must not block later steps.
- Preserve input sanitization and prompt boundaries that treat issue/comment content as untrusted data.
- Treat `dist/` as generated, tracked Action runtime files; regenerate the bundle with `vp run bundle`, not manual edits.
- Source changes intended for the published Action need a refreshed `dist/` bundle; `vp run build` only emits to `lib/`.
- Keep Action input/output changes aligned across `action.yml`, `src/main.ts`, and `README.md`.
- Use a GitHub-supported explicit Node runtime in `action.yml`; CI's LTS version does not control it.
- Record only user-facing changes in `CHANGELOG.md` under Unreleased.
- After publishing a release, update README usage pins to the released commit's full SHA in a follow-up commit; never amend the release commit to include its own hash (see `docs/releasing.md`).
- Before implementing GitHub Actions changes, research current guidance using `site:docs.github.com/actions` and verify the relevant official documentation.
- Keep configuration changes aligned across `src/config/schema.ts`, `src/config/loader.ts`, and `README.md`.

## References

| Need | File |
| --- | --- |
| Setup and development | `docs/development.md` |
| Architecture | `docs/development.md#architecture` |
| Configuration contract | `README.md#configuration`, `src/config/schema.ts` |
| Action interface and runtime | `action.yml` |
| CI checks | `.github/workflows/ci.yml` |
| Release process | `docs/releasing.md` |
| Input sanitization and prompt safety | `src/sanitizer.ts`, `src/prompts/` |
