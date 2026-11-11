import { useEffect, useState } from 'react';
import { Check, Copy, LoaderCircle, Swords, TriangleAlert, Users, X } from 'lucide-react';
import { BoardFrame } from './MainMenu.jsx';
import { ResultButton } from './ResultDialog.jsx';
import './result.css';
import './versus.css';

const MATCH_RULES = '5 MINUTES · SAME BOARDS FOR BOTH · MOST MAPS WINS';

// Before a 1v1: find an opponent, or play a friend with a code. `lobby.status` says where it is:
// connecting, menu (choose), searching (in the queue), room (waiting for a friend), offline.
export default function VersusLobby({ lobby, onQueue, onCreate, onJoin, onCancel, onClose, onRetry }) {
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
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
  } else if (status === 'searching') {
    body = (
      <>
        <p className="versus-wait"><LoaderCircle size={16} className="menu-spin" /> SEARCHING FOR AN OPPONENT</p>
        <p className="versus-sub">YOU&apos;LL BE MATCHED WITH THE NEXT PLAYER LOOKING</p>
        <div className="versus-single"><ResultButton onClick={onCancel}>CANCEL</ResultButton></div>
      </>
    );
  } else if (status === 'room') {
    body = (
      <>
        <p className="versus-sub">SEND THIS CODE TO YOUR FRIEND</p>
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
        <button type="button" className="versus-choice is-primary" onClick={onQueue} autoFocus>
          <Swords size={20} strokeWidth={1.4} />
          <span><b>FIND AN OPPONENT</b><small>RANKED · MOVES YOUR RATING</small></span>
        </button>
        <button type="button" className="versus-choice" onClick={onCreate}>
          <Users size={20} strokeWidth={1.4} />
          <span><b>PLAY A FRIEND</b><small>CREATE A CODE TO SHARE · UNRANKED</small></span>
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
