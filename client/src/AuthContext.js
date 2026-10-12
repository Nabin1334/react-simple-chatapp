import React, { createContext, useContext, useEffect, useState } from 'react';

const AuthContext = createContext(null);

async function requestAuth(path, body) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) {
    return {};
  }

  let result = {};
  try {
    result = await response.json();
  } catch {
    if (response.ok) {
      throw new Error('The server returned an invalid response.');
    }
  }

  if (!response.ok) {
    throw new Error(result.error || 'Unable to complete your request.');
  }
  return result;
}

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;
    requestAuth('/auth/me')
      .then((result) => {
        if (isMounted) {
          setUser(result.user);
        }
      })
      .catch((requestError) => {
        if (isMounted && requestError.message !== 'Authentication required.') {
          setError(requestError.message);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const authenticate = async (path, credentials) => {
    setError('');
    try {
      const result = await requestAuth(path, credentials);
      setUser(result.user);
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    }
  };

  const login = (credentials) => authenticate('/auth/login', credentials);
  const signup = (credentials) => authenticate('/auth/signup', credentials);

  const logout = async () => {
    setError('');
    try {
      await requestAuth('/auth/logout', {});
      setUser(null);
    } catch (requestError) {
      setError(requestError.message);
      throw requestError;
    }
  };

  const clearError = () => setError('');

  return (
    <AuthContext.Provider value={{
      user, isLoading, error, login, signup, logout, clearError,
    }}
    >
      {children}
    </AuthContext.Provider>
  );
};

const useAuth = () => useContext(AuthContext);

export { AuthProvider, useAuth };
