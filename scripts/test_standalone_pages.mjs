import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../woof-standalone.html', import.meta.url), 'utf8');

assert.match(html, /<style>[\s\S]+<\/style>/, 'the standalone page must embed its stylesheet');
assert.match(html, /<script>[\s\S]+<\/script>/, 'the standalone page must embed its JavaScript');
assert.doesNotMatch(html, /<script[^>]+type=["']module["']/i, 'the standalone page must not load ES modules');
assert.doesNotMatch(html, /\b(?:src|href)=["']\/?\.?\/?src\//i, 'the standalone page must not load source files');
assert.equal((html.match(/<\/script>/g) ?? []).length, 1, 'the standalone page must contain one script block');

// 上游致谢是必须出现在界面上的，而且要带得走：离线单文件版同样要留着。
assert.match(
  html,
  /fork-credit/,
  'the shipped page must carry the visible fork credit'
);
for (const link of [
  'https://github.com/ringhyacinth/Meow-Generator',
  'https://ringhyacinth.github.io/Meow-Generator/',
]) {
  assert.ok(html.includes(link), `the credit must link to ${link}`);
}

// 但产品本身必须是狗：标题、品牌和素材里都不许混进猫。
assert.match(html, /<title>[^<]*Woof Generator[^<]*<\/title>/, 'the page must be titled Woof Generator');
assert.doesNotMatch(html, /meow-generator-logo|neko|kitten|喵/i, 'no cat branding or assets may ship');
// 除了致谢里那两条上游链接，正文不该再出现 Meow
const withoutCredit = html
  .replace(/<p class="fork-credit">[\s\S]*?<\/p>/g, '')
  .replace(/<p class="footer-links">[\s\S]*?<\/p>/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '');
assert.doesNotMatch(withoutCredit, /meow/i, 'cat branding may only appear inside the credit');
assert.doesNotMatch(
  html,
  /data:(?:model\/gltf-binary|application\/octet-stream);base64,/,
  'the procedural dog must not ship a baked model'
);
for (const marker of [
  'dog-controls', 'pose-presets', 'ear-presets', 'saddle-color', 'under-color',
  'fluffy', 'codex-export',
]) {
  assert.ok(html.includes(marker), `the page must expose ${marker}`);
}

console.log(JSON.stringify({
  status: 'ok',
  standaloneBytes: Buffer.byteLength(html),
}, null, 2));
