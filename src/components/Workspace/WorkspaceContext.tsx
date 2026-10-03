/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { readTextAttachment, type AttachmentDescriptor } from '../../services/attachments';

type Mode = 'code' | 'preview';
type Entry = { id: string; title: string; filename?: string; html: string; mode: Mode; loading: boolean; streaming?: boolean; autoPreview?: boolean; error?: string; file?: AttachmentDescriptor };
type OpenHtml = { id: string; title?: string; mode?: Mode; html?: string; file?: AttachmentDescriptor };
const Context = createContext<{
  entry: Entry | null; openRevision: number; openHtml: (input: OpenHtml) => void; closeWorkspace: () => void;
  changeMode: (mode: Mode) => void; retry: () => void; updateStream: (messageId: string, html: string, loading?: boolean, ordinal?: number) => void;
  finishStream: (messageId: string, realId?: string) => void;
} | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [openRevision, setOpenRevision] = useState(0);
  const current = useRef<Entry | null>(null), ticket = useRef(0), request = useRef<AbortController | null>(null);
  const closedStreams = useRef(new Set<string>());
  const commit = useCallback((value: Entry | null) => { current.current = value; setEntry(value); }, []);
  const closeWorkspace = useCallback(() => { if (current.current?.id.includes(':html:')) { closedStreams.current.add(current.current.id); closedStreams.current.add(current.current.id.replace(/:\d+$/, '')); } ticket.current++; request.current?.abort(); commit(null); }, [commit]);
  const openHtml = useCallback((input: OpenHtml) => {
    setOpenRevision(value => value + 1);
    request.current?.abort(); const generation = ++ticket.current;
    closedStreams.current.delete(input.id);
    closedStreams.current.delete(input.id.replace(/:\d+$/, ''));
    const html = input.html || '';
    const title = input.title || html.match(/<title>([\s\S]*?)<\/title>/i)?.[1].trim() || '网页 HTML 预览';
    const value: Entry = { id: input.id, title, filename: input.file?.filename, html, mode: input.mode || 'preview', loading: Boolean(input.file), file: input.file };
    commit(value);
    if (input.file) {
      const controller = new AbortController(); request.current = controller;
      const timer = setTimeout(() => controller.abort(), 30000);
      void readTextAttachment(input.file, controller.signal).then(source => {
        if (generation === ticket.current) commit({ ...current.current!, html: source, loading: false });
      }).catch(cause => {
        if (generation === ticket.current) commit({ ...current.current!, loading: false, error: controller.signal.aborted ? 'HTML 加载超时，请重试。' : cause instanceof Error ? cause.message : 'HTML 加载失败。' });
      }).finally(() => clearTimeout(timer));
    }
  }, [commit]);
  const changeMode = useCallback((mode: Mode) => { if (current.current) commit({ ...current.current, mode, autoPreview: false }); }, [commit]);
  const retry = useCallback(() => { const value = current.current; if (value?.file) openHtml({ ...value, file: value.file }); }, [openHtml]);
  const updateStream = useCallback((messageId: string, html: string, loading = true, ordinal = 0) => {
    const value = current.current, id = `${messageId}:html:${ordinal}`;
    if (closedStreams.current.has(id) || closedStreams.current.has(`${messageId}:html`)) return;
    // A different manually opened file/block owns the panel until it is closed.
    if (value && (value.id !== id || value.file)) return;
    if (!value && (!loading || window.innerWidth <= 768)) return;
    if (value?.html === html && value.streaming === loading) return;
    commit({ id, title: html.match(/<title>([\s\S]*?)<\/title>/i)?.[1].trim() || '网页 HTML 预览', html, mode: value?.mode || 'code', loading: false, streaming: loading, autoPreview: value ? value.autoPreview : true });
  }, [commit]);
  const finishStream = useCallback((messageId: string, realId?: string) => {
    const value = current.current;
    if (!value || value.file || !value.id.startsWith(`${messageId}:html:`)) return;
    const ordinal = value.id.slice(`${messageId}:html:`.length);
    commit({ ...value, id: `${realId || messageId}:html:${ordinal}`, mode: value.autoPreview ? 'preview' : value.mode, streaming: false });
  }, [commit]);
  useEffect(() => () => { ticket.current++; request.current?.abort(); }, []);
  const value = useMemo(() => ({ entry, openRevision, openHtml, closeWorkspace, changeMode, retry, updateStream, finishStream }), [entry, openRevision, openHtml, closeWorkspace, changeMode, retry, updateStream, finishStream]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error('WorkspaceProvider is missing');
  return value;
}
