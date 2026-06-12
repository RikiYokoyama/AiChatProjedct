import { FileText, MessageSquare, Network, Settings } from 'lucide-react';

export type Tab = 'notes' | 'graph' | 'chat' | 'settings';

const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'notes', label: 'ノート', icon: FileText },
  { id: 'graph', label: 'グラフ', icon: Network },
  { id: 'chat', label: 'AIチャット', icon: MessageSquare },
  { id: 'settings', label: '設定', icon: Settings },
];

export default function BottomNav({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="safe-bottom shrink-0 border-t border-white/10 bg-[#060910]">
      <div className="flex">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors ${
              active === id ? 'text-indigo-400' : 'text-gray-500 active:text-gray-300'
            }`}
          >
            <Icon className="h-5 w-5" />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
