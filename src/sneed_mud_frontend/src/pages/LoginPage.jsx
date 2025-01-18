import { Navigate } from 'react-router-dom';

function LoginPage({ isAuthenticated, isLoading, login, playerName }) {
  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (isAuthenticated) {
    return <Navigate to={playerName ? "/game" : "/register"} replace />;
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <h1>Welcome to Sneed MUD</h1>
        <p>Login with Internet Identity to begin your adventure</p>
        <button onClick={login} className="login-button">
          Login with Internet Identity
        </button>
      </div>
    </div>
  );
}

export default LoginPage; 