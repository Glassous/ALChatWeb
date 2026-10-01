import { useEffect } from 'react';
import { agentActive, agentApi, AgentApiError, type AgentRun, type AgentStep } from '../services/agentApi';

function delay(signal: AbortSignal, ms: number) {
  return new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

// Reconnect only the subscription. Execution and all decisions remain on the server.
export function useAgentRun(id: string | undefined, onRun: (run: AgentRun) => void, onDisconnect: () => void) {
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    const signal = controller.signal;
    let warned = false;
    const connect = async () => {
      let retries = 0;
      while (!signal.aborted) {
        try {
          let run = await agentApi.get(id, signal);
          if (signal.aborted) return;
          onRun(run);
          if (!agentActive(run.status)) return;
          await agentApi.events(id, run.seq, signal, event => {
            if (signal.aborted || event.run_id !== id) return;
            if (event.type !== 'snapshot' && event.seq <= run.seq) return;
            if (event.type === 'snapshot' || event.type === 'terminal') {
              run = event.data as AgentRun;
            } else if (event.type === 'step') {
              const step = event.data as AgentStep;
              const steps = [...run.steps];
              const index = steps.findIndex(item => item.id === step.id);
              if (index < 0) steps.push(step); else steps[index] = step;
              run = { ...run, steps, seq: event.seq };
            } else {
              run = { ...run, ...event.data, seq: event.seq } as AgentRun;
            }
            onRun(run);
          });
          if (!agentActive(run.status)) return;
        } catch (error) {
          if (signal.aborted) return;
          if (!warned) { onDisconnect(); warned = true; }
          if (error instanceof AgentApiError && (error.status === 401 || error.status === 404)) return;
        }
        retries++;
        await delay(signal, Math.min(1000 * retries, 10000));
      }
    };
    void connect();
    return () => controller.abort();
  }, [id, onRun, onDisconnect]);
}
