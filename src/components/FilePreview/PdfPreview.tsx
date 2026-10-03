import { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import './renderers.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
const options = { cMapUrl: `${import.meta.env.BASE_URL}pdf-assets/cmaps/`, cMapPacked: true, standardFontDataUrl: `${import.meta.env.BASE_URL}pdf-assets/standard_fonts/`, wasmUrl: `${import.meta.env.BASE_URL}pdf-assets/wasm/`, iccUrl: `${import.meta.env.BASE_URL}pdf-assets/iccs/` };

export default function PdfPreview({ bytes }: { bytes: Uint8Array }) {
  // PDF.js transfers this copy to its worker; page/zoom updates retain the document.
  const source = useMemo(() => ({ data: bytes.slice() }), [bytes]);
  const scroll = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const [page, setPage] = useState(1), [pages, setPages] = useState(0), [zoom, setZoom] = useState(1);
  const [password, setPassword] = useState('');
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(200, element.clientWidth - 24)));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  return <div className="document-viewer">
    <div className="renderer-toolbar"><span>第 {page} / {pages || '…'} 页</span><div>
      <button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button>{' '}
      <button type="button" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>下一页</button>{' '}
      <button type="button" disabled={zoom <= .5} onClick={() => setZoom(value => Math.max(.5, value - .25))}>−</button>{' '}
      <button type="button" onClick={() => setZoom(1)}>适应宽度</button>{' '}
      <button type="button" disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, value + .25))}>＋</button>
    </div></div>
    <div ref={scroll} className="document-scroll"><Document file={source} options={options} suspense={false}
      onLoadSuccess={({ numPages }) => setPages(numPages)}
      onPassword={(_callback, reason) => setPassword(reason === 2 ? 'PDF 密码错误，请下载文件后打开。' : 'PDF 已加密，请下载文件后打开。')}
      loading="正在加载 PDF…" error="PDF 预览失败，请重新加载或下载原文件。">
      <div className="pdf-page"><Page pageNumber={page} width={width * zoom} suspense={false} loading="正在渲染页面…" error="页面渲染失败。" /></div>
    </Document>{password && <p role="status">{password}</p>}</div>
  </div>;
}
