#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { run } from "./cli.js";

process.exitCode = run(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  writeFile: (path, content) => writeFileSync(path, `${content}\n`),
});
