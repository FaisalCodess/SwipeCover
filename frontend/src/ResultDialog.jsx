import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, LogIn, Share2, TriangleAlert, WifiOff } from 'lucide-react';
import { BoardFrame, CutFrame, keyShape } from './MainMenu.jsx';
import { shareResult } from './share.js';
import './result.css';

// A button in the game's cut-corner style (same shape as the MENU / UNDO chips).
export function ResultButton({ children, onClick, primary = false, autoFocus = false, type = 'button', className = '' }) {
  return (
    <button type={type} className={`result-btn ${primary ? 'is-primary' : ''} ${className}`} onClick={onClick} autoFocus={autoFocus}>
      <CutFrame shape={keyShape} />
      <span className="result-btn-label">{children}</span>
    </button>
  );
}

// Shares the result: the phone's share sheet on a touch screen, a copy to the clipboard elsewhere.
const SHARE_LABELS = {
  idle: [Share2, 'SHARE RESULT'],
  shared: [Check, 'SHARED'],
  copied: [Check, 'COPIED TO CLIPBOARD'],
  failed: [Share2, 'COULD NOT SHARE'],
};

export function ShareButton({ text, url }) {
  const [state, setState] = useState('idle');
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function press() {
    const outcome = await shareResult(text, url, { sheet: window.matchMedia('(pointer: coarse)').matches });
    if (outcome === 'cancelled') return;
    setState(outcome);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2200);
  }

  const [Icon, label] = SHARE_LABELS[state];
  return (
    <ResultButton className="is-share" onClick={press}>
      <Icon size={14} strokeWidth={1.8} /> {label}
    </ResultButton>
  );
}

// Where the run stands on the global leaderboard: asks the player to log in (their account is
// what the time is posted under), then shows the sending / ranked state.
export function ResultStanding({ label, globalResult, onLogin }) {
  const { status } = globalResult;

  if (status === 'needs-login') {
    return (
      <div className="result-join">
        <p className="result-kicker">POST THIS TO THE GLOBAL LEADERBOARD</p>
        <ResultButton primary onClick={onLogin}><LogIn size={14} strokeWidth={1.6} /> LOG IN OR SIGN UP</ResultButton>
        <p className="result-hint-line">YOUR RUN IS SAVED AND WILL BE SENT AS SOON AS YOU LOG IN</p>
      </div>
    );
  }

  const messages = {
    sending: <><LoaderCircle size={14} className="menu-spin" /> SENDING TO THE GLOBAL LEADERBOARD</>,
    ranked: <><Check size={14} strokeWidth={2.4} /> <b>#{globalResult.rank}</b> TODAY · {label.toUpperCase()}</>,
    offline: <><WifiOff size={14} /> OFFLINE · WILL BE SENT NEXT TIME YOU PLAY</>,
    rejected: <><TriangleAlert size={14} /> {String(globalResult.message).toUpperCase()}</>,
  };
  if (!messages[status]) return null;
  return <p className={`result-status is-${status}`} role="status">{messages[status]}</p>;
}

// Note shown after a replay: it is not saved or sent anywhere.
export function PracticeStrip({ children }) {
  return (
    <p className="result-status is-practice">
      <span className="result-tag">JUST FOR FUN</span>
      <span>{children}</span>
    </p>
  );
}

// The panel that comes up when a level or a Swipe Rush ends. `tone` is 'level' (teal) or 'rush' (ember).
// `hero` is the big number, `stats` the small cells under it, `pips` the daily-level progress (levels only).
export default function ResultDialog({ tone = 'level', titleId, kicker, title, hero, stats = [], pips, standing, actions, hint }) {
  return (
    <div className="result-overlay fade-in">
      <section className={`result-panel pop-in is-${tone}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <BoardFrame />
        <div className="result-body">
          <p className="result-kicker result-item" style={{ '--i': 0 }}>{kicker}</p>
          <h2 id={titleId} className="result-title result-item" style={{ '--i': 1 }}>{title}</h2>

          {pips && (
            <span className="result-pips result-item" style={{ '--i': 2 }} aria-hidden="true">
              {Array.from({ length: pips.total }, (_, index) => {
                const level = index + 1;
                return <i key={level} className={level === pips.current ? 'is-current' : pips.done.includes(level) ? 'is-done' : ''} />;
              })}
            </span>
          )}

          <div className="result-hero result-item" style={{ '--i': 3 }}>
            <small>{hero.label}</small>
            <strong className="tabular-nums">{hero.value}</strong>
          </div>

          <dl className="result-stats result-item" style={{ '--i': 4 }}>
            {stats.map(({ label, value }) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          {standing && <div className="result-item" style={{ '--i': 5 }}>{standing}</div>}

          <div className="result-actions result-item" style={{ '--i': 6 }}>{actions}</div>
          {hint && <p className="result-hint result-item" style={{ '--i': 7 }}>{hint}</p>}
        </div>
      </section>
    </div>
  );
}
