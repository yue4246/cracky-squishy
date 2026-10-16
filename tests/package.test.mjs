import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('built classic script waits until the page DOM exists', () => {
  execFileSync('npm', ['run', 'build'], { stdio: 'pipe' });
  const html = readFileSync('dist/index.html', 'utf8');
  assert.match(html, /<script defer src="\.\/assets\/[^"/]+\.js"><\/script>/);
  assert.doesNotMatch(html, /type="module"/);
});

test('hamster uses the short display name', () => {
  const source = readFileSync('src/data/characters.ts', 'utf8');
  assert.match(source, /name: '小仓鼠', image: '人脸小仓鼠\.png'/);
  assert.doesNotMatch(source, /name: '人脸小仓鼠'/);
});

test('new collection features stay inside the offline Chrome 61 capability baseline', () => {
  const source = ['src/store/SquishyStore.ts', 'src/mysteryBox.ts', 'src/catalog.ts', 'src/main.ts', 'src/rendering/ClayRenderer.ts'].map(file => readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(source, /navigator\.locks|crypto\.randomUUID|structuredClone|new Audio\(|\.wav['"]/);
  assert.match(source, /setupMysteryBox[\s\S]*audio\.handleEvent/);
});

test('dessert catalog is exposed as an accessible cookie photo book',()=>{
 const html=readFileSync('index.html','utf8'),css=readFileSync('src/style.css','utf8');
 assert.match(html,/id="catalog-open"[^>]*aria-label="打开捏捏图册"/);
 assert.match(html,/id="catalog-dialog"[^>]*aria-labelledby="catalog-title"/);
 assert.match(css,/\.catalog-book/);assert.match(css,/\.catalog-locked-mark/);
});

test('mobile rendering targets 60 Hz, pauses in the background and uses a smaller lighting buffer',()=>{
  const scene=readFileSync('src/rendering/SceneManager.ts','utf8');
  const renderer=readFileSync('src/rendering/ClayRenderer.ts','utf8');
  assert.match(scene,/1000\s*\/\s*60/);
  assert.match(scene,/Math\.min\(0\.2,\s*elapsed\s*\/\s*1000\)/);
  assert.match(scene,/visibilitychange/);
  assert.match(scene,/document\.hidden[\s\S]*cancelAnimationFrame/);
  assert.match(renderer,/const SOFT_SIZE = 96/);
  assert.match(renderer,/Math\.min\(devicePixelRatio\s*\|\|\s*1,\s*1\.25\)/);
});
