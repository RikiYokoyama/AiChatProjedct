import React, { useEffect, useRef, useState, useCallback } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import forceAtlas2 from 'graphology-layout-forceatlas2';

// ============================================================
// カスタムトグルスイッチコンポーネント (HTML5ボタンベース)
// ============================================================
interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ checked, onChange, label }) => {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between w-full cursor-pointer select-none focus:outline-none py-1 group"
    >
      <span className="text-xs font-semibold text-gray-300 group-hover:text-white transition-colors">{label}</span>
      <div
        className={`w-9 h-5 rounded-full transition-colors relative flex items-center px-0.5 shrink-0 ${
          checked ? 'bg-[#00aaff]' : 'bg-gray-800'
        }`}
      >
        <div
          className={`w-4 h-4 bg-white rounded-full transition-transform shadow-md ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </div>
    </button>
  );
};

const FORCE_ATLAS2_SETTINGS = {
  settings: {
    gravity: 0.05,
    scalingRatio: 22,
    barnesHutOptimize: true,
    barnesHutTheta: 0.5,
    linLogMode: false,
    outboundAttractionDistribution: true,
    adjustSizes: true,
    edgeWeightInfluence: 0,
    strongGravityMode: false
  }
};

interface Note {
  name: string;
  path: string;
  updatedAt: string;
  content: string;
  tags?: string[];
  wikiLinks?: string[];
}

interface GraphViewProps {
  notes: Note[];
  onSelectNote: (note: Note) => void;
  onClose: () => void;
}

// ============================================================
// ★ ForceAtlas2 パラメータ調整 ★
// ============================================================
const FORCEATLAS2_SETTINGS = {
  settings: {
    gravity: 0.05,                        // 全体が散らばりすぎないように中心に引き戻す重力 (Obsidian風に緩める)
    scalingRatio: 12,                     // 反発力の強さ。クラスター同士の距離を広げる (反発力を少し弱めて密着度を向上)
    barnesHutOptimize: true,              // 大規模グラフ向け最適化（万ノード対応）
    barnesHutTheta: 0.5,                  // Barnes-Hut精度 (0.1=高精度, 1.2=高速)
    linLogMode: false,                    // クラスターの分離速度を向上させるため、のろのろ動く対数モードを無効化
    outboundAttractionDistribution: true, // ハブノードが適切に周囲を惹きつける
    adjustSizes: true,                    // ノードのサイズを考慮して重なりを防ぐ (重なりを防ぎつつ、高密度にパッキング)
    edgeWeightInfluence: 0,
    strongGravityMode: false,
  }
};

// ============================================================
// カラーパレット
// ============================================================
const COLORS = {
  bg: '#070a13',
  nodeDefault: '#cccccc', // ノートノードのデフォルト（薄いグレー）
  nodeHub: '#7c3aed',
  nodeMedium: '#2563eb',
  nodeGhost: '#4a5568',
  nodeTag: '#00aaff',   // タグノード（明るい青）
  edgeDefault: 'rgba(74,85,104,0.15)',
  edgeTag: 'rgba(0,170,255,0.2)', // タグ接続用の半透明エッジ
  edgeHighlight: 'rgba(0,170,255,0.8)',
  nodeHighlight: '#00ccff',
  nodeFaded: 'rgba(120,120,120,0.1)',
  edgeFaded: 'rgba(45,55,72,0.02)',
  labelDefault: '#94a3b8',
  labelHighlight: '#e2e8f0',
};

// ============================================================
// Circular配置を手動計算
// ============================================================
function assignCircularLayout(graph: Graph, scale = 200) {
  const nodes = graph.nodes();
  const count = nodes.length;
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / count;
    graph.setNodeAttribute(node, 'x', scale * Math.cos(angle) + (Math.random() - 0.5) * 10);
    graph.setNodeAttribute(node, 'y', scale * Math.sin(angle) + (Math.random() - 0.5) * 10);
  });
}

// ============================================================
// ノート群からgraphologyグラフを構築 (タグを含むかどうか)
// ============================================================
function buildGraphFromNotes(notes: Note[], showTags: boolean): Graph {
  const graph = new Graph({ multi: false });
  const noteMap = new Map<string, Note>();

  // 1. ノートノードの追加
  notes.forEach(note => {
    const id = note.name.replace(/\.md$/i, '');
    noteMap.set(id.toLowerCase(), note);
    if (!graph.hasNode(id)) {
      graph.addNode(id, { label: id, nodeType: 'note', size: 4, color: COLORS.nodeDefault });
    }
  });

  // 2. エッジ（WikiLinks）とタグノードの追加
  notes.forEach(note => {
    const srcId = note.name.replace(/\.md$/i, '');

    // WikiLinks の解決 (事前パース済みの note.wikiLinks を使用)
    const links = note.wikiLinks || [];
    links.forEach(link => {
      const targetKey = link.toLowerCase();
      const targetNote = noteMap.get(targetKey);
      const targetId = targetNote ? targetNote.name.replace(/\.md$/i, '') : link;

      if (!graph.hasNode(targetId)) {
        graph.addNode(targetId, { label: targetId, ghost: true, nodeType: 'note', size: 4, color: COLORS.nodeGhost });
      }
      // 安全なリンク作成チェック
      if (srcId !== targetId && graph.hasNode(srcId) && graph.hasNode(targetId) && !graph.hasEdge(srcId, targetId)) {
        try { graph.addEdge(srcId, targetId, { edgeType: 'wiki' }); } catch (_) { /* ignore */ }
      }
    });

    // タグノードの接続 (事前パース済みの note.tags を使用)
    if (showTags) {
      const tags = note.tags || [];
      tags.forEach(tag => {
        const tagId = `#${tag}`;
        if (!graph.hasNode(tagId)) {
          graph.addNode(tagId, { label: tagId, nodeType: 'tag', size: 15, color: COLORS.nodeTag });
        }
        // 安全なリンク作成チェック
        if (graph.hasNode(srcId) && graph.hasNode(tagId) && !graph.hasEdge(srcId, tagId)) {
          try { graph.addEdge(srcId, tagId, { edgeType: 'tag-link' }); } catch (_) { /* ignore */ }
        }
      });
    }
  });

  return graph;
}

