import { useRef } from 'react';
import { fileSize, type AttachmentDescriptor } from '../../services/attachments';
import { VideoIcon } from '../Icons/VideoIcon';
import { handlePreviewImageError, useFilePreview } from './FilePreview';
import styles from './FilePreview.module.css';

export function AttachmentCard({ file, variant = 'message', onRemove }: {
  file: AttachmentDescriptor;
  variant?: 'message' | 'composer';
  onRemove?: () => void;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLButtonElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const filename = useRef<HTMLElement>(null);
  const icon = useRef<HTMLSpanElement>(null);
  const { openPreview } = useFilePreview();
  const composer = variant === 'composer';
  return <span ref={root} className={composer ? styles.composerAttachment : styles.messageAttachment} onClick={event => event.stopPropagation()}>
    <button ref={card} type="button" className={composer ? styles.composerCard : styles.messageCard}
      title={`${file.filename} · ${fileSize(file.size)}`} aria-label={`预览 ${file.filename}`}
      onClick={() => openPreview(file, { root: root.current!, card: card.current, image: image.current, filename: filename.current, icon: icon.current })}>
      {file.type === 'image' ? <img ref={image} src={file.url} alt="" onError={handlePreviewImageError} />
        : <span ref={icon} className={styles.fileIcon}>{file.type === 'video' ? <VideoIcon size={28} /> : '▤'}</span>}
      {(!composer || file.type !== 'image') && <span className={styles.cardLabel}>
        <strong ref={filename}>{file.filename}</strong>
        {!composer && <small>{file.filename.split('.').pop()?.toUpperCase()} · {fileSize(file.size)}</small>}
      </span>}
    </button>
    {onRemove && <button type="button" className={styles.remove} aria-label={`移除 ${file.filename}`}
      onClick={event => { event.stopPropagation(); onRemove(); }}>×</button>}
  </span>;
}
