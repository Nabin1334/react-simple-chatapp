import React, { useContext, useEffect, useState } from 'react';
import { Button, Typography } from '@material-ui/core';
import { FiberManualRecord, Videocam } from '@material-ui/icons';

import VideoPlayer from './components/VideoPlayer';
import Sidebar from './components/Sidebar';
import Notifications from './components/Notifications';
import { ContextProvider, SocketContext } from './Context';
import AuthPage from './components/AuthPage';
import ThemeToggle from './components/ThemeToggle';
import { useAuth } from './AuthContext';

function saveThemePreference(theme) {
  try {
    window.localStorage.setItem('kurakane-theme', theme);
  } catch (error) {
    if (error.name !== 'SecurityError' && error.name !== 'QuotaExceededError') {
      throw error;
    }
  }
}

function loadThemePreference() {
  try {
    return window.localStorage.getItem('kurakane-theme') === 'dark' ? 'dark' : 'light';
  } catch (error) {
    if (error.name === 'SecurityError') {
      return 'light';
    }
    throw error;
  }
}

const VideoChat = ({ user, theme, onToggleTheme }) => {
  const { me, callError } = useContext(SocketContext);
  const { logout, error } = useAuth();
  const [logoutError, setLogoutError] = useState('');

  const handleLogout = async () => {
    setLogoutError('');
    try {
      await logout();
    } catch (logoutRequestError) {
      setLogoutError(logoutRequestError.message);
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon"><Videocam /></span>
          <div>
            <Typography variant="h5" className="brand-title">Kurakane</Typography>
            <span className="brand-subtitle">A little closer, wherever you are</span>
          </div>
        </div>
        <div className="header-actions">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <div className={`connection-status${me ? ' is-connected' : ''}`} role="status">
            <FiberManualRecord />
            <span>{me ? 'Ready to connect' : 'Connecting…'}</span>
          </div>
          <span className="signed-in-name">{user.displayName}</span>
          <Button className="sign-out-button" variant="outlined" onClick={handleLogout}>Sign out</Button>
        </div>
      </header>

      {(logoutError || error || callError) && (
        <div className="app-error" role="alert">{logoutError || error || callError}</div>
      )}

      <section className="call-layout" aria-label="Video call">
        <div className="call-main">
          <div className="section-heading">
            <div>
              <Typography variant="h4" component="h1">Video call</Typography>
              <p>Start a call or share your ID so someone can reach you.</p>
            </div>
            <span className="local-badge">Invite-only calls</span>
          </div>
          <VideoPlayer />
          <Notifications />
        </div>

        <Sidebar />
      </section>
      <footer className="app-footer">Private, direct calls between you and the person you invite.</footer>
    </main>
  );
};

const App = () => {
  const { user, isLoading } = useAuth();
  const [theme, setTheme] = useState(loadThemePreference);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    saveThemePreference(theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'));
  };

  if (isLoading) {
    return <main className="auth-loading" role="status">Checking your sign-in…</main>;
  }

  if (!user) {
    return <AuthPage theme={theme} onToggleTheme={toggleTheme} />;
  }

  return (
    <ContextProvider userName={user.displayName}>
      <VideoChat user={user} theme={theme} onToggleTheme={toggleTheme} />
    </ContextProvider>
  );
};

export default App;
