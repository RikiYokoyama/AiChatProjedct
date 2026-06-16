import { useEffect, useMemo, useRef, useState } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { X, Eye, Video, Settings, RotateCcw, Plus, Trash, Play, Pause } from 'lucide-react';
import * as THREE from 'three';

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
  isLocal?: boolean;
  centerNoteName?: string;
}

interface GroupRule {
  query: string;
  color: string;
}

// グラフ設定の初期値
const defaultSettings = {
  // フィルタ
  searchQuery: '',
  showTags: true,
  showAttachments: true,
  existingOnly: false,
  showOrphans: true,
  excludePattern: '',

  // 表示
  showArrows: false,
  showLinks: false, // リンク線をデフォルトで非表示にする
  showLabels: true, // ファイル名（ラベル）表示
  textFadeThreshold: 1,
  nodeSize: 1.0,
  linkThickness: 1.0,
  nodeColor: '#a5b4fc', // デフォルトノード色
  linkColor: '#334155', // デフォルトリンク色

  // 力の強さ
  centerForce: 0.5,
  repulsion: 1.0,
  linkForce: 1.0,
  linkDistance: 15,
  repulsionDistance: 15.0, // ノード反発距離
  linkRepulsionDistance: 5.0, // 接続ノード反発距離
};

function noteId(note: Note) {
  return note.name.replace(/\.md$/i, '');
}

