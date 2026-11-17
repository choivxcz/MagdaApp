// Trip options (Fastest / Least walking / Direct...) and the step-by-step
// timeline: Walk → Jeepney → Transfer → Jeepney → Walk / Tricycle.
import Icon from './Icon.jsx';
import { ScrollRow } from './ui.jsx';
import { DIRECTIONS } from '../lib/directions.js';
import { peso } from '../lib/fare.js';
import { TAG_LABEL, fmtMeters, fmtMinutes, spotText } from '../lib/planner.js';
import { landmarks } from '../lib/landmarkData.js';

const MODE_ICON = { walk: 'walk', tricycle: 'tricycle', ride: 'bus', transfer: 'swap' };
const near = (n, fallback = 'along the route') => (n ? `near ${n.stop.short ?? n.stop.name}` : fallback);
// "near Capitol (by Jollibee)"
const spot = (stopNear, point) => spotText(stopNear, point, (p) => landmarks.near(p));

// "₱13.00" or "₱13.00 + ~₱25 tricycle" or "Free".
export function fareText(option, fareType) {
  const jeep = option.fare[fareType === 'discounted' ? 'discounted' : 'regular'];
  const trike = option.fare[fareType === 'discounted' ? 'tricycleDiscounted' : 'tricycle'];
  if (!jeep && !trike) return 'Free';
  if (!trike) return peso(jeep);
  if (!jeep) return `~₱${trike}`;
  return `${peso(jeep)} + ~₱${trike}`;
}

export function modeChain(option) {
  return option.steps.filter((s) => s.type !== 'transfer' && !(s.type === 'walk' && s.meters < 60 && option.steps.length > 1));
}

export function OptionCards({ options, selectedId, onSelect, fareType }) {
  if (options.length < 2) return null;
  return (
    <ScrollRow className="option-row-wrap" trackClassName="option-row" role="tablist" aria-label="Trip options">
      {options.map((o, i) => {
        const on = o.id === selectedId;
        const tags = o.tags.filter((t) => t !== 'transfer');
        return (
          <button key={o.id} role="tab" aria-selected={on} className={`option-card ${on ? 'on' : ''}`} onClick={() => onSelect(o.id)}>
            <span className="option-tags">
              {i === 0 && <span className="option-tag best">Best</span>}
              {tags.slice(0, 2).map((t) => <span key={t} className="option-tag">{TAG_LABEL[t]}</span>)}
              {!tags.length && i > 0 && <span className="option-tag">{o.rides >= 2 ? 'With transfer' : 'Option'}</span>}
            </span>
            <span className="option-time">{fmtMinutes(o.minutes)}</span>
            <span className="option-chain" aria-hidden="true">
              {modeChain(o).map((s, k) => (
                <span key={k} className={`chain-step ${s.type === 'ride' ? DIRECTIONS[s.direction]?.className ?? '' : s.type}`}>
                  {k > 0 && <Icon name="chevron" size={10} className="chain-sep" />}
                  <Icon name={MODE_ICON[s.type]} size={14} />
                </span>
              ))}
            </span>
            <span className="option-meta">{fareText(o, fareType)} · {o.walkM >= 30 ? `${fmtMeters(o.walkM)} walk` : 'no walking'}</span>
          </button>
        );
      })}
    </ScrollRow>
  );
}

function StepRow({ icon, tone, title, sub, extra, children }) {
  return (
    <li className={`step ${tone ?? ''}`}>
      <span className="step-icon"><Icon name={icon} size={16} /></span>
      <div className="step-body">
        <b>{title}</b>
        {sub && <span className="sub">{sub}</span>}
        {extra}
        {children}
      </div>
    </li>
  );
}

// walkState: what we know about the first walk ('loading' | 'failed' | null).
export function Timeline({ option, from, to, fareType, firstWalkState, onRetryWalk }) {
  const ft = fareType === 'discounted' ? 'discounted' : 'regular';
  const steps = option.steps;
  const rows = [];
  steps.forEach((s, i) => {
    const next = steps[i + 1];
    if (s.type === 'walk') {
      const dest = s.role === 'first' ? `to the sakayan ${near(next?.boardNear, '')}`.trim() : `to ${to.label}`;
      rows.push(
        <StepRow key={i} icon="walk" tone="walk" title={`Walk ${fmtMeters(s.meters)} · ${fmtMinutes(s.minutes)}`} sub={dest}
          extra={s.role === 'first' && firstWalkState === 'loading' ? <span className="sub">Finding the walking route…</span>
            : s.role === 'first' && firstWalkState === 'failed' ? <span className="sub">Couldn’t load walking directions. Walk to the violet <b>Sakayan</b> pin. <button className="link-btn small" onClick={onRetryWalk}>Try again</button></span>
              : null}
        />,
      );
    } else if (s.type === 'tricycle') {
      const dest = s.role === 'first' ? `to the sakayan ${near(next?.boardNear, '')}`.trim() : `to ${to.label}`;
      rows.push(
        <StepRow key={i} icon="tricycle" tone="trike" title={`Tricycle ${fmtMeters(s.meters)} · ~${fmtMinutes(s.minutes)}`} sub={`${dest} · about ₱${s.fare[ft]} (estimate)`}
          extra={<span className="sub faint">{s.role === 'only' ? 'Door to door.' : 'Too far to walk.'} Tricycle fares are set by each town; agree on the fare first.</span>}
        />,
      );
    } else if (s.type === 'transfer') {
      rows.push(
        <StepRow key={i} icon="swap" tone="transfer" title="Transfer" sub={`${s.meters > 0 ? `Walk ${fmtMeters(s.meters)}, then w` : 'W'}ait for a jeepney ${DIRECTIONS[next?.direction]?.label.toLowerCase() ?? ''} (pay again)`} />,
      );
    } else if (s.type === 'ride') {
      const d = DIRECTIONS[s.direction];
      rows.push(
        <StepRow key={i} icon="bus" tone={`ride ${d?.className ?? ''}`} title={<>Jeepney <span className={`dir-badge ${d?.className}`}>{d?.short}</span></>}
          sub={`${fmtMeters(s.meters)} · ~${fmtMinutes(s.minutes)} · ${peso(s.fare[ft])}`}
        >
          <span className="ride-ends">
            <span><i className="end-dot board" />Get on {spot(s.boardNear, s.board)} <small>(sakayan)</small></span>
            <span><i className="end-dot alight" />Get off {spot(s.alightNear, s.alight)} <small>(babaan)</small></span>
          </span>
        </StepRow>,
      );
    }
  });
  rows.push(<StepRow key="end" icon="pin" tone="end" title={`Arrive at ${to.label}`} sub={`About ${fmtMinutes(option.minutes)} in all${from?.label ? ` from ${from.label}` : ''}`} />);
  return <ol className="steps">{rows}</ol>;
}
