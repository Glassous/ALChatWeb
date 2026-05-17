import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/list/list.js';
import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import alingApi, { type ALingTask } from '../../services/alingApi';
import './ALingDemoHome.css';

const STATUS_LABELS: Record<string, string> = {
  pending: '等待中',
  outline_generating: '生成大纲中...',
  outline_ready: '大纲就绪',
  generating: '生成演示中...',
  completed: '已完成',
  failed: '失败',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--text-muted)',
  outline_generating: '#ffa726',
  outline_ready: '#42a5f5',
  generating: '#ffa726',
  completed: '#66bb6a',
  failed: '#ef5350',
};

export function ALingDemoHome() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<ALingTask[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTasks = () => {
    setLoading(true);
    alingApi.listDemTasks()
      .then(res => setTasks(res.tasks))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' +
           d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="aling-demo-page">
      <header className="aling-topbar">
        <div className="aling-topbar-left">
          <md-icon-button onClick={() => navigate('/aling')}>
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
              <path d="m313-440 224 224-57 57-320-320 320-320 57 57-224 224h487v80H313Z"/>
            </svg>
          </md-icon-button>
          <h1 className="aling-topbar-title">ALing 演示</h1>
        </div>
        <md-filled-button onClick={() => navigate('/aling/demo/new')}>创作演示</md-filled-button>
      </header>

      <main className="aling-demo-main">
        {loading ? (
          <div className="aling-empty">加载中...</div>
        ) : tasks.length === 0 ? (
          <div className="aling-empty">
            <svg xmlns="http://www.w3.org/2000/svg" height="48px" viewBox="0 -960 960 960" width="48px" fill="var(--text-muted)">
              <path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q75 0 143.5 26T750-778l-58 58q-44-32-97.5-50T480-788q-122 0-207 85t-85 207q0 122 85 207t207 85q122 0 207-85t85-207q0-29-5-56.5T750-604l60-60q17 43 25 88.5t8 95.5q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/>
            </svg>
            <p>暂无演示记录</p>
            <p className="aling-empty-hint">点击"创作演示"开始创建</p>
          </div>
        ) : (
          <md-list className="aling-task-list">
            {tasks.map(task => (
              <div
                key={task.id}
                className="aling-task-item"
                onClick={() => {
                  if (task.status === 'completed') {
                    navigate(`/aling/demo/${task.id}`);
                  } else if (task.status === 'outline_ready') {
                    navigate(`/aling/demo/new?taskId=${task.id}`);
                  }
                }}
              >
                <div className="aling-task-main">
                  <div className="aling-task-title">{task.title || task.topic || '未命名'}</div>
                  <div className="aling-task-meta">
                    <span className="aling-task-status" style={{ color: STATUS_COLORS[task.status] }}>
                      {STATUS_LABELS[task.status] || task.status}
                    </span>
                    <span className="aling-task-time">{formatTime(task.created_at)}</span>
                    {task.slide_count > 0 && (
                      <span className="aling-task-pages">{task.slide_count} 页</span>
                    )}
                  </div>
                </div>
                <div className="aling-task-actions" onClick={e => e.stopPropagation()}>
                  <button
                    className="aling-task-delete"
                    onClick={async () => {
                      if (confirm('确定删除此演示？')) {
                        await alingApi.deleteDemoTask(task.id);
                        loadTasks();
                      }
                    }}
                    title="删除"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="var(--text-muted)">
                      <path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/>
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </md-list>
        )}
      </main>
    </div>
  );
}
