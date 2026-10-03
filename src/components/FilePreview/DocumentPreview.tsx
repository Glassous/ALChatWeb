import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { readAttachmentData, previewFormat, type AttachmentDescriptor } from '../../services/attachments';
import { CsvPreview } from './TextFilePreview';
import './renderers.css';
import { usePreviewReveal } from './usePreviewReveal';
import DOMPurify from 'dompurify';

const PdfPreview = lazy(() => import('./PdfPreview'));

function DocxPreview({ bytes }: { bytes: Uint8Array }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  usePreviewReveal(host, !loading);
  useEffect(() => {
    let active = true;
    const container = document.createElement('div');
    host.current?.append(container);
    void import('docx-preview').then(async ({ renderAsync }) => {
      if (!active) return;
      await renderAsync(bytes, container, container, { useBase64URL: true, renderAltChunks: false, ignoreWidth: true, breakPages: true });
      if (active) {
        container.innerHTML = DOMPurify.sanitize(container.innerHTML, { ADD_TAGS: ['style'] });
        container.querySelectorAll('a[href]').forEach(link => { link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer'); });
        setLoading(false);
      }
    }).catch(() => { if (active) { setError('DOCX 预览失败，请重新加载或下载原文件。'); setLoading(false); } });
    return () => { active = false; container.remove(); };
  }, [bytes]);
  return <div className="document-scroll">{loading && <p role="status">正在渲染文档…</p>}{error && <p role="status">{error}</p>}<div ref={host} style={{ visibility: loading ? 'hidden' : undefined }} className="docx-preview-host" /></div>;
}

function XlsxPreview({ bytes }: { bytes: Uint8Array }) {
  const host = useRef<HTMLDivElement>(null);
  const [sheets, setSheets] = useState<{ name: string; rows: string[][]; merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] }[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0), [error, setError] = useState('');
  usePreviewReveal(host, Boolean(sheets), activeSheet);
  useEffect(() => {
    let active = true;
    void import('xlsx').then(({ read, utils }) => {
      if (!active) return;
      const book = read(bytes, { type: 'array', cellDates: false, cellNF: true });
      const values = book.SheetNames.map(name => {
        const sheet = book.Sheets[name], merges = sheet['!merges'] || [];
        const range = utils.decode_range(sheet['!ref'] || 'A1'); range.s = { r: 0, c: 0 };
        for (const merge of merges) { range.e.r = Math.max(range.e.r, merge.e.r); range.e.c = Math.max(range.e.c, merge.e.c); }
        if ((range.e.r + 1) * (range.e.c + 1) > 2000000) throw new Error('工作表范围过大，请下载原文件查看。');
        return { name, rows: utils.sheet_to_json<string[]>(sheet, { header: 1, range, raw: false, defval: '', blankrows: true }), merges };
      });
      if (active) setSheets(values);
    }).catch(() => { if (active) setError('XLSX 预览失败，请重新加载或下载原文件。'); });
    return () => { active = false; };
  }, [bytes]);
  const sheet = sheets?.[activeSheet];
  return <div ref={host} className="document-viewer">{error ? <p role="status">{error}</p> : !sheets ? <p role="status">正在读取工作表…</p> : <>
    <div className="renderer-toolbar"><label>工作表 <select value={activeSheet} onChange={event => setActiveSheet(Number(event.target.value))}>{sheets.map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}</select></label></div>
    {sheet ? <CsvPreview key={sheet.name} rows={sheet.rows} merges={sheet.merges} /> : <p>工作簿没有工作表。</p>}
  </>}</div>;
}

function PptxPreview({ bytes }: { bytes: Uint8Array }) {
  const host = useRef<HTMLImageElement>(null);
  const [deck, setDeck] = useState<{ render: (page: number) => string; count: number } | null>(null);
  const [page, setPage] = useState(0), [url, setUrl] = useState(''), [error, setError] = useState('');
  usePreviewReveal(host, Boolean(url), url);
  useEffect(() => {
    let active = true;
    void Promise.all([import('@office-kit/pptx'), import('@office-kit/pptx-preview')]).then(async ([core, preview]) => {
      if (!active) return;
      const presentation = await core.loadPresentation(bytes);
      const slides = core.getSlides(presentation);
      if (active) setDeck({ count: slides.length, render: index => preview.renderSlideToSvg(presentation, slides[index], { textLayout: 'svg', measureText: preview.defaultMeasurer }) });
    }).catch(() => { if (active) setError('PPTX 预览失败，请重新加载或下载原文件。'); });
    return () => { active = false; };
  }, [bytes]);
  useEffect(() => {
    if (!deck?.count) return;
    try {
      const source = deck.render(page);
      const next = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
      setUrl(next); return () => URL.revokeObjectURL(next);
    } catch { setError('此幻灯片渲染失败，请下载原文件。'); }
  }, [deck, page]);
  return <div className="document-viewer"><div className="renderer-toolbar"><span>第 {page + 1} / {deck?.count || '…'} 页</span><div>
    <button type="button" disabled={!page} onClick={() => setPage(value => value - 1)}>上一页</button>{' '}
    <button type="button" disabled={!deck || page + 1 >= deck.count} onClick={() => setPage(value => value + 1)}>下一页</button>
  </div></div><div className="document-scroll">{error ? <p role="status">{error}</p> : url ? <img ref={host} className="pptx-image" src={url} alt={`幻灯片 ${page + 1}`} /> : <p role="status">{deck?.count === 0 ? '演示文稿没有幻灯片。' : '正在渲染幻灯片…'}</p>}</div></div>;
}

export default function DocumentPreview({ file, closing = false }: { file: AttachmentDescriptor; closing?: boolean }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (closing) return;
    const controller = new AbortController(); let active = true;
    const timer = setTimeout(() => controller.abort(), 30000);
    setBytes(null); setError('');
    void readAttachmentData(file, controller.signal).then(data => { if (active) setBytes(data.bytes); }).catch(cause => { if (active) setError(controller.signal.aborted ? '文件加载超时，请重试。' : cause instanceof Error ? cause.message : '文件加载失败'); }).finally(() => clearTimeout(timer));
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [file, attempt, closing]);
  const format = previewFormat(file);
  return <div className="document-viewer"><div className="renderer-toolbar"><button type="button" onClick={() => setAttempt(value => value + 1)}>重新加载</button></div>
    {error ? <p role="status">{error}</p> : !bytes ? <p role="status">正在加载文件…</p> : <Suspense fallback={<p>正在加载预览组件…</p>}>
      {format === 'pdf' ? <PdfPreview key={attempt} bytes={bytes} /> : format === 'docx' ? <DocxPreview key={attempt} bytes={bytes} /> : format === 'xlsx' ? <XlsxPreview key={attempt} bytes={bytes} /> : <PptxPreview key={attempt} bytes={bytes} />}
    </Suspense>}
  </div>;
}
