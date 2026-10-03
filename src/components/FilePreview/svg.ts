import DOMPurify from 'dompurify';

const localUrlsOnly = (value: string) => value.replace(/url\s*\(([^)]*)\)/gi, (match, target: string) => /^#[\w:.-]+$/.test(target.trim().replace(/^['"]|['"]$/g, '')) ? match : 'none');

export function cleanSvg(source: string) {
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(source)) throw new Error('SVG 不支持 DTD 或实体声明');
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') throw new Error('SVG 内容无效');
  const cleaned = DOMPurify.sanitize(source, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['foreignObject', 'script'] });
  const svg = new DOMParser().parseFromString(cleaned, 'image/svg+xml');
  for (const node of svg.querySelectorAll('*')) {
    for (const attribute of [...node.attributes]) {
      const name = attribute.localName.toLowerCase(), value = attribute.value.trim();
      if (name.startsWith('on') || ((name === 'href' || name === 'src') && !value.startsWith('#')) || /\\|@import|expression\s*\(/i.test(value)) node.removeAttributeNode(attribute);
      else if (/url\s*\(/i.test(value)) node.setAttribute(attribute.name, localUrlsOnly(value));
    }
  }
  svg.querySelectorAll('style').forEach(node => { const value = node.textContent || ''; node.textContent = /\\/.test(value) ? '' : localUrlsOnly(value.replace(/@import[^;]*;?/gi, '')); });
  return new XMLSerializer().serializeToString(svg.documentElement);
}

export function downloadSvg(svg: string, filename: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
