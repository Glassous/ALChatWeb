import * as React from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'md-icon-button': any;
      'md-icon': any;
      'md-fab': any;
      'md-list': any;
      'md-list-item': any;
      'md-divider': any;
    }
  }
}

