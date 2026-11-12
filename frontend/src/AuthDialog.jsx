import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { BoardFrame } from './MainMenu.jsx';
import { ResultButton } from './ResultDialog.jsx';
import { cleanName, fetchConfig, logIn, logInWithGoogle, PASSWORD_MIN_LENGTH, register, requestPasswordReset, resetPassword } from './api.js';
import PasswordField from './PasswordField.jsx';
import './result.css';
import './auth.css';

let googleScript = null;

// Google's sign-in script, loaded the first time it is needed (and only when the server has a client id).
function loadGoogle() {
  googleScript ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // hl=en: the whole game is in English, so the button says "Continue with Google" whatever the browser's language.
    script.src = 'https://accounts.google.com/gsi/client?hl=en';
    script.async = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => {
      googleScript = null;
      reject(new Error('Google sign-in could not load.'));
    };
    document.head.appendChild(script);
  });
  return googleScript;
}

function GoogleButton({ clientId, onCredential }) {
  const holder = useRef(null);
  const latest = useRef(onCredential);
  latest.current = onCredential;

  useEffect(() => {
    let cancelled = false;
    loadGoogle()
      .then((google) => {
        if (cancelled || !holder.current) return;
        google.accounts.id.initialize({ client_id: clientId, callback: (response) => latest.current(response.credential) });
        // Google draws this button itself (in an iframe we cannot style), so match what we can: the width of
        // the dialog's own buttons, the game's language (see loadGoogle), and (in auth.css) its cut corners.
        const width = Math.min(400, Math.max(200, Math.round(holder.current.clientWidth) || 320));
        google.accounts.id.renderButton(holder.current, { theme: 'filled_black', size: 'large', shape: 'rectangular', text: 'continue_with', width });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return <div ref={holder} className="auth-google" />;
}

// Log in, sign up, or finish a first Google sign-in by choosing a username.
// `reason` says why it opened ("Log in to post your time"); `onSuccess(user)` runs once logged in.
// Forgot password: ask for the email, then (same dialog, same tab) type the 6-digit code from it
// together with a new password.
export default function AuthDialog({ reason, onClose, onSuccess, onLegal }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'username' | 'forgot' | 'reset'
  const [code, setCode] = useState('');
  const [resent, setResent] = useState(false);
  const [googleClientId, setGoogleClientId] = useState(null);
  const [canReset, setCanReset] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const googleCredential = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchConfig(controller.signal)
      .then((config) => {
        setGoogleClientId(config.google_client_id);
        setCanReset(Boolean(config.password_reset));
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(action) {
    setError('');
    setBusy(true);
    try {
      const outcome = await action();
      if (outcome?.needsUsername) {
        setEmail(outcome.email);
        setMode('username');
      } else if (outcome) {
        onSuccess(outcome);
      }
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (mode === 'forgot') {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email.trim())) return setError('That email does not look right.');
      return run(async () => {
        await requestPasswordReset(email.trim());
        setMode('reset');
        return null;
      });
    }
    if (mode === 'reset') {
      if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from the email.');
      if (password.length < PASSWORD_MIN_LENGTH) return setError(`Passwords need at least ${PASSWORD_MIN_LENGTH} characters.`);
      return run(() => resetPassword(email.trim(), code, password));
    }
    if (mode === 'login') {
      if (!identifier.trim() || !password) return setError('Enter your email or username and your password.');
      return run(() => logIn(identifier.trim(), password));
    }
    const cleaned = cleanName(username);
    if (!cleaned) return setError('Usernames are 3-16 letters, numbers, spaces, _ or -.');
    if (mode === 'username') return run(() => logInWithGoogle(googleCredential.current, cleaned));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email.trim())) return setError('That email does not look right.');
    if (password.length < PASSWORD_MIN_LENGTH) return setError(`Passwords need at least ${PASSWORD_MIN_LENGTH} characters.`);
    return run(() => register(email.trim(), cleaned, password));
  }

  function switchMode(next) {
    setMode(next);
    setError('');
    setResent(false);
    setCode('');
  }

  // "Send it again": a new code replaces the old one.
  async function sendAgain() {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setResent(true);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  const titles = { login: 'Log in', register: 'Create account', username: 'Pick a username', forgot: 'Forgot password', reset: 'New password' };

  return (
    <div
      className="result-overlay auth-overlay fade-in"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="result-panel auth-panel pop-in is-level" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <BoardFrame />
        <button type="button" className="auth-close" onClick={onClose} aria-label="Close">
          <X size={16} strokeWidth={1.6} />
        </button>
        <form className="result-body auth-body" onSubmit={submit} noValidate>
          <p className="result-kicker">{(reason || 'SWIPE COVER ACCOUNT').toUpperCase()}</p>
          <h2 id="auth-title" className="result-title">{titles[mode]}</h2>

          {mode === 'username' && <p className="auth-note">Signed in with Google as {email}. Choose the name other players will see.</p>}

          {mode === 'login' && (
            <label className="auth-field">
              <span>EMAIL OR USERNAME</span>
              <input className="result-input" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" autoFocus maxLength={254} />
            </label>
          )}
          {mode === 'forgot' && (
            <p className="auth-note">Enter the email you signed up with and we will send you a 6-digit code.</p>
          )}
          {mode === 'reset' && (
            <p className="auth-note">
              If {email.trim()} has an account, a 6-digit code is on its way. It can take a minute, so check your spam folder too. The code works once, for 15 minutes. Type it here with a new password and you will be logged in.
            </p>
          )}
          {mode === 'reset' && (
            <label className="auth-field">
              <span>6-DIGIT CODE</span>
              <input
                className="result-input"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                placeholder="123456"
              />
            </label>
          )}
          {(mode === 'register' || mode === 'forgot') && (
            <label className="auth-field">
              <span>EMAIL</span>
              <input className="result-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" autoFocus maxLength={254} />
            </label>
          )}
          {(mode === 'register' || mode === 'username') && (
            <label className="auth-field">
              <span>USERNAME</span>
              <input className="result-input" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="nickname" autoFocus={mode === 'username'} maxLength={16} placeholder="3–16 CHARACTERS" />
            </label>
          )}
          {(mode === 'login' || mode === 'register' || mode === 'reset') && (
            <PasswordField
              label={mode === 'reset' ? 'NEW PASSWORD' : 'PASSWORD'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={mode !== 'login' ? `AT LEAST ${PASSWORD_MIN_LENGTH} CHARACTERS` : ''}
            />
          )}
          {mode === 'login' && canReset && (
            <button type="button" className="auth-forgot" onClick={() => switchMode('forgot')}>FORGOT PASSWORD?</button>
          )}

          {error && (
            <p className="result-status is-rejected" role="alert"><TriangleAlert size={14} /> {error.toUpperCase()}</p>
          )}

          <div className="auth-submit">
            <ResultButton type="submit" primary>
              {busy ? <LoaderCircle size={14} className="menu-spin" /> : null}
              {{ login: 'LOG IN', register: 'CREATE ACCOUNT', forgot: 'SEND ME A CODE', reset: 'SAVE NEW PASSWORD' }[mode] || 'CONTINUE'}
            </ResultButton>
          </div>
          {mode === 'reset' && (
            <p className="auth-switch">
              {resent ? 'A NEW CODE WAS SENT. THE OLD ONE NO LONGER WORKS.' : <>NO EMAIL? <button type="button" onClick={sendAgain}>SEND IT AGAIN</button></>}
            </p>
          )}

          {googleClientId && (mode === 'login' || mode === 'register') && (
            <>
              <p className="auth-or"><span>OR</span></p>
              <GoogleButton
                clientId={googleClientId}
                onCredential={(credential) => {
                  googleCredential.current = credential;
                  run(() => logInWithGoogle(credential));
                }}
              />
            </>
          )}

          {mode === 'register' && (
            <p className="auth-legal">
              BY CONTINUING YOU AGREE TO THE <button type="button" onClick={() => onLegal?.('terms')}>TERMS</button> AND{' '}
              <button type="button" onClick={() => onLegal?.('privacy')}>PRIVACY POLICY</button>
            </p>
          )}

          {mode === 'login' && (
            <p className="auth-switch">NEW HERE? <button type="button" onClick={() => switchMode('register')}>CREATE AN ACCOUNT</button></p>
          )}
          {(mode === 'forgot' || mode === 'reset') && (
            <p className="auth-switch"><button type="button" onClick={() => switchMode('login')}>BACK TO LOG IN</button></p>
          )}
          {mode === 'register' && (
            <p className="auth-switch">HAVE AN ACCOUNT? <button type="button" onClick={() => switchMode('login')}>LOG IN</button></p>
          )}
        </form>
      </section>
    </div>
  );
}
