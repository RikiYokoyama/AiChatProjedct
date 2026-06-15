import { useEffect, useState } from 'react';
import { GitBranch, Loader2, Pencil, Save, Trash2, X } from 'lucide-react';
import { AppConfig, CustomPrompt } from '../lib/storage';
import { AiModelMode } from '../lib/gemini';

export default function SettingsScreen({
  config,
  aiModelMode,
  gitStatus,
  gitMessage,
  onSave,
  onChangeModelMode,
  onSync,
  onDeletePrompt,
  onEditPrompt,
}: {
  config: AppConfig;
  aiModelMode: AiModelMode;
  gitStatus: 'idle' | 'syncing' | 'success' | 'error';
  gitMessage: string | null;
  onSave: (config: AppConfig) => void;
  onChangeModelMode: (mode: AiModelMode) => void;
  onSync: () => void;
  onDeletePrompt: (id: string) => void;
  onEditPrompt: (prompt: CustomPrompt) => void;
}) {
  const [draft, setDraft] = useState<AppConfig>(config);
  const [editingId, setEditingId] = useState<string | null>(null);

  // config.customPrompts が外部（削除・編集）で変わったら draft に反映
  useEffect(() => {
    setDraft((d) => ({ ...d, customPrompts: config.customPrompts }));
  }, [config.customPrompts]);
  const [editName, setEditName] = useState('');
  const [editInstruction, setEditInstruction] = useState('');

  const update = (patch: Partial<AppConfig>) => setDraft((d) => ({ ...d, ...patch }));

  function startEdit(p: CustomPrompt) {
    setEditingId(p.id);
    setEditName(p.name);
    setEditInstruction(p.prompt);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName('');
    setEditInstruction('');
  }

  function saveEdit() {
    if (!editingId || !editName.trim()) return;
    onEditPrompt({ id: editingId, name: editName.trim().slice(0, 10), prompt: editInstruction.trim() });
    cancelEdit();
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4 pb-24">
      <h1 className="mb-4 text-lg font-bold">設定</h1>

      <section className="mb-6 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">AI（Gemini）</h2>
        <Field label="Gemini APIキー">
          <input
            type="password"
            value={draft.geminiApiKey}
            onChange={(e) => update({ geminiApiKey: e.target.value })}
            placeholder="AIza..."
            className="input"
          />
        </Field>
        <Field label="モデル">
          <div className="flex gap-1.5">
            {(['flash', 'pro'] as AiModelMode[]).map((m) => (
              <button
                key={m}
                onClick={() => onChangeModelMode(m)}
                className={`rounded-full px-3 py-1.5 text-xs ${
                  aiModelMode === m ? 'bg-indigo-600 text-white' : 'bg-white/5 text-gray-300'
                }`}
              >
                {m === 'flash' ? 'Flash' : 'Pro'}
              </button>
            ))}
          </div>
        </Field>
      </section>

      <section className="mb-6 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">GitHub同期</h2>
        <p className="text-xs leading-5 text-gray-500">
          GitリモートURLを設定するとノートをGitHubと双方向同期します。形式: https://TOKEN@github.com/owner/repo.git
        </p>
        <Field label="GitリモートURL">
          <input
            type="text"
            value={draft.gitRemoteUrl}
            onChange={(e) => update({ gitRemoteUrl: e.target.value })}
            placeholder="https://ghp_...@github.com/username/my-notes.git"
            className="input"
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={draft.autoSync}
            onChange={(e) => update({ autoSync: e.target.checked })}
            className="h-4 w-4 accent-indigo-500"
          />
          アプリ起動時に自動同期する
        </label>
        <button
          onClick={onSync}
          disabled={gitStatus === 'syncing'}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold active:bg-white/10 disabled:opacity-50"
        >
          {gitStatus === 'syncing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
          今すぐ同期
        </button>
        {gitMessage && (
          <p className={`text-xs ${gitStatus === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>{gitMessage}</p>
        )}
      </section>

      {(config.customPrompts ?? []).length > 0 && (
        <section className="mb-6 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">カスタムプロンプト</h2>
          {config.customPrompts.map((p) =>
            editingId === p.id ? (
              /* 編集フォーム */
              <div key={p.id} className="space-y-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 p-3">
                <div>
                  <label className="mb-1 block text-[10px] text-gray-400">
                    名前（{editName.length}/10文字）
                  </label>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value.slice(0, 10))}
                    maxLength={10}
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] text-gray-400">指示内容</label>
                  <textarea
                    value={editInstruction}
                    onChange={(e) => setEditInstruction(e.target.value)}
                    rows={5}
                    className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/50"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={saveEdit}
                    disabled={!editName.trim() || !editInstruction.trim()}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2 text-sm font-bold text-white active:bg-indigo-500 disabled:opacity-40"
                  >
                    <Save className="h-4 w-4" /> 保存
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="flex items-center justify-center gap-1.5 rounded-xl bg-white/5 px-4 py-2 text-sm text-gray-300 active:bg-white/10"
                  >
                    <X className="h-4 w-4" /> キャンセル
                  </button>
                </div>
              </div>
            ) : (
              /* 通常表示 */
              <div key={p.id} className="rounded-xl border border-white/10 bg-white/5">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{p.name}</span>
                  <button
                    onClick={() => startEdit(p)}
                    className="flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-xs text-gray-300 active:bg-white/10"
                  >
                    <Pencil className="h-3.5 w-3.5" /> 編集
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`「${p.name}」を削除しますか？`)) onDeletePrompt(p.id);
                    }}
                    className="flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 text-xs text-red-400 active:bg-red-500/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> 削除
                  </button>
                </div>
              </div>
            )
          )}
        </section>
      )}

      <button
        onClick={() => onSave(draft)}
        className="w-full rounded-xl bg-indigo-600 px-4 py-3.5 text-sm font-bold text-white active:bg-indigo-500"
      >
        設定を保存
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-400">{label}</label>
      {children}
    </div>
  );
}
