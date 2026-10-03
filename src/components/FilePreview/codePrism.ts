import { Prism } from 'prism-react-renderer';

// Extra Prism grammars use its global registry, also inside the tokenization worker.
Object.assign(globalThis, { Prism });
const loaders: Record<string, () => Promise<unknown>> = {
  bash: () => import('prismjs/components/prism-bash.js'),
  sql: () => import('prismjs/components/prism-sql.js'),
  powershell: () => import('prismjs/components/prism-powershell.js'),
  batch: () => import('prismjs/components/prism-batch.js'),
  r: () => import('prismjs/components/prism-r.js'),
  ini: () => import('prismjs/components/prism-ini.js'),
  toml: () => import('prismjs/components/prism-toml.js'),
  latex: () => import('prismjs/components/prism-latex.js'),
};
const pending = new Map<string, Promise<unknown>>();
export async function loadGrammar(language: string) {
  if (Prism.languages[language] || !loaders[language]) return;
  if (!pending.has(language)) pending.set(language, loaders[language]());
  await pending.get(language);
}
