import { Outlet } from 'react-router-dom';
import Header from './Header';
import Footer from './Footer';

function Layout({ isAuthenticated, playerName, onLogout }) {
  return (
    <div className="app-container">
      <Header 
        isAuthenticated={isAuthenticated} 
        playerName={playerName} 
        onLogout={onLogout}
      />
      <main className="main-content">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

export default Layout; 