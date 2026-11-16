# Anti-slop provenance

Source: https://github.com/dmmulroy/anti-slop, installed from the `install-anti-slop` skill bundle via `vp dlx skills use dmmulroy/anti-slop --skill install-anti-slop`.

The source commit is unknown: the downloaded skill bundle did not identify a verifiable revision. The copied snapshot is installed under `tools/oxlint/anti-slop/`, including the generic and Effect plugins. Imports of `@oxlint/plugins` were replaced with Vite+'s `vite-plus/lint/plugins` exports to use the existing toolchain without a separate dependency. Only the generic plugin is enabled. The nested Stylistic vendor directory records its own provenance and license.
