#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const srcRoot = path.join(projectRoot, "src");
const outRoot = fs.mkdtempSync(path.join(projectRoot, ".preview-build-"));

try {
  transpileTree(srcRoot, path.join(outRoot, "src"));

  const args = process.argv.slice(2);
  const result = spawnSync(process.execPath, [path.join(outRoot, "src/index.js"), ...args], {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env
  });

  if (typeof result.status === "number") {
    process.exitCode = result.status;
  } else if (result.error) {
    throw result.error;
  } else {
    process.exitCode = 1;
  }
} finally {
  fs.rmSync(outRoot, { recursive: true, force: true });
}

function transpileTree(fromDir, toDir) {
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const sourcePath = path.join(fromDir, entry.name);
    const outputPath = path.join(
      toDir,
      entry.isDirectory() ? entry.name : entry.name.replace(/\.ts$/, ".js")
    );

    if (entry.isDirectory()) {
      transpileTree(sourcePath, outputPath);
      continue;
    }

    if (!entry.name.endsWith(".ts")) {
      continue;
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const source = fs.readFileSync(sourcePath, "utf8");
    const result = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ES2022,
        lib: ["ES2022"],
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        isolatedModules: true,
        verbatimModuleSyntax: false
      },
      fileName: sourcePath,
      reportDiagnostics: true
    });

    if (result.diagnostics?.length) {
      const messages = ts.formatDiagnosticsWithColorAndContext(result.diagnostics, {
        getCanonicalFileName: (value) => value,
        getCurrentDirectory: () => projectRoot,
        getNewLine: () => "\n"
      });
      throw new Error(messages);
    }

    fs.writeFileSync(outputPath, result.outputText, "utf8");
  }
}
