import { useEffect, useMemo, useRef, useState } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { X, Eye, Video } from 'lucide-react';
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
}

function noteId(note: Note) {
  return note.name.replace(/\.md$/i, '');
}

function buildGraph(notes: Note[]) {
  const graph = new Graph();
  const byId = new Map<string, Note>();

  notes.forEach((note, index) => {
    const id = noteId(note);
    byId.set(id.toLowerCase(), note);
    const angle = (Math.PI * 2 * index) / Math.max(notes.length, 1);
    graph.addNode(id, {
      label: id,
      x: Math.cos(angle) * 10,
      y: Math.sin(angle) * 10,
      size: 8,
      color: '#a5b4fc',
    });
  });

  notes.forEach((note) => {
    const source = noteId(note);
    note.wikiLinks?.forEach((link) => {
      const targetNote = byId.get(link.toLowerCase());
      const target = targetNote ? noteId(targetNote) : link;
      if (!graph.hasNode(target)) {
        graph.addNode(target, {
          label: target,
          x: Math.random() * 20 - 10,
          y: Math.random() * 20 - 10,
          size: 5,
          color: '#64748b',
        });
      }
      if (source !== target && !graph.hasEdge(source, target)) {
        graph.addEdge(source, target, { color: '#334155', size: 1 });
      }
    });
  });

  return graph;
}

