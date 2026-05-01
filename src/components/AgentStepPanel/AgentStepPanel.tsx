import { useState } from 'react';
import type { AgentStepData, AgentPlanItemData } from '../../services/api';
import './AgentStepPanel.css';

interface AgentStepPanelProps {
  steps: AgentStepData[];
  plan?: AgentPlanItemData[];
  isStreaming?: boolean;
}

export function AgentStepPanel({ steps, plan, isStreaming = false }: AgentStepPanelProps) {
  const [expanded, setExpanded] = useState(true);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return '●';
      case 'running':
        return '◐';
      case 'failed':
        return '✕';
      default:
        return '○';
    }
  };

  const formatToolName = (name: string) => {
    switch (name) {
      case 'web_search':
        return '网页搜索';
      case 'weather':
        return '天气查询';
      case 'calculator':
        return '数学计算';
      case 'get_time':
        return '时间查询';
      default:
        return name;
    }
  };

  const formatInput = (input: string) => {
    try {
      const parsed = JSON.parse(input);
      if (parsed.query) return parsed.query;
      if (parsed.location) return parsed.location;
      if (parsed.expression) return parsed.expression;
      if (parsed.timezone) return parsed.timezone;
      return input;
    } catch {
      return input;
    }
  };

  const formatOutput = (output: string, toolName: string) => {
    try {
      const parsed = JSON.parse(output);
      if (toolName === 'weather' && parsed.temperature !== undefined) {
        return `${parsed.temperature}°C, ${parsed.condition}`;
      }
      if (toolName === 'calculator' && parsed.result !== undefined) {
        return `= ${parsed.result}`;
      }
      if (toolName === 'get_time' && parsed.datetime) {
        return parsed.datetime;
      }
      if (Array.isArray(parsed)) {
        return `${parsed.length} 条结果`;
      }
      return output.length > 100 ? output.substring(0, 100) + '...' : output;
    } catch {
      return output.length > 100 ? output.substring(0, 100) + '...' : output;
    }
  };

  const hasContent = (plan && plan.length > 0) || steps.length > 0;

  if (!hasContent) return null;

  return (
    <div className="agent-step-panel">
      <button 
        className="agent-step-header" 
        onClick={() => setExpanded(!expanded)}
      >
        <div className="agent-step-header-left">
          <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
            <path d="M240-400h320v-80H240v80Zm0-120h480v-80H240v80Zm0-120h480v-80H240v80ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v527l46-47Zm-46 0v-480 480Z"/>
          </svg>
          <span>执行计划</span>
          {isStreaming && <span className="agent-streaming-badge">执行中</span>}
        </div>
        <svg 
          className={`agent-expand-icon ${expanded ? 'expanded' : ''}`} 
          viewBox="0 0 24 24" 
          width="20" 
          height="20" 
          fill="currentColor"
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {expanded && (
        <div className="agent-step-content">
          {plan && plan.length > 0 && (
            <div className="agent-plan-list">
              {plan.map((item, index) => (
                <div 
                  key={item.id} 
                  className={`agent-plan-item ${item.status}`}
                >
                  <div className="agent-plan-connector">
                    <span className={`agent-plan-icon ${item.status}`}>
                      {getStatusIcon(item.status)}
                    </span>
                    {index < plan.length - 1 && (
                      <div className="agent-plan-line" />
                    )}
                  </div>
                  <div className="agent-plan-info">
                    <div className="agent-plan-desc">{item.description}</div>
                    <div className="agent-plan-tool">{formatToolName(item.tool_name)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {steps.length > 0 && (
            <div className="agent-steps-list">
              {steps.map((step, index) => (
                <div 
                  key={index} 
                  className={`agent-step-item ${step.err ? 'error' : 'success'}`}
                >
                  <div className="agent-step-connector">
                    <span className={`agent-step-icon ${step.err ? 'error' : 'success'}`}>
                      {step.err ? '✕' : '●'}
                    </span>
                    {index < steps.length - 1 && (
                      <div className="agent-step-line" />
                    )}
                  </div>
                  <div className="agent-step-info">
                    <div className="agent-step-name">
                      <span className="agent-step-tool">{formatToolName(step.tool_name)}</span>
                      <span className="agent-step-input">{formatInput(step.tool_input)}</span>
                    </div>
                    {step.tool_output && (
                      <div className="agent-step-output">
                        {formatOutput(step.tool_output, step.tool_name)}
                      </div>
                    )}
                    {step.err && (
                      <div className="agent-step-error">{step.err}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
