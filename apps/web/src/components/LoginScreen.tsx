import { useState } from 'react';

import { useAuth } from '../context/AuthContext';

export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-title-wrap">
          <p className="login-kicker">Una Desktop</p>
          <h1 className="login-title">Log in to continue</h1>
          <p className="login-subtitle">Use your Una account to access organization-scoped collections.</p>
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
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              disabled={isSubmitting}
            />
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
