import type { CSSProperties, DetailedHTMLProps, HTMLAttributes } from 'react';

type MaterialElementProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  value?: string | number;
  label?: string;
  type?: string;
  rows?: number;
  open?: boolean;
  disabled?: boolean;
  indeterminate?: boolean;
  interactive?: boolean;
  autofocus?: boolean;
  selected?: boolean;
  checked?: boolean;
  slot?: string;
  style?: CSSProperties & Record<`--${string}`, string | number>;
  [attribute: string]: unknown;
};

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'md-icon-button': MaterialElementProps;
      'md-icon': MaterialElementProps;
      'md-fab': MaterialElementProps;
      'md-list': MaterialElementProps;
      'md-list-item': MaterialElementProps;
      'md-divider': MaterialElementProps;
      'md-outlined-text-field': MaterialElementProps;
      'md-filled-button': MaterialElementProps;
      'md-outlined-button': MaterialElementProps;
      'md-text-button': MaterialElementProps;
      'md-circular-progress': MaterialElementProps;
    }
  }
}
