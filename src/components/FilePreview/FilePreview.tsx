/* eslint-disable react-refresh/only-export-components */
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal, flushSync } from 'react-dom';
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { useGSAP } from '@gsap/react';
import { fileSize, isTextAttachment, previewFormat, readTextAttachment, type AttachmentDescriptor } from '../../services/attachments';
import { useWorkspace } from '../Workspace/WorkspaceContext';
import { useBlockingLayer, useToast } from '../LayerSystem/LayerSystem';
import layerStyles from '../LayerSystem/LayerSystem.module.css';
import { VideoIcon } from '../Icons/VideoIcon';
import { TextFilePreview } from './TextFilePreview';
import { PreviewBoundary } from './PreviewBoundary';
import styles from './FilePreview.module.css';

gsap.registerPlugin(Flip, useGSAP);
const DocumentPreview = lazy(() => import('./DocumentPreview'));

export interface PreviewSource {
  root: HTMLElement;
  imageOnly?: boolean;
  card?: HTMLElement | null;
  image?: HTMLImageElement | null;
  filename?: HTMLElement | null;
  icon?: HTMLElement | null;
}
type Rect = { left: number; top: number; width: number; height: number };
type Part = { rect: Rect; clip: string; radius: string; background: string; color: string; border: string; fontSize: string; lineHeight: string; fontWeight: string };
type Parts = Partial<Record<'card' | 'image' | 'filename' | 'icon', Part>>;
interface PreviewRequest { id: number; file: AttachmentDescriptor; source: PreviewSource; parts: Parts; imageUrl?: string; ratio?: number; focus: HTMLElement | null }
const PreviewContext = createContext<{ openPreview: (file: AttachmentDescriptor, source: PreviewSource) => void } | null>(null);

export function handlePreviewImageError(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget;
  if (image.src.includes('alchatfiles.fiacloud.top')) {
    image.src = image.src.replace('alchatfiles.fiacloud.top', 'alchatfiles-1350226447.cos.ap-tokyo.myqcloud.com');
  }
}

function measure(element: HTMLElement, imageRatio?: number): Part {
  const box = element.getBoundingClientRect();
  const css = getComputedStyle(element);
  let rect: Rect = { left: box.left, top: box.top, width: box.width, height: box.height };
  let clip = css.clipPath === 'none' ? 'inset(0% 0% 0% 0%)' : css.clipPath;
  if (element instanceof HTMLImageElement && imageRatio && ['cover', 'contain'].includes(css.objectFit)) {
    const cover = css.objectFit === 'cover';
    const width = (box.width / box.height > imageRatio) === cover ? box.width : box.height * imageRatio;
    const height = width / imageRatio;
    // All shared image surfaces use centered object positioning.
    rect = { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
    const x = Math.max(0, (width - box.width) / width * 50);
    const y = Math.max(0, (height - box.height) / height * 50);
    clip = `inset(${y}% ${x}% ${y}% ${x}%)`;
  }
  return { rect, clip, radius: css.borderRadius, background: css.backgroundColor, color: css.color, border: css.border,
    fontSize: css.fontSize, lineHeight: css.lineHeight, fontWeight: css.fontWeight };
}

function capture(source: PreviewSource, ratio?: number): Parts {
  const parts: Parts = {};
  for (const key of ['card', 'image', 'filename', 'icon'] as const) {
    const node = source[key];
    if (key === 'image' && !ratio) continue;
    if (node?.isConnected && node.getBoundingClientRect().width > 0) parts[key] = measure(node, ratio);
  }
  return parts;
}

function visibleSource(root: HTMLElement) {
  if (!root.isConnected) return false;
  const box = root.getBoundingClientRect();
  let left = Math.max(0, box.left), top = Math.max(0, box.top);
  let right = Math.min(window.innerWidth, box.right), bottom = Math.min(window.innerHeight, box.bottom);
  for (let parent = root.parentElement; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent);
    const clipX = /auto|scroll|hidden|clip/.test(css.overflowX);
    const clipY = /auto|scroll|hidden|clip/.test(css.overflowY);
    if (clipX || clipY) {
      const rect = parent.getBoundingClientRect();
      if (clipX) { left = Math.max(left, rect.left); right = Math.min(right, rect.right); }
      if (clipY) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom); }
    }
  }
  return right > left && bottom > top;
}

