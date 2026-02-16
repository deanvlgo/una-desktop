import { useState } from 'react';

import { useAuth } from '../context/AuthContext';
import historiqLogo from '../assets/historiq-logo.svg';

export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  const EyeIcon = ({ isOpen }: { isOpen: boolean }) => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {isOpen ? (
        <>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M17.94 17.94A10.9 10.9 0 0 1 12 19c-6.5 0-10-7-10-7a20.7 20.7 0 0 1 5.06-6.88" />
          <path d="M9.9 4.24A10.7 10.7 0 0 1 12 4c6.5 0 10 8 10 8a20.8 20.8 0 0 1-3.17 4.6" />
          <path d="M14.12 14.12a3 3 0 0 1-4.24-4.24" />
          <path d="M1 1l22 22" />
        </>
      )}
    </svg>
  );

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-title-wrap">
          <img src={historiqLogo} alt="Historiq" className="login-logo" />
        </div>

        {error ? <p className="login-error">{error}</p> : null}
        <form className="login-form" onSubmit={onSubmit}>
          <label className="login-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@organization.org"
              disabled={isSubmitting}
            />
          </label>

          <label className="login-field">
            <span>Password</span>
            <div className="login-password-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                disabled={isSubmitting}
              />
              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setShowPassword((s) => !s)}
                disabled={isSubmitting}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <EyeIcon isOpen={showPassword} />
              </button>
            </div>
          </label>

          <button
            type="submit"
            className="login-submit"
            disabled={isSubmitting || email.trim().length === 0 || password.length === 0}
          >
            {isSubmitting ? 'Logging in...' : 'Log In'}
          </button>
        </form>
      </section>
    </main>
  );
}