// ============================================================
// モックデータ（ノートが少ない場合のデモ用）
// モックデータ（ノートが少ない場合のデモ用）
// ============================================================
const MOCK_NODES = [
  // ハブタグ
  { id: '#work',        label: '#work',        type: 'tag' },
  { id: '#reading',     label: '#reading',     type: 'tag' },
  { id: '#projects',    label: '#projects',    type: 'tag' },
  { id: 'note-atomic',       label: 'アトミックノート',   type: 'note' },
  { id: 'note-linking',      label: 'ノート間リンク術',   type: 'note' },
  { id: 'note-capture',      label: 'インプット収集',     type: 'note' },
  { id: 'note-review',       label: '定期レビュー',       type: 'note' },
  { id: 'note-tags',         label: 'タグ設計',           type: 'note' },
  { id: 'note-ai-chat',      label: 'AIとの対話ログ',     type: 'note' },
  { id: 'note-workflow',     label: 'ワークフロー設計',   type: 'note' },
  { id: 'note-prompt',       label: 'プロンプト集',       type: 'note' },
  { id: 'note-gemini',       label: 'Gemini活用法',       type: 'note' },
  { id: 'note-reading-log',  label: '読書メモ',           type: 'note' },
  { id: 'note-pkm',          label: 'PKMシステム',        type: 'note' },
  { id: 'note-output',       label: 'アウトプット戦略',   type: 'note' },
];
const MOCK_EDGES = [
  // タグへの接続（ハブ構造の形成）
  { source: 'note-atomic',      target: '#work' },
  { source: 'note-linking',     target: '#work' },
  { source: 'note-review',      target: '#work' },
  { source: 'note-tags',        target: '#work' },
  { source: 'note-pkm',         target: '#work' },

  { source: 'note-reading-log', target: '#reading' },
  { source: 'note-capture',     target: '#reading' },
  { source: 'note-prompt',      target: '#reading' },

  { source: 'note-workflow',    target: '#projects' },
  { source: 'note-ai-chat',     target: '#projects' },
  { source: 'note-gemini',      target: '#projects' },
  { source: 'note-output',      target: '#projects' },

  // WikiLinkエッジ
  { source: 'note-atomic',      target: 'note-linking' },
  { source: 'note-linking',     target: 'note-tags' },
  { source: 'note-ai-chat',     target: 'note-prompt' },
  { source: 'note-ai-chat',     target: 'note-gemini' },
  { source: 'note-pkm',         target: 'note-atomic' },
];

