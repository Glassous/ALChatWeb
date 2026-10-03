export function codeLanguage(language = '') {
  const name = language.toLowerCase();
  return ({ js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', htm: 'markup', html: 'markup', svg: 'markup', xml: 'markup', yml: 'yaml', md: 'markdown', h: 'c', hpp: 'cpp', rs: 'rust', kt: 'kotlin', kts: 'kotlin', jsonl: 'json', ndjson: 'json', ps1: 'powershell', bat: 'batch', tex: 'latex' } as Record<string, string>)[name] || name || 'text';
}
