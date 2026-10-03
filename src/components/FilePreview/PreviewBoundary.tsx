import { Component, type ReactNode } from 'react';

export class PreviewBoundary extends Component<{ children: ReactNode; resetKey: string; onRetry: () => void }, { error: boolean; resetKey: string }> {
  state = { error: false, resetKey: this.props.resetKey };
  static getDerivedStateFromError() { return { error: true }; }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { resetKey: string }) {
    return props.resetKey !== state.resetKey ? { error: false, resetKey: props.resetKey } : null;
  }
  render() {
    return this.state.error ? <div className="preview-loading" role="status"><p>预览组件加载或渲染失败，仍可下载原文件。</p><button type="button" onClick={this.props.onRetry}>重试</button></div> : this.props.children;
  }
}
