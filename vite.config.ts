import { defineConfig } from "vite-plus";
import { licensePlugin } from "rolldown-license-plugin";

const agentAndVendorIgnores = [
  ".agent/**",
  ".agents/**",
  ".claude/**",
  ".codex/**",
  ".continue/**",
  ".cursor/**",
  ".gemini/**",
  ".opencode/**",
  ".pi/**",
  ".roo/**",
  ".windsurf/**",
  "tools/oxlint/anti-slop/**",
];

export default defineConfig({
  pack: {
    entry: ["src/main.ts"],
    format: "esm",
    platform: "node",
    target: "node24",
    deps: { alwaysBundle: [/.*/] },
    shims: true,
    sourcemap: true,
    dts: false,
    plugins: [
      licensePlugin({
        done(dependencies, context) {
          context.emitFile({
            type: "asset",
            fileName: "licenses.txt",
            source: dependencies
              .map(({ name, version, license, licenseText }) =>
                `${name}@${version} - ${license}\n${licenseText ?? ""}`.trim(),
              )
              .sort()
              .join("\n\n"),
          });
        },
      }),
    ],
  },
  staged: { "*": "vp check" },
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
    },
  },
  fmt: { ignorePatterns: ["dist/**", "AGENTS.md", ...agentAndVendorIgnores] },
  lint: {
    ignorePatterns: ["dist/**", ...agentAndVendorIgnores],
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "oxc/no-accumulating-spread": "error",
      "anti-slop/no-array-filter-map": "error",
      "anti-slop/no-reduce-accumulator-copy": "error",
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-conditional-empty-object-spread": "error",
      "anti-slop/no-known-value-widening": "error",
      "anti-slop/no-module-mocking": "error",
      "anti-slop/no-object-parameters": "error",
      "anti-slop/no-reflect-apply": "error",
      "anti-slop/no-reflect-get": "error",
      "anti-slop/no-runtime-typeof": "error",
      "anti-slop/no-shape-in-symbol-names": "error",
      "anti-slop/no-unknown-parameters": "error",
      "anti-slop/no-unknown-returns": "error",
      "anti-slop/no-unknown-type-aliases": "error",
      "anti-slop/no-unsafe-dictionary-type": "error",
      "anti-slop/no-widen-then-assert": "error",
      "anti-slop/require-readable-spacing": "error",
      "anti-slop/require-safety-comment-for-type-assertion": "error",
    },
    options: { typeAware: true, typeCheck: true },
  },
});
