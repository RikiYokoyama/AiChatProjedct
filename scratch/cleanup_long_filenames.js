const fs = require('fs');
const path = require('path');

// 設定：ファイル名の最大文字数（拡張子 .md を除く）
const MAX_FILENAME_LENGTH = 50;

// config.json の読み込みを試みる
let notesPath = '';
const configCandidates = [
  path.join(process.env.USERPROFILE, 'AppData/Roaming/AI Markdown Chat Note/config.json'),
  path.join(process.env.USERPROFILE, 'AppData/Roaming/ai-markdown-chat-note/config.json'),
  path.join(__dirname, '../config.json') // スクリプトの相対位置から
];

for (const p of configCandidates) {
  if (fs.existsSync(p)) {
    try {
      const config = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (config.notesPath) {
        notesPath = config.notesPath;
        console.log(`Config found: notesPath = ${notesPath}`);
        break;
      }
    } catch (e) {
      // 無視して次へ
    }
  }
}

// 見つからなければデフォルトパス
if (!notesPath) {
  notesPath = path.join(process.env.USERPROFILE, 'Documents', 'AiChatNotes');
  console.log(`Defaulting notesPath = ${notesPath}`);
}

if (!fs.existsSync(notesPath)) {
  console.error(`Error: notesPath not found: ${notesPath}`);
  process.exit(1);
}

// 再帰的にすべての .md ファイルを取得する関数
function getFilesRecursively(dir, filterExt = '.md') {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const file of list) {
    const res = path.resolve(dir, file.name);
    if (file.isDirectory()) {
      if (file.name === 'backup' || file.name === '.git' || file.name === 'node_modules') continue;
      results = results.concat(getFilesRecursively(res, filterExt));
    } else if (file.isFile() && file.name.endsWith(filterExt)) {
      results.push(res);
    }
  }
  return results;
}

// クリーンアップ対象の文字クリーンアップ関数
function cleanName(val) {
  return val.trim().replace(/[\\/:*?"<>|]/g, '-');
}

async function runMigration() {
  console.log("=== 長いファイル名一括置換プログラムを開始します ===");
  const files = getFilesRecursively(notesPath);
  console.log(`検出された全マークダウンファイル数: ${files.length}`);

  const renameMap = []; // { oldFullPath, newFullPath, oldBaseName, newBaseName }

  // 1. リネーム対応表を作成する（衝突を防ぎながら短い名前を決定）
  const usedNewNames = new Set();

  for (const fileFullPath of files) {
    const relativePath = path.relative(notesPath, fileFullPath).replace(/\\/g, '/');
    const folderPath = path.dirname(relativePath).replace(/\\/g, '/');
    const originalFileName = path.basename(fileFullPath);
    
    // _All_Notes_MOC や private/ 配下はスキップ
    if (originalFileName.startsWith('_') || relativePath.startsWith('private/') || relativePath.startsWith('moc/')) {
      continue;
    }

    const baseName = originalFileName.replace(/\.md$/i, '');
    
    // 設定文字数（30文字）を超えている場合のみ対象
    if (baseName.length > MAX_FILENAME_LENGTH) {
      let shortBase = cleanName(baseName.slice(0, MAX_FILENAME_LENGTH));
      let counter = 1;
      let targetBase = shortBase;
      
      // 衝突回避
      const targetFolderFullPath = path.dirname(fileFullPath);
      while (
        fs.existsSync(path.join(targetFolderFullPath, `${targetBase}.md`)) ||
        usedNewNames.has(path.join(folderPath, `${targetBase}.md`).replace(/\\/g, '/').toLowerCase())
      ) {
        targetBase = `${shortBase} (${counter})`;
        counter++;
      }

      const newFileName = `${targetBase}.md`;
      const newFullPath = path.join(targetFolderFullPath, newFileName);
      
      const oldRelPathWithoutExt = relativePath.replace(/\.md$/i, '');
      const newRelPathWithoutExt = path.join(folderPath, targetBase).replace(/\\/g, '/');

      renameMap.push({
        oldFullPath: fileFullPath,
        newFullPath: newFullPath,
        oldRelPath: oldRelPathWithoutExt,
        newRelPath: newRelPathWithoutExt,
        oldBase: baseName,
        newBase: targetBase
      });

      usedNewNames.add(newRelPathWithoutExt.toLowerCase() + '.md');
    }
  }

  if (renameMap.length === 0) {
    console.log("30文字を超える長いファイル名は見つかりませんでした。処理を終了します。");
    return;
  }

  console.log(`\nリネーム対象のファイル数: ${renameMap.length}`);
  renameMap.forEach(item => {
    console.log(`[予定] ${item.oldBase} -> ${item.newBase}`);
  });

  // 2. 各ファイル内の Wiki リンクを一括置換する
  console.log("\n各ファイル内の Wiki リンクを置換中...");
  const allFiles = getFilesRecursively(notesPath);
  
  let totalLinkReplacements = 0;

  for (const file of allFiles) {
    let content = fs.readFileSync(file, 'utf8');
    let hasChanged = false;

    // renameMap の古い名前への Wiki リンクをすべて置換
    for (const item of renameMap) {
      // パス形式のリンク置換
      const pathPattern = new RegExp(`\\[\\[${escapeRegExp(item.oldRelPath)}(\\|[^\\]]+)?\\]\\]`, 'gi');
      if (pathPattern.test(content)) {
        content = content.replace(pathPattern, (match, displayPart) => {
          return `[[${item.newRelPath}${displayPart ?? ''}]]`;
        });
        hasChanged = true;
        totalLinkReplacements++;
      }

      // ファイル名のみのリンク置換
      const basePattern = new RegExp(`\\[\\[${escapeRegExp(item.oldBase)}(\\|[^\\]]+)?\\]\\]`, 'gi');
      if (basePattern.test(content)) {
        content = content.replace(basePattern, (match, displayPart) => {
          return `[[${item.newBase}${displayPart ?? ''}]]`;
        });
        hasChanged = true;
        totalLinkReplacements++;
      }
    }

    if (hasChanged) {
      fs.writeFileSync(file, content, 'utf8');
      console.log(`リンク更新: ${path.basename(file)}`);
    }
  }

  console.log(`合計 ${totalLinkReplacements} 箇所のリンクを更新しました。`);

  // 3. 実際のファイルリネームを実行
  console.log("\n実際のファイル名をリネーム中...");
  let successCount = 0;
  for (const item of renameMap) {
    try {
      if (fs.existsSync(item.oldFullPath)) {
        fs.renameSync(item.oldFullPath, item.newFullPath);
        successCount++;
      }
    } catch (err) {
      console.error(`リネーム失敗: ${item.oldBase} -> ${item.newBase}`, err.message);
    }
  }

  console.log(`\n=== 処理完了 ===`);
  console.log(`ファイルリネーム成功: ${successCount} / ${renameMap.length}`);
  console.log(`これで長いファイル名のクリーンアップとリンクの整合性維持が完了しました！`);
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

runMigration().catch(console.error);
