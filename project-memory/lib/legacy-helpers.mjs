const pad = value => String(value).padStart(2, '0');

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayStr() { return localDate(); }
export function nowTimestamp() {
  const date = new Date();
  return `${localDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
export function shortSessionId(sessionId) { return sessionId.slice(0, 8); }

export function isValidDailyDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function scratchpadAdd(content, text, meta) {
  if (!content.trim()) return `# Scratchpad\n\n${meta}\n- [ ] ${text}\n`;
  return `${content.replace(/\n+$/, '')}\n${meta}\n- [ ] ${text}\n`;
}

export function scratchpadToggle(content, needle, done) {
  const lines = content.split('\n');
  const lower = needle.toLowerCase();
  for (let index = 0; index < lines.length; index++) {
    const match = /^- \[([ xX])\] (.+)$/.exec(lines[index]);
    if (!match || (match[1].toLowerCase() === 'x') === done || !match[2].toLowerCase().includes(lower)) continue;
    lines[index] = `- [${done ? 'x' : ' '}] ${match[2]}`;
    return { content: lines.join('\n'), matched: true };
  }
  return { content, matched: false };
}

export function scratchpadClearDone(content) {
  const lines = content.split('\n'), output = [];
  let removed = 0;
  for (const line of lines) {
    const match = /^- \[([ xX])\] (.+)$/.exec(line);
    if (match?.[1].toLowerCase() === 'x') {
      removed++;
      if (output.length && /^<!-- \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[[^\]\r\n]+\] -->$/.test(output.at(-1))) output.pop();
    } else output.push(line);
  }
  return { content: output.join('\n'), removed };
}

export function forgetBlocks(content, match) {
  const needle = match.trim().toLowerCase();
  if (!needle) return { content, removed: [] };
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const normalized = content.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const blocks = [];
  let lines = [], stamped = false;
  const flush = () => {
    const current = lines.join('\n').trim();
    if (!current) return;
    blocks.push(...(stamped ? [current] : current.split(/\n{2,}/).map(value => value.trim()).filter(Boolean)));
  };
  const entry = /^<!-- (?:(?:last updated: )?\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}|HANDOFF \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[[^\]\r\n]+\] -->$/;
  for (const line of normalized.split('\n')) {
    if (entry.test(line)) { flush(); lines = [line]; stamped = true; }
    else lines.push(line);
  }
  flush();
  const removed = blocks.filter(block => block.toLowerCase().includes(needle));
  if (!removed.length) return { content, removed };
  const kept = blocks.filter(block => !block.toLowerCase().includes(needle)).join('\n\n').trim();
  return { content: kept ? `${kept}\n`.replace(/\n/g, newline) : '', removed: removed.map(block => block.replace(/\n/g, newline)) };
}