export default function GraphView({ notes, onSelectNote, onClose }: GraphViewProps) {
  const containerRef2D = useRef<HTMLDivElement>(null);
  const containerRef3D = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const sigmaRef = useRef<Sigma | null>(null);
  const graph = useMemo(() => buildGraph(notes), [notes]);
  const [viewMode, setViewMode] = useState<'2D' | '3D'>('3D');

  // 2D Sigma.js implementation
  useEffect(() => {
    if (viewMode !== '2D' || !containerRef2D.current) return;

    const sigma = new Sigma(graph, containerRef2D.current, {
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
  }, [graph, notes, onSelectNote, viewMode]);

  // 3D Three.js implementation
  useEffect(() => {
    if (viewMode !== '3D' || !containerRef3D.current) return;

    const container = containerRef3D.current;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || (window.innerHeight - 48);

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#070a13');

    // Camera setup
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.z = 40;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Compute 3D node positions (Spherical Layout with simple attraction/repulsion force layout)
    const nodesArray = graph.nodes();
    const nodePositions = new Map<string, THREE.Vector3>();

    // Initial spherical distribution
    nodesArray.forEach((node, i) => {
      const phi = Math.acos(-1 + (2 * i) / Math.max(nodesArray.length, 1));
      const theta = Math.sqrt(nodesArray.length * Math.PI) * phi;
      const radius = 15;
      const pos = new THREE.Vector3(
        radius * Math.cos(theta) * Math.sin(phi),
        radius * Math.sin(theta) * Math.sin(phi),
        radius * Math.cos(phi)
      );
      nodePositions.set(node, pos);
    });

    // Run simple force iteration to relax overlapping points
    const edgesArray = graph.edges().map((edge) => {
      const ext = graph.extremities(edge);
      return { source: ext[0], target: ext[1] };
    });

    for (let iter = 0; iter < 12; iter++) {
      // Repulsion between all nodes
      for (let i = 0; i < nodesArray.length; i++) {
        const nodeA = nodesArray[i];
        const posA = nodePositions.get(nodeA)!;
        for (let j = i + 1; j < nodesArray.length; j++) {
          const nodeB = nodesArray[j];
          const posB = nodePositions.get(nodeB)!;
          const dir = new THREE.Vector3().subVectors(posA, posB);
          const distSq = dir.lengthSq() || 0.01;
          if (distSq < 25) {
            dir.normalize().multiplyScalar(0.2 * (5 - Math.sqrt(distSq)));
            posA.add(dir);
            posB.sub(dir);
          }
        }
      }
      // Attraction along edges
      edgesArray.forEach(({ source, target }) => {
        const posA = nodePositions.get(source);
        const posB = nodePositions.get(target);
        if (posA && posB) {
          const dir = new THREE.Vector3().subVectors(posB, posA);
          const dist = dir.length();
          if (dist > 8) {
            dir.normalize().multiplyScalar(0.05 * (dist - 8));
            posA.add(dir);
            posB.sub(dir);
          }
        }
      });
    }

    // InstancedMesh for Nodes (smooth spheres)
    const sphereGeometry = new THREE.SphereGeometry(0.6, 16, 16);
    const nodeMaterial = new THREE.MeshBasicMaterial({ color: 0xa5b4fc });
    const instancedMesh = new THREE.InstancedMesh(sphereGeometry, nodeMaterial, nodesArray.length);

    const tempObject = new THREE.Object3D();
    nodesArray.forEach((node, i) => {
      const pos = nodePositions.get(node)!;
      tempObject.position.copy(pos);
      tempObject.updateMatrix();
      instancedMesh.setMatrixAt(i, tempObject.matrix);
    });
    instancedMesh.instanceMatrix.needsUpdate = true;
    scene.add(instancedMesh);

    // Edges using LineSegments
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.6 });
    const lineVertices: number[] = [];
    edgesArray.forEach(({ source, target }) => {
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

    // Camera control states (自作の滑らかな OrbitControls)
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };
    let rotation = { x: 0, y: 0 };
    let targetRotation = { x: 0, y: 0 };
    let distance = 40;
    let targetDistance = 40;
    let pan = new THREE.Vector3(0, 0, 0);
    let targetPan = new THREE.Vector3(0, 0, 0);
    let isRightDragging = false;

    // Raycaster for mouse events
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
        // Limit polar angle
        targetRotation.x = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, targetRotation.x));
        dragStart.x = e.clientX;
        dragStart.y = e.clientY;
      } else if (isRightDragging) {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        // Pan coordinate calculations based on camera orientation
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
      targetDistance = Math.max(10, Math.min(150, targetDistance));
    };

    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0) return; // Only left-click
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(instancedMesh);
      if (intersects.length > 0) {
        const instanceId = intersects[0].instanceId;
        if (instanceId !== undefined) {
          const clickedNode = nodesArray[instanceId];
          const found = notes.find((n) => noteId(n) === clickedNode);
          if (found) onSelectNote(found);
        }
      }
    };

    const preventDefault = (e: MouseEvent) => {
      e.preventDefault();
    };

    // Add event listeners
    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('click', handleClick);
    container.addEventListener('contextmenu', preventDefault);

    // Animation Loop
    let animationFrameId: number;
    const animate = () => {
      // Smooth interpolation (Damping)
      rotation.x += (targetRotation.x - rotation.x) * 0.1;
      rotation.y += (targetRotation.y - rotation.y) * 0.1;
      distance += (targetDistance - distance) * 0.1;
      pan.lerp(targetPan, 0.1);

      // Spherical coordinates camera position update
      const offset = new THREE.Vector3(
        distance * Math.sin(rotation.y) * Math.cos(rotation.x),
        distance * Math.sin(rotation.x),
        distance * Math.cos(rotation.y) * Math.cos(rotation.x)
      );

      camera.position.copy(pan).add(offset);
      camera.lookAt(pan);

      // Node Hover Check (Raycasting)
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(instancedMesh);
      if (intersects.length > 0) {
        const idx = intersects[0].instanceId;
        if (idx !== undefined && idx !== hoveredIndex) {
          hoveredIndex = idx;
          const nodeName = nodesArray[idx];
          if (tooltipRef.current) {
            tooltipRef.current.style.display = 'block';
            tooltipRef.current.textContent = nodeName;
          }
        }
        // Update tooltip position to match screen coordinates of node
        if (tooltipRef.current) {
          const worldPos = nodePositions.get(nodesArray[hoveredIndex!])!;
          const screenPos = worldPos.clone().project(camera);
          const x = (screenPos.x * .5 + .5) * width;
          const y = (-(screenPos.y * .5) + .5) * height;
          tooltipRef.current.style.left = `${x + 12}px`;
          tooltipRef.current.style.top = `${y - 12}px`;
        }
      } else {
        hoveredIndex = null;
        if (tooltipRef.current) {
          tooltipRef.current.style.display = 'none';
        }
      }

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    // Resize Handler
    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
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
      renderer.dispose();
    };
  }, [graph, notes, onSelectNote, viewMode]);

  return (
    <div className="h-screen bg-[#070a13] text-gray-100 flex flex-col relative select-none">
      <header className="flex h-12 items-center justify-between border-b border-white/10 bg-[#0b1020] px-4 z-10 shrink-0">
        <div className="flex items-center gap-6">
          <div>
            <h1 className="font-semibold">ノートグラフ</h1>
            <p className="text-xs text-gray-400">{notes.length} notes / {graph.size} links</p>
          </div>
          <div className="no-drag flex items-center bg-[#070a13] border border-white/10 rounded-full p-0.5">
            <button
              onClick={() => setViewMode('2D')}
              className={`no-drag flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                viewMode === '2D'
                  ? 'bg-indigo-600 text-white shadow-lg'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              2D
            </button>
            <button
              onClick={() => setViewMode('3D')}
              className={`no-drag flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                viewMode === '3D'
                  ? 'bg-indigo-600 text-white shadow-lg'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <Video className="w-3.5 h-3.5" />
              3D
            </button>
          </div>
        </div>
        <div className="flex items-center">
          <button className="rounded bg-white/5 p-2 hover:bg-white/10" onClick={onClose} title="閉じる">
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 w-full relative min-h-0">
        {viewMode === '2D' && (
          <div className="w-full h-full" ref={containerRef2D} />
        )}
        {viewMode === '3D' && (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
