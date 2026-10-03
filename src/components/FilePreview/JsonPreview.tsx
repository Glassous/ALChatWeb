import { useMemo, useState } from 'react';
import { parseTree, printParseErrorCode, type Node, type ParseError } from 'jsonc-parser';
import './renderers.css';

function JsonNode({ node, text, label, depth = 0 }: { node: Node; text: string; label?: string; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [visible, setVisible] = useState(200);
  const branch = node.type === 'object' || node.type === 'array';
  const children = node.children || [];
  return <div className="json-node">
    <div className="json-row">{branch && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '▾' : '▸'}</button>}
      {label !== undefined && <span className="json-key">{label}: </span>}
      {branch ? <span>{node.type === 'array' ? '数组' : '对象'} · {children.length} 项</span>
        : <><span className={`json-${node.type}`}>{text.slice(node.offset, node.offset + node.length)}</span><small className="json-type">{node.type}</small></>}
    </div>
    {branch && expanded && <div className="json-children">{children.slice(0, visible).map((child, index) => {
      const value = child.type === 'property' ? child.children?.[1] : child;
      return value && <JsonNode key={child.offset} node={value} text={text} depth={depth + 1} label={child.type === 'property' ? String(child.children?.[0].value) : String(index)} />;
    })}{visible < children.length && <button type="button" onClick={() => setVisible(value => value + 200)}>显示更多（剩余 {children.length - visible} 项）</button>}</div>}
  </div>;
}

export default function JsonPreview({ text }: { text: string }) {
  const { root, errors } = useMemo(() => {
    const errors: ParseError[] = [];
    return { root: parseTree(text, errors, { disallowComments: true, allowTrailingComma: false }), errors };
  }, [text]);
  if (errors.length || !root) {
    const error = errors[0], before = text.slice(0, error?.offset || 0).split('\n');
    return <p role="status">JSON 预览失败：第 {before.length} 行，第 {(before.at(-1)?.length || 0) + 1} 列（{error ? printParseErrorCode(error.error) : '文件为空'}）</p>;
  }
  return <div className="json-tree" tabIndex={0}><JsonNode key={text} node={root} text={text} /></div>;
}
