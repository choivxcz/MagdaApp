// Community, like DavaoGo: routes, terminals and tips from commuters, and a
// live chat. Anyone can read; signed-in riders post, vote, confirm,
// comment and chat; admins approve new routes and terminals.
import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader, Skeleton, Segmented, navigate } from '../components/ui.jsx';
import { haptic } from '../lib/haptics.js';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../lib/auth.jsx';
import { usePrefs, setPrefs } from '../lib/prefs.js';
import { isDemo } from '../lib/supabase.js';
import { deleteTip, toggleHelpful, TIP_CATEGORIES, tipAge } from '../lib/community.js';
import { useFeed, votePost, confirmPost, deletePost, blockAuthor, targetOf, refreshCommunityPlaces } from '../lib/communityPosts.js';
import { useChat } from '../lib/chat.js';
import { PostCard, ReportSheet, ContributorSheet, Byline, Menu } from '../components/CommunityPost.jsx';
import CreatePost from '../components/CreatePost.jsx';
import { t } from '../lib/i18n.js';

// Used by the admin page for tips (including hidden ones).
export function TipCard({ tip, route, user, isAdmin, onVote, onDelete, onHide }) {
  const cat = TIP_CATEGORIES[tip.category];
  const stop = tip.stopId ? route.stops.find((s) => s.id === tip.stopId) : null;
  return (
    <article className={`tip-card ${tip.status === 'hidden' ? 'hidden-tip' : ''}`}>
      <div className="tip-head">
        <span className="menu-icon"><Icon name={cat.icon} size={18} /></span>
        <div>
          <b>{cat.label}{stop ? ` · ${stop.short ?? stop.name}` : ''}</b>
          <span className="sub">{tip.author} · {tipAge(tip.createdAt)}{tip.point ? t(" · has a location") : ''}{tip.status === 'hidden' ? t(" · hidden") : ''}</span>
        </div>
      </div>
      <p className="tip-body">{tip.body}</p>
      <div className="tip-actions">
        <button
          className={`helpful-btn ${tip.voted ? 'on' : ''}`} onClick={() => onVote(tip)} disabled={!user || tip.mine || tip.status === 'hidden'}
          aria-pressed={tip.voted} title={!user ? t("Sign in to vote") : tip.mine ? t("Your tip") : t("Mark as helpful")}
        >
          <Icon name="thumb" size={15} />{' '}{t("Helpful")}{tip.helpful ? ` · ${tip.helpful}` : ''}
        </button>
        {(tip.mine || isAdmin) && <button className="link-btn small danger-text" onClick={() => onDelete(tip)}>{t("Delete")}</button>}
        {isAdmin && <button className="link-btn small" onClick={() => onHide(tip)}>{tip.status === 'hidden' ? t("Show again") : t("Hide")}</button>}
      </div>
    </article>
  );
}

const FILTERS = [['all', 'All'], ['local_route', 'Routes'], ['terminal', 'Terminals'], ['tip', 'Tips']];

