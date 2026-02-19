/**
 * 修剪 ClassJob.json：
 * - 删除指定顶层字段
 * - GameContentLinks 只保留 Action 子字段
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.join(__dirname, '../src/data/ClassJob.json');
const OUTPUT = INPUT;

const FIELDS_TO_DELETE = [
  'ClassJobParent',
  'GamePatch',
  'ItemSoulCrystal',
  'Prerequisite',
  'RelicQuest',
  'UnlockQuest',
];

const LIMITBREAK_PREFIX = 'LimitBreak';

function trimObject(obj) {
  const result = { ...obj };

  // 删除指定字段
  for (const key of FIELDS_TO_DELETE) {
    delete result[key];
  }

  // 删除 LimitBreak 开头的所有字段
  for (const key of Object.keys(result)) {
    if (key.startsWith(LIMITBREAK_PREFIX)) {
      delete result[key];
    }
  }

  // 删除 ClassJob 开头的所有字段
  for (const key of Object.keys(result)) {
    if (key.startsWith('ClassJob')) {
      delete result[key];
    }
  }

  // GameContentLinks 只保留 Action
  if (result.GameContentLinks != null) {
    const links = result.GameContentLinks;
    result.GameContentLinks = links.Action != null ? { Action: links.Action } : {};
  }

  return result;
}

console.log('Reading', INPUT);
const data = JSON.parse(fs.readFileSync(INPUT, 'utf8'));

if (!Array.isArray(data)) {
  console.error('Expected root to be an array');
  process.exit(1);
}

console.log('Trimming', data.length, 'objects');
const trimmed = data.map(trimObject);

console.log('Writing', OUTPUT);
fs.writeFileSync(OUTPUT, JSON.stringify(trimmed, null, 2), 'utf8');
console.log('Done.');