// ============================================================
// モックデータからgraphologyグラフを構築
// ============================================================
function buildMockGraph(): Graph {
  const graph = new Graph({ multi: false });
  MOCK_NODES.forEach(n => {
    const isTag = n.type === 'tag';
    graph.addNode(n.id, { 
      label: n.label, 
      nodeType: n.type,
      size: isTag ? 15 : 4,
      color: isTag ? COLORS.nodeTag : COLORS.nodeDefault,
      labelColor: COLORS.labelDefault
    });
  });
  MOCK_EDGES.forEach(e => {
    if (graph.hasNode(e.source) && graph.hasNode(e.target) && !graph.hasEdge(e.source, e.target)) {
      const isTagLink = e.target.startsWith('#');
      try { 
        graph.addEdge(e.source, e.target, { edgeType: isTagLink ? 'tag-link' : 'wiki' }); 
      } catch (_) { /* ignore */ }
    }
  });
  return graph;
}

const GraphView: React.FC<GraphViewProps> = ({ notes, onSelectNote, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null
  const [showTags, setShowTags] = useState(true); // 初期状態でタグを有効化して美しい星雲を見せる
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string } | null>(null);
  
  const [isSimulating, setIsSimulating] = useState(true);
  const isSimulatingRef = useRef(true);
  const [isFastSim, setIsFastSim] = useState(false);
  const isFastSimRef = useRef(false);
  const requestRef = useRef<number | null>(null);

  useEffect(() => {
    isSimulatingRef.current = isSimulating;
  }, [isSimulating]);

  useEffect(() => {
    simSpeedRef.current = simSpeed;
  }, [simSpeed]);

  const applyHighlight = useCallback((_sigma: Sigma, graph: Graph, nodeId: string | null) => {
    if (!nodeId) {
      graph.forEachNode(node => {
        const nodeType = graph.getNodeAttribute(node, 'nodeType');
        const ghost = graph.getNodeAttribute(node, 'ghost');
        const color = nodeType === 'tag' ? COLORS.nodeTag
          : ghost ? COLORS.nodeGhost
          : COLORS.nodeDefault;

        graph.setNodeAttribute(node, 'color', color);
        graph.setNodeAttribute(node, 'labelColor', COLORS.labelDefault); // 全員透明に戻す
        graph.setNodeAttribute(node, 'highlighted', false);
      });
      graph.forEachEdge(edge => {
        const edgeType = graph.getEdgeAttribute(edge, 'edgeType');
        graph.setEdgeAttribute(edge, 'color', edgeType === 'tag-link' ? COLORS.edgeTag : COLORS.edgeDefault);
      });
      return;
    }

    const neighbors = new Set(graph.neighbors(nodeId));
    neighbors.add(nodeId);

    graph.forEachNode(node => {
      if (neighbors.has(node)) {
        const nodeType = graph.getNodeAttribute(node, 'nodeType');
        graph.setNodeAttribute(node, 'color', nodeType === 'tag' ? COLORS.nodeTag : COLORS.nodeHighlight);
        graph.setNodeAttribute(node, 'labelColor', COLORS.labelHighlight); // ホバーとその隣接だけ白く浮かび上がらせる
        graph.setNodeAttribute(node, 'highlighted', true);
      } else {
        graph.setNodeAttribute(node, 'color', COLORS.nodeFaded);
        graph.setNodeAttribute(node, 'labelColor', 'rgba(0,0,0,0)'); // 他は完全透明
        graph.setNodeAttribute(node, 'highlighted', false);
      }
    });

    graph.forEachEdge((edge, _attrs, source, target) => {
      if (neighbors.has(source) && neighbors.has(target)) {
        graph.setEdgeAttribute(edge, 'color', COLORS.edgeHighlight);
      } else {
        graph.setEdgeAttribute(edge, 'color', COLORS.edgeFaded);
      }
    });
  }, []);

  // グラフのロード・初期化
  const initializeGraph = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // コンテナの幅または高さが0の場合は、ブラウザの描画タイミングを待つために次のフレームで再試行する
    if (container.clientWidth === 0 || container.clientHeight === 0) {
      requestAnimationFrame(() => initializeGraph());
      return;
    }

    try {
      // 前回のSigmaインスタンスがあれば破棄
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
      }

      // グラフ構築
      const hasRealNotes = notes.length > 2;
      const graph = hasRealNotes ? buildGraphFromNotes(notes, showTags) : buildMockGraph();

      if (graph.order === 0) return;

      setNodeCount(graph.order);
      setEdgeCount(graph.size);

      // 配置の初期化 (初期円を大きくして分散しやすくする)
      assignCircularLayout(graph, 500);

      // 初期同期配置計算 (初期位置での重なりをあらかじめほぐしておく)
      forceAtlas2.assign(graph, {
        iterations: 50,
        settings: FORCEATLAS2_SETTINGS.settings
      });

      // Sigma初期化
      const sigma = new Sigma(graph, container, {
        renderEdgeLabels: false,
        defaultEdgeColor: COLORS.edgeDefault,
        defaultNodeColor: COLORS.nodeDefault,
        labelColor: { color: COLORS.labelDefault },
        labelSize: 11,
        labelWeight: '600',
        labelFont: 'Inter, system-ui, sans-serif',
        labelRenderedSizeThreshold: 5,
        minCameraRatio: 0.03,
        maxCameraRatio: 10,
      });
      sigmaRef.current = sigma;

      // リアルタイム物理シミュレーションループ
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }

      // 物理の微振動を抑えるための状態変数
      let prevTotalMovement = 999999;

      const loop = () => {
        if (isSimulatingRef.current && sigmaRef.current) {
          try {
            const speed = simSpeedRef.current;
            const nodeCount = graph.order;
            
            // 60FPS以上の描画の「ぬるぬるした滑らかさ」と「極めて速い収束」を両立させるチューニング
            const dynamicIterations = 3;
            const dynamicSlowDown = Math.max(0.02, 10.0 - (speed * 0.00998));
            const dynamicScalingRatio = 12 + (speed * 0.388); // 1000x 時は最大 400
            const dynamicGravity = 0.05 + (speed * 0.00195); // 1000x 時は最大 2.0
              prevCoords[node] = {
                x: graph.getNodeAttribute(node, 'x') as number,
                y: graph.getNodeAttribute(node, 'y') as number
              };
            });

            forceAtlas2.assign(graph, {
              iterations: dynamicIterations,
              settings: {
                ...FORCEATLAS2_SETTINGS.settings,
                slowDown: dynamicSlowDown,
                scalingRatio: dynamicScalingRatio,
                gravity: dynamicGravity
              }
            });

            // ノードの合計移動量を算出
 

              const prev = prevCoords[node];
              if (prev) {
                const dx = (graph.getNodeAttribute(node, 'x') as number) - prev.x;
                const dy = (graph.getNodeAttribute(node, 'y') as number) - prev.y;
                totalMovement += Math.sqrt(dx * dx + dy * dy);
              }
            });

            // 平均移動量が極めて小さくなった（配置完了した）ら、自動でシミュレーションを停止して静止させる
            const nodeCount = graph.order;
            const threshold = nodeCount * 0.05; // 1ノードあたり平均0.05ピクセル以下の移動
            if (nodeCount > 0 && totalMovement < threshold) {
              setIsSimulating(false); // UI状態とシミュレーションを自動スリープ
            }

            sigmaRef.current.refresh();
          } catch (e) {
            console.error("Simulation iteration failed:", e);
          }
        }
        requestRef.current = requestAnimationFrame(loop);
      };
      loop();

      // イベントリスナー
      sigma.on('enterNode', ({ node }) => {
        applyHighlight(sigma, graph, node);
        const nodeX = graph.getNodeAttribute(node, 'x') as number;
        const nodeY = graph.getNodeAttribute(node, 'y') as number;
        const vp = sigma.graphToViewport({ x: nodeX, y: nodeY });
        setTooltip({
          x: vp.x + 18,
          y: vp.y - 12,
          label: graph.getNodeAttribute(node, 'label') as string || node,
        });
      });

      sigma.on('leaveNode', () => {
        applyHighlight(sigma, graph, null);
        setTooltip(null);
      });

      sigma.on('clickNode', ({ node }) => {
        const nodeType = graph.getNodeAttribute(node, 'nodeType');
        if (nodeType === 'tag') return; // タグクリック時は何もしない

        const found = notes.find(n =>
          n.name.replace(/\.md$/i, '').toLowerCase() === node.toLowerCase()
        );
        if (found) {
          onSelectNote(found);
          onClose();
        }
      });

      let draggedNode: string | null = null;
      sigma.on('downNode', ({ node }) => {
        draggedNode = node;
        sigma.getCamera().disable();
      });

      sigma.getMouseCaptor().on('mousemovebody', (coords) => {
        if (!draggedNode) return;
        const pos = sigma.viewportToGraph({ x: coords.x, y: coords.y });
        graph.setNodeAttribute(draggedNode, 'x', pos.x);
        graph.setNodeAttribute(draggedNode, 'y', pos.y);
        // シミュレーション停止中もドラッグの挙動を即座に描画反映
        if (!isSimulatingRef.current) {
          sigma.refresh();
        }
        }
      });

      sigma.getMouseCaptor().on('mouseup', () => {
        draggedNode = null;
        sigma.getCamera().enable();
      });

    } catch (err) {
      console.error("Sigma initialization failed:", err);
        graph.setNodeAttribute(draggedNode, 'y', pos.y);
        // シミュレーション停止中もドラッグの挙動を即座に描画反映
        if (!isSimulatingRef.current) {
          sigma.refresh();
        }
      });

      sigma.getMouseCaptor().on('mouseup', () => {
        draggedNode = null;
        sigma.getCamera().enable();
      });

    } catch (err) {
      console.error("Sigma initialization failed:", err);
    }
  }, [notes, showTags, applyHighlight, onClose, onSelectNote]);

  useEffect(() => {
    initializeGraph();
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
      }
    };
  }, [initializeGraph]);

  // タグ表示切り替え時に、物理シミュレーションを自動で再開させて再配置を促す
  useEffect(() => {
    setIsSimulating(true);
  }, [showTags]);

  return (
    <div
      className="fixed inset-y-0 left-16 right-0 z-[100] flex flex-col"
      style={{ background: COLORS.bg }}
    >
      {/* ヘッダー */}
      <div
        className="flex items-center justify-between px-5 py-3 border-b shrink-0 z-10"
        style={{ borderColor: 'rgba(74,85,104,0.2)', background: 'rgba(7,10,19,0.96)' }}
      >
        <div className="flex items-center space-x-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00aaff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
          <span className="font-semibold text-sm" style={{ color: '#e2e8f0' }}>グラフビュー (クラスター)</span>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: 'rgba(0,170,255,0.15)', color: '#00aaff', border: '1px solid rgba(0,170,255,0.3)' }}
          >
            {nodeCount} ノード · {edgeCount} エッジ
          </span>
        </div>

        <div className="flex items-center space-x-4">
          {/* 閉じる */}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-all hover:bg-gray-800"
            style={{ color: '#64748b' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {/* グラフキャンバス */}
      <div ref={containerRef} className="flex-1 w-full z-0 relative" style={{ cursor: 'grab', position: 'relative' }} />

      {/* ツールチップ */}
      {tooltip && (
        <div
          className="fixed pointer-events-none z-[120] px-2.5 py-1.5 rounded-lg text-xs font-medium shadow-xl"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            background: 'rgba(13,17,23,0.95)',
            border: '1px solid rgba(0,170,255,0.4)',
            color: '#e2e8f0',
            maxWidth: 220,
            backdropFilter: 'blur(8px)',
          }}
        >
          {tooltip.label}
            </div>
          ))}
        </div>
        <div className="pt-1.5 border-t text-[10px] leading-relaxed" style={{ borderColor: 'rgba(74,85,104,0.2)', color: '#475569' }}>
          ホイール：ズーム　ドラッグ：全体移動<br />
          ノードドラッグ：個別移動　クリック：ノートを開く
        </div>
      </div>
    </div>
  );
};
export default GraphView;

      className="fixed inset-y-0 left-16 right-0 z-40 flex flex-col"
      style={{ background: COLORS.bg }}
    >
      {/* ヘッダー */}
      <div
        className="flex items-center justify-between px-5 py-3 border-b shrink-0 z-10"
        style={{ borderColor: 'rgba(74,85,104,0.2)', background: 'rgba(7,10,19,0.96)' }}
      >
        <div className="flex items-center space-x-3">
              <span className="text-xs font-semibold text-gray-300">速度倍率</span>
              <span className="text-xs font-bold text-[#00aaff]">{simSpeed}x</span>
            </div>
            <input
              type="range"
              min="1"
              max="1000"
              value={simSpeed}
              onChange={(e) => setSimSpeed(Number(e.target.value))}
              className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-[#00aaff] focus:outline-none"
            />
          </div>
        </div>

        <div className="font-bold text-gray-400 text-[10px] tracking-wider uppercase pt-1">凡例</div>
        <div className="space-y-1.5">
          {[
            { color: COLORS.nodeTag,     label: 'タグノード (#) - 大サイズ' },
            { color: COLORS.nodeDefault, label: '通常ノート - 小サイズ' },
            { color: COLORS.nodeGhost,   label: '未作成ノート（WikiLink先）' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ background: color }} />
              <span style={{ color: '#94a3b8' }}>{label}</span>
            </div>
          ))}
        </div>
        <div className="pt-1.5 border-t text-[10px] leading-relaxed" style={{ borderColor: 'rgba(74,85,104,0.2)', color: '#475569' }}>
          ホイール：ズーム　ドラッグ：全体移動<br />
          ノードドラッグ：個別移動　クリック：ノートを開く
        </div>
      </div>
    </div>
  );
};
export default GraphView;

          {/* 閉じる */}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-all hover:bg-gray-800"
            style={{ color: '#64748b' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {/* グラフキャンバス */}
      <div ref={containerRef} className="flex-1 w-full z-0" style={{ cursor: 'grab' }} />

      {/* ツールチップ */}
      {tooltip && (
        <div
          className="fixed pointer-events-none z-[60] px-2.5 py-1.5 rounded-lg text-xs font-medium shadow-xl"
          style={{
            le
      const ctx = canvas?.getContext('2d');
      const container = containerRef.current;
      if (!canvas || !ctx || !container) {
            color: '#e2e8f0',
            maxWidth: 220,
            backdropFilter: 'blur(8px)',
          }}
        >
          {tooltip.label}
        </div>
      )}

      {/* 凡例パネル */}
      <div
        className="absolute bottom-4 left-4 rounded-xl px-4 py-3 text-xs space-y-1.5 z-10"
        style={{
          background: 'rgba(13,17,23,0.88)',
          border: '1px solid rgba(74,85,104,0.2)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div className="font-semibold mb-2" style={{ color: '#64748b' }}>凡例</div>
        {[
          { color: COLORS.nodeHub,     label: 'ハブノード (8+リンク)' },
          { color: COLORS.nodeMedium,  label: '中程度のノード (5+リンク)' },
          { color: COLORS.nodeDefault, label: '通常ノート' },
          { color: COLORS.nodeGhost,   label: '未作成リンク先' },
          ...(showTags ? [{ color: COLORS.nodeTag, label: 'タグノード (#)' }] : []),
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ background: color }} />
            <span style={{ color: '#94a3b8' }}>{label}</span>
          </div>
        ))}
        <div className="pt-1.5 border-t text-[10px] leading-relaxed" style={{ borderColor: 'rgba(74,85,104,0.2)', color: '#475569' }}>
          ホイール：ズーム　ドラッグ：全体移動<br />
          ノードドラッグ：個別移動　クリック：ノートを開く
        </div>
      </div>
    </div>
  );
};

export default GraphView;
