#!/usr/bin/env node

// PreToolUse hook: redirect docs/superpowers/ → .claude/superpowers/
// Works with both Write and Edit tools

import { stdin } from "node:process";

const chunks = [];
for await (const chunk of stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString());

const filePath = input.tool_input?.file_path ?? input.tool_input?.filePath ?? "";
const pattern = /docs[/\\]superpowers[/\\]/;

if (!pattern.test(filePath)) process.exit(0);

const newPath = filePath.replace(pattern, ".claude/superpowers/");
const updatedInput = { ...input.tool_input };
if ("file_path" in updatedInput) {
  updatedInput.file_path = newPath;
} else if ("filePath" in updatedInput) {
  updatedInput.filePath = newPath;
}

const output = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    updatedInput,
    additionalContext: `Redirected superpowers doc: ${filePath} → ${newPath}`,
  },
};

console.log(JSON.stringify(output));
