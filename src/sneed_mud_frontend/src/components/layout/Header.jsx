import { Link } from 'react-router-dom';

function Header({ isAuthenticated, playerName, onLogout }) {
  return (
    <header className="header">
      <div className="header-content">
        <h1>Sneed MUD</h1>
        {isAuthenticated && (
          <nav>
            {playerName ? (
              <>
                <span>Welcome, {playerName}!</span>
                <Link to="/game">Game</Link>
                <button onClick={onLogout}>Logout</button>
              </>
            ) : (
              <>
                <Link to="/register">Register Character</Link>
                <button onClick={onLogout}>Logout</button>
              </>
            )}
          </nav>
        )}
      </div>
    </header>
  );
}

export default Header; 