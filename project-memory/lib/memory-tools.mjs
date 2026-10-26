const object = properties => ({ type: 'object', properties, additionalProperties: false });
const string = (maxLength, extra = {}) => ({ type: 'string', maxLength, ...extra });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });

export const MEMORY_TOOLS = Object.freeze({
  memory_status: {
    title: 'Memory Status',
    description: 'Report effective memory mode, access flags, diagnostics and maintenance health. Does not start or repair QMD.',
    inputSchema: object({}),
  },
  memory_read: {
    title: 'Memory Read',
    description: 'Read one topic, selected section or bounded range; inspect source provenance or a legacy memory target.',
    inputSchema: object({
      id: string(80), section: string(160), view: { type: 'string', enum: ['sources'] },
      target: { type: 'string', enum: ['topics', 'long_term', 'scratchpad', 'daily', 'list'] },
      date: string(10), cursor: string(80), searchId: string(64), offset: integer(0, 10000000), limit: integer(1, 24000),
    }),
  },
  memory_search: {
    title: 'Memory Search',
    description: 'Search project memory using keyword, semantic or deep retrieval. Returns bounded navigation and freshness metadata.',
    inputSchema: { ...object({ query: string(512, { minLength: 1 }), mode: { type: 'string', enum: ['keyword', 'semantic', 'deep'] }, limit: integer(1, 50) }), required: ['query'] },
  },
  memory_upsert: {
    title: 'Memory Upsert',
    description: 'Create or revise one stable-ID topic. Analysis writes require code-research mode, verified source inspection and source anchors.',
    inputSchema: { ...object({
      id: string(80, { pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }), title: string(160), summary: string(400),
      content: string(24000), tags: { type: 'array', maxItems: 12, items: string(48) },
      anchors: { type: 'array', maxItems: 32, items: { ...object({ path: string(512), symbol: string(160) }), required: ['path'] } },
      verified: { type: 'boolean' }, expectedRevision: integer(1, Number.MAX_SAFE_INTEGER),
      reason: { type: 'string', enum: ['explicit', 'analysis'] },
    }), required: ['id', 'title', 'summary', 'content', 'reason'] },
  },
  memory_write: {
    title: 'Legacy Memory Write',
    description: 'Write a legacy note only for an explicit user request. Overwrite requires explicit whole-file replacement approval.',
    inputSchema: { ...object({ target: { type: 'string', enum: ['long_term', 'daily'] }, content: string(24000), mode: { type: 'string', enum: ['append', 'overwrite'] } }), required: ['target', 'content'] },
  },
  scratchpad: {
    title: 'Scratchpad',
    description: 'Read or explicitly edit the legacy project checklist.',
    inputSchema: object({ action: { type: 'string', enum: ['add', 'done', 'undo', 'clear_done', 'list'] }, text: string(2000), offset: integer(0, 10000000), limit: integer(1, 24000) }),
  },
  memory_forget: {
    title: 'Memory Forget',
    description: 'Delete a topic by ID and expected revision, or remove matching legacy content; retain the recovery ID.',
    inputSchema: object({ id: string(80), expectedRevision: integer(1, Number.MAX_SAFE_INTEGER), match: string(512), target: { type: 'string', enum: ['long_term', 'daily'] }, date: string(10) }),
  },
  memory_restore: {
    title: 'Memory Restore',
    description: 'Restore a topic or legacy recovery record returned by memory_forget.',
    inputSchema: { ...object({ recoveryId: string(117) }), required: ['recoveryId'] },
  },
});
