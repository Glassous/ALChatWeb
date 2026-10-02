import { useEffect, useState } from 'react';
import { ModalCard, useToast } from '../LayerSystem/LayerSystem';
import layerStyles from '../LayerSystem/LayerSystem.module.css';
import { fileSize, isTextAttachment, readTextAttachment, type AttachmentDescriptor } from '../../services/attachments';
import { VideoIcon } from '../Icons/VideoIcon';

export function FileAttachment({ file }: { file: AttachmentDescriptor }) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [rawText, setRawText] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const textFile = isTextAttachment(file);
  const toast = useToast();
  useEffect(() => {
    if (!open || !textFile) return;
    const controller = new AbortController();
    let active = true;
    setRawText(null); setPreviewError('');
    const timer = setTimeout(() => controller.abort(), 30000);
    void readTextAttachment(file, controller.signal).then(text => {
      if (active) setRawText(text);
    }).catch(error => {
      if (active) setPreviewError(controller.signal.aborted ? '原文加载超时，请重试或下载文件' : error instanceof Error ? error.message : '原文加载失败');
    }).finally(() => clearTimeout(timer));
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [open, textFile, file.url, previewAttempt]);
  const download = async () => {
    setDownloading(true);
    try {
      const response = await fetch(file.url);
      if (!response.ok) throw new Error('下载失败');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url; link.download = file.filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { toast({ tone: 'error', message: '下载失败，请重试' }); }
    finally { setDownloading(false); }
  };
  return <span onClick={event => event.stopPropagation()}>
    <button type="button" className="attachment-file-card" onClick={event => { event.stopPropagation(); setOpen(true); }}>
      {file.type === 'image' ? <img src={file.url} alt="" /> : <span className="attachment-file-icon">{file.type === 'video' ? <VideoIcon size={28} /> : '▤'}</span>}
      <span><strong>{file.filename}</strong><small>{file.filename.split('.').pop()?.toUpperCase()} · {fileSize(file.size)}</small></span>
    </button>
    <ModalCard open={open} title="文件预览" onClose={() => setOpen(false)} actions={<>
      <button type="button" className={layerStyles.secondaryButton} onClick={() => setOpen(false)}>关闭</button>
      <button type="button" className={layerStyles.primaryButton} disabled={downloading} onClick={download}>{downloading ? '下载中…' : '下载文件'}</button>
    </>}>
      {file.type === 'image' && <img className="attachment-preview-image" src={file.url} alt={file.filename} />}
      {file.type === 'video' && <video className="attachment-preview-image" src={file.url} controls />}
      <dl className="attachment-file-info"><dt>文件名</dt><dd>{file.filename}</dd><dt>格式</dt><dd>{file.mime_type === 'application/octet-stream' ? file.filename.split('.').pop()?.toUpperCase() || '未知' : file.mime_type}</dd><dt>大小</dt><dd>{fileSize(file.size)}</dd></dl>
      {textFile && <section className="attachment-text-section" aria-label="原文预览">
        <strong>原文预览</strong>
        {previewError ? <div role="status"><p>{previewError}</p><button type="button" className={layerStyles.secondaryButton} onClick={() => setPreviewAttempt(value => value + 1)}>重新加载</button></div> : rawText === null ? <p role="status">加载原文中…</p> : <pre className="attachment-raw-text">{rawText}</pre>}
      </section>}
    </ModalCard>
  </span>;
}
