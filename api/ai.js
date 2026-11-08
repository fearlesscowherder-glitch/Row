// POST /api/ai { task: 'tag', item }   -> { title, kind, summary, tags, colors }
// POST /api/ai { task: 'polish', text } -> { text }
import { send, requireAuth, readBody } from './_lib.js';
import { askJson } from './_ai.js';

const TAG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'kind', 'summary', 'tags', 'colors'],
  properties: {
    title: { type: 'string', description: 'A clean, short title (keep the original if it is already good).' },
    kind: { type: 'string', enum: ['article', 'video', 'product', 'recipe', 'quote', 'idea', 'note', 'person', 'place', 'image', 'book', 'music', 'design', 'school', 'other'] },
    summary: { type: 'string', description: 'One sentence, under 160 characters.' },
    tags: { type: 'array', items: { type: 'string' }, description: '3 to 6 lowercase tags a person would search for.' },
    colors: { type: 'array', items: { type: 'string' }, description: 'For images only: up to 3 dominant colors as simple names (red, orange, yellow, green, blue, purple, pink, brown, black, white, gray). Empty otherwise.' },
  },
};

const POLISH_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['text'],
  properties: { text: { type: 'string' } },
};

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
  const body = await readBody(req);
  try {
    if (body.task === 'polish') {
      const text = String(body.text || '').slice(0, 500);
      const out = await askJson({
        system: 'You rewrite a to-do item so it is concrete and action-oriented, under 60 characters. Keep the meaning.',
        content: 'To-do: ' + text,
        schema: POLISH_SCHEMA,
        maxTokens: 2000,
      });
      return send(res, 200, out);
    }

    if (body.task === 'tag') {
      const item = body.item || {};
      const parts = [];
      const m = typeof item.image === 'string' && item.image.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
      if (m) parts.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
      parts.push({
        type: 'text',
        text: [
          'Saved item type: ' + (item.type || 'unknown'),
          item.title ? 'Title: ' + item.title : '',
          item.url ? 'URL: ' + item.url : '',
          item.siteName ? 'Site: ' + item.siteName : '',
          item.description ? 'Page description: ' + String(item.description).slice(0, 800) : '',
          item.text ? 'Content:\n' + String(item.text).slice(0, 4000) : '',
        ].filter(Boolean).join('\n'),
      });
      const out = await askJson({
        system: 'You organize a personal library of saved things (links, notes, images, quotes). Describe and tag the saved item so it is easy to find later by searching.',
        content: parts,
        schema: TAG_SCHEMA,
        maxTokens: 4000,
      });
      out.tags = (out.tags || []).map(t => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 6);
      return send(res, 200, out);
    }

    send(res, 400, { error: 'unknown task' });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
}
