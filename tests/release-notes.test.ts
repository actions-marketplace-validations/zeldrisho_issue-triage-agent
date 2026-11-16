import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

const script = resolve("scripts/release-notes.py");
const dirs: string[] = [];

function run(tag: string, changelog: string, version = "1.2.3") {
  const cwd = mkdtempSync(join(tmpdir(), "release-notes-"));
  dirs.push(cwd);
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ version }));
  writeFileSync(join(cwd, "CHANGELOG.md"), changelog);

  return spawnSync("python3", [script, tag], { cwd, encoding: "utf8" });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("release notes", () => {
  const entry = "## [1.2.3] - 2026-11-16\n\n### Fixed\n\n- Fix the issue.\n";

  it("extracts only the requested release, excluding reference definitions", () => {
    const result = run(
      "v1.2.3",
      `## [Unreleased]\n\n${entry}\n## [1.0.0] - 2026-01-01\n\n- Old.\n\n[1.0.0]: https://example.com\n`,
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("### Fixed\n\n- Fix the issue.");
    const last = run("v1.2.3", `${entry}\n[1.2.3]: https://example.com\n`);
    expect(last.stdout.trim()).toBe("### Fixed\n\n- Fix the issue.");
  });

  it("retains referenced definitions from outside the release section", () => {
    const result = run(
      "v1.2.3",
      "## [1.2.3] - 2026-11-16\n\n- See [guide][docs].\n\n## [1.0.0] - 2026-01-01\n\n- Old.\n\n[docs]: https://example.com\n",
    );

    expect(result.stdout.trim()).toBe("- See [guide][docs].\n\n[docs]: https://example.com");
  });

  it("rejects invalid tags, mismatched versions, and missing or duplicate entries", () => {
    for (const [tag, text, version] of [
      ["v1.2.3-rc.1", entry, "1.2.3"],
      ["v1.2.3", entry, "1.2.4"],
      ["v1.2.3", "## [Unreleased]\n", "1.2.3"],
      ["v1.2.3", entry + entry, "1.2.3"],
      ["v1.2.3", "## [1.2.3] - 2026-02-30\n\n- Change.\n", "1.2.3"],
      ["v1.2.3", "## [1.2.3] - 2026-11-16\n\n### Fixed\n", "1.2.3"],
    ]) {
      expect(run(tag, text, version).status).not.toBe(0);
    }
  });
});
