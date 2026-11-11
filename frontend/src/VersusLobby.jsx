import { useEffect, useState } from 'react';
import { Check, Copy, LoaderCircle, Swords, TriangleAlert, Users, X, Zap } from 'lucide-react';
import { BoardFrame } from './MainMenu.jsx';
import { ResultButton } from './ResultDialog.jsx';
import './result.css';
import './versus.css';

const MATCH_RULES = 'SAME BOARDS FOR BOTH · MOST MAPS WINS';
// How long a friend match can last, in seconds. Quick and ranked matches have fixed lengths (server).
const FRIEND_LENGTHS = [60, 180, 300];
const DEFAULT_LENGTH = 180;

const minutes = (seconds) => `${seconds / 60} MIN`;

// Before a 1v1: a quick match, a ranked match, or a friend match with a code. `lobby.status` says where
// it is: connecting, menu (choose), searching (in a queue), room (waiting for a friend), offline.
export default function VersusLobby({ lobby, onQueue, onCreate, onJoin, onCancel, onClose, onRetry }) {
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [length, setLength] = useState(DEFAULT_LENGTH);
  const { status, error } = lobby;

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(lobby.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // The code is on screen to read out; copying is only a convenience.
    }
  }

  let body;
  if (status === 'connecting') {
    body = <p className="versus-wait"><LoaderCircle size={16} className="menu-spin" /> CONNECTING</p>;
  } else if (status === 'offline') {
    body = (
      <>
        <p className="result-status is-rejected"><TriangleAlert size={14} /> CAN&apos;T REACH THE 1V1 SERVER</p>
        <div className="result-actions"><ResultButton onClick={onClose}>CLOSE</ResultButton><ResultButton primary onClick={onRetry}>TRY AGAIN</ResultButton></div>
      </>
    );
  } else if (status === 'searching' && lobby.mode === 'ranked') {
    const low = Math.max(0, lobby.rating - lobby.range);
    const high = lobby.rating + lobby.range;
    body = (
      <>
        <p className="versus-wait"><LoaderCircle size={16} className="menu-spin" /> SEARCHING · RANKED</p>
        <div className="versus-range" role="status" aria-label={`Looking for ratings between ${low} and ${high}`}>
          <div className="versus-range-scale" aria-hidden="true">
            <b>{low}</b>
            <span className="versus-range-line"><i /><em>{lobby.rating}</em></span>
            <b>{high}</b>
          </div>
          <p>YOUR RATING {lobby.rating} · LOOKING WITHIN ±{lobby.range}</p>
          <small>THE SEARCH WIDENS THE LONGER YOU WAIT, SO YOU ALWAYS FIND A GAME</small>
        </div>
        <div className="versus-single"><ResultButton onClick={onCancel}>CANCEL</ResultButton></div>
      </>
    );
  } else if (status === 'searching') {
    body = (
      <>
        <p className="versus-wait"><LoaderCircle size={16} className="menu-spin" /> SEARCHING · QUICK MATCH</p>
        <p className="versus-sub">YOU&apos;LL BE PAIRED WITH THE NEXT PLAYER LOOKING · 3 MIN · NO RATING</p>
        <div className="versus-single"><ResultButton onClick={onCancel}>CANCEL</ResultButton></div>
      </>
    );
  } else if (status === 'room') {
    body = (
      <>
        <p className="versus-sub">{minutes(lobby.seconds || DEFAULT_LENGTH)} FRIEND MATCH · SEND THIS CODE TO YOUR FRIEND</p>
        <button type="button" className="versus-code" onClick={copyCode} aria-label={`Game code ${lobby.code}. Press to copy`}>
          <span>{lobby.code}</span>
          <small>{copied ? <><Check size={12} /> COPIED</> : <><Copy size={12} /> TAP TO COPY</>}</small>
        </button>
        <p className="versus-wait"><LoaderCircle size={16} className="menu-spin" /> WAITING FOR THEM TO JOIN</p>
        <div className="versus-single"><ResultButton onClick={onCancel}>CANCEL</ResultButton></div>
      </>
    );
  } else {
    body = (
      <>
        <button type="button" className="versus-choice" onClick={() => onQueue('quick')} autoFocus>
          <Zap size={20} strokeWidth={1.4} />
          <span><b>QUICK MATCH</b><small>3 MIN · ANYONE ONLINE · NO RATING</small></span>
          <em>3:00</em>
        </button>
        <button type="button" className="versus-choice is-primary" onClick={() => onQueue('ranked')}>
          <Swords size={20} strokeWidth={1.4} />
          <span><b>RANKED</b><small>5 MIN · CLOSE RATING · RATED</small></span>
          <em>5:00</em>
        </button>

        <div className="versus-friends">
          <p className="versus-group"><Users size={12} strokeWidth={1.6} /> PLAY A FRIEND · NO RATING</p>
          <div className="versus-lengths" role="radiogroup" aria-label="Match length">
            {FRIEND_LENGTHS.map((seconds) => (
              <button
                type="button"
                key={seconds}
                role="radio"
                aria-checked={length === seconds}
                className={length === seconds ? 'is-active' : ''}
                onClick={() => setLength(seconds)}
              >
                {minutes(seconds)}
              </button>
            ))}
          </div>
          <button type="button" className="versus-choice is-compact" onClick={() => onCreate(length)}>
            <span><b>CREATE A CODE</b><small>SHARE IT · {minutes(length)} MATCH</small></span>
          </button>
          <form
            className="versus-join"
            onSubmit={(event) => {
              event.preventDefault();
              if (code.trim()) onJoin(code.trim());
            }}
          >
            <input
              className="result-input"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder="HAVE A CODE?"
              maxLength={5}
              aria-label="Game code"
              autoComplete="off"
              spellCheck={false}
            />
            <ResultButton type="submit" primary>JOIN</ResultButton>
          </form>
        </div>
      </>
    );
  }

  return (
    <div className="result-overlay auth-overlay fade-in" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="result-panel versus-panel pop-in is-rush" role="dialog" aria-modal="true" aria-labelledby="versus-title">
        <BoardFrame />
        <button type="button" className="auth-close" onClick={onClose} aria-label="Close"><X size={16} strokeWidth={1.6} /></button>
        <div className="result-body versus-body">
          <p className="result-kicker">SWIPE RUSH</p>
          <h2 id="versus-title" className="result-title">1 v 1</h2>
          <p className="versus-rules">{MATCH_RULES}</p>
          {error && <p className="result-status is-rejected" role="alert"><TriangleAlert size={14} /> {error.toUpperCase()}</p>}
          {body}
        </div>
      </section>
    </div>
  );
}
