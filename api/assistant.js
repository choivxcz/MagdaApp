// POST /api/assistant: the Sakay AI chat (Vercel serverless function).
// Needs GEMINI_API_KEY in the Vercel project's Environment Variables.
// Without it the app answers with its built-in offline assistant instead.
import { handleAssistant } from './_agent.js';

const MAX_BODY_BYTES = 64 * 1024; // a chat question is a few KB at most

export default async function handler(req, res) {
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'too_large' });
  }
  const out = await handleAssistant({
    method: req.method,
    origin: req.headers.origin,
    // Set by Vercel itself (a caller can't fake it, unlike the first x-forwarded-for entry).
    ip: req.headers['x-real-ip'] || String(req.headers['x-vercel-forwarded-for'] ?? req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket?.remoteAddress,
    body: typeof req.body === 'string' ? safeJson(req.body) : req.body,
    env: process.env,
  });
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  if (out.json == null) return res.status(out.status).end();
  return res.status(out.status).json(out.json);
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}
