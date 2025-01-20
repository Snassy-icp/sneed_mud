import { Link } from 'react-router-dom';

function Header({ isAuthenticated, playerName, onLogout, principal }) {
  const copyPrincipal = () => {
    navigator.clipboard.writeText(principal);
  };

  // Function to compact principal ID - show first 5 and last 5 chars
  const compactPrincipal = (principal) => {
    if (principal.length <= 10) return principal;
    return `${principal.slice(0, 5)}...${principal.slice(-5)}`;
  };

  return (
    <header className="header">
      <div className="header-content">
        <h1>Sneed MUD</h1>
        {isAuthenticated && (
          <nav>
            {playerName ? (
              <>
                <span>Welcome, {playerName}!</span>
                <div className="principal-container">
                  Principal: <code onClick={copyPrincipal} title="Click to copy full ID">{compactPrincipal(principal)}</code>
                </div>
                <Link to="/game">Game</Link>
                <button onClick={onLogout}>Logout</button>
              </>
            ) : (
              <>
                <div className="principal-container">
                  Principal: <code onClick={copyPrincipal} title="Click to copy full ID">{compactPrincipal(principal)}</code>
                </div>
                <Link to="/register">Register Character</Link>
                <button onClick={onLogout}>Logout</button>
              </>
            )}
          </nav>
        )}
      </div>
      <style>{`
        .principal-container {
          display: inline-block;
          margin: 0 10px;
          color: #d4d4d4;
        }
        .principal-container code {
          background: #2d2d2d;
          padding: 2px 6px;
          border-radius: 4px;
          cursor: pointer;
          font-family: monospace;
          color: #e0e0e0;
        }
        .principal-container code:hover {
          background: #3d3d3d;
        }
      `}</style>
    </header>
  );
}

export default Header; 