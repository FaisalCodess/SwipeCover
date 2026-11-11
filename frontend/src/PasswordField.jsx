import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import './auth.css';

// A password box with an eye button that shows or hides what was typed.
export default function PasswordField({ label = 'PASSWORD', value, onChange, autoComplete, placeholder, autoFocus, maxLength = 128 }) {
  const [shown, setShown] = useState(false);
  return (
    <label className="auth-field">
      <span>{label}</span>
      <div className="auth-password">
        <input
          className="result-input"
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          maxLength={maxLength}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="auth-eye"
          onClick={() => setShown((current) => !current)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          title={shown ? 'Hide password' : 'Show password'}
        >
          {shown ? <EyeOff size={16} strokeWidth={1.6} /> : <Eye size={16} strokeWidth={1.6} />}
        </button>
      </div>
    </label>
  );
}
