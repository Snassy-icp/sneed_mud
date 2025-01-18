import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import Layout from './components/layout/Layout';
import LoginPage from './pages/LoginPage';
import CharacterRegistrationPage from './pages/CharacterRegistrationPage';
import GamePage from './pages/GamePage';

function App() {
  const {
    isLoading,
    isAuthenticated,
    principal,
    playerName,
    authenticatedActor,
    login,
    logout,
    setPlayerName
  } = useAuth();

  return (
    <BrowserRouter>
      <Routes>
        <Route 
          path="/" 
          element={
            <Layout 
              isAuthenticated={isAuthenticated}
              playerName={playerName}
              onLogout={logout}
            />
          }
        >
          <Route 
            index 
            element={<Navigate to={isAuthenticated ? (playerName ? "/game" : "/register") : "/login"} replace />} 
          />
          <Route 
            path="login" 
            element={
              <LoginPage 
                isAuthenticated={isAuthenticated}
                isLoading={isLoading}
                login={login}
                playerName={playerName}
              />
            } 
          />
          <Route 
            path="register" 
            element={
              <CharacterRegistrationPage 
                isAuthenticated={isAuthenticated}
                playerName={playerName}
                authenticatedActor={authenticatedActor}
                setPlayerName={setPlayerName}
              />
            } 
          />
          <Route 
            path="game" 
            element={
              <GamePage 
                isAuthenticated={isAuthenticated}
                playerName={playerName}
                authenticatedActor={authenticatedActor}
              />
            } 
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
