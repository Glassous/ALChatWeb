import { useEffect, useMemo, useRef, useState } from 'react';
import { Highlight, themes, type Token } from 'prism-react-renderer';
import { useVirtualizer } from '@tanstack/react-virtual';
import { codeLanguage } from './codeLanguage';
import { loadGrammar } from './codePrism';
import './renderers.css';
import { usePreviewReveal } from './usePreviewReveal';

function VirtualCode({ code, language, follow }: { code: string; language: string; follow: boolean }) {
  const scroll = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [result, setResult] = useState<{ code: string; tokens: Token[][] } | null>(null);
  const latest = useRef({ code, language });
  const send = useRef<(() => void) | null>(null);
  const lines = useMemo(() => code.split('\n'), [code]);
  useEffect(() => {
    const worker = new Worker(new URL('./code.worker.ts', import.meta.url), { type: 'module' });
    let pending: { code: string; language: string } | null = null, completed: { code: string; language: string } | null = null;
    const dispatch = () => {
      const next = latest.current;
      if (pending || (completed?.code === next.code && completed.language === next.language)) return;
      pending = next; worker.postMessage(next);
    };
    send.current = dispatch;
    worker.onmessage = event => {
      if (!pending) return;
      completed = pending;
      if (pending.code === latest.current.code && pending.language === latest.current.language) setResult({ code: pending.code, tokens: event.data.tokens });
      pending = null; dispatch();
    };
    return () => { send.current = null; worker.terminate(); };
  }, []);
  useEffect(() => {
    latest.current = { code, language };
    const timer = setTimeout(() => send.current?.(), 60);
    return () => clearTimeout(timer);
  }, [code, language]);
  const virtual = useVirtualizer({ count: lines.length, getScrollElement: () => scroll.current, estimateSize: () => 22, overscan: 15 });
  useEffect(() => {
    if (!follow || !nearBottom.current) return;
    const frame = requestAnimationFrame(() => { const node = scroll.current; if (node) node.scrollTop = node.scrollHeight; });
    return () => cancelAnimationFrame(frame);
  }, [code, follow]);
  const tokens = result?.code === code ? result.tokens : null;
  return <div ref={scroll} className="code-scroll code-virtual" tabIndex={0} aria-label="代码预览" onScroll={event => { const node = event.currentTarget; nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60; }}>
    <div style={{ height: virtual.getTotalSize(), position: 'relative', minWidth: '100%', width: 'max-content' }}>
      {virtual.getVirtualItems().map(row => <div key={row.key} className="code-line" style={{ position: 'absolute', top: row.start, height: row.size }}>
        <span className="code-line-number" aria-hidden="true">{row.index + 1}</span>
        <span>{tokens ? tokens[row.index]?.map((token, index) => <span key={index} className={`token ${token.types.join(' ')}`}>{token.content}</span>) : lines[row.index] || '\u00a0'}</span>
      </div>)}
    </div>
  </div>;
}

export function CodePreview({ code, language = 'text', virtualized = false, follow = false }: { code: string; language?: string; virtualized?: boolean; follow?: boolean }) {
  const [copied, setCopied] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  usePreviewReveal(host);
  const [, setGrammarVersion] = useState(0);
  useEffect(() => {
    if (virtualized || code.length > 50000) return;
    let active = true;
    void loadGrammar(codeLanguage(language)).then(() => { if (active) setGrammarVersion(value => value + 1); }).catch(() => {});
    return () => { active = false; };
  }, [language, virtualized, code.length > 50000]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1800); return () => clearTimeout(timer); }, [copied]);
  return <div ref={host} className="code-viewer">
    <div className="renderer-toolbar"><span>{language || 'text'}</span><button type="button" onClick={() => void navigator.clipboard.writeText(code).then(() => setCopied(true)).catch(() => setCopied(false))}>{copied ? '已复制' : '复制代码'}</button></div>
    {virtualized || code.length > 50000 ? <VirtualCode code={code} language={language} follow={follow} />
      : <Highlight theme={themes.vsDark} code={code} language={codeLanguage(language)}>{({ tokens, getLineProps, getTokenProps }) => <pre className="code-scroll" tabIndex={0}>
        {tokens.map((line, index) => <div {...getLineProps({ line })} className="code-line" key={index}><span className="code-line-number" aria-hidden="true">{index + 1}</span><span>{line.map((token, tokenIndex) => <span {...getTokenProps({ token })} key={tokenIndex} />)}</span></div>)}
      </pre>}</Highlight>}
  </div>;
}
