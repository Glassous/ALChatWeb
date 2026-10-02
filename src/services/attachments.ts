export interface AttachmentDescriptor {
  url: string;
  filename: string;
  mime_type: string;
  size?: number;
  type: 'image' | 'video' | 'document' | 'file';
}

export const documentFile = (name: string) => /\.(pdf|docx|xlsx)$/i.test(name);
export const fileSize = (size?: number) => size == null ? '大小未知' : size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KiB` : `${(size / (1024 * 1024)).toFixed(2)} MiB`;
export function attachmentFor(url: string, descriptors: AttachmentDescriptor[] = [], tag = 'file'): AttachmentDescriptor {
  const found = descriptors.find(item => item.url === url);
  if (found) return found;
  let filename = '文件';
  try { filename = decodeURIComponent(new URL(url).pathname.split('/').pop() || '文件'); } catch { /* Older incomplete URLs. */ }
  const type = tag === 'image' || /\.(png|jpe?g|gif|webp|bmp)$/i.test(filename) ? 'image' : tag === 'video' || /\.(mp4|mov|webm|avi|ogg)$/i.test(filename) ? 'video' : documentFile(filename) ? 'document' : 'file';
  return { url, filename, mime_type: type === 'image' ? 'image/*' : type === 'video' ? 'video/*' : 'application/octet-stream', type };
}
export function messageAttachments(content: string, descriptors: AttachmentDescriptor[] = []) {
  const tags = Array.from(content.matchAll(/<(image|file|video)\s+src="([^"]+)">/gi), match => attachmentFor(match[2], descriptors, match[1]));
  return [...tags, ...descriptors.filter(file => !tags.some(item => item.url === file.url))];
}
