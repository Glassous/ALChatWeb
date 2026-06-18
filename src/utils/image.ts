export function getThumbnailUrl(url: string | undefined): string {
  if (!url) return '';
  if (url.includes('alchatfiles.fiacloud.top') || url.includes('myqcloud.com')) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}imageMogr2/thumbnail/300x`;
  }
  return url;
}
