/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './LayerSystem.module.css';

type ToastTone = 'info' | 'success' | 'warning' | 'error';

interface ToastInput {
  message: string;
  tone?: ToastTone;
  duration?: number;
}

interface ToastItem extends Required<ToastInput> {
  id: number;
}

interface LayerContextValue {
  registerModal: () => () => void;
  showToast: (toast: ToastInput) => void;
}

const LayerContext = createContext<LayerContextValue | null>(null);

function getLayerRoot() {
  return document.getElementById('layer-root');
}

export function LayerProvider({ children }: { children: ReactNode }) {
  const activeModalsRef = useRef(0);
  const restoreRef = useRef<null | (() => void)>(null);
  const toastIdRef = useRef(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const releasePage = useCallback(() => {
    restoreRef.current?.();
    restoreRef.current = null;
  }, []);

  const lockPage = useCallback(() => {
    if (restoreRef.current) return;
    const appRoot = document.getElementById('root');
    const body = document.body;
    const scrollY = window.scrollY;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
      ariaHidden: appRoot?.getAttribute('aria-hidden') ?? null,
      inert: appRoot?.inert ?? false,
    };

    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    if (appRoot) {
      appRoot.inert = true;
      appRoot.setAttribute('aria-hidden', 'true');
    }

    restoreRef.current = () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      if (appRoot) {
        appRoot.inert = previous.inert;
        if (previous.ariaHidden === null) appRoot.removeAttribute('aria-hidden');
        else appRoot.setAttribute('aria-hidden', previous.ariaHidden);
      }
      window.scrollTo({ top: scrollY, behavior: 'instant' });
    };
  }, []);

  const registerModal = useCallback(() => {
    activeModalsRef.current += 1;
    lockPage();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeModalsRef.current = Math.max(0, activeModalsRef.current - 1);
      if (activeModalsRef.current === 0) releasePage();
    };
  }, [lockPage, releasePage]);

  const showToast = useCallback(({ message, tone = 'info', duration = 3200 }: ToastInput) => {
    const id = ++toastIdRef.current;
    setToasts((items) => [...items, { id, message, tone, duration }]);
    window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id));
    }, duration);
  }, []);

  useEffect(() => releasePage, [releasePage]);

  const value = useMemo(() => ({ registerModal, showToast }), [registerModal, showToast]);
  const layerRoot = getLayerRoot();

  return (
    <LayerContext.Provider value={value}>
      {children}
      {layerRoot && createPortal(
        <div className={styles.toastRegion} aria-live="polite" aria-atomic="false">
          {toasts.map((toast) => (
            <div key={toast.id} className={`${styles.toast} ${styles[toast.tone]}`} role="status">
              {toast.message}
            </div>
          ))}
        </div>,
        layerRoot,
      )}
    </LayerContext.Provider>
  );
}

export function useToast() {
  const context = useContext(LayerContext);
  if (!context) throw new Error('useToast must be used inside LayerProvider');
  return context.showToast;
}

export function useBlockingLayer(active: boolean) {
  const context = useContext(LayerContext);
  if (!context) throw new Error('useBlockingLayer must be used inside LayerProvider');
  useEffect(() => {
    if (!active) return;
    return context.registerModal();
  }, [active, context]);
}

interface FullscreenLayerProps {
  open: boolean;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  ariaLabel: string;
}

export function FullscreenLayer({ open, children, onClose, className = '', ariaLabel }: FullscreenLayerProps) {
  useBlockingLayer(open);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    containerRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [onClose, open]);

  const layerRoot = getLayerRoot();
  if (!open || !layerRoot) return null;
  return createPortal(
    <div ref={containerRef} className={`${styles.fullscreenLayer} ${className}`} role="dialog" aria-modal="true" aria-label={ariaLabel} tabIndex={-1}>
      {children}
    </div>,
    layerRoot,
  );
}

interface AnchoredPopoverProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  onClose: () => void;
  align?: 'start' | 'end';
  gap?: number;
}

export function AnchoredPopover({ open, anchorRef, children, onClose, align = 'start', gap = 12 }: AnchoredPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, visible: false });

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const popover = popoverRef.current;
    if (!anchor || !popover) return;
    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const preferredLeft = align === 'end' ? anchorRect.right - popoverRect.width : anchorRect.left;
    const left = Math.min(Math.max(8, preferredLeft), window.innerWidth - popoverRect.width - 8);
    const preferredTop = anchorRect.top - popoverRect.height - gap;
    const top = preferredTop >= 8
      ? preferredTop
      : Math.min(window.innerHeight - popoverRect.height - 8, anchorRect.bottom + gap);
    setPosition({ top, left, visible: true });
  }, [align, anchorRef, gap]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!anchorRef.current?.contains(target) && !popoverRef.current?.contains(target)) onClose();
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, onClose, open, updatePosition]);

  const layerRoot = getLayerRoot();
  if (!open || !layerRoot) return null;
  return createPortal(
    <div
      ref={popoverRef}
      className={styles.anchoredPopover}
      style={{ top: position.top, left: position.left, visibility: position.visible ? 'visible' : 'hidden' }}
    >
      {children}
    </div>,
    layerRoot,
  );
}

export type ModalSize = 'small' | 'medium' | 'large';
export type ModalDismissMode = 'standard' | 'locked';

export interface ModalCardProps {
  open: boolean;
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  size?: ModalSize;
  dismissMode?: ModalDismissMode;
  busy?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  ariaLabel?: string;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function ModalCard({
  open,
  title,
  children,
  actions,
  size = 'medium',
  dismissMode = 'standard',
  busy = false,
  initialFocusRef,
  onClose,
  className = '',
  ariaLabel,
}: ModalCardProps) {
  const context = useContext(LayerContext);
  if (!context) throw new Error('ModalCard must be used inside LayerProvider');
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      // Mounting here is intentional so the same instance can play its exit animation.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const unregister = context.registerModal();
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      const target = initialFocusRef?.current
        ?? cardRef.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, select, button:not([disabled])');
      target?.focus();
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
      unregister();
      previousFocusRef.current?.focus({ preventScroll: true });
    };
  }, [context, initialFocusRef, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissMode === 'standard' && !busy) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !cardRef.current) return;
      const focusable = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        cardRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [busy, dismissMode, mounted, onClose]);

  const layerRoot = getLayerRoot();
  if (!mounted || !layerRoot) return null;
  const canDismiss = dismissMode === 'standard' && !busy;

  return createPortal(
    <div className={`${styles.modalLayer} ${closing ? styles.closing : ''}`}>
      <button
        type="button"
        className={styles.backdrop}
        aria-label={canDismiss ? '关闭弹窗' : undefined}
        tabIndex={-1}
        onClick={canDismiss ? onClose : undefined}
      />
      <div
        ref={cardRef}
        className={`${styles.modalCard} ${styles[size]} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        {title && <div id={titleId} className={styles.title}>{title}</div>}
        <div className={styles.content}>{children}</div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </div>,
    layerRoot,
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确定',
  cancelLabel = '取消',
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <ModalCard
      open={open}
      title={title}
      size="small"
      dismissMode={danger || busy ? 'locked' : 'standard'}
      busy={busy}
      onClose={onClose}
      actions={(
        <>
          <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? styles.dangerButton : styles.primaryButton}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? '处理中…' : confirmLabel}
          </button>
        </>
      )}
    >
      <div className={styles.description}>{description}</div>
    </ModalCard>
  );
}

export const modalButtonStyles = {
  primary: styles.primaryButton,
  secondary: styles.secondaryButton,
  danger: styles.dangerButton,
};
