import React, { useState } from 'react';
import { Videocam } from '@material-ui/icons';

import { useAuth } from '../AuthContext';
import ThemeToggle from './ThemeToggle';

const AuthPage = ({ theme, onToggleTheme }) => {
  const {
    error, login, signup, clearError,
  } = useAuth();
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const submitLabel = isSubmitting
    ? 'Please wait…'
    : ['Sign in', 'Create account'][Number(isSigningUp)];

  const handleSubmit = async (event) => {
    event.preventDefault();
    clearError();
    setLocalError('');
    setIsSubmitting(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = formData.get('email');
    const password = formData.get('password');
    let succeeded;

    try {
      if (isSigningUp) {
        const displayName = formData.get('displayName');
        const confirmPassword = formData.get('confirmPassword');
        if (password !== confirmPassword) {
          setLocalError('Those passwords do not match.');
          return;
        }
        succeeded = await signup({ displayName, email, password });
      } else {
        succeeded = await login({ email, password });
      }

      if (succeeded) {
        form.reset();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const changeMode = () => {
    clearError();
    setLocalError('');
    setIsSigningUp((currentMode) => !currentMode);
  };

  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="About Kurakane">
        <a className="auth-brand" href="/" aria-label="Kurakane home">
          <span className="brand-icon"><Videocam /></span>
          <span>Kurakane</span>
        </a>
        <div className="auth-story-copy">
          <span className="auth-eyebrow">Good conversations start here</span>
          <h1>Closer, even when you&apos;re apart.</h1>
          <p>Make a private video call with the people who matter, wherever life takes you.</p>
          <div className="auth-story-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
        <p className="auth-privacy-note">Your password is stored as a strong one-way hash, with private sign-in sessions.</p>
      </section>

      <section className="auth-form-area" aria-labelledby="auth-heading">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <div className="auth-card">
          <span className="auth-card-kicker">{isSigningUp ? 'Get started' : 'Welcome back'}</span>
          <h2 id="auth-heading">{isSigningUp ? 'Create your account' : 'Sign in to Kurakane'}</h2>
          <p className="auth-intro">
            {isSigningUp
              ? 'A few details, then you’re ready to connect.'
              : 'Sign in to pick up where your conversations left off.'}
          </p>

          {(error || localError) && (
            <div className="auth-error" role="alert">
              {localError || error}
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit}>
            {isSigningUp && (
              <label className="auth-field" htmlFor="display-name">
                <span>Your name</span>
                <input
                  id="display-name"
                  name="displayName"
                  type="text"
                  autoComplete="name"
                  maxLength="80"
                  placeholder="How should people know you?"
                  required
                />
              </label>
            )}
            <label className="auth-field" htmlFor="email">
              <span>Email address</span>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength="254"
                placeholder="you@example.com"
                required
              />
            </label>
            <label className="auth-field" htmlFor="password">
              <span>Password</span>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={isSigningUp ? 'new-password' : 'current-password'}
                minLength={isSigningUp ? '12' : undefined}
                maxLength="128"
                placeholder={isSigningUp ? 'At least 12 characters' : 'Enter your password'}
                required
              />
            </label>
            {isSigningUp && (
              <label className="auth-field" htmlFor="confirm-password">
                <span>Confirm password</span>
                <input
                  id="confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength="12"
                  maxLength="128"
                  placeholder="Enter your password again"
                  required
                />
              </label>
            )}
            <button className="auth-submit" type="submit" disabled={isSubmitting}>
              {submitLabel}
              {!isSubmitting && <span aria-hidden="true">→</span>}
            </button>
          </form>

          <div className="auth-switch">
            <span>{isSigningUp ? 'Already have an account?' : 'New to Kurakane?'}</span>
            <button type="button" onClick={changeMode}>
              {isSigningUp ? 'Sign in' : 'Create an account'}
            </button>
          </div>
          <p className="auth-terms">By continuing, you agree to use Kurakane respectfully and keep your sign-in details private.</p>
        </div>
      </section>
    </main>
  );
};

export default AuthPage;
