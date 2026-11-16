import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";

import { getWorkspace } from "../src/shell-tools.js";
import { createToolRunner, REPO_TOOLS } from "../src/repo-tools.js";

// ---------------------------------------------------------------------------
// getWorkspace
// ---------------------------------------------------------------------------
describe("getWorkspace", () => {
  const original = process.env.GITHUB_WORKSPACE;

  afterEach(() => {
    if (original === undefined) delete process.env.GITHUB_WORKSPACE;
    else process.env.GITHUB_WORKSPACE = original;
  });

  it("returns null when GITHUB_WORKSPACE is unset", () => {
    delete process.env.GITHUB_WORKSPACE;
    expect(getWorkspace()).toBeNull();
  });

  it("returns null when GITHUB_WORKSPACE is blank", () => {
    process.env.GITHUB_WORKSPACE = "  ";
    expect(getWorkspace()).toBeNull();
  });

  it("returns the trimmed workspace path", () => {
    process.env.GITHUB_WORKSPACE = "/home/runner/work/repo ";
    expect(getWorkspace()).toBe("/home/runner/work/repo");
  });
});

// ---------------------------------------------------------------------------
// REPO_TOOLS schema
// ---------------------------------------------------------------------------
describe("REPO_TOOLS", () => {
  it("exports a single shell tool", () => {
    expect(REPO_TOOLS).toHaveLength(1);
    expect(REPO_TOOLS[0].name).toBe("shell");
  });

  it("shell tool requires command parameter", () => {
    const tool = REPO_TOOLS[0];
    expect(tool.parameters.required).toContain("command");
  });
});

// ---------------------------------------------------------------------------
// createToolRunner
// ---------------------------------------------------------------------------
describe("createToolRunner", () => {
  const original = process.env.GITHUB_WORKSPACE;

  afterEach(() => {
    if (original === undefined) delete process.env.GITHUB_WORKSPACE;
    else process.env.GITHUB_WORKSPACE = original;
  });

  it("returns null when no workspace", () => {
    delete process.env.GITHUB_WORKSPACE;
    expect(createToolRunner()).toBeNull();
  });

  it("returns a function when workspace is set", () => {
    process.env.GITHUB_WORKSPACE = "/workspace/repo";
    expect(createToolRunner()).not.toBeNull();
  });

  describe("with a real temp workspace", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "shell-tools-test-"));
      process.env.GITHUB_WORKSPACE = tmpDir;
      await fs.writeFile(path.join(tmpDir, "README.md"), "# Hello\nLine 2\nLine 3\n");
      await fs.mkdir(path.join(tmpDir, "src"));
      await fs.writeFile(path.join(tmpDir, "src", "index.ts"), "export {};\n");
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("runs ls on root", async () => {
      const runner = createToolRunner()!;
      const output = await runner({ id: "1", input: { name: "shell", command: "ls ." } });
      expect(output).toContain("README.md");
      expect(output).toContain("src");
    });

    it("runs ls on subdirectory", async () => {
      const runner = createToolRunner()!;
      const output = await runner({ id: "1", input: { name: "shell", command: "ls src" } });
      expect(output).toContain("index.ts");
    });

    it("runs cat on a file", async () => {
      const runner = createToolRunner()!;
      const output = await runner({ id: "1", input: { name: "shell", command: "cat README.md" } });
      expect(output).toContain("# Hello");
      expect(output).toContain("Line 2");
    });

    it("runs grep inside the workspace", async () => {
      const runner = createToolRunner()!;

      const output = await runner({
        id: "1",
        input: { name: "shell", command: "grep -r Hello ." },
      });

      expect(output).toContain("README.md");
    });

    it("blocks disallowed commands", async () => {
      const runner = createToolRunner()!;

      const output = await runner({
        id: "1",
        input: { name: "shell", command: "rm -rf ." },
      });

      expect(output).toMatch(/not allowed/);
    });

    it("returns an error for nonexistent files gracefully", async () => {
      const runner = createToolRunner()!;

      const output = await runner({
        id: "1",
        input: { name: "shell", command: "cat does-not-exist.txt" },
      });

      expect(output).toMatch(/Error/);
    });
  });
});