function Posts({ route, user, isAdmin, openOnMap }) {
  const { posts, loaded, error, reload, patch, remove } = useFeed(route.id, user?.id ?? null);
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState(null);
  const [reporting, setReporting] = useState(null);
  const [profile, setProfile] = useState(null);
  const shown = posts.filter((p) => filter === 'all' || p.kind === filter);

  async function act(fn) {
    try { await fn(); } catch (err) { setMsg({ kind: 'warn', text: err.message }); }
  }
  const vote = (p, value) => act(async () => {
    haptic.tap();
    const r = await votePost(p.id, value);
    if (r) patch(p.id, { up: r.up, down: r.down, myVote: r.my_vote });
  });
  const confirm = (p) => act(async () => {
    haptic.tap();
    const r = await confirmPost(p.id);
    if (r) patch(p.id, { confirms: r.confirms, myConfirm: r.my_confirm });
  });
  const helpful = (p) => act(async () => {
    haptic.tap();
    const r = await toggleHelpful(p.id);
    if (r) patch(p.id, { up: r.helpful, myVote: r.voted ? 1 : 0 });
  });
  const del = (p) => act(async () => {
    if (!window.confirm('Delete this post?')) return;
    if (p.kind === 'tip') await deleteTip(p.id); else await deletePost(p.id);
    remove(p.id);
  });
  const block = (p) => act(async () => {
    if (!window.confirm(`Block ${p.author}? You won’t see each other’s posts, comments or chat messages. You can unblock in More → Preferences.`)) return;
    await blockAuthor(targetOf(p), p.id);
    setProfile(null);
    setMsg({ kind: 'ok', text: `${p.author} is blocked.` });
    reload();
  });
  const showOnMap = (p) => openOnMap({ focus: { id: p.id, kind: p.kind, name: p.name ?? TIP_CATEGORIES[p.category]?.label, point: p.point, path: p.path } });

  function done(text) {
    setCreating(false);
    setMsg({ kind: 'ok', text });
    reload();
    refreshCommunityPlaces(route.id);
  }

  return (
    <>
      {creating ? (
        <CreatePost route={route} initialKind={typeof creating === 'string' ? creating : null} onDone={done} onCancel={() => setCreating(false)} />
      ) : (
        <button type="button" className="contribute-card" onClick={() => (user ? setCreating(true) : setPrefs({ guest: false }))}>
          <span className="contribute-icon"><Icon name="plus" size={22} /></span>
          <span>
            <b>{t("Know a route that’s not on the map?")}</b>
            <small>{user ? t("Add a tricycle route, mark a terminal, or share a tip") : t("Sign in to add a route or terminal. You can browse without an account.")}</small>
          </span>
        </button>
      )}
      {msg && <p className={msg.kind === 'ok' ? 'ok' : 'warn'}>{msg.text}</p>}
      {error && <p className="warn">{t("Couldn’t load Community:")}{' '}{error}</p>}

      <div className="tip-filter" role="group" aria-label={t("Show")}>
        {FILTERS.map(([id, label]) => (
          <button key={id} className={`chip small ${filter === id ? 'on' : ''}`} onClick={() => setFilter(id)}>{label}</button>
        ))}
      </div>

      {!loaded && !error ? (
        <Skeleton rows={3} />
      ) : shown.length ? (
        <div className="tip-list">
          {shown.map((p) => (
            <PostCard
              key={`${p.kind}:${p.id}`} post={p} route={route} user={user} isAdmin={isAdmin}
              onVote={vote} onConfirm={confirm} onHelpful={helpful} onDelete={del} onShowOnMap={showOnMap}
              onReport={setReporting} onBlock={block} onProfile={setProfile} onPatch={patch}
            />
          ))}
        </div>
      ) : (
        <div className="empty compact">
          <span className="empty-icon"><Icon name="chat" size={28} /></span>
          <p>{filter === 'all' ? t("Nothing here yet. Be the first to add a tricycle route, a terminal or a tip.") : t("Nothing of this kind yet.")}</p>
        </div>
      )}
      <p className="fineprint center">{t("Shared by commuters and checked only lightly. Fares and times can change: confirm with the driver.")}{' '}<button type="button" className="link-btn small" onClick={() => navigate('more/guidelines')}>{t("Community guidelines")}</button></p>

      {reporting && (
        <ReportSheet kind={targetOf(reporting)} id={reporting.id} what={reporting.kind === 'tip' ? 'tip' : 'post'} canBlock={reporting.author !== 'Anonymous commuter'}
          onClose={() => setReporting(null)} onDone={({ blocked }) => { if (blocked) reload(); }} />
      )}
      {profile && (
        <ContributorSheet kind={targetOf(profile)} id={profile.id} canBlock={!!user && !profile.mine} onClose={() => setProfile(null)} onBlock={() => block(profile)} />
      )}
    </>
  );
}

