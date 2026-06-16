import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Note, noteTitle } from '../lib/notes';

// タッチ操作対応の軽量2Dナレッジグラフ（Canvas + 自前force-layout）
// - ドラッグ: パン / ピンチ: ズーム / ダブルタップ: ズームイン / ノードタップ: ノートを開く

interface GraphNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
  exists: boolean; // 実ノートが存在するか（未作成リンク先はfalse）
}

interface GraphEdge {
  source: string;
  target: string;
}

export default function GraphScreen({
  notes,
  centerNoteName,
  onSelectNote,
  onCloseLocal,
}: {
  notes: Note[];
  centerNoteName?: string | null;
  onSelectNote: (name: string) => void;
  onCloseLocal?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const transformRef = useRef(transform);
  transformRef.current = transform;

  const GLOBAL_NODE_LIMIT = 200;
  const LOCAL_NODE_LIMIT = 50;

  // グラフデータ構築
  const { nodes, edges, totalNodeCount, isLimited } = useMemo(() => {
    const center = centerNoteName ? noteTitle(centerNoteName) : null;
    const nodeMap = new Map<string, GraphNode>();
    const edgeList: GraphEdge[] = [];

    const ensureNode = (id: string, exists: boolean) => {
      if (!nodeMap.has(id)) {
        nodeMap.set(id, {
          id,
          x: (Math.random() - 0.5) * 400,
          y: (Math.random() - 0.5) * 400,
          vx: 0,
          vy: 0,
          degree: 0,
          exists,
        });
      } else if (exists) {
        nodeMap.get(id)!.exists = true;
      }
      return nodeMap.get(id)!;
    };

    for (const note of notes) {
      const src = noteTitle(note.name);
      ensureNode(src, true);
      for (const dest of note.wikiLinks) {
        ensureNode(dest, false);
        edgeList.push({ source: src, target: dest });
      }
    }
    // 実在フラグを反映
    for (const note of notes) {
      const n = nodeMap.get(noteTitle(note.name));
      if (n) n.exists = true;
    }
    for (const e of edgeList) {
      nodeMap.get(e.source)!.degree++;
      nodeMap.get(e.target)!.degree++;
    }

    // ローカルグラフ: 中心ノートとその1ホップ近傍のみ
    if (center) {
      const keep = new Set<string>([center]);
      for (const e of edgeList) {
        if (e.source === center) keep.add(e.target);
        if (e.target === center) keep.add(e.source);
      }
      let filteredNodes = Array.from(nodeMap.values()).filter((n) => keep.has(n.id));
      const totalNodeCount = filteredNodes.length;
      // 中心ノードを常に含めつつ、残りをdegree順に制限
      if (filteredNodes.length > LOCAL_NODE_LIMIT) {
        const centerNode = filteredNodes.find((n) => n.id === center);
        const others = filteredNodes.filter((n) => n.id !== center).sort((a, b) => b.degree - a.degree).slice(0, LOCAL_NODE_LIMIT - 1);
        filteredNodes = centerNode ? [centerNode, ...others] : others.slice(0, LOCAL_NODE_LIMIT);
      }
      const keepIds = new Set(filteredNodes.map((n) => n.id));
      const filteredEdges = edgeList.filter((e) => keepIds.has(e.source) && keepIds.has(e.target));
      return { nodes: filteredNodes, edges: filteredEdges, totalNodeCount, isLimited: totalNodeCount > LOCAL_NODE_LIMIT };
    }

    // 全体グラフ: degree（リンク数）降順 + 上位200件に制限
    const allNodes = Array.from(nodeMap.values());
    const totalNodeCount = allNodes.length;
    let limitedNodes = allNodes;
    if (allNodes.length > GLOBAL_NODE_LIMIT) {
      limitedNodes = allNodes.sort((a, b) => b.degree - a.degree).slice(0, GLOBAL_NODE_LIMIT);
    }
    const keepIds = new Set(limitedNodes.map((n) => n.id));
    const limitedEdges = edgeList.filter((e) => keepIds.has(e.source) && keepIds.has(e.target));
    return { nodes: limitedNodes, edges: limitedEdges, totalNodeCount, isLimited: totalNodeCount > GLOBAL_NODE_LIMIT };
  }, [notes, centerNoteName]);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // 物理シミュレーション + 描画ループ
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let iterations = 0;
    const nodeList = nodes;
    const edgeList = edges;
    const nodeMap = new Map(nodeList.map((n) => [n.id, n]));

    function step() {
      // 反発力
      for (let i = 0; i < nodeList.length; i++) {
        for (let j = i + 1; j < nodeList.length; j++) {
          const a = nodeList[i];
          const b = nodeList[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let dist2 = dx * dx + dy * dy;
          if (dist2 < 1) dist2 = 1;
          const force = 3000 / dist2;
          const dist = Math.sqrt(dist2);
          dx /= dist;
          dy /= dist;
          a.vx += dx * force;
          a.vy += dy * force;
          b.vx -= dx * force;
          b.vy -= dy * force;
        }
      }
      // ばね力（エッジ）
      for (const e of edgeList) {
        const a = nodeMap.get(e.source)!;
        const b = nodeMap.get(e.target)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const force = (dist - 110) * 0.01;
        a.vx += (dx / dist) * force;
        a.vy += (dy / dist) * force;
        b.vx -= (dx / dist) * force;
        b.vy -= (dy / dist) * force;
      }
      // 中心への引力 + 減衰
      for (const n of nodeList) {
        n.vx += -n.x * 0.002;
        n.vy += -n.y * 0.002;
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;
      }
    }

    function draw() {
      const rect = container!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas!.width !== rect.width * dpr || canvas!.height !== rect.height * dpr) {
        canvas!.width = rect.width * dpr;
        canvas!.height = rect.height * dpr;
      }
      const t = transformRef.current;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, rect.width, rect.height);
      ctx!.save();
      ctx!.translate(rect.width / 2 + t.x, rect.height / 2 + t.y);
      ctx!.scale(t.scale, t.scale);

      // エッジ
      ctx!.strokeStyle = 'rgba(129, 140, 248, 0.25)';
      ctx!.lineWidth = 1;
      for (const e of edgeList) {
        const a = nodeMap.get(e.source)!;
        const b = nodeMap.get(e.target)!;
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(b.x, b.y);
        ctx!.stroke();
      }
      // ノード
      for (const n of nodeList) {
        const r = Math.min(16, 5 + n.degree * 1.5);
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx!.fillStyle = n.exists ? '#818cf8' : 'rgba(248, 113, 113, 0.6)';
        ctx!.fill();
        // ラベル
        ctx!.fillStyle = 'rgba(229, 231, 235, 0.85)';
        ctx!.font = `${11 / Math.max(0.6, t.scale)}px sans-serif`;
        ctx!.textAlign = 'center';
        ctx!.fillText(n.id.length > 14 ? n.id.slice(0, 13) + '…' : n.id, n.x, n.y + r + 12 / Math.max(0.6, t.scale));
      }
      ctx!.restore();
    }

    function loop() {
      if (iterations < 300) {
        step();
        iterations++;
      }
      draw();
      raf = requestAnimationFrame(loop);
    }
    loop();
    return () => cancelAnimationFrame(raf);
  }, [nodes, edges]);

  // タッチ操作（パン・ピンチ・ダブルタップ・ノードタップ）
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let lastTouches: { x: number; y: number }[] = [];
    let lastDist = 0;
    let lastTapTime = 0;
    let moved = false;

    const getTouches = (e: TouchEvent) =>
      Array.from(e.touches).map((t) => ({ x: t.clientX, y: t.clientY }));

    const onStart = (e: TouchEvent) => {
      lastTouches = getTouches(e);
      moved = false;
      if (e.touches.length === 2) {
        const dx = lastTouches[0].x - lastTouches[1].x;
        const dy = lastTouches[0].y - lastTouches[1].y;
        lastDist = Math.sqrt(dx * dx + dy * dy);
      }
    };

    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      const touches = getTouches(e);
      if (touches.length === 1 && lastTouches.length >= 1) {
        const dx = touches[0].x - lastTouches[0].x;
        const dy = touches[0].y - lastTouches[0].y;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
      } else if (touches.length === 2) {
        moved = true;
        const dx = touches[0].x - touches[1].x;
        const dy = touches[0].y - touches[1].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (lastDist > 0) {
          const factor = dist / lastDist;
          setTransform((t) => ({ ...t, scale: Math.max(0.2, Math.min(4, t.scale * factor)) }));
        }
        lastDist = dist;
      }
      lastTouches = touches;
    };

    const onEnd = (e: TouchEvent) => {
      if (e.touches.length > 0) return;
      const now = Date.now();
      if (!moved) {
        // タップ位置のノード判定
        const rect = container.getBoundingClientRect();
        const t = transformRef.current;
        const touch = lastTouches[0];
        if (touch) {
          const gx = (touch.x - rect.left - rect.width / 2 - t.x) / t.scale;
          const gy = (touch.y - rect.top - rect.height / 2 - t.y) / t.scale;
          let hit: GraphNode | null = null;
          for (const n of nodesRef.current) {
            const r = Math.min(16, 5 + n.degree * 1.5) + 12;
            if ((n.x - gx) ** 2 + (n.y - gy) ** 2 < r * r) {
              hit = n;
              break;
            }
          }
          if (hit) {
            onSelectNoteRef.current(hit.id);
            return;
          }
        }
        // ダブルタップでズームイン
        if (now - lastTapTime < 300) {
          setTransform((t2) => ({ ...t2, scale: Math.min(4, t2.scale * 1.6) }));
        }
        lastTapTime = now;
      }
    };

    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onEnd);
    // マウス（開発用）
    let mouseDown = false;
    let lastMouse = { x: 0, y: 0 };
    const onMouseDown = (e: MouseEvent) => { mouseDown = true; lastMouse = { x: e.clientX, y: e.clientY }; moved = false; };
    const onMouseMove = (e: MouseEvent) => {
      if (!mouseDown) return;
      moved = true;
      setTransform((t) => ({ ...t, x: t.x + e.clientX - lastMouse.x, y: t.y + e.clientY - lastMouse.y }));
      lastMouse = { x: e.clientX, y: e.clientY };
    };
    const onMouseUp = (e: MouseEvent) => {
      mouseDown = false;
      if (!moved) {
        const rect = container.getBoundingClientRect();
        const t = transformRef.current;
        const gx = (e.clientX - rect.left - rect.width / 2 - t.x) / t.scale;
        const gy = (e.clientY - rect.top - rect.height / 2 - t.y) / t.scale;
        for (const n of nodesRef.current) {
          const r = Math.min(16, 5 + n.degree * 1.5) + 12;
          if ((n.x - gx) ** 2 + (n.y - gy) ** 2 < r * r) {
            onSelectNoteRef.current(n.id);
            break;
          }
        }
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setTransform((t) => ({ ...t, scale: Math.max(0.2, Math.min(4, t.scale * (e.deltaY < 0 ? 1.1 : 0.9))) }));
    };
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      canvas.removeEventListener('touchstart', onStart);
      canvas.removeEventListener('touchmove', onMove);
      canvas.removeEventListener('touchend', onEnd);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  const onSelectNoteRef = useRef(onSelectNote);
  onSelectNoteRef.current = onSelectNote;

  return (
    <div ref={containerRef} className="relative h-full w-full bg-[#070a13]">
      <canvas ref={canvasRef} className="h-full w-full touch-none" />
      <div className="pointer-events-none absolute left-4 top-3 text-xs text-gray-500">
        {centerNoteName ? `ローカルグラフ: ${noteTitle(centerNoteName)}` : 'ナレッジグラフ'}
        {' '}
        <span className="text-gray-600">({nodes.length}{isLimited ? ` / ${totalNodeCount}件` : '件'})</span>
        <br />
        ドラッグ移動 / ピンチ拡大 / タップで開く
      </div>
      {isLimited && (
        <div className="pointer-events-none absolute left-4 top-12 right-12 rounded-lg bg-amber-900/60 border border-amber-500/30 px-3 py-1.5 text-[11px] text-amber-300">
          ⚠️ {totalNodeCount}件中{nodes.length}件を表示（リンク数順）
        </div>
      )}
      {centerNoteName && onCloseLocal && (
        <button
          onClick={onCloseLocal}
          className="absolute right-4 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-gray-300"
          aria-label="閉じる"
        >
          <X className="h-5 w-5" />
        </button>
      )}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">
          [[Wikiリンク]] を含むノートを作るとグラフが表示されます
        </div>
      )}
    </div>
  );
}
