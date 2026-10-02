import type { AgentStep } from './agentApi';

// Older saved replies may contain an unmarked transition before the report.
const narration = /^(?:I (?:now )?have (?:enough|sufficient) (?:data|information|material|evidence)\b|I (?:will|can now|am now ready to) (?:compile|prepare|write|draft) (?:a |the )?(?:research )?(?:report|summary|answer)\b|我(?:现在|已经)?(?:收集|获取|掌握)了?(?:足够|充分|充足)的?(?:资料|数据|信息))[^.!?。！？\n]*(?:[.!?。！？](?=\s|$)|(?=\n|$))\s*/i;

export function agentMessageDisplay(content: string, steps: AgentStep[], messageId: string) {
  const metadata = content.match(/^(\s*<search>[\s\S]*?<\/search>\s*)/)?.[1] || '';
  let answer = content.slice(metadata.length).trim();
  const progress: string[] = [];
  const final = /<final_answer>([\s\S]*?)(?:<\/final_answer>|$)/i.exec(answer);
  if (final) {
    progress.push((answer.slice(0, final.index) + '\n' + answer.slice(final.index + final[0].length))
      .replace(/<\/?(?:agent_process|think|analysis)>/gi, '').trim());
    answer = final[1].trim();
  } else {
    answer = answer.replace(/<(agent_process|think|analysis)>([\s\S]*?)<\/\1>/gi, (_match, _tag: string, text: string) => {
      progress.push(text.trim());
      return '';
    }).trim();
    const unfinished = /<(?:agent_process|think|analysis)>([\s\S]*)$/i.exec(answer);
    if (unfinished) {
      progress.push(unfinished[1].trim());
      answer = answer.slice(0, unfinished.index).trim();
    }
  }
  for (let match = narration.exec(answer); match; match = narration.exec(answer)) {
    progress.push(match[0].trim());
    answer = answer.slice(match[0].length).trim();
  }
  const process = progress.filter(Boolean).join('\n\n');
  const displaySteps = process && !steps.some(step => step.type === 'model' && step.summary?.includes(process))
    ? [...steps, { id: messageId + ':process', type: 'model' as const, title: '整理过程', status: 'completed' as const, summary: process }]
    : steps;
  return { content: metadata + answer, steps: displaySteps };
}
