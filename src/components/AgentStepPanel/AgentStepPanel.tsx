import { useState, useEffect, useRef, type ReactNode } from 'react';
import type { AgentPlanItemData, AgentStepData } from '../../services/api';
import type { SearchData } from '../SearchSidebar/SearchSidebar';
import './AgentStepPanel.css';

type AgentStep = AgentStepData;
type AgentPlanItem = AgentPlanItemData;

const ExpandIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="6 9 12 15 18 9"></polyline>
  </svg>
);

const SearchIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 -960 960 960" fill="currentColor">
    <path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z"/>
  </svg>
);

const LocationIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 -960 960 960" fill="currentColor">
    <path d="M480-480q33 0 56.5-23.5T560-560q0-33-23.5-56.5T480-640q-33 0-56.5 23.5T400-560q0 33 23.5 56.5T480-480Zm0 366q105-96 158-172.5T680-540q0-87-55.5-151T480-754q-89 0-144.5 64T240-540q0 77 53 153.5T480-114Zm0-114q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Z"/>
  </svg>
);

const LoadingIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="spinning">
    <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
  </svg>
);

interface AgentStepPanelProps {
  steps: AgentStep[];
  plan?: AgentPlanItem[];
  isStreaming?: boolean;
  onShowSearch?: (data: SearchData) => void;
}

function getToolDisplayName(toolName: string): string {
  const nameMap: Record<string, string> = {
    'web_search': '网页搜索',
    'weather': '天气查询',
    'calculator': '计算器',
    'get_time': '时间查询',
  };
  return nameMap[toolName] || toolName;
}

const WebSearchIcon = () => (
  <svg width="14" height="14" viewBox="0 -960 960 960" fill="currentColor">
    <path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z"/>
  </svg>
);

const WeatherIcon = () => (
  <svg width="14" height="14" viewBox="0 -960 960 960" fill="currentColor">
    <path d="M260-160q-91 0-155.5-63T40-377q0-78 47-139t123-78q25-92 100-149t170-57q117 0 198.5 81.5T760-520q69 8 114.5 59.5T920-340q0 75-52.5 127.5T740-160H260Zm0-80h480q42 0 71-29t29-71q0-42-29-71t-71-29h-60v-80q0-83-58.5-141.5T480-720q-83 0-141.5 58.5T280-520h-20q-58 0-99 41t-41 99q0 58 41 99t99 41Zm220-240Z"/>
  </svg>
);

const CalculatorIcon = () => (
  <svg width="14" height="14" viewBox="0 -960 960 960" fill="currentColor">
    <path d="M320-240h60v-80h80v-60h-80v-80h-60v80h-80v60h80v80Zm200-30h200v-60H520v60Zm0-100h200v-60H520v60Zm44-152 56-56 56 56 42-42-56-58 56-56-42-42-56 56-56-56-42 42 56 56-56 58 42 42Zm-314-70h200v-60H250v60Zm-50 472q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z"/>
  </svg>
);

function getToolIconComponent(toolName: string) {
  const iconMap: Record<string, ReactNode> = {
    'web_search': <WebSearchIcon />,
    'weather': <WeatherIcon />,
    'calculator': <CalculatorIcon />,
  };
  return iconMap[toolName] || <WebSearchIcon />;
}

const hiddenTools = ['get_time'];

function parseToolInput(toolInput: string): Record<string, any> | null {
  if (!toolInput) return null;
  try {
    return JSON.parse(toolInput);
  } catch {
    return null;
  }
}

function getStepTitle(step: AgentStep): string {
  const input = parseToolInput(step.tool_input);
  if (!input) return getToolDisplayName(step.tool_name);
  
  if (step.tool_name === 'web_search' && input.query) {
    return input.query;
  }
  if (step.tool_name === 'weather' && input.location) {
    return input.location;
  }
  if (step.tool_name === 'calculator' && input.expression) {
    return input.expression;
  }
  return getToolDisplayName(step.tool_name);
}

interface SearchResultData {
  title: string;
  url: string;
  snippet: string;
}

function parseSearchResults(step: AgentStep): SearchResultData[] | null {
  if (step.tool_name !== 'web_search' || !step.tool_output) return null;
  try {
    const output = JSON.parse(step.tool_output);
    if (output.results && Array.isArray(output.results)) {
      return output.results;
    }
  } catch {}
  return null;
}

function parseWeatherData(step: AgentStep): Record<string, any> | null {
  if (step.tool_name !== 'weather' || !step.tool_output) return null;
  try {
    const output = JSON.parse(step.tool_output);
    if (output.weather_data) {
      return JSON.parse(output.weather_data);
    }
  } catch {}
  return null;
}

