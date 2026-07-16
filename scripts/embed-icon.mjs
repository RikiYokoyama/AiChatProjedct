import { createRequire } from 'module';
const { rcedit } = createRequire(import.meta.url)('rcedit');
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ビルド出力は OneDrive/プロジェクト外（package.json の build.directories.output と一致させる）
// Claude Desktop 等がプロジェクト内の app.asar を掴んでビルドが失敗するのを避けるため
const OUTPUT_DIR = 'C:/Users/user/AppData/Local/AiChatBuild';
const exe = resolve(OUTPUT_DIR, 'win-unpacked/AI Markdown Chat Note.exe');
const ico = resolve(root, 'build/icon.ico');

console.log('アイコンを埋め込み中...');
await rcedit(exe, { icon: ico });
console.log('完了:', exe);
