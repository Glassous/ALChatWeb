import { useEffect, useId, useRef, useState } from 'react';
import { usePreviewReveal } from './usePreviewReveal';
import { cleanSvg, downloadSvg } from './svg';
import './renderers.css';

let queue = Promise.resolve();
let sequence = 0;
export default function DiagramPreview({ text, format, filename = '流程图.mmd', streaming = false }: { text: string; format: 'svg' | 'mermaid'; filename?: string; streaming?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [result, setResult] = useState<{ source: string; svg: string; url: string } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  usePreviewReveal(host, Boolean(result?.source === text), result?.url);
  useEffect(() => {
    let active = true, url = '';
    const timer = setTimeout(() => {
      const render = async () => {
        if (!active) return;
        try {
          let svg = text;
          if (format === 'mermaid') {
            const { default: mermaid } = await import('mermaid');
            if (!active) return;
            mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, maxTextSize: 100000, htmlLabels: false });
            svg = (await mermaid.render(`diagram-${id}-${++sequence}`, text)).svg;
          }
          if (!active) return;
          svg = cleanSvg(svg);
          url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
          setResult({ source: text, svg, url }); setError('');
        } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : '图形渲染失败'); }
      };
      // Mermaid owns temporary DOM and configuration; serialize renders across instances.
      queue = queue.then(render, render);
    }, streaming ? 350 : 0);
    return () => { active = false; clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
  }, [text, format, filename, id, attempt, streaming]);
  const current = result?.source === text ? result : null;
  return <div ref={host} className="diagram-viewer">
    {error && !streaming ? <div role="status"><p>图形预览失败：{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重新渲染</button></div>
      : current ? <><div className="renderer-toolbar">{format === 'mermaid' && <button type="button" onClick={() => downloadSvg(current.svg, filename.replace(/\.(mmd|mermaid)$/i, '') + '.svg')}>下载 SVG</button>}</div><img className="diagram-image" src={current.url} alt={format === 'svg' ? 'SVG 预览' : 'Mermaid 图形预览'} /></>
        : <p role="status">{streaming ? '图形生成中…' : '正在渲染图形…'}</p>}
  </div>;
}
