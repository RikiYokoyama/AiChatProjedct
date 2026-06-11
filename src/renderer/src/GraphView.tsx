import { useEffect, useMemo, useRef } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { X } from 'lucide-react';

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
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graph = useMemo(() => buildGraph(notes), [notes]);

  useEffect(() => {
    if (!containerRef.current) return;

    const sigma = new Sigma(graph, containerRef.current, {
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
  }, [graph, notes, onSelectNote]);

  return (
    <div className="h-screen bg-[#070a13] text-gray-100">
      <header className="flex h-12 items-center justify-between border-b border-white/10 bg-[#0b1020] px-4">
        <div>
          <h1 className="font-semibold">ノートグラフ</h1>
          <p className="text-xs text-gray-400">{notes.length} notes / {graph.size} links</p>
        </div>
        <button className="rounded bg-white/5 p-2 hover:bg-white/10" onClick={onClose} title="閉じる">
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="h-[calc(100vh-3rem)]" ref={containerRef} />
    </div>
  );
}
