import { useState } from 'react';
import { GitBranch, Loader2, Trash2 } from 'lucide-react';
import { AppConfig } from '../lib/storage';
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
}: {
  config: AppConfig;
  aiModelMode: AiModelMode;
  gitStatus: 'idle' | 'syncing' | 'success' | 'error';
  gitMessage: string | null;
  onSave: (config: AppConfig) => void;
  onChangeModelMode: (mode: AiModelMode) => void;
  onSync: () => void;
  onDeletePrompt: (id: string) => void;
}) {
  const [draft, setDraft] = useState<AppConfig>(config);

  const update = (patch: Partial<AppConfig>) => setDraft((d) => ({ ...d, ...patch }));

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
            {(['flash-lite', 'flash', 'flash-3-5'] as AiModelMode[]).map((m) => (
              <button
                key={m}
                onClick={() => onChangeModelMode(m)}
                className={`rounded-full px-3 py-1.5 text-xs ${
                  aiModelMode === m ? 'bg-indigo-600 text-white' : 'bg-white/5 text-gray-300'
                }`}
              >
                {m === 'flash-lite' ? 'Flash Lite（高速）' : m === 'flash' ? 'Flash' : 'Flash 3.5'}
              </button>
            ))}
          </div>
        </Field>
      </section>

      <section className="mb-6 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">GitHub同期</h2>
        <p className="text-xs leading-5 text-gray-500">
          GitHubのPersonal Access Token（contents権限）とリポジトリを設定すると、ノートをファイル単位で双方向同期します。両側で変更があった場合はリモート版を「(conflict)」ノートとして保存し、データは失われません。
        </p>
        <Field label="Personal Access Token">
          <input
            type="password"
            value={draft.githubToken}
            onChange={(e) => update({ githubToken: e.target.value })}
            placeholder="ghp_... / github_pat_..."
            className="input"
          />
        </Field>
        <Field label="リポジトリ（owner/repo）">
          <input
            value={draft.githubRepo}
            onChange={(e) => update({ githubRepo: e.target.value })}
            placeholder="username/my-notes"
            className="input"
          />
        </Field>
        <Field label="ブランチ">
          <input
            value={draft.githubBranch}
            onChange={(e) => update({ githubBranch: e.target.value })}
            placeholder="main"
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
          {config.customPrompts.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
              <button onClick={() => onDeletePrompt(p.id)} className="text-gray-500 active:text-red-400" aria-label="削除">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
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
