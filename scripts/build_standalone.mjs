import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptsDirectory, '..');
const sourceHtmlPath = resolve(projectRoot, 'index.html');
const sourceCssPath = resolve(projectRoot, 'src/style.css');
const sourceScriptPath = resolve(projectRoot, 'src/main.js');
const standalonePath = resolve(projectRoot, 'woof-standalone.html');
const distStandalonePath = resolve(projectRoot, 'dist/woof-standalone.html');

const [sourceHtml, css, bundled] = await Promise.all([
  readFile(sourceHtmlPath, 'utf8'),
  readFile(sourceCssPath, 'utf8'),
  build({
    entryPoints: [sourceScriptPath],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    legalComments: 'inline',
    write: false,
  }),
]);

const javascript = bundled.outputFiles[0]?.text;
if (!javascript) throw new Error('Woof Generator bundle did not produce JavaScript.');

const standaloneHtml = sourceHtml
  .replace(
    /<link\s+rel="stylesheet"\s+href="\.\/src\/style\.css"\s*\/?>/,
    () => `    <style>\n${css}\n    </style>`
  )
  .replace(
    /<script\s+type="module"\s+src="\.\/src\/main\.js"><\/script>/,
    () => `    <script>\n${javascript}\n    </script>`
  )
  .replace(
    '<meta charset="UTF-8" />',
    '<meta charset="UTF-8" />\n    <!-- Standalone build: CSS and JavaScript are embedded for direct file opening. -->'
  );

const staleStyleReference = standaloneHtml.includes('href="./src/style.css"');
const staleScriptReference = standaloneHtml.includes('src="./src/main.js"');
if (staleStyleReference || staleScriptReference) {
  throw new Error(
    `Standalone build still contains source asset references: style=${staleStyleReference}, script=${staleScriptReference}.`
  );
}

await mkdir(dirname(distStandalonePath), { recursive: true });
await Promise.all([
  writeFile(standalonePath, standaloneHtml),
  writeFile(distStandalonePath, standaloneHtml),
]);

console.log(`Standalone Woof Generator: ${standalonePath}`);
