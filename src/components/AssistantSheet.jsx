import { Fragment, useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

export const GREETING = {
  role: 'assistant',
  text: 'Hi! I’m **Sakay AI**. Ask me about fares, the next jeepney, free seats or the route — in English or Tagalog.',
};

const SUGGESTIONS = [
  'Magkano Magdalena papuntang Santa Cruz?',
  'May jeep ba papuntang Santa Cruz ngayon?',
  'When is the next jeep at the Capitol?',
  'Saan dumadaan ang jeep?',
  'Student fare from DLTB to Sta. Cruz Plaza',
];

// Tiny formatter for the assistant's replies: **bold** and line breaks only.
function Rich({ text }) {
  return text.split('\n').map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {line.split(/(\*\*[^*]+\*\*)/g).map((part, k) => (
        part.startsWith('**') && part.endsWith('**') && part.length > 4
          ? <b key={k}>{part.slice(2, -2)}</b>
          : <Fragment key={k}>{part}</Fragment>
      ))}
    </Fragment>
  ));
}

// The chat window. `chat` lives in the map screen so the conversation
// stays while the window is closed.
export default function AssistantSheet({ chat, onSend, onShowTrip, onClose }) {
  const [draft, setDraft] = useState('');
  const logRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat.messages.length, chat.busy]);

  function send(text) {
    const q = text.trim();
    if (!q || chat.busy) return;
    setDraft('');
    onSend(q);
  }

  const fresh = chat.messages.length <= 1;

  return (
    <div className="driver-backdrop" onClick={onClose}>
      <section className="assistant-sheet" role="dialog" aria-modal="true" aria-label="Sakay AI assistant" onClick={(e) => e.stopPropagation()}>
        <header className="assistant-head">
          <span className="assistant-badge"><Icon name="sparkle" size={20} /></span>
          <div className="assistant-title">
            <b>Sakay AI</b>
            <span className="sub">Fares, jeepneys, seats · English or Tagalog</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
        </header>

        <div className="assistant-log" ref={logRef} aria-live="polite">
          {chat.messages.map((m, i) => (
            <div key={i} className={`bubble-row ${m.role}`}>
              <div className={`bubble ${m.role}`}>
                <span><Rich text={m.text} /></span>
                {m.trip && (
                  <button className="bubble-action" onClick={() => onShowTrip(m.trip)}>
                    <Icon name="map" size={16} /> Show on map
                  </button>
                )}
                {m.source === 'offline' && <span className="bubble-tag" title="Answered on your phone without the AI">offline answer</span>}
              </div>
            </div>
          ))}
          {chat.busy && (
            <div className="bubble-row assistant">
              <div className="bubble assistant typing" aria-label="Sakay AI is typing"><i /><i /><i /></div>
            </div>
          )}
        </div>

        {fresh && (
          <div className="assistant-suggest" role="list" aria-label="Example questions">
            {SUGGESTIONS.map((s) => (
              <button key={s} role="listitem" className="suggest-chip" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}

        <form className="assistant-input" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
          <input
            ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500}
            placeholder="Itanong mo dito… / Ask here…" aria-label="Your question" enterKeyHint="send"
          />
          <button type="submit" className="send-btn" disabled={!draft.trim() || chat.busy} aria-label="Send">
            <Icon name="send" size={20} />
          </button>
        </form>
        <p className="assistant-fine">AI answers can be wrong; fares and times are estimates. Don’t type personal details.</p>
      </section>
    </div>
  );
}
