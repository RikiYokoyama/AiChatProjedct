import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { AppConfig, CustomPrompt } from '../lib/storage';

export default function SettingsScreen({
  config,
  onSave,
  onDeletePrompt,
}: {
  config: AppConfig;
  onSave: (config: AppConfig) => void;
  onDeletePrompt: (id: string) => void;
}) {
  const [draft, setDraft] = useState<AppConfig>(config);
  const [newPromptName, setNewPromptName] = useState('');
  const [newPromptText, setNewPromptText] = useState('');

  useEffect(() => {
    setDraft((d) => ({ ...d, customPrompts: config.customPrompts }));
  }, [config.customPrompts]);

  const update = (patch: Partial<AppConfig>) => setDraft((d) => ({ ...d, ...patch }));

  function handleAddPrompt() {
    if (!newPromptName.trim() || !newPromptText.trim()) return;
    const newPrompt: CustomPrompt = {
      id: Date.now().toString(),
      name: newPromptName.trim().slice(0, 10),
      prompt: newPromptText.trim(),
    };
    update({ customPrompts: [...(draft.customPrompts ?? []), newPrompt] });
    setNewPromptName('');
    setNewPromptText('');
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4 pb-24">
      <h1 className="mb-4 text-lg font-bold">設定</h1>

      {/* Gemini APIキー */}
      <label className="mb-3 block text-sm">
        <span className="mb-1 block text-gray-300">Gemini APIキー</span>
        <input
          type="password"
          value={draft.geminiApiKey}
          onChange={(e) => update({ geminiApiKey: e.target.value })}
          className="input"
        />
      </label>

      {/* GitリモートURL */}
      <label className="mb-3 block text-sm">
        <span className="mb-1 block text-gray-300">GitリモートURL</span>
        <input
          type="text"
          value={draft.gitRemoteUrl}
          onChange={(e) => update({ gitRemoteUrl: e.target.value })}
          className="input"
        />
      </label>

      {/* 自動同期 */}
      <label className="mb-5 flex items-center gap-2 text-sm text-gray-300">
        <input
          type="checkbox"
          checked={draft.autoSync}
          onChange={(e) => update({ autoSync: e.target.checked })}
          className="h-4 w-4 accent-indigo-500"
        />
        自動同期を有効にする
      </label>

      {/* カスタムプロンプト */}
      <div className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-gray-200">■ カスタムプロンプト</h2>

        {/* 登録済みリスト */}
        <div className="mb-4 max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-2 text-xs">
          {(draft.customPrompts ?? []).length === 0 ? (
            <div className="py-2 text-center text-gray-500">登録されたカスタムプロンプトはありません</div>
          ) : (
            (draft.customPrompts ?? []).map((cp) => (
              <div key={cp.id} className="flex items-center justify-between border-b border-white/5 py-1.5 last:border-0">
                <div className="min-w-0 flex-1 pr-2">
                  <div className="font-semibold text-gray-200 truncate">{cp.name}</div>
                  <div className="mt-0.5 truncate text-gray-400">{cp.prompt}</div>
                </div>
                <button
                  onClick={() => {
                    if (window.confirm(`「${cp.name}」を削除しますか？`)) onDeletePrompt(cp.id);
                  }}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 text-xs text-red-400 active:bg-red-500/20"
                >
                  <Trash2 className="h-3.5 w-3.5" /> 削除
                </button>
              </div>
            ))
          )}
        </div>

        {/* 手動追加フォーム */}
        <div className="space-y-3 rounded-lg border border-white/5 bg-white/5 p-3">
          <div className="text-xs font-semibold text-indigo-300">新規追加 (手動)</div>
          <label className="block text-xs">
            <span className="mb-1 block text-gray-400">プロンプト名</span>
            <input
              value={newPromptName}
              onChange={(e) => setNewPromptName(e.target.value)}
              placeholder="例: 翻訳アシスタント"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500/50"
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block text-gray-400">指示 (システムプロンプト)</span>
            <textarea
              value={newPromptText}
              onChange={(e) => setNewPromptText(e.target.value)}
              placeholder="AIに対する具体的な指示テキスト..."
              rows={4}
              className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500/50"
            />
          </label>
          <button
            onClick={handleAddPrompt}
            disabled={!newPromptName.trim() || !newPromptText.trim()}
            className="w-full rounded-lg bg-indigo-600/30 py-1.5 text-xs font-semibold text-indigo-300 active:bg-indigo-600/50 disabled:opacity-40"
          >
            プロンプトを追加
          </button>
        </div>
      </div>

      {/* 保存 */}
      <button
        onClick={() => onSave(draft)}
        className="w-full rounded-xl bg-indigo-600 px-4 py-3.5 text-sm font-bold text-white active:bg-indigo-500"
      >
        保存
      </button>
    </div>
  );
}
