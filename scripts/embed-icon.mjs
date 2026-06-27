import { createRequire } from 'module';
const { rcedit } = createRequire(import.meta.url)('rcedit');
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const exe = resolve(root, 'release/win-unpacked/AI Markdown Chat Note.exe');
const ico = resolve(root, 'build/icon.ico');

console.log('アイコンを埋め込み中...');
await rcedit(exe, { icon: ico });
console.log('完了:', exe);
