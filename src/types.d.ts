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
      'md-dialog': any;
      'md-outlined-text-field': any;
      'md-filled-button': any;
      'md-outlined-button': any;
      'md-text-button': any;
    }
  }
}

declare module '@fontsource-variable/playwrite-no' {
  const content: any;
  export default content;
}