function Chat({ route, user }) {
  const prefs = usePrefs();
  const { messages, error, loaded, send, remove, hide } = useChat(route.id, true);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [reporting, setReporting] = useState(null);
  const listRef = useRef(null);
  const anonymous = !!prefs.chatAnonymous;
  const people = useMemo(() => new Set(messages.map((m) => m.author)).size, [messages]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function submit(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      await send(body.trim(), anonymous);
      setBody('');
      haptic.tap();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function blockFrom(m) {
    if (!window.confirm(`Block ${m.author}? You won’t see each other’s messages or posts.`)) return;
    try {
      await blockAuthor('chat', m.id);
      hide(m.id);
    } catch (err) { setMsg(err.message); }
  }

  return (
    <div className="chat">
      <p className="chat-note"><Icon name="clock" size={14} />{' '}{t("Messages disappear after 1 hour")}{messages.length ? ` · ${people} ${people === 1 ? 'person' : 'people'} chatting` : ''}</p>
      <div className="chat-list" ref={listRef} aria-live="polite" aria-label={t("Community chat messages")}>
        {!loaded && <Skeleton rows={2} />}
        {loaded && !messages.length && !error && <p className="sub center">{t("No messages yet. Ask if the jeepney is coming, or share what’s happening on the road.")}</p>}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.mine ? 'mine' : ''}`}>
            {!m.mine && <Byline name={m.author} driver={m.authorDriver} when={m.createdAt} />}
            <div className="chat-bubble">
              <span>{m.body}</span>
              <Menu label={t("Message options")} items={[
                m.mine && { label: 'Delete', icon: 'trash', danger: true, onClick: () => remove(m.id).catch((err) => setMsg(err.message)) },
                user && !m.mine && { label: 'Report', icon: 'flag', onClick: () => setReporting(m) },
                user && !m.mine && m.author !== 'Anonymous commuter' && { label: `Block ${m.author}`, icon: 'block', onClick: () => blockFrom(m) },
              ]} />
            </div>
            {m.mine && <span className="sub chat-time">{tipAge(m.createdAt)}</span>}
          </div>
        ))}
      </div>
      {error && <p className="warn small">{error}</p>}
      {user ? (
        <form className="chat-form" onSubmit={submit}>
          <input value={body} onChange={(e) => setBody(e.target.value.slice(0, 300))} maxLength={300} placeholder={t("Message commuters…")} aria-label={t("Message commuters")} />
          <button className="send-btn" disabled={busy || !body.trim()} aria-label={t("Send message")}><Icon name="send" size={18} /></button>
        </form>
      ) : (
        <div className="card compact-card">
          <p className="body-text">{t("Sign in to send messages. You can read the chat without an account.")}</p>
          <button className="btn primary" onClick={() => setPrefs({ guest: false })}>{t("Sign in")}</button>
        </div>
      )}
      {user && (
        <label className="switch-label small-switch"><span>{t("Send as “Anonymous commuter”")}</span>
          <input type="checkbox" className="switch" checked={anonymous} onChange={(e) => setPrefs({ chatAnonymous: e.target.checked })} />
        </label>
      )}
      {msg && <p className="warn small">{msg}</p>}
      <p className="fineprint">{t("Be kind. No selling, no personal info, no plate numbers. For a bad ride use More → Report a ride.")}</p>
      {reporting && <ReportSheet kind="chat" id={reporting.id} what="message" canBlock={reporting.author !== 'Anonymous commuter'}
        onClose={() => setReporting(null)} onDone={({ blocked }) => { hide(reporting.id); if (blocked) setMsg(`${reporting.author} is blocked.`); }} />}
    </div>
  );
}

export default function CommunityScreen({ route, sub, openOnMap }) {
  const { user, isAdmin } = useAuth();
  const tab = sub === 'chat' ? 'chat' : 'posts';
  return (
    <div className="page">
      <PageHeader title={t("Community")} subtitle="Routes, terminals and tips from Magdalena – Santa Cruz commuters" />
      <div className="page-body">
        <Segmented value={tab} onChange={(t) => navigate(t === 'chat' ? 'community/chat' : 'community')} options={[['posts', 'Posts'], ['chat', 'Chat']]} />
        {isDemo ? (
          <p className="hint">{t("Community works once the database is connected.")}</p>
        ) : tab === 'chat' ? (
          <Chat route={route} user={user} />
        ) : (
          <Posts route={route} user={user} isAdmin={isAdmin} openOnMap={openOnMap} />
        )}
      </div>
    </div>
  );
}
