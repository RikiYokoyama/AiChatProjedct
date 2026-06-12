# AI Markdown Chat Note — Mobile

PC版「AI Markdown Chat Note」（Electron）をベースにした **iOS / Android 向けモバイルアプリ** です。
ローカルファーストのMarkdownノート・AIチャット（Gemini）・ナレッジグラフ・GitHub同期というコアコンセプトを維持しつつ、スマートフォンのタッチ操作に最適化しています。

## 技術スタック

**Capacitor + React + Vite + TypeScript + TailwindCSS**

PC版のReact/TypeScript/TailwindCSS資産（Geminiストリーミングクライアント、Wikiリンク処理、Markdownプレビュー）をほぼそのまま流用するため、React Native ではなく Capacitor を採用しました。

- Gemini APIのSSEストリーミング（`fetch` + ReadableStream）がWebViewでそのまま動作
- `simple-git`（Node依存）はモバイルで動かないため、**GitHub Contents APIベースの軽量同期ロジック**に置き換え
- ノートはネイティブの **Documentsフォルダ**（iOSではファイルAppからもアクセス可能）に `.md` として保存

## モバイル向けUI/UX

| PC版 | モバイル版 |
| --- | --- |
| 3ペイン（一覧・エディタ・チャット） | **ボトムナビ**（ノート / グラフ / AIチャット / 設定） |
| エディタ＋プレビュー並列表示 | 1タップ切り替え ＋ **左右スワイプ切り替え** |
| ドラッグ＆ドロップのタブ | **最近開いたノートのカルーセル** |
| 右クリックメニュー | **スワイプアクション**（左: アーカイブ/削除、右: お気に入り/共有） |
| ツールバーボタン | **FAB**（新規ノート / AIノート作成） |
| Sigma.js / Three.js グラフ | **Canvas製の軽量2Dグラフ**（ピンチズーム・パン・ダブルタップズーム・タップで開く） |

### 追加機能

- **音声入力**: ノート編集・AIチャットでマイクボタンから音声入力（Web Speech API、対応環境のみ）
- **クイックAIアクションツールバー**: 編集時にキーボード直上へ「タイトル生成 / タグ生成 / 要約 / Wikiリンク化」を表示
- **キーボード回避**: Capacitor Keyboard + visualViewport で入力欄が隠れない
- **AIチャットの自動ノート保存**: 会話をタイトル・タグ自動生成付きでノート化（PC版と同じ）

### GitHub同期（モバイル向け軽量ロジック)

git cloneの代わりに GitHub Contents API でファイル単位の双方向同期を行います。

- 前回同期時のコンテンツハッシュを基点（base）として保持
- ローカルのみ変更 → push / リモートのみ変更 → pull
- **双方変更（競合）→ リモート版を `ノート名 (conflict).md` として保存**してからローカルをpush。データは失われません

設定画面で Personal Access Token（`contents: read/write` 権限）と `owner/repo` を入力してください。

## セットアップ

```bash
npm install
npm run dev        # ブラウザで開発（localStorage保存にフォールバック）
```

### Android

```bash
npm run android    # build → cap sync → Android Studioを開く
```

### iOS（macOSが必要）

```bash
npm run ios        # build → cap sync → Xcodeを開く
```

## 設定

1. アプリの「設定」タブで **Gemini APIキー** を入力（[Google AI Studio](https://aistudio.google.com/apikey) で取得）
2. （任意）GitHub同期: PAT・リポジトリ・ブランチを設定。「起動時に自動同期」も選択可能

## ディレクトリ構成

```
src/
  lib/
    gemini.ts       # Gemini ストリーミングクライアント（PC版から流用）
    notes.ts        # タグ・Wikiリンク抽出などノートのドメインロジック
    storage.ts      # Capacitor Filesystem / Preferences（Web時はlocalStorage）
    githubSync.ts   # GitHub Contents API 軽量同期
  hooks/
    useKeyboardInset.ts  # キーボード回避
    useSpeechInput.ts    # 音声入力
  components/       # BottomNav / FAB / スワイプ行 / Markdownビュー
  screens/          # ノート一覧 / エディタ / チャット / グラフ / 設定
```