function parseFrontmatterTags(content: string): string[] {
  const tags: string[] = [];
  const lines = content.split('\n');
  let inFrontmatter = false;
  for (let line of lines) {
    line = line.trim();
    if (line === '---') {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) {
      if (line.startsWith('tags:') || line.startsWith('tag:')) {
        const tagPart = line.substring(line.indexOf(':') + 1).trim();
        // [tag1, tag2] 形式または カンマ区切りまたはスペース区切り
        const cleaned = tagPart.replace(/[\[\]]/g, '');
        cleaned.split(/[\s,]+/).forEach((t) => {
          const ct = t.trim().replace(/^#/, '');
          if (ct) tags.push(ct);
        });
      }
    }
  }
  // 本文中の #タグ も簡易抽出
  const hashTagRegex = /(?:^|\s)#([a-zA-Z0-9_\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\-]+)/g;
  let match;
  while ((match = hashTagRegex.exec(content)) !== null) {
    const tag = match[1].trim();
    if (tag && !tags.includes(tag) && isNaN(Number(tag))) {
      tags.push(tag);
    }
  }
  return tags;
}

export default function GraphView({ notes, onSelectNote, onClose, isLocal = false, centerNoteName }: GraphViewProps) {
  const containerRef2D = useRef<HTMLDivElement>(null);
  const containerRef3D = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const sigmaRef = useRef<Sigma | null>(null);
  const lineMaterialRef = useRef<THREE.LineBasicMaterial | null>(null);
  const coneMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const [viewMode, setViewMode] = useState<'2D' | '3D'>('2D');
  const [showSettings, setShowSettings] = useState(false);

  // ローカルグラフ用の深さ（デフォルト2）
  const [localDepth, setLocalDepth] = useState<number>(2);

  // 設定状態 (2Dと3Dで分離)
  const [settings2D, setSettings2D] = useState(defaultSettings);
  const [settings3D, setSettings3D] = useState(defaultSettings);
  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);

  // 現在のアクティブな設定を動的に取得・更新するヘルパー
  const settings = viewMode === '2D' ? settings2D : settings3D;
  const setSettings = viewMode === '2D' ? setSettings2D : setSettings3D;

  // 手動でドラッグして固定されたノードの座標管理用Ref (初期化時は一度空にする)
  const fixedNodes2D = useRef<Record<string, { x: number; y: number }>>({});
  const fixedNodes3D = useRef<Record<string, { x: number; y: number; z?: number }>>({});

  // グループ設定
  const [groupRules, setGroupRules] = useState<GroupRule[]>([]);
  const [newGroupQuery, setNewGroupQuery] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#818cf8');

  // ノードの一時停止
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(isPaused);
  const worker2DInstanceRef = useRef<any>(null);

  useEffect(() => {
    isPausedRef.current = isPaused;
    if (worker2DInstanceRef.current) {
      if (isPaused) {
        worker2DInstanceRef.current.stop();
      } else {
        worker2DInstanceRef.current.start();
      }
    }
  }, [isPaused]);

  // 設定および手動固定座標の読み込み効果
  useEffect(() => {
    // まず設定を読み込む
    window.electronAPI.loadGraphSettings().then((saved) => {
      if (saved) {
        if (saved['2d']) setSettings2D((prev) => ({ ...prev, ...saved['2d'] }));
        if (saved['3d']) setSettings3D((prev) => ({ ...prev, ...saved['3d'] }));
      }
      setIsSettingsLoaded(true);
    });

    // 固定された座標を読み込む
    window.electronAPI.loadCoordinates().then((coords) => {
      if (coords) {
        if (coords['2d']) fixedNodes2D.current = coords['2d'];
        if (coords['3d']) fixedNodes3D.current = coords['3d'];
      }
    });
  }, []);

  // 設定保存効果 (2D)
  useEffect(() => {
    if (!isSettingsLoaded) return;
    window.electronAPI.saveGraphSettings({ '2d': settings2D });
  }, [settings2D, isSettingsLoaded]);

  // 設定保存効果 (3D)
  useEffect(() => {
    if (!isSettingsLoaded) return;
    window.electronAPI.saveGraphSettings({ '3d': settings3D });
  }, [settings3D, isSettingsLoaded]);

  const saveAllCoordinates = () => {
    window.electronAPI.saveCoordinates({
      '2d': fixedNodes2D.current,
      '3d': fixedNodes3D.current
    });
  };

  const resetToDefaults = () => {
    setSettings2D(defaultSettings);
    setSettings3D(defaultSettings);
    setGroupRules([]);
  };

  const addGroupRule = () => {
    if (!newGroupQuery.trim()) return;
    setGroupRules([...groupRules, { query: newGroupQuery.trim(), color: newGroupColor }]);
    setNewGroupQuery('');
  };

  const removeGroupRule = (index: number) => {
    setGroupRules(groupRules.filter((_, i) => i !== index));
  };

  // 初期配置リセット（手動固定座標のクリア & 力学の再スタート用）
  const handleResetCoordinates = () => {
    if (viewMode === '2D') {
      fixedNodes2D.current = {};
    } else {
      fixedNodes3D.current = {};
    }
    saveAllCoordinates();
    // settings をトリガーして useEffect を再起動
    setSettings({ ...settings });
  };

  // グラフ構築ロジック（フィルタ・グループ・タグ展開などを適用）
  const graph = useMemo(() => {
    const g = new Graph();
    const byId = new Map<string, Note>();
    const noteList = [...notes];

    // 全てのノートからタグや更新日時をパースして保持
    const notesParsed = noteList.map((note) => {
      const parsedTags = parseFrontmatterTags(note.content);
      const allTags = Array.from(new Set([...(note.tags || []), ...parsedTags]));
      byId.set(noteId(note).toLowerCase(), { ...note, tags: allTags });
      return { ...note, tags: allTags };
    });

    let activeNotes = notesParsed;

    // 除外ファイルフィルタ
    if (settings.excludePattern.trim()) {
      try {
        const regex = new RegExp(settings.excludePattern.trim(), 'i');
        activeNotes = activeNotes.filter((n) => !regex.test(n.name));
      } catch (e) {
        // 正規表現が無効な場合は単純な部分一致
        const term = settings.excludePattern.toLowerCase();
        activeNotes = activeNotes.filter((n) => !n.name.toLowerCase().includes(term));
      }
    }

    // ローカルグラフのフィルタリング（深さ優先探索/幅優先探索）
    if (isLocal && centerNoteName) {
      const startId = centerNoteName.replace(/\.md$/i, '').toLowerCase();
      const visited = new Set<string>();
      visited.add(startId);

      let currentLevel = new Set<string>();
      currentLevel.add(startId);

      for (let depth = 0; depth < localDepth; depth++) {
        const nextLevel = new Set<string>();
        currentLevel.forEach((nid) => {
          // 該当ノートを探す
          const noteObj = notesParsed.find((n) => noteId(n).toLowerCase() === nid);
          if (noteObj) {
            // wikiLinksの接続先を収集
            noteObj.wikiLinks?.forEach((link) => {
              const targetId = link.toLowerCase();
              if (!visited.has(targetId)) {
                visited.add(targetId);
                nextLevel.add(targetId);
              }
            });
          }
          // 逆に、このノートをリンクしている他のノートも逆方向に辿る
          notesParsed.forEach((n) => {
            const sid = noteId(n).toLowerCase();
            n.wikiLinks?.forEach((link) => {
              if (link.toLowerCase() === nid && !visited.has(sid)) {
                visited.add(sid);
                nextLevel.add(sid);
              }
            });
          });
        });
        currentLevel = nextLevel;
      }

      // 該当するノートのみを有効とする
      activeNotes = activeNotes.filter((n) => visited.has(noteId(n).toLowerCase()));
    }

    // 存在するファイルのみを表示する場合の存在マップ
    const existMap = new Set(activeNotes.map((n) => noteId(n).toLowerCase()));

    // 1. ノード追加（ノートノード）
    activeNotes.forEach((note) => {
      const id = noteId(note);
      let color = settings.nodeColor; // デフォルトノード色

      // グループルールの適用
      for (const rule of groupRules) {
        if (
          id.toLowerCase().includes(rule.query.toLowerCase()) ||
          note.tags?.some((t) => t.toLowerCase().includes(rule.query.toLowerCase()))
        ) {
          color = rule.color;
          break;
        }
      }

      // 検索ワード一致によるハイライト
      if (settings.searchQuery.trim()) {
        const query = settings.searchQuery.toLowerCase();
        if (!id.toLowerCase().includes(query) && !note.tags?.some((t) => t.toLowerCase().includes(query))) {
          // 検索に一致しないノードは暗めのグレーにする
          color = '#334155';
        }
      }

      g.addNode(id, {
        label: id,
        size: settings.nodeSize * 8,
        color: color,
        updatedAt: note.updatedAt,
      });
    });

    // 2. タグノードの展開（オプション）
    if (settings.showTags) {
      const tagMap = new Map<string, string[]>(); // tag -> nodeIds
      activeNotes.forEach((note) => {
        const nid = noteId(note);
        note.tags?.forEach((tag) => {
          if (!tagMap.has(tag)) tagMap.set(tag, []);
          tagMap.get(tag)!.push(nid);
        });
      });

      tagMap.forEach((nids, tag) => {
        const tagNodeId = `#${tag}`;
        let color = '#34d399'; // タグ用のデフォルト色（エメラルド）
        
        // タグに対するグループ色
        for (const rule of groupRules) {
          if (tag.toLowerCase().includes(rule.query.toLowerCase())) {
            color = rule.color;
            break;
          }
        }

        g.addNode(tagNodeId, {
          label: tagNodeId,
          size: settings.nodeSize * 6,
          color: color,
        });

        // タグから各ノートへのリンクを追加
        nids.forEach((nid) => {
          if (g.hasNode(nid)) {
            g.addEdge(tagNodeId, nid, { color: '#10b981', size: settings.linkThickness * 0.8 });
          }
        });
      });
    }

    // 3. リンク（エッジ）の構築
    activeNotes.forEach((note) => {
      const source = noteId(note);
      note.wikiLinks?.forEach((link) => {
        const targetNote = byId.get(link.toLowerCase());
        const target = (targetNote ? noteId(targetNote) : link).replace(/\.md$/i, '');

        // 存在するファイルのみを表示かつターゲットが存在しない場合はスキップ
        if (settings.existingOnly && !existMap.has(target.toLowerCase())) {
          return;
        }

        if (!g.hasNode(target)) {
          // 存在しない（空のリンク）だがフィルタを通過したノードを追加
          let color = '#475569';
          g.addNode(target, {
            label: target,
            size: settings.nodeSize * 5,
            color: color,
          });
        }

        if (source !== target && !g.hasEdge(source, target)) {
          g.addEdge(source, target, { color: settings.linkColor, size: settings.linkThickness });
        }
      });
    });

    // 4. オーファン（孤立ノート）のフィルタリング
    if (!settings.showOrphans) {
      g.nodes().forEach((n) => {
        if (g.degree(n) === 0) {
          g.dropNode(n);
        }
      });
    }

    return g;
  }, [notes, settings, groupRules, isLocal, centerNoteName, localDepth]);

  // フィルタリング後の動的表示ノード・エッジ
  const activeElements = useMemo(() => {
    const nodes = graph.nodes();
    const edges = graph.edges().map((edge) => {
      const ext = graph.extremities(edge);
      return { id: edge, source: ext[0], target: ext[1] };
    });
    return { nodes, edges };
  }, [graph]);

  // 2D Sigma.js rendering update
  const settings2DRef = useRef(settings2D);
  useEffect(() => {
    settings2DRef.current = settings2D;
  }, [settings2D]);

  useEffect(() => {
    if (viewMode !== '2D' || !containerRef2D.current || !isSettingsLoaded) return;

    // 現在のアクティブな状態のサブグラフをビルド
    const subGraph = new Graph();
    activeElements.nodes.forEach((node) => {
      subGraph.addNode(node, graph.getNodeAttributes(node));
    });
    activeElements.edges.forEach((edge) => {
      subGraph.addEdge(edge.source, edge.target, graph.getEdgeAttributes(edge.id));
    });

    const nodesArray = subGraph.nodes();

    // 初期2D配置 (手動固定された座標がある場合は適用、なければ円形配置)
    subGraph.nodes().forEach((node, index) => {
      if (fixedNodes2D.current[node]) {
        subGraph.setNodeAttribute(node, 'x', fixedNodes2D.current[node].x);
        subGraph.setNodeAttribute(node, 'y', fixedNodes2D.current[node].y);
      } else {
        const angle = (Math.PI * 2 * index) / Math.max(subGraph.order, 1);
        subGraph.setNodeAttribute(node, 'x', Math.cos(angle) * 100);
        subGraph.setNodeAttribute(node, 'y', Math.sin(angle) * 100);
      }
    });

    const sigma = new Sigma(subGraph, containerRef2D.current, {
      renderEdgeLabels: false,
      defaultEdgeColor: settings2DRef.current.linkColor,
      defaultNodeColor: settings2DRef.current.nodeColor,
      labelColor: { color: '#dbeafe' },
      allowInvalidContainer: true,
      labelRenderedSizeThreshold: settings2DRef.current.showLabels 
        ? (settings2DRef.current.textFadeThreshold === 1 ? 0 : (settings2DRef.current.textFadeThreshold || 15)) 
        : 999,
      defaultDrawNodeHover: () => {},
      edgeReducer: (_, data) => {
        const res = { ...data };
        if (!settings2DRef.current.showLinks) {
          res.color = '#00000000';
          res.size = 0;
        }
        return res;
      },
    });
    sigmaRef.current = sigma;

    // ダブルクリックでファイルを開く
    sigma.on('doubleClickNode', ({ node }) => {
      const found = notes.find((note) => noteId(note) === node);
      if (found) onSelectNote(found);
    });

    // --- 2D標準の ForceAtlas2 WebWorker 物理エンジンの復活 ---
    let worker: any = null;

    import('graphology-layout-forceatlas2/worker').then(({ default: FA2LayoutWorker }) => {
      if (!sigmaRef.current || viewMode !== '2D') return;

      worker = new FA2LayoutWorker(subGraph, {
        settings: {
          gravity: settings2DRef.current.centerForce * 0.5,
          scalingRatio: settings2DRef.current.repulsion * 5.0,
          strongGravityMode: true,
          slowDown: 2.0, // 以前の普通のアニメーションスピード
          barnesHutOptimize: nodesArray.length > 300,
          barnesHutTheta: 0.6,
        }
      });

      worker2DInstanceRef.current = worker;

      // 物理演算開始（停止はautoStopWithFixで一元管理）
      if (!isPausedRef.current) {
        worker.start();
      }

      // ドラッグ固定ノードの座標を維持するためForceAtlas2停止後に1回だけ適用
      const applyFixedNodes = () => {
        nodesArray.forEach((node) => {
          if (fixedNodes2D.current[node]) {
            subGraph.setNodeAttribute(node, 'x', fixedNodes2D.current[node].x);
            subGraph.setNodeAttribute(node, 'y', fixedNodes2D.current[node].y);
          }
        });
        if (sigmaRef.current) sigmaRef.current.refresh();
      };

      // ForceAtlas2停止後に固定座標を反映して静止
      const autoStopWithFix = setTimeout(() => {
        if (worker && typeof worker.stop === 'function') worker.stop();
        applyFixedNodes();
      }, (nodesArray.length > 500 ? 3000 : 5000) + 100);

      return () => {
        clearTimeout(autoStopWithFix);
        if (worker) {
          worker.kill();
        }
      };
    });

    let draggedNode2D: string | null = null;
    let hoveredNode2D: string | null = null;

    sigma.on('enterNode', ({ node }) => {
      hoveredNode2D = node;
      if (tooltipRef.current) {
        tooltipRef.current.style.display = 'block';
        tooltipRef.current.textContent = node;
      }
    });

    sigma.on('leaveNode', () => {
      hoveredNode2D = null;
      if (tooltipRef.current) {
        tooltipRef.current.style.display = 'none';
      }
    });

    sigma.on('downNode', (e) => {
      draggedNode2D = e.node;
      sigma.getCamera().disable();
      if (worker && typeof worker.start === 'function') {
        worker.start();
      }
    });

    sigma.getMouseCaptor().on('mousemovebody', (e) => {
      if (!containerRef2D.current) return;
      const rect = containerRef2D.current.getBoundingClientRect();
      
      const clientX = 'clientX' in e.original ? e.original.clientX : (e.original as TouchEvent).touches[0].clientX;
      const clientY = 'clientY' in e.original ? e.original.clientY : (e.original as TouchEvent).touches[0].clientY;
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      if (draggedNode2D) {
        e.preventSigmaDefault();
        e.original.preventDefault();
        e.original.stopPropagation();

        const graphCoords = sigma.viewportToGraph({ x, y });
        subGraph.setNodeAttribute(draggedNode2D, 'x', graphCoords.x);
        subGraph.setNodeAttribute(draggedNode2D, 'y', graphCoords.y);
        sigma.refresh();

        if (tooltipRef.current) {
          tooltipRef.current.style.display = 'block';
          tooltipRef.current.textContent = draggedNode2D;
          tooltipRef.current.style.left = `${x + 12}px`;
          tooltipRef.current.style.top = `${y - 12}px`;
        }
      } else if (hoveredNode2D) {
        if (tooltipRef.current) {
          tooltipRef.current.style.display = 'block';
          tooltipRef.current.textContent = hoveredNode2D;
          tooltipRef.current.style.left = `${x + 12}px`;
          tooltipRef.current.style.top = `${y - 12}px`;
        }
      }
    });

    const handleMouseUp2D = () => {
      if (draggedNode2D) {
        const finalX = subGraph.getNodeAttribute(draggedNode2D, 'x') as number;
        const finalY = subGraph.getNodeAttribute(draggedNode2D, 'y') as number;
        fixedNodes2D.current[draggedNode2D] = { x: finalX, y: finalY };
        saveAllCoordinates();

        draggedNode2D = null;
        sigma.getCamera().enable();

        setTimeout(() => {
          if (worker && typeof worker.stop === 'function') {
            worker.stop();
          }
        }, 1000);
      }
      if (tooltipRef.current) {
        tooltipRef.current.style.display = 'none';
      }
    };

    sigma.getMouseCaptor().on('mouseup', handleMouseUp2D);
    window.addEventListener('mouseup', handleMouseUp2D);

    return () => {
      window.removeEventListener('mouseup', handleMouseUp2D);
      sigma.kill();
      sigmaRef.current = null;
      worker2DInstanceRef.current = null;
      if (containerRef2D.current) {
        containerRef2D.current.innerHTML = '';
      }
    };
  }, [graph, activeElements, viewMode, isSettingsLoaded, settings2D.showLinks, settings2D.showLabels, settings2D.textFadeThreshold, settings2D.centerForce, settings2D.repulsion, settings2D.nodeSize, settings2D.linkThickness, notes, onSelectNote, settings2D.nodeColor, settings2D.linkColor]);

  // リンク表示やファイル名表示の切り替え時にSigmaを再描画
  useEffect(() => {
    if (sigmaRef.current) {
      const sizeThreshold = settings2D.showLabels 
        ? (settings2D.textFadeThreshold === 1 ? 0 : (settings2D.textFadeThreshold || 15)) 
        : 999;
      sigmaRef.current.setSetting('labelRenderedSizeThreshold', sizeThreshold);
      sigmaRef.current.refresh();
    }
  }, [settings2D.showLinks, settings2D.showLabels, settings2D.textFadeThreshold]);

  // 3D Three.js rendering update
  const settings3DRef = useRef(settings3D);
  useEffect(() => {
    settings3DRef.current = settings3D;
  }, [settings3D]);

  useEffect(() => {
    if (viewMode !== '3D' || !containerRef3D.current || !isSettingsLoaded) return;

    const container = containerRef3D.current;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || (window.innerHeight - 48);

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#070a13');

    // Camera
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.z = 40;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const { nodes: targetNodes, edges: targetEdges } = activeElements;
    const nodePositions = new Map<string, THREE.Vector3>();

    // 3D初期配置（手動固定座標の復帰、なければ標準的なフィボナッチ球状配置）
    targetNodes.forEach((node, i) => {
      if (fixedNodes3D.current[node]) {
        const saved = fixedNodes3D.current[node];
        nodePositions.set(node, new THREE.Vector3(saved.x, saved.y, saved.z || 0));
      } else {
        const phi = Math.acos(-1 + (2 * i) / Math.max(targetNodes.length, 1));
        const theta = Math.sqrt(targetNodes.length * Math.PI) * phi;
        const radius = settings3DRef.current.linkDistance;
        const pos = new THREE.Vector3(
          radius * Math.cos(theta) * Math.sin(phi),
          radius * Math.sin(theta) * Math.sin(phi),
          radius * Math.cos(phi)
        );
        nodePositions.set(node, pos);
      }
    });

    // InstancedMesh を使ったノード描画
    const sphereGeometry = new THREE.SphereGeometry(0.6, 16, 16);
    const nodeMaterial = new THREE.MeshBasicMaterial();
    const instancedMesh = new THREE.InstancedMesh(sphereGeometry, nodeMaterial, targetNodes.length);

    const tempObject = new THREE.Object3D();
    const tempColor = new THREE.Color();
    targetNodes.forEach((node, i) => {
      const pos = nodePositions.get(node)!;
      const baseScale = graph.getNodeAttribute(node, 'size') / 8.0;
      tempObject.position.copy(pos);
      tempObject.scale.setScalar(baseScale * settings3DRef.current.nodeSize);
      tempObject.updateMatrix();
      instancedMesh.setMatrixAt(i, tempObject.matrix);

      const colorStr = graph.getNodeAttribute(node, 'color') || '#a5b4fc';
      tempColor.set(colorStr);
      instancedMesh.setColorAt(i, tempColor);
    });

    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) {
      instancedMesh.instanceColor.needsUpdate = true;
    }
    scene.add(instancedMesh);

    // エッジ (LineSegments)
    const lineMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(settings3D.linkColor),
      transparent: true,
      opacity: settings3D.showLinks ? 0.6 : 0.0,
      linewidth: settings3DRef.current.linkThickness,
    });
    lineMaterialRef.current = lineMaterial;
    const lineVertices: number[] = [];
    targetEdges.forEach(({ source, target }) => {
      const posA = nodePositions.get(source);
      const posB = nodePositions.get(target);
      if (posA && posB) {
        lineVertices.push(posA.x, posA.y, posA.z);
        lineVertices.push(posB.x, posB.y, posB.z);
      }
    });

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lineVertices, 3));
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    scene.add(lines);

    // 矢印表示 (コーン)
    const arrows: THREE.Mesh[] = [];
    const coneGeometry = new THREE.ConeGeometry(0.3, 0.8, 8);
    const coneMaterial = new THREE.MeshBasicMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: (settings3D.showLinks && settings3D.showArrows) ? 1.0 : 0.0,
    });
    coneMaterialRef.current = coneMaterial;

    targetEdges.forEach(({ source, target }) => {
      const posA = nodePositions.get(source);
      const posB = nodePositions.get(target);
      if (posA && posB) {
        const arrowMesh = new THREE.Mesh(coneGeometry, coneMaterial);
        const midPoint = new THREE.Vector3().lerpVectors(posA, posB, 0.7);
        arrowMesh.position.copy(midPoint);
        const dir = new THREE.Vector3().subVectors(posB, posA).normalize();
        const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        arrowMesh.setRotationFromQuaternion(quaternion);
        scene.add(arrowMesh);
        arrows.push(arrowMesh);
      }
    });

    // カメラドラッグ & ズーム
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };
    let rotation = { x: 0, y: 0 };
    let targetRotation = { x: 0, y: 0 };
    let distance = 40;
    let targetDistance = 40;
    let pan = new THREE.Vector3(0, 0, 0);
    let targetPan = new THREE.Vector3(0, 0, 0);
    let isRightDragging = false;

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let hoveredIndex: number | null = null;

    // 3Dドラッグ移動管理用変数
    let draggedInstanceId3D: number | null = null;
    let dragPlane = new THREE.Plane();
    let dragIntersection = new THREE.Vector3();
    let hasDragged3D = false;

    const handleMouseDown = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(instancedMesh);

      if (e.button === 0 && intersects.length > 0) {
        const idx = intersects[0].instanceId;
        if (idx !== undefined) {
          draggedInstanceId3D = idx;
          const nodePos = nodePositions.get(targetNodes[idx])!;
          const planeNormal = new THREE.Vector3();
          camera.getWorldDirection(planeNormal);
          planeNormal.negate();
          dragPlane.setFromNormalAndCoplanarPoint(planeNormal, nodePos);
          isDragging = false;
          hasDragged3D = false;
        }
      } else {
        isDragging = e.button === 0;
      }
      isRightDragging = e.button === 2;
      dragStart.x = e.clientX;
      dragStart.y = e.clientY;
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / height) * 2 + 1;

      if (draggedInstanceId3D !== null) {
        raycaster.setFromCamera(mouse, camera);
        if (raycaster.ray.intersectPlane(dragPlane, dragIntersection)) {
          const nodeName = targetNodes[draggedInstanceId3D];
          const pos = nodePositions.get(nodeName)!;
          if (pos.distanceTo(dragIntersection) > 0.01) {
            hasDragged3D = true;
          }
          pos.copy(dragIntersection);
          stepCount3D = 0; // スリープ解除

          if (tooltipRef.current) {
            tooltipRef.current.style.display = 'block';
            tooltipRef.current.textContent = nodeName;
            const screenPos = pos.clone().project(camera);
            const x = (screenPos.x * 0.5 + 0.5) * width;
            const y = (-(screenPos.y * 0.5) + 0.5) * height;
            tooltipRef.current.style.left = `${x + 12}px`;
            tooltipRef.current.style.top = `${y - 12}px`;
          }
        }
      } else if (isDragging) {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        targetRotation.y -= dx * 0.005;
        targetRotation.x -= dy * 0.005;
        targetRotation.x = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, targetRotation.x));
        dragStart.x = e.clientX;
        dragStart.y = e.clientY;
      } else if (isRightDragging) {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        const scale = distance * 0.001;
        const panDirX = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(-dx * scale);
        const panDirY = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(dy * scale);
        targetPan.add(panDirX).add(panDirY);
        dragStart.x = e.clientX;
        dragStart.y = e.clientY;
      }
    };

    const handleMouseUp = () => {
      if (draggedInstanceId3D !== null) {
        const nodeName = targetNodes[draggedInstanceId3D];
        const pos = nodePositions.get(nodeName)!;
        if (hasDragged3D) {
          fixedNodes3D.current[nodeName] = { x: pos.x, y: pos.y, z: pos.z };
          saveAllCoordinates();
        }
        draggedInstanceId3D = null;
      }
      isDragging = false;
      isRightDragging = false;
      if (tooltipRef.current) {
        tooltipRef.current.style.display = 'none';
      }
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      targetDistance += e.deltaY * 0.03;
      targetDistance = Math.max(1, Math.min(200, targetDistance));
    };

    const handleDoubleClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(instancedMesh);
      if (intersects.length > 0) {
        const instanceId = intersects[0].instanceId;
        if (instanceId !== undefined) {
          const clickedNode = targetNodes[instanceId];
          const found = notes.find((n) => noteId(n) === clickedNode);
          if (found) onSelectNote(found);
        }
      }
    };

    const preventDefault = (e: MouseEvent) => e.preventDefault();

    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('dblclick', handleDoubleClick);
    container.addEventListener('contextmenu', preventDefault);

    // 各ノードの隣接リストを事前に構築 (O(N + E) で1回だけ処理して高速化)
    const adjacencyMap = new Map<string, Set<string>>();
    targetNodes.forEach((node) => {
      adjacencyMap.set(node, new Set<string>());
    });
    targetEdges.forEach(({ source, target }) => {
      adjacencyMap.get(source)?.add(target);
      adjacencyMap.get(target)?.add(source);
    });

    // アニメーションフレーム (ここで物理計算を毎フレーム行う)
    let animationFrameId: number;
    let stepCount3D = 0;
    const maxSteps3D = 100; // 初期微調整は100ステップで十分

    // 外部の settings3D 変更を検知して物理演算を再稼働（ウェイクアップ）させるための監視
    let lastRepulsion = settings3DRef.current.repulsion;
    let lastLinkForce = settings3DRef.current.linkForce;
    let lastLinkDistance = settings3DRef.current.linkDistance;
    let lastCenterForce = settings3DRef.current.centerForce;
    let lastRepulsionDistance = settings3DRef.current.repulsionDistance;
    let lastLinkRepulsionDistance = settings3DRef.current.linkRepulsionDistance;

    const animate = () => {
      // 設定スライダーの値が変更されたら、自動的に物理演算をウェイクアップ（再稼働）
      if (
        settings3DRef.current.repulsion !== lastRepulsion ||
        settings3DRef.current.linkForce !== lastLinkForce ||
        settings3DRef.current.linkDistance !== lastLinkDistance ||
        settings3DRef.current.centerForce !== lastCenterForce ||
        settings3DRef.current.repulsionDistance !== lastRepulsionDistance ||
        settings3DRef.current.linkRepulsionDistance !== lastLinkRepulsionDistance
      ) {
        lastRepulsion = settings3DRef.current.repulsion;
        lastLinkForce = settings3DRef.current.linkForce;
        lastLinkDistance = settings3DRef.current.linkDistance;
        lastCenterForce = settings3DRef.current.centerForce;
        lastRepulsionDistance = settings3DRef.current.repulsionDistance;
        lastLinkRepulsionDistance = settings3DRef.current.linkRepulsionDistance;
        stepCount3D = 0; // スリープ解除
      }

      // ユーザーがドラッグ（カメラ操作含む）している場合もスリープを延長/解除
      if (isDragging || isRightDragging || draggedInstanceId3D !== null) {
        stepCount3D = 0;
      }

      const isCooling = stepCount3D >= maxSteps3D;

      if (!isCooling && !isPausedRef.current) {
        stepCount3D++;
        
        // --- 以前の普通で正しい3D物理演算モデルの復元 ---
        const repulsionStrength = settings3DRef.current.repulsion * 0.05;
        const attractionStrength = settings3DRef.current.linkForce * 0.01;
        const centerStrength = settings3DRef.current.centerForce * 0.005;

        const skipRepulsion = targetNodes.length > 800 && (stepCount3D % 2 === 0);

        if (!skipRepulsion) {
          for (let i = 0; i < targetNodes.length; i++) {
            const nodeA = targetNodes[i];
            if (fixedNodes3D.current[nodeA]) continue;

            const posA = nodePositions.get(nodeA)!;
            const step = targetNodes.length > 1000 ? 2 : 1;
            for (let j = i + 1; j < targetNodes.length; j += step) {
              const nodeB = targetNodes[j];
              const posB = nodePositions.get(nodeB)!;
              
              const dir = new THREE.Vector3().subVectors(posA, posB);
              const distSq = dir.lengthSq() || 0.01;
              const isLinked = adjacencyMap.get(nodeA)?.has(nodeB) || false;
              const minDist = isLinked
                ? (settings3DRef.current.linkRepulsionDistance ?? 5.0)
                : (settings3DRef.current.repulsionDistance || 15.0);

              // 近いもの同士だけを押し出す元のシンプルな反発力
              if (distSq < minDist * minDist) {
                dir.normalize().multiplyScalar(repulsionStrength * (minDist - Math.sqrt(distSq)));
                posA.add(dir);
                if (!fixedNodes3D.current[nodeB]) {
                  posB.sub(dir);
                }
              }
            }
          }
        }

        // 2. エッジによる引力 (リンク距離より離れたら引き合う元のロジック)
        targetEdges.forEach(({ source, target }) => {
          const posA = nodePositions.get(source);
          const posB = nodePositions.get(target);
          if (posA && posB) {
            const dir = new THREE.Vector3().subVectors(posB, posA);
            const dist = dir.length();
            if (dist > settings3DRef.current.linkDistance) {
              const forceVec = dir.normalize().multiplyScalar(attractionStrength * (dist - settings3DRef.current.linkDistance));
              if (!fixedNodes3D.current[source]) {
                posA.add(forceVec);
              }
              if (!fixedNodes3D.current[target]) {
                posB.sub(forceVec);
              }
            }
          }
        });

        // 3. 重心に向かう引力
        targetNodes.forEach((node) => {
          if (fixedNodes3D.current[node]) return;
          const pos = nodePositions.get(node)!;
          pos.multiplyScalar(1 - centerStrength);
        });
      }

      // 4. 流動（ゆらぎ）モーションの追加 (手動ドラッグ固定されていないノード)
      const now = Date.now();
      targetNodes.forEach((node) => {
        if (fixedNodes3D.current[node] || isPausedRef.current) return;

        let hash = 0;
        for (let idx = 0; idx < node.length; idx++) {
          hash = (hash << 5) - hash + node.charCodeAt(idx);
        }
        const offset = Math.abs(hash) % 1000;

        const pos = nodePositions.get(node)!;

        // 呼吸するような微小なゆらぎ
        const jitterX = Math.sin((now * 0.0006) + offset) * 0.02;
        const jitterY = Math.cos((now * 0.0006) + offset) * 0.02;
        const jitterZ = Math.sin((now * 0.0008) + offset) * 0.02;

        pos.x += jitterX;
        pos.y += jitterY;
        pos.z += jitterZ;
      });

      // ノードの3D位置行列およびエッジの線を更新
      targetNodes.forEach((node, i) => {
        const pos = nodePositions.get(node)!;
        const baseScale = graph.getNodeAttribute(node, 'size') / 8.0;
        tempObject.position.copy(pos);
        tempObject.scale.setScalar(baseScale * settings3DRef.current.nodeSize);
        tempObject.updateMatrix();
        instancedMesh.setMatrixAt(i, tempObject.matrix);
      });
      instancedMesh.instanceMatrix.needsUpdate = true;

      // エッジの頂点座標バッファの更新
      const positionsAttr = lineGeometry.getAttribute('position') as THREE.BufferAttribute;
      let lineIdx = 0;
      targetEdges.forEach(({ source, target }) => {
        const posA = nodePositions.get(source);
        const posB = nodePositions.get(target);
        if (posA && posB) {
          positionsAttr.setXYZ(lineIdx++, posA.x, posA.y, posA.z);
          positionsAttr.setXYZ(lineIdx++, posB.x, posB.y, posB.z);
        }
      });
      positionsAttr.needsUpdate = true;

      // 矢印位置と方向の更新
      if (settings3DRef.current.showArrows) {
        let arrowIdx = 0;
        targetEdges.forEach(({ source, target }) => {
          const posA = nodePositions.get(source);
          const posB = nodePositions.get(target);
          if (posA && posB && arrows[arrowIdx]) {
            const arrowMesh = arrows[arrowIdx++];
            const midPoint = new THREE.Vector3().lerpVectors(posA, posB, 0.7);
            arrowMesh.position.copy(midPoint);
            const dir = new THREE.Vector3().subVectors(posB, posA).normalize();
            const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            arrowMesh.setRotationFromQuaternion(quaternion);
          }
        });
      }

      rotation.x += (targetRotation.x - rotation.x) * 0.1;
      rotation.y += (targetRotation.y - rotation.y) * 0.1;
      distance += (targetDistance - distance) * 0.1;
      pan.lerp(targetPan, 0.1);

      const offset = new THREE.Vector3(
        distance * Math.sin(rotation.y) * Math.cos(rotation.x),
        distance * Math.sin(rotation.x),
        distance * Math.cos(rotation.y) * Math.cos(rotation.x)
      );

      camera.position.copy(pan).add(offset);
      camera.lookAt(pan);

      // ホバーとラベルフェード判定
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(instancedMesh);

      if (intersects.length > 0) {
        const idx = intersects[0].instanceId;
        if (idx !== undefined && idx !== hoveredIndex) {
          hoveredIndex = idx;
          const nodeName = targetNodes[idx];
          if (tooltipRef.current) {
            tooltipRef.current.style.display = 'block';
            tooltipRef.current.textContent = nodeName;
          }
        }
        if (tooltipRef.current && hoveredIndex !== null) {
          const worldPos = nodePositions.get(targetNodes[hoveredIndex])!;
          const screenPos = worldPos.clone().project(camera);
          const x = (screenPos.x * 0.5 + 0.5) * width;
          const y = (-(screenPos.y * 0.5) + 0.5) * height;
          tooltipRef.current.style.left = `${x + 12}px`;
          tooltipRef.current.style.top = `${y - 12}px`;
        }
      } else {
        hoveredIndex = null;
        if (tooltipRef.current) {
          tooltipRef.current.style.display = 'none';
        }
      }

      // 常時表示ラベルのプロジェクションマッピング更新 (画面内のノードのみ & カメラに近い上位100個に制限)
      const labelsContainer = document.getElementById('labels-container-3d');
      if (labelsContainer) {
        if (!settings3DRef.current.showLabels) {
          labelsContainer.innerHTML = '';
        } else {
          const frustum = new THREE.Frustum();
          const projScreenMatrix = new THREE.Matrix4();
          projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
          frustum.setFromProjectionMatrix(projScreenMatrix);

          const visibleNodes: { name: string; pos: THREE.Vector3; dist: number }[] = [];
          const textFade = settings3DRef.current.textFadeThreshold || 20;
          const maxDist = textFade === 1 ? Infinity : 800 / textFade;

          targetNodes.forEach((nodeName) => {
            const worldPos = nodePositions.get(nodeName);
            if (worldPos) {
              if (frustum.containsPoint(worldPos)) {
                const dist = camera.position.distanceTo(worldPos);
                if (dist <= maxDist) {
                  visibleNodes.push({ name: nodeName, pos: worldPos, dist });
                }
              }
            }
          });

          visibleNodes.sort((a, b) => a.dist - b.dist);
          const limit = 100;
          const displayNodes = visibleNodes.slice(0, limit);

          let childNodes = labelsContainer.children;
          if (childNodes.length !== displayNodes.length) {
            labelsContainer.innerHTML = '';
            displayNodes.forEach(() => {
              const labelDiv = document.createElement('div');
              labelDiv.className = 'absolute text-[9px] text-gray-300 font-medium px-1 py-0.5 pointer-events-none whitespace-nowrap bg-black/60 rounded border border-white/5';
              labelDiv.style.transform = 'translate(-50%, -100%)';
              labelsContainer.appendChild(labelDiv);
            });
            childNodes = labelsContainer.children;
          }

          displayNodes.forEach((nodeInfo, idx) => {
            const el = childNodes[idx] as HTMLDivElement;
            if (el) {
              const screenPos = nodeInfo.pos.clone().project(camera);
              const x = (screenPos.x * 0.5 + 0.5) * width;
              const y = (-(screenPos.y * 0.5) + 0.5) * height;
              el.textContent = nodeInfo.name;
              el.style.display = 'block';
              el.style.left = `${x}px`;
              el.style.top = `${y - 10}px`;
            }
          });
        }
      }

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('dblclick', handleDoubleClick);
      container.removeEventListener('contextmenu', preventDefault);
      window.removeEventListener('resize', handleResize);

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }

      sphereGeometry.dispose();
      nodeMaterial.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
      coneGeometry.dispose();
      coneMaterial.dispose();
      renderer.dispose();
      lineMaterialRef.current = null;
      coneMaterialRef.current = null;
    };
  }, [graph, activeElements, viewMode, isSettingsLoaded, groupRules, notes, onSelectNote, settings3D.textFadeThreshold, settings3D.nodeColor, settings3D.linkColor]);

  // 3D リンク表示・矢印表示・カラー・太さの切り替え時にマテリアルの不透明度や色・太さを動的に更新
  useEffect(() => {
    if (lineMaterialRef.current) {
      lineMaterialRef.current.opacity = settings3D.showLinks ? 0.6 : 0.0;
      lineMaterialRef.current.color.set(settings3D.linkColor);
      lineMaterialRef.current.linewidth = settings3D.linkThickness;
      lineMaterialRef.current.needsUpdate = true;
    }
    if (coneMaterialRef.current) {
      coneMaterialRef.current.opacity = (settings3D.showLinks && settings3D.showArrows) ? 1.0 : 0.0;
      coneMaterialRef.current.needsUpdate = true;
    }
  }, [settings3D.showLinks, settings3D.showArrows, settings3D.linkColor, settings3D.linkThickness]);

  return (
    <div className="h-screen bg-[#070a13] text-gray-100 flex relative select-none">
      {/* 左上フローティングラベル情報 */}
      <div className="absolute top-4 left-4 z-20 pointer-events-none bg-[#0b1020]/90 border border-white/10 rounded-lg p-3 shadow-xl backdrop-blur-md">
        <h1 className="font-semibold text-xs text-gray-200">
          {isLocal ? `ローカルグラフ: ${centerNoteName?.replace(/\.md$/i, '')}` : 'ノートグラフ'}
        </h1>
        <p className="text-[10px] text-gray-400 mt-0.5">
          {activeElements.nodes.length} nodes / {activeElements.edges.length} links
        </p>
      </div>

      {/* スライドイン設定パネル */}
      {showSettings && (
        <div className="absolute left-0 top-0 bottom-0 w-80 bg-[#0b1020]/95 border-r border-white/10 z-30 overflow-y-auto p-4 backdrop-blur-md flex flex-col gap-4 text-xs">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <span className="font-semibold text-gray-200 text-sm">グラフ設定</span>
            <button
              onClick={resetToDefaults}
              className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-indigo-400 transition-colors"
              title="デフォルトに戻す"
            >
              <RotateCcw className="w-3 h-3" />
              デフォルトに戻す
            </button>
          </div>

          {/* ローカルグラフ専用設定 */}
          {isLocal && (
            <div className="space-y-1 bg-indigo-950/20 p-2 rounded border border-indigo-500/20">
              <span className="font-medium text-indigo-300 block mb-1">ローカル設定</span>
              <div className="flex justify-between text-[10px] text-gray-400">
                <span>接続の深さ</span>
                <span>{localDepth}</span>
              </div>
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={localDepth}
                onChange={(e) => setLocalDepth(Number(e.target.value))}
                className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
          )}

          {/* フィルタ */}
          <div className="space-y-2">
            <span className="font-medium text-gray-300 block">フィルタ</span>
            <div className="space-y-1.5">
              <input
                type="text"
                placeholder="ファイルを検索..."
                value={settings.searchQuery}
                onChange={(e) => setSettings({ ...settings, searchQuery: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 outline-none text-gray-200 focus:border-indigo-500"
              />
              <input
                type="text"
                placeholder="除外ファイルパターン..."
                value={settings.excludePattern}
                onChange={(e) => setSettings({ ...settings, excludePattern: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 outline-none text-gray-200 focus:border-indigo-500"
              />
              <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.showTags}
                  onChange={(e) => setSettings({ ...settings, showTags: e.target.checked })}
                  className="rounded text-indigo-600 bg-black/40 border-white/10"
                />
                タグを表示
              </label>
              <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.existingOnly}
                  onChange={(e) => setSettings({ ...settings, existingOnly: e.target.checked })}
                  className="rounded text-indigo-600 bg-black/40 border-white/10"
                />
                存在するファイルのみ表示
              </label>
              <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.showOrphans}
                  onChange={(e) => setSettings({ ...settings, showOrphans: e.target.checked })}
                  className="rounded text-indigo-600 bg-black/40 border-white/10"
                />
                オーファン（孤立点）を表示
              </label>
            </div>
          </div>

          {/* グループ */}
          <div className="space-y-2">
            <span className="font-medium text-gray-300 block">グループ</span>
            <div className="flex gap-1.5">
              <input
                type="text"
                placeholder="検索クエリ (タグ等)..."
                value={newGroupQuery}
                onChange={(e) => setNewGroupQuery(e.target.value)}
                className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 outline-none text-gray-200 text-[11px]"
              />
              <input
                type="color"
                value={newGroupColor}
                onChange={(e) => setNewGroupColor(e.target.value)}
                className="w-6 h-6 border border-white/10 rounded cursor-pointer bg-transparent"
              />
              <button
                onClick={addGroupRule}
                className="bg-indigo-600 hover:bg-indigo-500 text-white rounded p-1"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {groupRules.map((rule, idx) => (
                <div key={idx} className="flex items-center justify-between bg-black/20 p-1.5 rounded border border-white/5">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: rule.color }} />
                    <span className="truncate max-w-[150px]">{rule.query}</span>
                  </div>
                  <button onClick={() => removeGroupRule(idx)} className="text-red-400 hover:text-red-300">
                    <Trash className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 表示 */}
          <div className="space-y-2">
            <span className="font-medium text-gray-300 block">表示</span>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.showArrows}
                  onChange={(e) => setSettings({ ...settings, showArrows: e.target.checked })}
                  className="rounded text-indigo-600 bg-black/40 border-white/10"
                />
                接続の矢印表示
              </label>
              <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.showLinks}
                  onChange={(e) => setSettings({ ...settings, showLinks: e.target.checked })}
                  className="rounded text-indigo-600 bg-black/40 border-white/10"
                />
                リンク（線）を表示する
              </label>
              <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.showLabels}
                  onChange={(e) => setSettings({ ...settings, showLabels: e.target.checked })}
                  className="rounded text-indigo-600 bg-black/40 border-white/10"
                />
                ファイル名を表示する
              </label>
              <div className="space-y-1">
                <div className="flex justify-between text-gray-400">
                  <span>ノードの大きさ</span>
                  <span>{settings.nodeSize.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min={viewMode === '3D' ? '0.1' : '0.5'}
                  max="3"
                  step="0.1"
                  value={settings.nodeSize}
                  onChange={(e) => setSettings({ ...settings, nodeSize: Number(e.target.value) })}
                  className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-gray-400">
                  <span>リンクの太さ</span>
                  <span>{settings.linkThickness.toFixed(1)}px</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="10"
                  step="0.1"
                  value={settings.linkThickness}
                  onChange={(e) => setSettings({ ...settings, linkThickness: Number(e.target.value) })}
                  className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1 space-y-1">
                  <div className="flex justify-between text-gray-400">
                    <span>ノードの色</span>
                  </div>
                  <input
                    type="color"
                    value={settings.nodeColor || '#a5b4fc'}
                    onChange={(e) => setSettings({ ...settings, nodeColor: e.target.value })}
                    className="w-full h-8 border border-white/10 rounded cursor-pointer bg-transparent"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex justify-between text-gray-400">
                    <span>リンクの色</span>
                  </div>
                  <input
                    type="color"
                    value={settings.linkColor || '#334155'}
                    onChange={(e) => setSettings({ ...settings, linkColor: e.target.value })}
                    className="w-full h-8 border border-white/10 rounded cursor-pointer bg-transparent"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-gray-400">
                  <span>テキスト表示閾値</span>
                  <span>{settings.textFadeThreshold}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="50"
                  step="1"
                  value={settings.textFadeThreshold}
                  onChange={(e) => setSettings({ ...settings, textFadeThreshold: Number(e.target.value) })}
                  className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* 力の強さ */}
          <div className="space-y-2">
            <span className="font-medium text-gray-300 block">力の強さ</span>
            <div className="space-y-2">
              <div className="space-y-1">
                <div className="flex justify-between text-gray-400">
                  <span>中心力</span>
                  <span>{settings.centerForce.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={settings.centerForce}
                  onChange={(e) => setSettings({ ...settings, centerForce: Number(e.target.value) })}
                  className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-gray-400">
                  <span>反発力</span>
                  <span>{settings.repulsion.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max={viewMode === '3D' ? '10' : '3'}
                  step="0.1"
                  value={settings.repulsion}
                  onChange={(e) => setSettings({ ...settings, repulsion: Number(e.target.value) })}
                  className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-gray-400">
                  <span>リンクする力</span>
                  <span>{settings.linkForce.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="3"
                  step="0.1"
                  value={settings.linkForce}
                  onChange={(e) => setSettings({ ...settings, linkForce: Number(e.target.value) })}
                  className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-gray-400">
                  <span>リンク距離</span>
                  <span>{settings.linkDistance}px</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="40"
                  step="1"
                  value={settings.linkDistance}
                  onChange={(e) => setSettings({ ...settings, linkDistance: Number(e.target.value) })}
                  className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
              {viewMode === '3D' && (
                <>
                  <div className="space-y-1">
                    <div className="flex justify-between text-gray-400">
                      <span>ノード反発距離（接近限界）</span>
                      <span>{settings.repulsionDistance || 15}px</span>
                    </div>
                    <input
                      type="range"
                      min="2"
                      max="30"
                      step="1"
                      value={settings.repulsionDistance || 15}
                      onChange={(e) => setSettings({ ...settings, repulsionDistance: Number(e.target.value) })}
                      className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-gray-400">
                      <span>接続ノード反発距離（リンク先接近限界）</span>
                      <span>{settings.linkRepulsionDistance ?? 5}px</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="20"
                      step="1"
                      value={settings.linkRepulsionDistance ?? 5}
                      onChange={(e) => setSettings({ ...settings, linkRepulsionDistance: Number(e.target.value) })}
                      className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>
                </>
              )}
              <button
                onClick={handleResetCoordinates}
                className="w-full flex items-center justify-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded py-2 mt-2 font-medium transition-colors border border-white/5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                配置をリセットする
              </button>
            </div>
          </div>

          {/* ノードの動き制御 */}
          <div className="pt-2 border-t border-white/10 space-y-2">
            <span className="font-medium text-gray-300 block">ノードの動き制御</span>
            <button
              onClick={() => setIsPaused(!isPaused)}
              className={`w-full flex items-center justify-center gap-1.5 text-white rounded py-2 font-semibold transition-colors ${
                isPaused ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-red-600 hover:bg-red-500'
              }`}
            >
              {isPaused ? (
                <>
                  <Play className="w-3.5 h-3.5" />
                  ノードの動きを再開
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  ノードの動きを一時停止
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* グラフ描画エリア */}
      <div className="flex-1 h-full relative min-h-[300px]">
        <div className={`w-full h-full min-h-[300px] ${viewMode === '2D' ? '' : 'hidden'}`} ref={containerRef2D} />
        <div className={`w-full h-full min-h-[300px] relative ${viewMode === '3D' ? '' : 'hidden'}`}>
          <div className="w-full h-full cursor-grab active:cursor-grabbing" ref={containerRef3D} />
          {/* 3Dノード名常時表示用コンテナ */}
          <div id="labels-container-3d" className="absolute inset-0 pointer-events-none overflow-hidden z-10" />
          <div
            ref={tooltipRef}
            style={{ display: 'none' }}
            className="absolute pointer-events-none bg-[#0b1020]/95 border border-indigo-500/30 text-indigo-200 text-xs py-1.5 px-3 rounded shadow-xl font-medium backdrop-blur-md z-20"
          />
          <div className="absolute bottom-4 left-4 pointer-events-none bg-[#0b1020]/80 border border-white/5 text-gray-400 text-[10px] py-1.5 px-3 rounded backdrop-blur z-20 space-y-0.5">
            <p>左ドラッグ：カメラ回転 / ノードドラッグ</p>
            <p>右ドラッグ：カメラ並行移動</p>
            <p>ホイール　：ズーム</p>
          </div>
        </div>

        {/* 右下フローティング操作パネル */}
        <div className="absolute bottom-4 right-4 z-20 flex items-center gap-3 bg-[#0b1020]/90 border border-white/10 rounded-lg p-2 shadow-2xl backdrop-blur-md no-drag">
          <div className="flex items-center bg-[#070a13] border border-white/10 rounded-full p-0.5">
            <button
              onClick={() => setViewMode('2D')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium transition-all ${
                viewMode === '2D' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <Eye className="w-3 h-3" />
              2D
            </button>
            <button
              onClick={() => setViewMode('3D')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium transition-all ${
                viewMode === '3D' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <Video className="w-3 h-3" />
              3D
            </button>
          </div>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`rounded p-1.5 transition-colors ${showSettings ? 'bg-indigo-600 text-white' : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-gray-200'}`}
            title="設定"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-5 bg-white/10" />

          <button
            onClick={onClose}
            className="rounded bg-white/5 p-1.5 hover:bg-white/10 text-gray-400 hover:text-gray-200"
            title="閉じる"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
