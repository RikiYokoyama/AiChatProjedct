import { useRef, useState } from 'react';
import { Archive, FileText, Share2, Star, Trash2 } from 'lucide-react';
import { Note, noteTitle } from '../lib/notes';

// 左スワイプ: 削除・アーカイブ / 右スワイプ: 共有・お気に入り
export default function SwipeableNoteRow({
  note,
  isActive,
  isFavorite,
  isEmpty,
  onOpen,
  onDelete,
  onArchive,
  onShare,
  onToggleFavorite,
}: {
  note: Note;
  isActive: boolean;
  isFavorite: boolean;
  isEmpty: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onShare: () => void;
  onToggleFavorite: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const baseOffset = useRef(0);
  const isHorizontal = useRef<boolean | null>(null);

  const MAX = 144; // アクションボタン2つ分

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    baseOffset.current = offset;
    isHorizontal.current = null;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    if (isHorizontal.current === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      isHorizontal.current = Math.abs(dx) > Math.abs(dy);
    }
    if (!isHorizontal.current) return;
    const next = Math.max(-MAX, Math.min(MAX, baseOffset.current + dx));
    setOffset(next);
  };

  const onTouchEnd = () => {
    if (!isHorizontal.current) return;
    // 半分以上スワイプしたらスナップ、それ以外は閉じる
    if (offset < -MAX / 2) setOffset(-MAX);
    else if (offset > MAX / 2) setOffset(MAX);
    else setOffset(0);
  };

  const close = () => setOffset(0);

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* 右スワイプで現れる左側アクション */}
      <div className="absolute inset-y-0 left-0 flex" style={{ width: MAX, visibility: offset > 0 ? 'visible' : 'hidden' }}>
        <button
          className="flex flex-1 flex-col items-center justify-center gap-0.5 bg-amber-600 text-white"
          onClick={() => { onToggleFavorite(); close(); }}
        >
          <Star className={`h-4 w-4 ${isFavorite ? 'fill-current' : ''}`} />
          <span className="text-[10px]">{isFavorite ? '解除' : 'お気に入り'}</span>
        </button>
        <button
          className="flex flex-1 flex-col items-center justify-center gap-0.5 bg-sky-600 text-white"
          onClick={() => { onShare(); close(); }}
        >
          <Share2 className="h-4 w-4" />
          <span className="text-[10px]">共有</span>
        </button>
      </div>
      {/* 左スワイプで現れる右側アクション */}
      <div className="absolute inset-y-0 right-0 flex" style={{ width: MAX, visibility: offset < 0 ? 'visible' : 'hidden' }}>
        <button
          className="flex flex-1 flex-col items-center justify-center gap-0.5 bg-gray-600 text-white"
          onClick={() => { onArchive(); close(); }}
        >
          <Archive className="h-4 w-4" />
          <span className="text-[10px]">アーカイブ</span>
        </button>
        <button
          className="flex flex-1 flex-col items-center justify-center gap-0.5 bg-red-600 text-white"
          onClick={() => { onDelete(); close(); }}
        >
          <Trash2 className="h-4 w-4" />
          <span className="text-[10px]">削除</span>
        </button>
      </div>

      {/* ノート本体 */}
      <div
        className={`relative flex items-center gap-3 px-4 py-3 transition-transform ${
          isActive ? 'bg-indigo-500/20' : 'bg-[#0b1020]'
        }`}
        style={{ transform: `translateX(${offset}px)`, transitionDuration: '150ms' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={() => {
          if (offset !== 0) { close(); return; }
          onOpen();
        }}
      >
        {isEmpty && (
          <div className="absolute left-0 top-0 h-full w-0.5 rounded-r bg-yellow-400/70" />
        )}
        <FileText className={`h-4 w-4 shrink-0 ${isEmpty ? 'text-yellow-400' : 'text-gray-500'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {isFavorite && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />}
            <span className={`truncate text-sm ${isActive ? 'font-semibold text-indigo-100' : 'text-gray-200'}`}>
              {noteTitle(note.name)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-500">
            <span>{new Date(note.updatedAt).toLocaleDateString()}</span>
            {note.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-emerald-400/80">#{tag}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
