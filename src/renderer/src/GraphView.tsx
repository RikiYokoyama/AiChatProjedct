import { useEffect, useMemo, useRef, useState } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { X, Eye, Video, Settings, RotateCcw, Plus, Trash, Play } from 'lucide-react';
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
  textFadeThreshold: 20,
  nodeSize: 1.0,
  linkThickness: 1.0,

  // 力の強さ
  centerForce: 0.5,
  repulsion: 1.0,
  linkForce: 1.0,
  linkDistance: 15,
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
  const [viewMode, setViewMode] = useState<'2D' | '3D'>('3D');
  const [showSettings, setShowSettings] = useState(false);

  // ローカルグラフ用の深さ（デフォルト2）
  const [localDepth, setLocalDepth] = useState<number>(2);

  // 設定状態
  const [settings, setSettings] = useState(defaultSettings);
  // グループ設定
  const [groupRules, setGroupRules] = useState<GroupRule[]>([]);
  const [newGroupQuery, setNewGroupQuery] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#818cf8');

  // タイムラプス
  const [timelapseActive, setTimelapseActive] = useState(false);
  const [timelapseLimit, setTimelapseLimit] = useState<number>(0); // 表示上限インデックス

  const resetToDefaults = () => {
    setSettings(defaultSettings);
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
      let color = '#a5b4fc'; // デフォルトノード色

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
        type: 'note',
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
          type: 'tag',
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
        const target = targetNote ? noteId(targetNote) : link;

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
            type: 'ghost',
          });
        }

        if (source !== target && !g.hasEdge(source, target)) {
          g.addEdge(source, target, { color: '#334155', size: settings.linkThickness });
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

  // タイムラプスアニメーション制御
  useEffect(() => {
    if (!timelapseActive) return;

    // 更新日時（作成日時とみなす）で全ノードをソート
    const sortedNodes = graph.nodes()
      .map((n) => ({ id: n, time: new Date(graph.getNodeAttribute(n, 'updatedAt') || 0).getTime() }))
      .sort((a, b) => a.time - b.time);

    setTimelapseLimit(0);

    const interval = setInterval(() => {
      setTimelapseLimit((prev) => {
        if (prev >= sortedNodes.length) {
          clearInterval(interval);
          setTimelapseActive(false);
          return prev;
        }
        return prev + 1;
      });
    }, 250);

    return () => clearInterval(interval);
  }, [timelapseActive, graph]);

  // フィルタリング後のアニメーション制限を適用した動的表示ノード・エッジ
  const activeElements = useMemo(() => {
    const nodes = graph.nodes();
    const edges = graph.edges().map((edge) => {
      const ext = graph.extremities(edge);
      return { id: edge, source: ext[0], target: ext[1] };
    });

    if (timelapseActive || timelapseLimit > 0) {
      const sorted = nodes
        .map((n) => ({ id: n, time: new Date(graph.getNodeAttribute(n, 'updatedAt') || 0).getTime() }))
        .sort((a, b) => a.time - b.time);

      const visibleSet = new Set(sorted.slice(0, timelapseLimit).map((x) => x.id));
      const filteredNodes = nodes.filter((n) => visibleSet.has(n));
      const filteredEdges = edges.filter((e) => visibleSet.has(e.source) && visibleSet.has(e.target));
      return { nodes: filteredNodes, edges: filteredEdges };
    }

    return { nodes, edges };
  }, [graph, timelapseActive, timelapseLimit]);

  // 2D Sigma.js rendering update
  useEffect(() => {
    if (viewMode !== '2D' || !containerRef2D.current) return;

    // 現在のアクティブな状態のサブグラフをビルド
    const subGraph = new Graph();
    activeElements.nodes.forEach((node) => {
      subGraph.addNode(node, graph.getNodeAttributes(node));
    });
    activeElements.edges.forEach((edge) => {
      subGraph.addEdge(edge.source, edge.target, graph.getEdgeAttributes(edge.id));
    });

    // 簡易的な初期2D配置
    subGraph.nodes().forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(subGraph.order, 1);
      subGraph.setNodeAttribute(node, 'x', Math.cos(angle) * 10);
      subGraph.setNodeAttribute(node, 'y', Math.sin(angle) * 10);
    });

    const sigma = new Sigma(subGraph, containerRef2D.current, {
      renderEdgeLabels: false,
      defaultEdgeColor: '#334155',
      defaultNodeColor: '#a5b4fc',
      labelColor: { color: '#dbeafe' },
    });
    sigmaRef.current = sigma;

    sigma.on('clickNode', ({ node }) => {
      const found = notes.find((note) => noteId(note) === node);
      if (found) onSelectNote(found);
    });

    return () => {
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [graph, activeElements, viewMode, notes, onSelectNote]);

  // 3D Three.js rendering update
  useEffect(() => {
    if (viewMode !== '3D' || !containerRef3D.current) return;

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

    // 初期球状配置
    targetNodes.forEach((node, i) => {
      const phi = Math.acos(-1 + (2 * i) / Math.max(targetNodes.length, 1));
      const theta = Math.sqrt(targetNodes.length * Math.PI) * phi;
      const radius = settings.linkDistance;
      const pos = new THREE.Vector3(
        radius * Math.cos(theta) * Math.sin(phi),
        radius * Math.sin(theta) * Math.sin(phi),
        radius * Math.cos(phi)
      );
      nodePositions.set(node, pos);
    });

    // 力学計算シミュレーションループ (設定された力のパラメータに基づく)
    const repulsionStrength = settings.repulsion * 0.2;
    const attractionStrength = settings.linkForce * 0.05;
    const centerStrength = settings.centerForce * 0.02;

    for (let iter = 0; iter < 15; iter++) {
      // 1. ノード間の反発力 (Repulsion)
      for (let i = 0; i < targetNodes.length; i++) {
        const nodeA = targetNodes[i];
        const posA = nodePositions.get(nodeA)!;
        for (let j = i + 1; j < targetNodes.length; j++) {
          const nodeB = targetNodes[j];
          const posB = nodePositions.get(nodeB)!;
          const dir = new THREE.Vector3().subVectors(posA, posB);
          const distSq = dir.lengthSq() || 0.01;
          const minDist = settings.linkDistance * 0.8;
          if (distSq < minDist * minDist) {
            dir.normalize().multiplyScalar(repulsionStrength * (minDist - Math.sqrt(distSq)));
            posA.add(dir);
            posB.sub(dir);
          }
        }
      }

      // 2. エッジによる引力 (Attraction)
      targetEdges.forEach(({ source, target }) => {
        const posA = nodePositions.get(source);
        const posB = nodePositions.get(target);
        if (posA && posB) {
          const dir = new THREE.Vector3().subVectors(posB, posA);
          const dist = dir.length();
          if (dist > settings.linkDistance) {
            dir.normalize().multiplyScalar(attractionStrength * (dist - settings.linkDistance));
            posA.add(dir);
            posB.sub(dir);
          }
        }
      });

      // 3. 重心に向かう引力 (Center Force)
      targetNodes.forEach((node) => {
        const pos = nodePositions.get(node)!;
        pos.multiplyScalar(1 - centerStrength);
      });
    }

    // InstancedMesh を使ったノード描画
    // D3 / Three.js 上でグループ分けに対応した色を管理するため、色のバッファ属性を設定
    const sphereGeometry = new THREE.SphereGeometry(0.6, 16, 16);
    const nodeMaterial = new THREE.MeshBasicMaterial();
    const instancedMesh = new THREE.InstancedMesh(sphereGeometry, nodeMaterial, targetNodes.length);

    const tempObject = new THREE.Object3D();
    const tempColor = new THREE.Color();
    targetNodes.forEach((node, i) => {
      const pos = nodePositions.get(node)!;
      const baseScale = graph.getNodeAttribute(node, 'size') / 8.0;
      tempObject.position.copy(pos);
      tempObject.scale.setScalar(baseScale * settings.nodeSize);
      tempObject.updateMatrix();
      instancedMesh.setMatrixAt(i, tempObject.matrix);

      // 色の適用
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
      color: 0x475569,
      transparent: true,
      opacity: 0.6,
      linewidth: settings.linkThickness, // WebGLの実装によっては変化しない場合あり
    });
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
    if (settings.showArrows) {
      const coneGeometry = new THREE.ConeGeometry(0.3, 0.8, 8);
      const coneMaterial = new THREE.MeshBasicMaterial({ color: 0x64748b });
      targetEdges.forEach(({ source, target }) => {
        const posA = nodePositions.get(source);
        const posB = nodePositions.get(target);
        if (posA && posB) {
          const arrowMesh = new THREE.Mesh(coneGeometry, coneMaterial);
          // 始点と終点の中間やや終点寄りに配置
          const midPoint = new THREE.Vector3().lerpVectors(posA, posB, 0.7);
          arrowMesh.position.copy(midPoint);

          // 矢印の向きを設定
          const dir = new THREE.Vector3().subVectors(posB, posA).normalize();
          const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          arrowMesh.setRotationFromQuaternion(quaternion);

          scene.add(arrowMesh);
          arrows.push(arrowMesh);
        }
      });
    }

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

    const handleMouseDown = (e: MouseEvent) => {
      isDragging = e.button === 0;
      isRightDragging = e.button === 2;
      dragStart.x = e.clientX;
      dragStart.y = e.clientY;
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / height) * 2 + 1;

      if (isDragging) {
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
        const rightVec = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const upVec = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        const panFactor = distance * 0.0015;
        targetPan.addScaledVector(rightVec, -dx * panFactor);
        targetPan.addScaledVector(upVec, dy * panFactor);
        dragStart.x = e.clientX;
        dragStart.y = e.clientY;
      }
    };

    const handleMouseUp = () => {
      isDragging = false;
      isRightDragging = false;
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      targetDistance += e.deltaY * 0.03;
      targetDistance = Math.max(10, Math.min(200, targetDistance));
    };

    const handleClick = (e: MouseEvent) => {
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
    container.addEventListener('click', handleClick);
    container.addEventListener('contextmenu', preventDefault);

    // アニメーションフレーム
    let animationFrameId: number;
    const animate = () => {
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
          // ホバーがない場合でも、ズーム距離に応じて簡易的に中心付近のノード名などを表示させたり、ツールチップを閉じる
          tooltipRef.current.style.display = 'none';
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
      container.removeEventListener('click', handleClick);
      container.removeEventListener('contextmenu', preventDefault);
      window.removeEventListener('resize', handleResize);

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }

      sphereGeometry.dispose();
      nodeMaterial.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
      if (settings.showArrows) {
        arrows.forEach((arrow) => {
          arrow.geometry.dispose();
          if (Array.isArray(arrow.material)) {
            arrow.material.forEach((m) => m.dispose());
          } else {
            arrow.material.dispose();
          }
        });
      }
      renderer.dispose();
    };
  }, [graph, activeElements, viewMode, settings, groupRules, notes, onSelectNote]);

  return (
    <div className="h-screen bg-[#070a13] text-gray-100 flex flex-col relative select-none">
      <header className="flex h-12 items-center justify-between border-b border-white/10 bg-[#0b1020] px-4 z-20 shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <h1 className="font-semibold text-sm">
              {isLocal ? `ローカルグラフ: ${centerNoteName?.replace(/\.md$/i, '')}` : 'ノートグラフ'}
            </h1>
            <p className="text-[10px] text-gray-400">
              {activeElements.nodes.length} nodes / {activeElements.edges.length} links
            </p>
          </div>
          <div className="no-drag flex items-center bg-[#070a13] border border-white/10 rounded-full p-0.5">
            <button
              onClick={() => setViewMode('2D')}
              className={`no-drag flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                viewMode === '2D' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              2D
            </button>
            <button
              onClick={() => setViewMode('3D')}
              className={`no-drag flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                viewMode === '3D' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <Video className="w-3.5 h-3.5" />
              3D
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`rounded p-2 transition-colors ${showSettings ? 'bg-indigo-600 text-white' : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-gray-200'}`}
            title="設定"
          >
            <Settings className="h-4 w-4" />
          </button>
          <button className="rounded bg-white/5 p-2 hover:bg-white/10" onClick={onClose} title="閉じる">
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 w-full relative min-h-0 flex">
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
                <div className="space-y-1">
                  <div className="flex justify-between text-gray-400">
                    <span>ノードの大きさ</span>
                    <span>{settings.nodeSize.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
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
                    max="5"
                    step="0.1"
                    value={settings.linkThickness}
                    onChange={(e) => setSettings({ ...settings, linkThickness: Number(e.target.value) })}
                    className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-gray-400">
                    <span>テキスト表示閾値</span>
                    <span>{settings.textFadeThreshold}</span>
                  </div>
                  <input
                    type="range"
                    min="5"
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
                    max="3"
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
                    min="5"
                    max="40"
                    step="1"
                    value={settings.linkDistance}
                    onChange={(e) => setSettings({ ...settings, linkDistance: Number(e.target.value) })}
                    className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>
              </div>
            </div>

            {/* タイムラプスアニメーション */}
            <div className="pt-2 border-t border-white/10 space-y-2">
              <span className="font-medium text-gray-300 block">タイムラプスアニメーション</span>
              <button
                onClick={() => setTimelapseActive(true)}
                disabled={timelapseActive}
                className="w-full flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded py-2 font-semibold transition-colors disabled:opacity-40"
              >
                <Play className="w-3.5 h-3.5" />
                アニメーション開始
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 h-full relative min-h-[300px]">
          <div className={`w-full h-full min-h-[300px] ${viewMode === '2D' ? '' : 'hidden'}`} ref={containerRef2D} />
          <div className={`w-full h-full min-h-[300px] relative ${viewMode === '3D' ? '' : 'hidden'}`}>
            <div className="w-full h-full cursor-grab active:cursor-grabbing" ref={containerRef3D} />
            <div
              ref={tooltipRef}
              style={{ display: 'none' }}
              className="absolute pointer-events-none bg-[#0b1020]/95 border border-indigo-500/30 text-indigo-200 text-xs py-1.5 px-3 rounded shadow-xl font-medium backdrop-blur-md z-20"
            />
            <div className="absolute bottom-4 left-4 pointer-events-none bg-[#0b1020]/80 border border-white/5 text-gray-400 text-[10px] py-1.5 px-3 rounded backdrop-blur z-20 space-y-0.5">
              <p>左ドラッグ：カメラ回転</p>
              <p>右ドラッグ：カメラ並行移動</p>
              <p>ホイール　：ズーム</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
