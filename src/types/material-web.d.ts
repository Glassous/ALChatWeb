import * as React from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'md-dialog': any;
      'md-filled-button': any;
      'md-text-button': any;
      'md-switch': any;
      'md-icon-button': any;
      'md-outlined-text-field': any;
      'md-circular-progress': any;
      'md-list': any;
      'md-list-item': any;
      'md-tabs': any;
      'md-primary-tab': any;
      'md-outlined-select': any;
      'md-select-option': any;
    }
  }
}
