import { Children, isValidElement, lazy, Suspense, useEffect, useId, type ReactNode } from 'react';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useWorkspace } from '../Workspace/WorkspaceContext';
import 'katex/dist/katex.min.css';

const CodePreview = lazy(() => import('./CodePreview').then(module => ({ default: module.CodePreview })));
const DiagramPreview = lazy(() => import('./DiagramPreview'));
export const markdownRemarkPlugins = [remarkGfm, remarkMath];
export const markdownRehypePlugins = [[rehypeKatex, { throwOnError: false, trust: false, maxSize: 20, maxExpand: 1000 }]];

function rawText(value: ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(rawText).join('');
  if (isValidElement<{ children?: ReactNode }>(value)) return rawText(value.props.children);
  return '';
}

export function MarkdownPre({ children, prefix = 'markdown', source = '', offset = 0, streaming = false }: { children?: ReactNode; prefix?: string; source?: string; offset?: number; streaming?: boolean }) {
  const { entry, openHtml, updateStream } = useWorkspace();
  const instance = useId();
  const code = Children.toArray(children).find(child => isValidElement<{ className?: string }>(child));
  const language = isValidElement<{ className?: string }>(code) ? code.props.className?.match(/language-([^\s]+)/)?.[1] || 'text' : 'text';
  const text = rawText(children).replace(/\n$/, '');
  const ordinal = (source.slice(0, offset).match(/(?:^|\n)\s*(?:`{3,}|~{3,})html?\b/gi) || []).length;
  const id = `${prefix === 'markdown' ? instance : prefix}:html:${ordinal}`;
  useEffect(() => {
    if (streaming && entry?.id === id && ['html', 'htm'].includes(language.toLowerCase())) updateStream(prefix, text, true, ordinal);
  }, [streaming, entry?.id, id, language, prefix, text, ordinal, updateStream]);
  if (['html', 'htm'].includes(language.toLowerCase())) {
    return <div className={`html-preview-card ${entry?.id === id ? 'active' : ''}`}><span>HTML</span><div className="html-preview-card-actions">
      <button type="button" className="html-preview-card-btn" onClick={() => openHtml({ id, html: text, mode: 'code' })}>代码</button>
      <button type="button" className="html-preview-card-btn" onClick={() => openHtml({ id, html: text, mode: 'preview' })}>预览</button>
    </div></div>;
  }
  return <Suspense fallback={<pre>{text}</pre>}>{language.toLowerCase() === 'mermaid' ? <DiagramPreview text={text} format="mermaid" streaming={streaming} /> : <CodePreview code={text} language={language} />}</Suspense>;
}
