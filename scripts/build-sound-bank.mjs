import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';

const ffmpeg = process.env.FFMPEG_BIN || [
  '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg',
  '/Applications/VideoFusion-macOS.app/Contents/Resources/ffmpeg',
].find(existsSync);
if (!ffmpeg) throw new Error('ffmpeg is required to build the compact AAC sound bank');

const root = 'public/sounds';
const files = readdirSync(root, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.wav') && !entry.name.startsWith('cont_release_pop_'))
  .map(entry => join(entry.parentPath, entry.name))
  .sort();
const bank = {}, temp = mkdtempSync(join(tmpdir(), 'squishy-aac-'));
try {
  for (const [index, input] of files.entries()) {
    const key = relative(root, input).split(sep).join('/').replace(/\.wav$/, '');
    const output = join(temp, `${index}.m4a`);
    execFileSync(ffmpeg, ['-hide_banner','-loglevel','error','-i',input,'-vn','-ac','1','-ar','24000','-c:a','aac','-b:a','64k',output]);
    bank[key] = readFileSync(output).toString('base64');
    process.stdout.write(`\rPacked ${index + 1}/${files.length}: ${basename(input)}   `);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
mkdirSync('src/generated', { recursive: true });
writeFileSync('src/generated/sound-bank.ts', `// Generated from the original designed WAV files as mono 24 kHz AAC.\nexport const SOUND_BANK: Record<string, string> = ${JSON.stringify(bank, null, 2)};\n`);
process.stdout.write('\n');
