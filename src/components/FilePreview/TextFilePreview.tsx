import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { attachmentFor, fileExtension, previewFormat, type AttachmentDescriptor } from '../../services/attachments';
import { MarkdownPre, markdownRemarkPlugins, markdownRehypePlugins } from './MarkdownSupport';
import { useWorkspace } from '../Workspace/WorkspaceContext';
import type { PluggableList } from 'unified';
import styles from './FilePreview.module.css';
import { usePreviewReveal } from './usePreviewReveal';

const DiagramPreview = lazy(() => import('./DiagramPreview'));
const JsonPreview = lazy(() => import('./JsonPreview'));
const CodePreview = lazy(() => import('./CodePreview').then(module => ({ default: module.CodePreview })));
type Merge = { s: { r: number; c: number }; e: { r: number; c: number } };

// Quoted fields may contain delimiters, escaped quotes, and literal line breaks.
function parseDelimitedText(input: string, delimiter: string): { rows: string[][]; error?: string } {
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, afterQuote = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; afterQuote = true; }
      } else field += char;
    } else if (char === delimiter) {
      row.push(field); field = ''; afterQuote = false;
    } else if (char === '\n' || char === '\r') {
      row.push(field); rows.push(row); row = []; field = ''; afterQuote = false;
      if (char === '\r' && text[index + 1] === '\n') index++;
    } else if (char === '"' && !field && !afterQuote) {
      quoted = true;
    } else if (afterQuote) {
      if (char !== ' ' && char !== '\t') return { rows: [], error: '带引号的单元格结束后出现了多余字符，请下载文件查看。' };
    } else {
      field += char;
    }
  }
  if (quoted) return { rows: [], error: '文件中存在未闭合的引号，请下载文件查看。' };
  if (row.length || field || afterQuote) { row.push(field); rows.push(row); }
  return { rows };
}

function columnLabel(index: number) {
  let label = '';
  for (let number = index + 1; number > 0; number = Math.floor((number - 1) / 26)) label = String.fromCharCode(65 + (number - 1) % 26) + label;
  return label;
}