export function FilePreviewProvider({ children }: { children: ReactNode }) {
  const { openHtml, openRevision } = useWorkspace();
  const [request, setRequest] = useState<PreviewRequest | null>(null);
  const sequence = useRef(0);
  const openPreview = useCallback((file: AttachmentDescriptor, source: PreviewSource) => {
    if (isTextAttachment(file) && file.type !== 'file') file = { ...file, type: 'file' };
    if (previewFormat(file) === 'html') {
      setRequest(null); openHtml({ id: file.url, file, mode: 'preview' }); return;
    }
    const image = source.image;
    const ratio = image?.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : undefined;
    setRequest({ id: ++sequence.current, file, source, parts: capture(source, ratio), ratio,
      imageUrl: image?.currentSrc || image?.src,
      focus: document.activeElement instanceof HTMLElement ? document.activeElement : null });
  }, [openHtml]);
  useEffect(() => { setRequest(null); }, [openRevision]);
  const dismiss = useCallback((id: number) => setRequest(current => current?.id === id ? null : current), []);
  const value = useMemo(() => ({ openPreview }), [openPreview]);
  return <PreviewContext.Provider value={value}>{children}{request && <PreviewCard key={request.id} request={request} onDismiss={dismiss} />}</PreviewContext.Provider>;
}

export function useFilePreview() {
  const context = useContext(PreviewContext);
  if (!context) throw new Error('useFilePreview must be used inside FilePreviewProvider');
  return context;
}

