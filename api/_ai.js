// One helper for every AI call this app makes: a single request that must
// come back as JSON matching `schema`.
//
// Two providers:
//   • OpenAI-compatible gateway (e.g. OmniRoute running on your PC) when
//     AI_BASE_URL is set. Uses AI_API_KEY and AI_MODEL.
//   • Claude API otherwise, using ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk';

export const CLAUDE_MODEL = 'claude-opus-5-5';

export function aiProvider() {
  if (process.env.AI_BASE_URL) return 'gateway';
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  return null;
}

export async function askJson(opts) {
  const p = aiProvider();
  if (p === 'gateway') return askGateway(opts);
  if (p === 'claude') return askClaude(opts);
  throw new Error('No AI configured: set AI_BASE_URL (+ AI_API_KEY, AI_MODEL) for OmniRoute, or ANTHROPIC_API_KEY.');
}

// ---------- Claude API ----------
let client = null;
async function askClaude({ system, content, schema, maxTokens = 8000, effort = 'low' }) {
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const response = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    // If a safety classifier declines, the API retries on a recommended
    // fallback model instead of returning a refusal.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort, format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude declined this request.');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude response was cut off (max_tokens).');
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text);
}

// ---------- OpenAI-compatible gateway (OmniRoute etc.) ----------
// Content arrives in the Claude block format used by the callers; convert it.
function toOpenAiContent(content) {
  if (typeof content === 'string') return content;
  return content.map(b => {
    if (b.type === 'image' && b.source && b.source.type === 'base64') {
      return { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } };
    }
    return { type: 'text', text: b.text || '' };
  });
}

// Pull the first JSON object out of a reply, tolerating ```json fences or
// a sentence before/after it (models behind a router vary).
export function extractJson(text) {
  const s = String(text || '').trim();
  try { return JSON.parse(s); } catch {}
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  throw new Error('AI reply was not valid JSON: ' + s.slice(0, 200));
}

function checkShape(obj, schema) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('AI reply was not a JSON object.');
  for (const k of schema.required || []) {
    if (!(k in obj)) throw new Error('AI reply is missing "' + k + '".');
  }
  return obj;
}

async function postChat(body) {
  const base = process.env.AI_BASE_URL.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.AI_API_KEY) headers.Authorization = 'Bearer ' + process.env.AI_API_KEY;
  let r;
  try {
    r = await fetch(base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS) || 55000) });
  } catch (e) {
    throw new Error('Could not reach the AI gateway at ' + base + ' (is OmniRoute running?): ' + (e.cause?.code || e.message));
  }
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { ok: r.ok, status: r.status, data, text };
}

async function askGateway({ system, content, schema, maxTokens = 8000 }) {
  const model = process.env.AI_MODEL || 'auto';
  const sys = system + '\n\nReply with only a JSON object (no prose, no code fences) matching this JSON Schema:\n' + JSON.stringify(schema);
  const base = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'system', content: sys }, { role: 'user', content: toOpenAiContent(content) }],
  };

  // Ask for strict structured output first; some upstream models reject
  // response_format, so fall back to the plain request on a 4xx.
  let res = await postChat({ ...base, response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } } });
  if (!res.ok && res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403) {
    res = await postChat(base);
  }
  if (!res.ok) {
    const msg = res.data?.error?.message || res.text.slice(0, 300);
    throw new Error('AI gateway error ' + res.status + ': ' + msg);
  }
  const choice = res.data?.choices?.[0];
  if (!choice) throw new Error('AI gateway returned no choices.');
  if (choice.finish_reason === 'length') throw new Error('AI reply was cut off (max_tokens).');
  if (choice.message?.refusal) throw new Error('The model declined this request.');
  let text = choice.message?.content;
  if (Array.isArray(text)) text = text.map(p => p.text || '').join('');
  return checkShape(extractJson(text), schema);
}
