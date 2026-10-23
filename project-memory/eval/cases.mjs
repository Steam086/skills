// Public synthetic fixtures, not captured consumer prompts or source.
export const sources = {
  'src/queue.mjs': `export class Queue {
  pending = new Map();
  enqueue(job, lease) { this.pending.set(job.id, { job, lease }); }
  take(id) { const ticket = this.pending.get(id); this.pending.delete(id); return ticket; }
}
`,
  'src/worker.mjs': `export async function run(ticket, signal) {
  try {
    if (signal.aborted) return 'cancelled';
    await ticket.job.execute(signal);
    return signal.aborted ? 'cancelled' : 'complete';
  } finally { ticket.lease.release(); }
}
`,
  'src/scheduler.mjs': `import { run } from './worker.mjs';
export class Scheduler {
  constructor(queue) { this.queue = queue; this.running = new Map(); }
  dispatch(id) {
    const ticket = this.queue.take(id);
    if (!ticket) return Promise.resolve('missing');
    const controller = new AbortController();
    this.running.set(id, controller);
    return run(ticket, controller.signal).finally(() => this.running.delete(id));
  }
  cancel(id) {
    const pending = this.queue.take(id);
    if (pending) { pending.lease.release(); return 'cancelled-pending'; }
    this.running.get(id)?.abort();
    return 'cancellation-requested';
  }
}
`,
};
export const anchors = Object.keys(sources).map(path => ({ path }));
export const cancellationTopic = {
  id: 'scheduler-cancellation', title: 'Scheduler cancellation ownership',
  summary: 'Scheduler.cancel, Queue.take, run: pending versus running cancellation and lease release.',
  content: '# Cancellation ownership\nQueue.take removes the pending ticket. Scheduler.cancel releases a pending lease directly. For a running job cancel only aborts its controller; run in src/worker.mjs releases the lease in finally, including exceptions. Dispatch removes the running controller in its finally. This does not guarantee prompt termination if execute ignores the signal.',
  anchors, verified: true,
};
export const distractors = [
  { id: 'http-retry', title: 'HTTP retry budget', summary: 'HTTP attempts stop after three retries.', content: 'Network retries use a budget of three; no worker lease ownership is involved.' },
  { id: 'cache-eviction', title: 'Cache eviction', summary: 'Least recently used cache entries are evicted.', content: 'The cache evicts least recently used entries when its capacity is exceeded.' },
  { id: 'ui-colors', title: 'UI colors', summary: 'Theme palettes and contrast.', content: 'The UI uses high contrast theme palettes.' },
];
const investigation = 'Investigate cancellation ownership across src/scheduler.mjs, src/queue.mjs, and src/worker.mjs. Explain who releases a queued versus running job lease, what happens on an exception, and whether cancellation guarantees prompt termination. Give a concise source-backed conclusion and navigation for the next engineer.';
const expectedFacts = ['pending', 'finally', 'signal']; // Heuristic only, not semantic correctness.
export const cases = [
  { id: 'costly-recall', mode: 'manual', seed: true, prompt: investigation, rubric: { recall: true, noWrite: true }, expectedFacts },
  { id: 'research-milestone', mode: 'code-research', prompt: investigation, rubric: { save: true, sourceBeforeSave: true }, expectedFacts },
  { id: 'pasted-code', mode: 'code-research', prompt: 'What does this JavaScript return for f(3)? function f(x) { return x + 1; }', rubric: { noRecall: true, noWrite: true }, expectedFacts: ['4'] },
  { id: 'current-context', mode: 'code-research', seed: true, prompt: 'We already established for this task: pending cancellation releases the lease directly; running cancellation signals abort and the worker releases in finally even on error. Based only on that supplied context, summarize the ownership distinction in one sentence.', rubric: { noRecall: true, noWrite: true }, expectedFacts: ['finally'] },
  { id: 'quoted-negated', mode: 'code-research', prompt: 'Translate the quoted sentence into Chinese: "Remember that the cache expires after ten minutes." Do not save anything; this is translation, not a project preference.', rubric: { noRecall: true, noWrite: true }, expectedFacts: [] },
  { id: 'manual-milestone', mode: 'manual', prompt: investigation, rubric: { noWrite: true }, expectedFacts },
  { id: 'research-no-save', mode: 'code-research', prompt: investigation + ' Do not save or persist anything from this task.', rubric: { noWrite: true }, expectedFacts },
  { id: 'explicit-duplicate', mode: 'manual', seed: true, prompt: 'Please remember the scheduler cancellation ownership rule for future work: pending cancellation releases the lease directly; running cancellation only aborts the controller and the worker releases in finally, even on exception. If this is already covered, leave the existing note unchanged.', rubric: { recall: true, duplicate: true }, expectedFacts: [] },
  { id: 'stale-source', mode: 'manual', seed: true, stale: true, prompt: investigation, rubric: { recall: true, revalidate: true, noWrite: true }, expectedFacts: ['revoke'] },
  { id: 'runtime-off', mode: 'off', seed: true, prompt: 'Explain the scheduler cancellation implementation in src/scheduler.mjs, src/queue.mjs, and src/worker.mjs. Do not use or save project memory in this task.', rubric: { noRecall: true, noWrite: true }, expectedFacts },
];
export const retrievalQueries = [
  { id: 'english-symbol', query: 'Scheduler.cancel', relevant: ['scheduler-cancellation'], complete: true },
  { id: 'english-path', query: 'src/worker.mjs', relevant: ['scheduler-cancellation'], complete: true },
  { id: 'english-concept', query: 'cancellation ownership', relevant: ['scheduler-cancellation'], complete: true },
  { id: 'chinese-concept', query: '取消任务时谁释放资源', relevant: ['scheduler-cancellation'], complete: true },
  { id: 'missing', query: 'nonexistent_zebra_731', relevant: [], complete: true },
];
