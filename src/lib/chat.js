// Community chat: commuters on the route talking right now ("May jeep pa
// ba?"). Messages show for 1 hour. To save load it checks for NEW messages
// only, and only while the chat is open on screen: every 8 seconds
// (15 with Data saver), and slower when nobody is talking.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase.js';
import { isDataSaver } from './prefs.js';

const HOUR = 60 * 60 * 1000;
const toMsg = (r) => ({ id: Number(r.id), body: r.body, author: r.author, authorDriver: !!r.author_driver, mine: !!r.mine, createdAt: new Date(r.created_at) });

function must({ data, error }) {
  if (error) {
    if (/could not find the function|schema cache/i.test(error.message)) throw new Error('Chat isn’t switched on yet. (Admin: run npm run setup:db.)');
    throw error;
  }
  return data;
}

export async function fetchChat(routeId, after = 0) {
  return (must(await supabase.rpc('list_chat', { p_route_id: routeId, p_after: after })) ?? []).map(toMsg);
}
export const sendChat = async (routeId, body, anonymous) => Number(must(await supabase.rpc('send_chat', { p_route_id: routeId, p_body: body, p_anonymous: !!anonymous })));
export const deleteChat = async (id) => must(await supabase.rpc('delete_chat', { p_id: id }));

export function useChat(routeId, active) {
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const last = useRef(0);
  const quiet = useRef(0); // checks in a row with nothing new

  const poll = useCallback(async () => {
    if (!supabase) return;
    try {
      const fresh = await fetchChat(routeId, last.current);
      quiet.current = fresh.length ? 0 : quiet.current + 1;
      if (fresh.length) last.current = fresh.at(-1).id;
      setMessages((m) => {
        const cutoff = Date.now() - HOUR;
        const seen = new Set(m.map((x) => x.id));
        return [...m.filter((x) => x.createdAt.getTime() > cutoff), ...fresh.filter((x) => !seen.has(x.id))];
      });
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoaded(true);
    }
  }, [routeId]);

  useEffect(() => {
    if (!active || !supabase) return undefined;
    let timer;
    let stopped = false;
    const tick = async () => {
      if (!document.hidden) await poll();
      if (stopped) return;
      const base = isDataSaver() ? 15000 : 8000;
      timer = setTimeout(tick, quiet.current > 6 ? base * 2 : base); // quiet chat: check half as often
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [active, poll]);

  const send = useCallback(async (body, anonymous) => {
    await sendChat(routeId, body, anonymous);
    quiet.current = 0;
    await poll();
  }, [routeId, poll]);

  const remove = useCallback(async (id) => {
    await deleteChat(id);
    setMessages((m) => m.filter((x) => x.id !== id));
  }, []);

  const hide = useCallback((id) => setMessages((m) => m.filter((x) => x.id !== id)), []);
  return { messages, error, loaded, send, remove, hide, reload: poll };
}
