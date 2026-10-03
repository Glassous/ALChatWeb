import type { RefObject } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

export function usePreviewReveal<T extends HTMLElement>(host: RefObject<T | null>, ready = true, identity: unknown = undefined) {
  useGSAP(() => {
    if (!ready || !host.current) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    gsap.fromTo(host.current, { opacity: 0 }, { opacity: 1, duration: reduced ? .07 : .18, ease: 'power1.out', clearProps: 'opacity' });
  }, { scope: host, dependencies: [ready, identity], revertOnUpdate: true });
}
