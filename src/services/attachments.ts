export interface AttachmentDescriptor {
  url: string;
  filename: string;
  mime_type: string;
  size?: number;
  type: 'image' | 'video' | 'document' | 'file';
}

export const documentFile = (name: string) => /\.(pdf|docx|xlsx)$/i.test(name);
const textExtensions = new Set('txt md markdown csv tsv log json jsonl ndjson yaml yml xml ini cfg conf toml html htm css js mjs cjs ts tsx jsx py sh bat ps1 sql r java kt kts c h cpp hpp rs go tex'.split(' '));
export function isTextAttachment(file: AttachmentDescriptor) {
  const mime = file.mime_type.toLowerCase().split(';')[0].trim();
  return file.type === 'file' && (mime.startsWith('text/') || ['application/json', 'application/xml', 'application/javascript', 'application/x-javascript', 'application/yaml', 'application/x-yaml', 'application/x-ndjson', 'application/toml'].includes(mime) || textExtensions.has(file.filename.split('.').pop()?.toLowerCase() || ''));
}

export async function readTextAttachment(file: AttachmentDescriptor, signal: AbortSignal): Promise<string> {
  const limit = 10 * 1024 * 1024;
  const response = await fetch(file.url, { signal });
  if (!response.ok) throw new Error('无法加载原文，请重试或下载文件');
  if (Number(response.headers.get('content-length')) > limit) throw new Error('文件过大，请下载后查看原文');
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) { await reader.cancel(); throw new Error('文件过大，请下载后查看原文'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  } else {
    const value = new Uint8Array(await response.arrayBuffer());
    if (value.length > limit) throw new Error('文件过大，请下载后查看原文');
    chunks.push(value); size = value.length;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const charset = response.headers.get('content-type')?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || 'utf-8';
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : charset;
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('Binary content');
    return text;
  } catch { throw new Error('无法按文本编码读取此文件，请下载原文件查看'); }
}
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
