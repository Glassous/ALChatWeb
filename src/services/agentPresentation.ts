import type { AgentStep } from './agentApi';

// Older saved replies may contain an unmarked transition before the report.
const narration = /^(?:I (?:now )?have (?:enough|sufficient) (?:data|information|material|evidence)\b|I (?:will|can now|am now ready to) (?:compile|prepare|write|draft) (?:a |the )?(?:research )?(?:report|summary|answer)\b|我(?:现在|已经)?(?:收集|获取|掌握)了?(?:足够|充分|充足)的?(?:资料|数据|信息))[^.!?。！？\n]*(?:[.!?。！？](?=\s|$)|(?=\n|$))\s*/i;

const boundaryTags = ['final_answer', 'agent_process', 'think', 'analysis'].flatMap(tag => [`<${tag}>`, `</${tag}>`]);

function splitReply(text: string) {
  // Hold an unfinished boundary until the next SSE frame completes it.
  const suffix = /<[^>]*$/.exec(text);
  if (suffix && boundaryTags.some(tag => tag.startsWith(suffix[0].toLowerCase()))) text = text.slice(0, suffix.index);
  let answer = text.trim();
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
  return { answer, process: progress.filter(Boolean).join('\n\n'), hasFinal: Boolean(final) };
}

export function agentMessageDisplay(content: string, steps: AgentStep[], messageId: string, options: {
  active?: boolean;
  previousAnswer?: string;
  previousStepId?: string;
} = {}) {
  const metadata = content.match(/^(\s*<search>[\s\S]*?<\/search>\s*)/)?.[1] || '';
  const reply = splitReply(content.slice(metadata.length));
  let answer = reply.answer;
  let finalStepId = options.previousStepId;
  const latestModel = steps.findLast(step => step.type === 'model');
  if (options.active) {
    const streamed = splitReply(latestModel?.summary || '');
    const isFinal = streamed.hasFinal || (latestModel?.phase === 'summarizing' && latestModel.status === 'running');
    if (isFinal) {
      answer = streamed.answer || options.previousAnswer || answer;
      finalStepId = latestModel?.id;
    } else {
      // A completed step may contain only progress until the terminal snapshot arrives.
      const completedAnswer = latestModel?.id === finalStepId && options.previousAnswer && streamed.answer.startsWith(options.previousAnswer)
        ? streamed.answer : '';
      answer = answer || completedAnswer || options.previousAnswer || '';
    }
  }

  const displaySteps = steps.map(step => {
    if (step.type !== 'model' || !step.summary) return step;
    const parsed = splitReply(step.summary);
    const duplicatesAnswer = Boolean(parsed.answer) && (answer.startsWith(parsed.answer)
      || (step.id === finalStepId && options.previousAnswer === parsed.answer));
    const isFinalStep = step.id === finalStepId || (!options.active && step.id === latestModel?.id);
    const streamingFinal = options.active && step.id === finalStepId && step.phase === 'summarizing' && step.status === 'running';
    const summary = parsed.hasFinal || streamingFinal || (isFinalStep && duplicatesAnswer) ? parsed.process : step.summary;
    return summary === step.summary ? step : { ...step, summary };
  });
  if (reply.process && !displaySteps.some(step => step.type === 'model' && step.summary?.includes(reply.process))) {
    displaySteps.push({ id: messageId + ':process', type: 'model', title: '整理过程', status: 'completed', summary: reply.process });
  }
  return { content: metadata + answer, answer, finalStepId, steps: displaySteps };
}