export function CsvPreview({ text = '', delimiter = ',', rows, merges = [] }: { text?: string; delimiter?: string; rows?: string[][]; merges?: Merge[] }) {
  const parsed = useMemo(() => rows ? { rows, error: undefined } : parseDelimitedText(text, delimiter), [text, delimiter, rows]);
  const columns = useMemo(() => parsed.rows.reduce((max, row) => Math.max(max, row.length), 0), [parsed]);
  const [selected, setSelected] = useState<{ row: number; column: number } | null>(null);
  const [page, setPage] = useState(0);
  const [copyStatus, setCopyStatus] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const focusFrame = useRef<number | null>(null);
  const alive = useRef(true);
  const pageSize = 200;
  const pageCount = Math.ceil(parsed.rows.length / pageSize);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current); };
  }, []);
  const select = (row: number, column: number) => {
    const merge = merges.find(item => row >= item.s.r && row <= item.e.r && column >= item.s.c && column <= item.e.c);
    const anchor = merge ? merge.s : { r: row, c: column };
    const targetPage = Math.floor(row / pageSize), visibleRow = Math.max(anchor.r, targetPage * pageSize);
    setSelected({ row: anchor.r, column: anchor.c }); setCopyStatus(''); setPage(targetPage);
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      root.current?.querySelector<HTMLElement>(`[data-csv-row="${visibleRow}"][data-csv-column="${anchor.c}"]`)?.focus({ preventScroll: false });
      focusFrame.current = null;
    });
  };
  const selectedValue = selected ? parsed.rows[selected.row]?.[selected.column] ?? '' : '';
  const copy = async () => {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selectedValue); if (alive.current) setCopyStatus('已复制单元格内容'); }
    catch { if (alive.current) setCopyStatus('复制失败，请保持单元格选中并按 Ctrl/Cmd+C'); }
  };
  if (parsed.error) return <p role="status">CSV 预览失败：{parsed.error}</p>;
  if (!parsed.rows.length) return <p role="status">文件内容为空。</p>;
  return <div ref={root} className={styles.csvPreview} onCopy={event => {
    if (!selected) return;
    event.preventDefault(); event.clipboardData.setData('text/plain', selectedValue); setCopyStatus('已复制单元格内容');
  }}>
    <div className={styles.csvToolbar}>
      <span>{parsed.rows.length} 行 · {columns} 列{selected ? ` · 已选 ${columnLabel(selected.column)}${selected.row + 1}` : ''}</span>
      <button type="button" className={styles.viewerButton} disabled={!selected} onClick={() => void copy()}>复制单元格</button>
      <span role="status" aria-live="polite">{copyStatus}</span>
    </div>
    <div className={styles.csvScroll}>
      <table className={styles.csvTable} role="grid" aria-label="CSV 单元格预览" aria-rowcount={parsed.rows.length + 1} aria-colcount={columns + 1}>
        <thead><tr><th scope="col" aria-label="行号" />{Array.from({ length: columns }, (_, column) => <th scope="col" key={column}>{columnLabel(column)}</th>)}</tr></thead>
        <tbody>{parsed.rows.slice(page * pageSize, (page + 1) * pageSize).map((row, localRow) => {
          const rowIndex = page * pageSize + localRow;
          return <tr key={rowIndex} aria-rowindex={rowIndex + 2}><th scope="row">{rowIndex + 1}</th>{Array.from({ length: columns }, (_, column) => {
            const merge = merges.find(item => rowIndex >= item.s.r && rowIndex <= item.e.r && column >= item.s.c && column <= item.e.c);
            const anchorRow = merge ? Math.max(merge.s.r, page * pageSize) : rowIndex;
            if (merge && (rowIndex !== anchorRow || column !== merge.s.c)) return null;
            const valueRow = merge ? merge.s.r : rowIndex;
            const active = selected?.row === valueRow && selected.column === column;
            return <td key={column} role="gridcell" aria-selected={active} data-csv-row={rowIndex} data-csv-column={column}
              rowSpan={merge ? Math.min(merge.e.r + 1, (page + 1) * pageSize) - anchorRow : undefined} colSpan={merge ? merge.e.c - merge.s.c + 1 : undefined}
              tabIndex={active || (!selected && localRow === 0 && column === 0) ? 0 : -1}
              className={active ? styles.selectedCell : undefined}
              onClick={event => { setSelected({ row: valueRow, column }); setCopyStatus(''); event.currentTarget.focus(); }}
              onFocus={() => setSelected({ row: valueRow, column })}
              onKeyDown={event => {
                const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
                if (!step) return;
                event.preventDefault();
                const startRow = step[0] > 0 && merge ? merge.e.r : step[0] < 0 && merge ? merge.s.r : rowIndex;
                const startColumn = step[1] > 0 && merge ? merge.e.c : step[1] < 0 && merge ? merge.s.c : column;
                select(Math.max(0, Math.min(parsed.rows.length - 1, startRow + step[0])), Math.max(0, Math.min(columns - 1, startColumn + step[1])));
              }}>{parsed.rows[valueRow]?.[column] ?? row[column] ?? ''}</td>;
          })}</tr>;
        })}</tbody>
      </table>
    </div>
    {pageCount > 1 && <div className={styles.csvToolbar}>
      <button type="button" className={styles.viewerButton} disabled={page === 0} onClick={() => { setPage(page - 1); setSelected(null); setCopyStatus(''); }}>上一页</button>
      <span>第 {page + 1} / {pageCount} 页 · 每页 {pageSize} 行</span>
      <button type="button" className={styles.viewerButton} disabled={page + 1 >= pageCount} onClick={() => { setPage(page + 1); setSelected(null); setCopyStatus(''); }}>下一页</button>
    </div>}
  </div>;
}

export function TextFilePreview({ file, text }: { file: AttachmentDescriptor; text: string }) {
  const format = previewFormat(file);
  const { openHtml } = useWorkspace();
  const host = useRef<HTMLDivElement>(null);
  usePreviewReveal(host);
  return <div ref={host} className={styles.textViewer}>
    <Suspense fallback={<p>正在加载预览组件…</p>}>{format === 'markdown' ? <div className={styles.markdown} tabIndex={0}><ReactMarkdown remarkPlugins={markdownRemarkPlugins} rehypePlugins={markdownRehypePlugins as PluggableList} components={{
        pre: ({ children, node }) => <MarkdownPre prefix={file.url} source={text} offset={node?.position?.start.offset} children={children} />,
        a: ({ children, node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" onClick={event => {
          if (props.href && /\.(html?|htm)(?:[?#]|$)/i.test(props.href)) {
            event.preventDefault(); openHtml({ id: `${file.url}:link:${props.href}`, file: attachmentFor(props.href) });
          }
        }}>{children}</a>,
      }}>{text}</ReactMarkdown></div>
      : format === 'csv' || format === 'tsv' ? <CsvPreview text={text} delimiter={format === 'tsv' ? '\t' : ','} />
        : format === 'mermaid' || format === 'svg' ? <DiagramPreview text={text} format={format} filename={file.filename} />
          : format === 'json' ? <JsonPreview text={text} />
            : ['txt', 'log'].includes(fileExtension(file)) ? <pre className={styles.plainText} tabIndex={0} aria-label="文本预览">{text}</pre>
              : <CodePreview code={text} language={fileExtension(file)} virtualized />}</Suspense>
  </div>;
}
