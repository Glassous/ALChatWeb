import { Prism, normalizeTokens } from 'prism-react-renderer';
import { codeLanguage } from './codeLanguage';
import { loadGrammar } from './codePrism';

globalThis.onmessage = async (event: MessageEvent<{ code: string; language: string }>) => {
  const { code, language } = event.data;
  try {
    await loadGrammar(codeLanguage(language));
    const grammar = Prism.languages[codeLanguage(language)];
    globalThis.postMessage({ tokens: normalizeTokens(grammar ? Prism.tokenize(code, grammar) : [code]) });
  } catch {
    globalThis.postMessage({ tokens: normalizeTokens([code]) });
  }
};
