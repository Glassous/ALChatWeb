import { useMemo, useState, useRef, useEffect } from 'react';
import XarrowRaw, { useXarrow as useXarrowRaw, Xwrapper as XwrapperRaw } from 'react-xarrows';

// Fix for potential ESM/CJS interop issues in some environments
const Xarrow = (XarrowRaw as any).default || XarrowRaw;
const Xwrapper = (XwrapperRaw as any).default || XwrapperRaw;
const useXarrow = (useXarrowRaw as any).default || useXarrowRaw;
import { type Message } from './ChatArea';
import './TreeView.css';

interface TreeViewProps {
  allMessages: Message[];
  activePath: Message[];
  currentNodeId: string | null;
  onSelectNode: (messageId: string) => void;
  onClose: () => void;
}

interface TreeNode {
  id: string;
  message: Message;
  children: TreeNode[];
}

export function TreeView({ allMessages, activePath, currentNodeId, onSelectNode, onClose }: TreeViewProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<TreeNode | null>(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);
  const updateXarrow = useXarrow();

  const forestRef = useRef<HTMLDivElement>(null);

  // Update arrows when tree changes or scroll happens
  useEffect(() => {
    const timer = setInterval(updateXarrow, 100);
    window.addEventListener('resize', updateXarrow);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', updateXarrow);
    };
  }, [updateXarrow]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 200); // Match animation duration
  };

  const forest = useMemo(() => {
    const nodesMap = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];

    // Create all nodes first
    allMessages.forEach(msg => {
      nodesMap.set(msg.id, {
        id: msg.id,
        message: msg,
        children: []
      });
    });

    // Link children to parents
    allMessages.forEach(msg => {
      const node = nodesMap.get(msg.id)!;
      if (msg.parent_id && nodesMap.has(msg.parent_id)) {
        const parent = nodesMap.get(msg.parent_id)!;
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    });

    // Sort children by created_at
    nodesMap.forEach(node => {
      node.children.sort((a, b) => 
        new Date(a.message.created_at).getTime() - new Date(b.message.created_at).getTime()
      );
    });

    return roots;
  }, [allMessages]);

  const isActive = (id: string) => activePath.some(m => m.id === id);
  const isCurrent = (id: string) => id === currentNodeId;

  const handleNodeMouseEnter = (e: React.MouseEvent, node: TreeNode) => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredNode(node);
    setHoverPosition({
      x: rect.left + rect.width / 2,
      y: rect.top
    });
  };

  const handleNodeMouseLeave = () => {
    hoverTimerRef.current = setTimeout(() => {
      setHoveredNode(null);
    }, 150); // Small delay to allow moving mouse to tooltip
  };

  const handleTooltipMouseEnter = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const handleTooltipMouseLeave = () => {
    setHoveredNode(null);
  };

  const renderNode = (node: TreeNode) => {
    const msg = node.message;
    
    // Improved content summary
    let content = msg.content;
    if (content.includes('<image')) {
      content = '[图片] ' + content.replace(/<image src="[^"]+">/g, '').trim();
    }
    if (content.length > 60) {
      content = content.substring(0, 60) + '...';
    }
    if (!content.trim() && msg.reasoning) {
      content = '正在思考...';
    } else if (!content.trim()) {
      content = '消息';
    }

    const roleClass = msg.role === 'user' ? 'user' : 'assistant';
    
    return (
      <div key={node.id} className="tree-node-container">
        <div 
          id={`node-${node.id}`}
          className={`tree-node ${roleClass} ${isActive(node.id) ? 'active' : ''} ${isCurrent(node.id) ? 'current' : ''}`}
          onClick={() => onSelectNode(node.id)}
          onMouseEnter={(e) => handleNodeMouseEnter(e, node)}
          onMouseLeave={handleNodeMouseLeave}
        >
          <div className="tree-node-content">{content || (msg.reasoning ? '正在思考...' : '消息')}</div>
        </div>
        {node.children.length > 0 && (
          <div className="tree-children">
            {node.children.map(child => renderNode(child))}
          </div>
        )}
      </div>
    );
  };

  const renderArrows = (nodes: TreeNode[]) => {
    const arrows: React.ReactNode[] = [];
    
    const traverse = (node: TreeNode) => {
      node.children.forEach(child => {
        arrows.push(
          <Xarrow
            key={`${node.id}-${child.id}`}
            start={`node-${node.id}`}
            end={`node-${child.id}`}
            strokeWidth={1.2}
            headSize={0}
            curveness={0.9}
            path="smooth"
            startAnchor="bottom"
            endAnchor="top"
            showHead={false}
            color="var(--border-color)"
          />
        );
        traverse(child);
      });
    };

    nodes.forEach(root => traverse(root));
    return arrows;
  };

  return (
    <div className={`tree-view-overlay ${isClosing ? 'closing' : ''}`} onClick={handleClose}>
      <div className="tree-view-content" onClick={e => e.stopPropagation()}>
        <div className="tree-view-header">
          <h3>对话总览</h3>
          <button className="close-tree-btn" onClick={handleClose}>
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
              <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
            </svg>
          </button>
        </div>
        <div className="tree-view-forest" onScroll={updateXarrow} ref={forestRef}>
          <Xwrapper>
            <div className="forest-container">
              {forest.map(root => renderNode(root))}
            </div>
            {renderArrows(forest)}
          </Xwrapper>
        </div>
      </div>
      
      {hoveredNode && (
        <div 
          className="tree-node-tooltip"
          style={{ 
            left: `${hoverPosition.x}px`,
            top: `${hoverPosition.y}px`
          }}
          onMouseEnter={handleTooltipMouseEnter}
          onMouseLeave={handleTooltipMouseLeave}
        >
          <div className="tooltip-role">{hoveredNode.message.role === 'user' ? '用户' : '助理'}</div>
          <div className="tooltip-content">{hoveredNode.message.content}</div>
          {hoveredNode.message.reasoning && (
            <div className="tooltip-reasoning">
              <div className="reasoning-label">思考过程:</div>
              {hoveredNode.message.reasoning}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
