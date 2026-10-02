import type { SVGProps } from 'react';

/** A shared film frame, sized to remain clear in menus and attachment cards. */
export function VideoIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M7 4v16M17 4v16M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4" />
    <path d="m10 8.75 4.5 3.25-4.5 3.25z" fill="currentColor" stroke="none" />
  </svg>;
}