function PreviewCard({ request, onDismiss }: { request: PreviewRequest; onDismiss: (id: number) => void }) {
  const { file, source } = request;
  const [closing, setClosing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [rawText, setRawText] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageRatio, setImageRatio] = useState(request.ratio || 1);
  const layer = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLButtonElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const filename = useRef<HTMLHeadingElement>(null);
  const icon = useRef<HTMLSpanElement>(null);
  const shellFlight = useRef<HTMLDivElement>(null);
  const flight = useRef<HTMLDivElement>(null);
  const motion = useRef<gsap.core.Timeline | null>(null);
  const movingParts = useRef<Partial<Record<keyof Parts, HTMLElement>>>({});
  const interrupted = useRef<{ parts: Parts; backdrop: number; extras: number } | null>(null);
  const titleId = useId();
  const alive = useRef(true);
  const sourceVisibility = useRef(source.root.style.visibility);
  const toast = useToast();
  const textFile = isTextAttachment(file);
  const format = previewFormat(file);
  const documentFile = ['pdf', 'docx', 'xlsx', 'pptx'].includes(format);
  const imageFile = format === 'image';
  const imageOnly = imageFile && Boolean(source.imageOnly);
  const close = useCallback(() => {
    if (!interrupted.current) {
      const parts: Parts = {};
      for (const key of ['card', 'image', 'filename', 'icon'] as const) {
        const node = movingParts.current[key];
        if (node?.isConnected) parts[key] = measure(node);
      }
      interrupted.current = { parts, backdrop: Number(gsap.getProperty(backdrop.current, 'opacity')),
        extras: Number(gsap.getProperty(frame.current?.querySelector('[data-preview-extra]') || dialog.current, 'opacity')) };
    }
    setClosing(true);
  }, []);
  const finish = useCallback(() => {
    // Restore the source and remove the overlay in one commit. Leaving this to a
    // passive effect lets Flip's revert briefly reveal the full-size preview.
    source.root.style.visibility = sourceVisibility.current;
    if (layer.current) layer.current.style.visibility = 'hidden';
    flushSync(() => onDismiss(request.id));
  }, [onDismiss, request.id, source]);
  useBlockingLayer(true);

  useLayoutEffect(() => {
    alive.current = true;
    const visibility = source.root.style.visibility;
    sourceVisibility.current = visibility;
    source.root.style.visibility = 'hidden';
    frame.current?.focus({ preventScroll: true });
    const observer = new MutationObserver(() => { if (!source.root.isConnected) close(); });
    const appRoot = document.getElementById('root');
    if (appRoot) observer.observe(appRoot, { childList: true, subtree: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key !== 'Tab' || !frame.current) return;
      const nodes = Array.from(frame.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], video[controls], [tabindex="0"]'));
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); frame.current.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === frame.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === frame.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      alive.current = false;
      observer.disconnect();
      document.removeEventListener('keydown', keydown, true);
      source.root.style.visibility = visibility;
      queueMicrotask(() => { if (request.focus?.isConnected) request.focus.focus({ preventScroll: true }); });
    };
  }, [close, request, source]);

  useEffect(() => {
    if (!textFile || closing) return;
    const controller = new AbortController();
    let active = true;
    setRawText(null); setPreviewError('');
    const timer = window.setTimeout(() => controller.abort(), 30000);
    void readTextAttachment(file, controller.signal).then(text => { if (active) setRawText(text); })
      .catch(error => { if (active) setPreviewError(controller.signal.aborted ? '原文加载超时，请重试或下载文件' : error instanceof Error ? error.message : '原文加载失败'); })
      .finally(() => window.clearTimeout(timer));
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [file, textFile, attempt, closing]);

  const { contextSafe } = useGSAP(() => {
    const card = dialog.current!;
    const targets = { card, image: image.current, filename: filename.current, icon: icon.current };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? .1 : closing ? .32 : .42;
    const origin = closing ? (visibleSource(source.root) ? capture(source, request.ratio) : {}) : request.parts;
    const ghosts: HTMLElement[] = [];
    const hidden: HTMLElement[] = [];
    const extras: HTMLElement[] = Array.from(frame.current!.querySelectorAll<HTMLElement>('[data-preview-extra]'));
    const pairs: { key: keyof Parts; ghost: HTMLElement; start: Part; end: Part }[] = [];
    // Read both layouts before writing any animation styles. Every ghost is a sibling,
    // so the image and filename never inherit the card's scale.
    if (!reduced) for (const key of ['card', 'image', 'filename', 'icon'] as const) {
      const target = targets[key];
      const from = origin[key];
      if (!target || !from || (key === 'image' && imageFailed)) continue;
      const to = measure(target, key === 'image' ? request.ratio : undefined);
      const ghost = key === 'card' ? document.createElement('div') : target.cloneNode(true) as HTMLElement;
      ghost.removeAttribute('id'); ghost.setAttribute('aria-hidden', 'true');
      Object.assign(ghost.style, { position: 'fixed', margin: '0', padding: '0', minWidth: '0', maxWidth: 'none', maxHeight: 'none', boxSizing: 'border-box', transformOrigin: '0 0', pointerEvents: 'none', willChange: 'transform, opacity', overflow: 'hidden' });
      if (key === 'image') { ghost.style.objectFit = 'fill'; (ghost as HTMLImageElement).src = request.imageUrl || file.url; }
      (key === 'card' ? shellFlight.current : flight.current)!.appendChild(ghost);
      pairs.push({ key, ghost, start: closing ? interrupted.current?.parts[key] || to : from, end: closing ? from : to });
      movingParts.current[key] = ghost;
      ghosts.push(ghost);
      if (key !== 'card') hidden.push(target);
    }
    const hasShell = Boolean(!reduced && origin.card);
    if (hasShell) gsap.set(card, { backgroundColor: 'transparent', borderColor: 'transparent', boxShadow: 'none' });
    gsap.set(hidden, { visibility: 'hidden' });
    for (const key of ['image', 'filename', 'icon'] as const) {
      const target = targets[key];
      if (target && !hidden.includes(target)) extras.push(target);
    }
    const timeline = gsap.timeline({ defaults: { ease: 'power3.inOut' }, onComplete: contextSafe(() => {
      if (closing) { finish(); return; }
      gsap.set(card, { clearProps: 'backgroundColor,borderColor,boxShadow,opacity,transform' });
      gsap.set([...hidden, ...extras], { clearProps: 'visibility,opacity' });
      ghosts.forEach(ghost => ghost.remove());
      movingParts.current = {};
    }) });
    motion.current = timeline;
    const place = (ghost: HTMLElement, part: Part) => {
      Object.assign(ghost.style, { left: `${part.rect.left}px`, top: `${part.rect.top}px`, width: `${part.rect.width}px`, height: `${part.rect.height}px`, borderRadius: part.radius, backgroundColor: part.background, color: part.color, border: part.border, clipPath: part.clip,
        fontSize: part.fontSize, lineHeight: part.lineHeight, fontWeight: part.fontWeight });
    };
    for (const { key, ghost, start, end } of pairs) {
      place(ghost, start);
      const state = Flip.getState(ghost, { props: 'borderRadius,backgroundColor,color,border,fontSize,lineHeight,fontWeight' });
      place(ghost, end);
      timeline.add(Flip.from(state, { targets: ghost, scale: key !== 'filename', duration, ease: 'power3.inOut' }), 0);
      timeline.fromTo(ghost, { clipPath: start.clip }, { clipPath: end.clip, duration }, 0);
    }
    timeline.fromTo(backdrop.current, { opacity: closing ? interrupted.current?.backdrop ?? 1 : 0 }, { opacity: closing ? 0 : 1, duration }, 0);
    timeline.fromTo(extras, { opacity: closing ? interrupted.current?.extras ?? 1 : 0 }, { opacity: closing ? 0 : 1, duration: Math.min(.18, duration) }, closing ? 0 : duration * .45);
    if (!hasShell) timeline.fromTo(card, { opacity: closing ? 1 : 0 }, { opacity: closing ? 0 : 1, duration }, 0);
    const resize = () => { timeline.progress(1); };
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      ghosts.forEach(ghost => ghost.remove());
      movingParts.current = {};
      motion.current = null;
    };
  }, { scope: layer, dependencies: [closing], revertOnUpdate: true });

  const download = async () => {
    setDownloading(true);
    try {
      const response = await fetch(file.type === 'image' ? request.imageUrl || file.url : file.url);
      if (!response.ok) throw new Error('下载失败');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = file.filename; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { if (alive.current) toast({ tone: 'error', message: '下载失败，请重试' }); }
    finally { if (alive.current) setDownloading(false); }
  };
  const media = imageFile || file.type === 'video';
  const toolbar = <div className={`${styles.toolbar} ${imageOnly ? styles.imageToolbar : ''}`} data-preview-extra>
    <button type="button" className={styles.toolbarButton} disabled={downloading || closing}
      aria-label={downloading ? '下载中' : '下载文件'} title={downloading ? '下载中…' : '下载文件'} onClick={() => void download()}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5" /></svg>
    </button>
    <button type="button" className={styles.toolbarButton} aria-label="关闭预览" title="关闭预览" onClick={close}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
    </button>
  </div>;
  const previewImage = <img ref={image} src={request.imageUrl || file.url} alt={imageOnly ? '图片预览' : file.filename}
    className={imageOnly ? styles.imageOnlyPicture : styles.media}
    onLoad={event => { setImageFailed(false); if (imageOnly && event.currentTarget.naturalHeight) setImageRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight); }}
    onError={event => {
      if (event.currentTarget.src.includes('alchatfiles.fiacloud.top')) handlePreviewImageError(event);
      else { motion.current?.progress(1); setImageFailed(true); }
    }} />;
  const layerRoot = document.getElementById('layer-root');
  if (!layerRoot) return null;
  return createPortal(<div ref={layer} className={styles.layer}>
    <button ref={backdrop} type="button" className={styles.backdrop} aria-label="关闭文件预览" tabIndex={-1} onClick={close} />
    <div ref={shellFlight} className={`${styles.flight} ${styles.shellFlight}`} aria-hidden="true" />
    <div ref={frame} className={`${styles.frame} ${imageOnly ? styles.imageFrame : textFile || documentFile ? styles.textFrame : media ? styles.mediaFrame : ''}`}
      style={imageOnly ? { '--preview-image-ratio': imageRatio } as CSSProperties : undefined}
      role="dialog" aria-modal="true" aria-labelledby={imageOnly ? undefined : titleId} aria-label={imageOnly ? '图片预览' : undefined} tabIndex={-1}>
      {imageOnly && toolbar}
      <div ref={dialog} className={`${styles.dialog} ${imageOnly ? styles.imageSurface : ''}`}>
        {imageOnly ? <>
          {previewImage}
          {imageFailed && <p className={styles.imageError} role="status" data-preview-extra>图片加载失败，请下载原文件。</p>}
        </> : <>
          <header className={styles.header}>
            {!imageFile && <span ref={icon} className={styles.fileIcon}>{file.type === 'video' ? <VideoIcon size={28} /> : '▤'}</span>}
            <h2 ref={filename} id={titleId} className={styles.title} title={file.filename}>{file.filename}</h2>
            {toolbar}
          </header>
          <div className={styles.body}>
            {imageFile && previewImage}
            {imageFailed && <p className={styles.error} role="status" data-preview-extra>图片加载失败，请重试或下载原文件。</p>}
            {file.type === 'video' && <video className={styles.media} src={file.url} controls data-preview-extra />}
            <dl className={styles.metadata} data-preview-extra>
              <div><dt>格式</dt><dd>{file.mime_type === 'application/octet-stream' ? file.filename.split('.').pop()?.toUpperCase() || '未知' : file.mime_type}</dd></div>
              <div><dt>大小</dt><dd>{fileSize(file.size)}</dd></div>
            </dl>
            {textFile && <section className={styles.textSection} aria-label="文本预览" data-preview-extra>
              <div className={styles.textBody}>{previewError ? <div role="status"><p>{previewError}</p><button type="button" className={layerStyles.secondaryButton} onClick={() => setAttempt(value => value + 1)}>重新加载</button></div>
                : rawText === null ? <p role="status">正在加载文本…</p> : <PreviewBoundary resetKey={`${file.url}:${attempt}`} onRetry={() => setAttempt(value => value + 1)}><TextFilePreview file={file} text={rawText} /></PreviewBoundary>}</div>
            </section>}
            {documentFile && <section className={`${styles.textSection} ${styles.textBody}`} aria-label="文档预览" data-preview-extra><PreviewBoundary resetKey={`${file.url}:${attempt}`} onRetry={() => setAttempt(value => value + 1)}><Suspense fallback={<p>正在加载文档组件…</p>}><DocumentPreview key={attempt} file={file} closing={closing} /></Suspense></PreviewBoundary></section>}
          </div>
        </>}
      </div>
    </div>
    <div ref={flight} className={styles.flight} aria-hidden="true" />
  </div>, layerRoot);
}
