import { useEffect, useState } from 'react';
import { LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { BoardFrame } from './MainMenu.jsx';
import { ResultButton } from './ResultDialog.jsx';
import { changeUsername, cleanName, deleteAccount, getSession } from './api.js';
import './result.css';
import './auth.css';

// Change username, or delete the account. Deleting asks the player to type their username (and their
// password, if the account has one) so it cannot happen by a stray click.
export default function AccountDialog({ mode, player, onClose, onRenamed, onDeleted }) {
  const [username, setUsername] = useState(mode === 'rename' ? player.name : '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const hasPassword = getSession()?.user?.hasPassword !== false;
  const deleting = mode === 'delete';

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (!deleting) {
      const cleaned = cleanName(username);
      if (!cleaned) return setError('Usernames are 3-16 letters, numbers, spaces, _ or -.');
      if (cleaned === player.name) return onClose();
    }
    setBusy(true);
    try {
      if (deleting) {
        await deleteAccount(username.trim(), password);
        onDeleted();
      } else {
        onRenamed(await changeUsername(cleanName(username)));
      }
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
    return undefined;
  }

  return (
    <div className="result-overlay auth-overlay fade-in" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`result-panel auth-panel pop-in ${deleting ? 'is-rush' : 'is-level'}`} role="dialog" aria-modal="true" aria-labelledby="account-title">
        <BoardFrame />
        <button type="button" className="auth-close" onClick={onClose} aria-label="Close"><X size={16} strokeWidth={1.6} /></button>
        <form className="result-body auth-body" onSubmit={submit} noValidate>
          <p className="result-kicker">{deleting ? 'THIS CANNOT BE UNDONE' : 'YOUR ACCOUNT'}</p>
          <h2 id="account-title" className="result-title">{deleting ? 'Delete account' : 'Change username'}</h2>

          {deleting && (
            <p className="auth-note">
              This removes your account, your logins and your leaderboard times for good. Type your username
              ({player.name}){hasPassword ? ' and your password' : ''} to confirm.
            </p>
          )}

          <label className="auth-field">
            <span>{deleting ? 'TYPE YOUR USERNAME' : 'NEW USERNAME'}</span>
            <input className="result-input" value={username} onChange={(event) => setUsername(event.target.value)} maxLength={16} autoFocus autoComplete="off" />
          </label>
          {deleting && hasPassword && (
            <label className="auth-field">
              <span>PASSWORD</span>
              <input className="result-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" maxLength={128} />
            </label>
          )}

          {error && <p className="result-status is-rejected" role="alert"><TriangleAlert size={14} /> {error.toUpperCase()}</p>}

          <div className="auth-submit">
            <ResultButton type="submit" primary>
              {busy ? <LoaderCircle size={14} className="menu-spin" /> : null}
              {deleting ? 'DELETE MY ACCOUNT' : 'SAVE'}
            </ResultButton>
          </div>
        </form>
      </section>
    </div>
  );
}