function WeatherInlineCard({ data }: { data: Record<string, any> }) {
  const current = data.current || {};
  const location = data.location || '未知';
  const condition = current.condition || '未知';
  const temp = current.temp ?? '--';
  const feelsLike = current.feels_like ?? '--';
  const humidity = current.humidity ?? '--';
  const windSpeed = current.wind_speed ?? '--';

  const conditionIcons: Record<string, string> = {
    '晴': '☀️', '多云': '⛅', '雾': '🌫️', '毛毛雨': '🌦️',
    '雨': '🌧️', '雪': '🌨️', '阵雨': '⛈️', '雷暴': '⛈️',
    'Partly cloudy': '⛅', 'Clear': '☀️', 'Overcast': '☁️',
    'Rain': '🌧️', 'Snow': '🌨️', 'Fog': '🌫️',
  };
  const icon = conditionIcons[condition] || '🌤️';

  const forecast = data.forecast || [];
  
  return (
    <div className="weather-inline-card">
      <div className="weather-inline-header">
        <span className="weather-inline-icon">{icon}</span>
        <div className="weather-inline-info">
          <span className="weather-inline-location">
            <LocationIcon size={12} /> {location}
          </span>
          <span className="weather-inline-condition">{condition}</span>
        </div>
        <span className="weather-inline-temp">{temp}°C</span>
      </div>
      <div className="weather-inline-details">
        <span>体感 {feelsLike}°C</span>
        <span>湿度 {humidity}%</span>
        <span>风速 {windSpeed} km/h</span>
      </div>
      {forecast.length > 0 && (
        <div className="weather-inline-forecast">
          {forecast.slice(0, 3).map((day: any, i: number) => (
            <div key={i} className="weather-inline-forecast-day">
              <span className="forecast-date">{day.date?.slice(5) || '--'}</span>
              <span className="forecast-icon">{conditionIcons[day.condition] || '🌤️'}</span>
              <span className="forecast-temp">{day.low}°/{day.high}°</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchInlineResults({ results, onViewAll }: { results: SearchResultData[]; onViewAll: () => void }) {
  return (
    <div className="search-inline-results">
      {results.slice(0, 2).map((r, i) => (
        <div key={i} className="search-inline-item">
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="search-inline-title">
            {r.title}
          </a>
          <p className="search-inline-snippet">{r.snippet?.slice(0, 80)}...</p>
        </div>
      ))}
      {results.length > 2 && (
        <button className="search-inline-more" onClick={onViewAll}>
          查看全部 {results.length} 条结果
        </button>
      )}
    </div>
  );
}

export function AgentStepPanel({ steps, plan, isStreaming, onShowSearch }: AgentStepPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasContent = (plan && plan.length > 0) || steps.filter(step => !hiddenTools.includes(step.tool_name)).length > 0;
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isStreaming) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [steps, isStreaming]);

  if (!hasContent) return null;

  const completedCount = plan ? plan.filter(item => item.status === 'completed').length : 0;
  const totalCount = plan ? plan.length : 0;
  const filteredSteps = steps.filter(step => !hiddenTools.includes(step.tool_name));

  const handleSearchClick = (step: AgentStep) => {
    const input = parseToolInput(step.tool_input);
    const results = parseSearchResults(step);
    if (input && onShowSearch) {
      const searchData: SearchData = {
        query: input.query || '',
        status: 'completed',
        results: results || [],
      };
      onShowSearch(searchData);
    }
  };

  return (
    <div className="agent-step-panel">
      <button 
        className="agent-panel-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="header-left">
          {isStreaming ? (
            <LoadingIcon />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 11l3 3L22 4"></path>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
            </svg>
          )}
          <span className="header-title">
            {isStreaming ? '执行中...' : '执行计划'}
          </span>
          {plan && plan.length > 0 && (
            <span className="step-count">{completedCount}/{totalCount}</span>
          )}
          {!plan && filteredSteps.length > 0 && (
            <span className="step-count">{filteredSteps.length} 步</span>
          )}
        </div>
        <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>
          <ExpandIcon />
        </span>
      </button>

      <div className={`agent-panel-body ${isExpanded ? 'expanded' : 'collapsed'}`}>
          {plan && plan.length > 0 && (
            <div className="plan-list">
              {plan.map((item) => (
                <div key={item.id} className={`plan-item ${item.status}`}>
                  <div className="plan-status">
                    {item.status === 'completed' ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M9 11l3 3L22 4"></path>
                      </svg>
                    ) : item.status === 'in_progress' ? (
                      <LoadingIcon />
                    ) : (
                      <span className="status-dot"></span>
                    )}
                  </div>
                  <div className="plan-content">
                    <span className="plan-description">{item.description}</span>
                    {item.tool_name && (
                      <span className="plan-tool"><span className="plan-tool-icon">{getToolIconComponent(item.tool_name)}</span> {getToolDisplayName(item.tool_name)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {filteredSteps.length > 0 && (
            <div className="step-list">
              {filteredSteps.map((step, index) => {
                const searchData = parseSearchResults(step);
                const weatherData = parseWeatherData(step);
                const title = getStepTitle(step);
                const isClickable = step.tool_name === 'web_search' && searchData;
                
                return (
                  <div key={index} className={`step-item ${step.err ? 'error' : ''}`}>
                    <div 
                      className={`step-header ${isClickable ? 'clickable' : ''}`}
                      onClick={isClickable ? () => handleSearchClick(step) : undefined}
                    >
                      <span className="step-icon">{getToolIconComponent(step.tool_name)}</span>
                      <span className="step-title">{title}</span>
                      {step.err && <span className="step-error-badge">错误</span>}
                      {isClickable && <span className="step-click-hint"><SearchIcon /></span>}
                    </div>
                    {step.err && (
                      <div className="step-error">{step.err}</div>
                    )}
                    {searchData && (
                      <SearchInlineResults 
                        results={searchData} 
                        onViewAll={() => handleSearchClick(step)} 
                      />
                    )}
                    {weatherData && (
                      <WeatherInlineCard data={weatherData} />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
    </div>
  );
}
