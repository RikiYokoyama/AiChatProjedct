const fs = require('fs');
const jsPath = 'C:/Users/user/OneDrive/Desktop/Aiチャット制作/unpacked_app/dist/assets/index-CNoeV2lg.js';
const jsContent = fs.readFileSync(jsPath, 'utf8');

// 1. "h-screen" や "w-screen" や "select-none" や "glass-panel" の周辺を調べて
// 最上位のコンポーネントのレイアウト構造を抽出する
console.log('--- Search App Root Layout ---');
const rootIdx = jsContent.indexOf('h-screen w-screen');
if (rootIdx !== -1) {
  console.log(`Found root layout at ${rootIdx}`);
  const snippet = jsContent.substring(rootIdx - 200, rootIdx + 3000);
  fs.writeFileSync('C:/Users/user/.gemini/antigravity/brain/aba33604-9993-4508-9bc3-7d8d9991fa81/scratch/extracted_root_layout.txt', snippet, 'utf8');
  console.log('Extracted root layout to extracted_root_layout.txt');
}
