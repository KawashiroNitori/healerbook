#!/usr/bin/env node

// PreToolUse hook: reject writes under docs/ whose path contains any
// forbidden keyword. docs/ is published by VitePress, so internal notes
// (superpowers, specs, plans, designs) must live outside docs/.

import { stdin, stderr, exit } from "node:process";

const FORBIDDEN = ["superpowers", "spec", "plan", "design"];

const chunks = [];
for await (const chunk of stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString());

const filePath = input.tool_input?.file_path ?? input.tool_input?.filePath ?? "";
const normalized = filePath.replace(/\\/g, "/");

if (!/(^|\/)docs\//.test(normalized)) exit(0);

const hit = FORBIDDEN.find((kw) => normalized.toLowerCase().includes(kw));
if (!hit) exit(0);

stderr.write(
  `Refusing to write ${filePath}: path under docs/ contains forbidden keyword "${hit}".\n` +
    `docs/ is published by VitePress. Internal notes matching [${FORBIDDEN.join(", ")}] ` +
    `must live outside docs/ (e.g. project-root design/, design/superpowers/plans/, design/superpowers/specs/).\n`,
);
exit(2);
