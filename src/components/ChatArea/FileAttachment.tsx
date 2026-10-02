import { useState } from 'react';
import { ModalCard, useToast } from '../LayerSystem/LayerSystem';
import { fileSize, type AttachmentDescriptor } from '../../services/attachments';

export function FileAttachment({ file }: { file: AttachmentDescriptor }) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();
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
      {file.type === 'image' ? <img src={file.url} alt="" /> : <span className="attachment-file-icon">{file.type === 'video' ? '▶' : '▤'}</span>}
      <span><strong>{file.filename}</strong><small>{file.filename.split('.').pop()?.toUpperCase()} · {fileSize(file.size)}</small></span>
    </button>
    <ModalCard open={open} title="文件预览" onClose={() => setOpen(false)} actions={<button type="button" disabled={downloading} onClick={download}>{downloading ? '下载中…' : '下载文件'}</button>}>
      {file.type === 'image' && <img className="attachment-preview-image" src={file.url} alt={file.filename} />}
      {file.type === 'video' && <video className="attachment-preview-image" src={file.url} controls />}
      <dl className="attachment-file-info"><dt>文件名</dt><dd>{file.filename}</dd><dt>格式</dt><dd>{file.mime_type === 'application/octet-stream' ? file.filename.split('.').pop()?.toUpperCase() || '未知' : file.mime_type}</dd><dt>大小</dt><dd>{fileSize(file.size)}</dd></dl>
    </ModalCard>
  </span>;
}
