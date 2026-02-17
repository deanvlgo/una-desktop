import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import { LoginScreen } from './components/LoginScreen';
import { AuthProvider, useAuth } from './context/AuthContext';
import '../../../packages/hierarchy-widget/src/styles.css';
import './styles.css';

function Root() {
  const { token, user, isLoading, logout } = useAuth();

  if (isLoading) {
    return (
      <div className="app-boot">
        <p>Loading session...</p>
      </div>
    );
  }

  if (!token || !user) {
    return <LoginScreen />;
  }

  return <App currentUser={user} token={token} onLogout={logout} />;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </React.StrictMode>,
);
