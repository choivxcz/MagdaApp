// Sends a chat question to Sakay AI (Gemini, on our server). If the AI is
// not set up, busy, or the phone is offline, answers on the phone instead.
import { Capacitor } from '@capacitor/core';
import { answerOffline } from './offline.js';

// The phone app has no server of its own, so it calls the website's.
const API_URL = import.meta.env.VITE_ASSISTANT_URL
  || (Capacitor.isNativePlatform() ? 'https://sakay-laguna.vercel.app/api/assistant' : '/api/assistant');

let aiPausedUntil = 0;

const snapshot = (jeepneys) => jeepneys.map((j) => ({
  plate: j.plate,
  direction: j.direction,
  lat: j.lat,
  lng: j.lng,
  seatsTotal: j.seatsTotal,
  seatsTaken: j.seatsTaken,
  updatedAt: j.updatedAt instanceof Date ? j.updatedAt.toISOString() : j.updatedAt,
  tripStatus: j.tripStatus,
  lastTrip: j.lastTrip,
}));

// The most useful community tips, short, for the AI to relay.
const tipSnapshot = (tips = []) => [...tips]
  .sort((a, b) => b.helpful - a.helpful || b.createdAt - a.createdAt)
  .slice(0, 15)
  .map((t) => ({ category: t.category, body: t.body, stopId: t.stopId }));

// messages: [{ role: 'user' | 'assistant', text }], last one is the question.
// mapTrip: { fromId, toId, from: { label, point }, to: { label, point } }
// Returns { text, actions, source: 'ai' | 'offline', memory }.
export async function askAssistant({ messages, route, jeepneys, fareType, mapTrip, demo, memory, tips }) {
  const question = messages[messages.length - 1].text;
  // Always run the offline reader too: it remembers the stops mentioned,
  // so it can take over mid-conversation if the AI drops out.
  const local = answerOffline(question, { route, jeepneys, fareType, mapTrip, memory });
  const offline = () => ({ ...local, source: 'offline' });

  if (Date.now() < aiPausedUntil || (typeof navigator !== 'undefined' && navigator.onLine === false)) return offline();

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: messages.slice(-10).map((m) => ({ role: m.role, text: m.text })),
        context: { jeepneys: snapshot(jeepneys), fareType, mapTrip, demo, tips: tipSnapshot(tips) },
      }),
      signal: AbortSignal.timeout(25000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.text) {
      // Not set up (no key, or no /api in this build): stop trying this session.
      // Busy / daily limit: try the AI again in a minute.
      aiPausedUntil = Date.now() + (data?.error === 'not_configured' || res.status === 404 ? 6 * 60 * 60 * 1000 : 60 * 1000);
      return offline();
    }
    return { text: data.text, actions: Array.isArray(data.actions) ? data.actions : [], source: 'ai', memory: local.memory };
  } catch {
    aiPausedUntil = Date.now() + 30 * 1000;
    return offline();
  }
}
