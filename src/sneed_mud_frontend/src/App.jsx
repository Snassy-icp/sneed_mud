import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { sneed_mud_backend } from 'declarations/sneed_mud_backend';
import { AuthClient } from "@dfinity/auth-client";
import { Principal } from '@dfinity/principal';
import { Actor, HttpAgent } from "@dfinity/agent";
import { idlFactory as mainIdlFactory } from "declarations/sneed_mud_backend/sneed_mud_backend.did.js";
import { idlFactory as stagingIdlFactory } from "declarations/sneed_mud_backend_staging/sneed_mud_backend_staging.did.js";
import Layout from './components/layout/Layout';
import LoginPage from './pages/LoginPage';
import CharacterRegistrationPage from './pages/CharacterRegistrationPage';
import GamePage from './pages/GamePage';
import config from './config.json';

// Get the environment from config
const isStaging = config.environment === 'staging';
const BACKEND_CANISTER_ID = config.backendCanisterId;
const idlFactory = isStaging ? stagingIdlFactory : mainIdlFactory;

console.log('Config:', config);
console.log('Environment detection:', {
  isStaging,
  BACKEND_CANISTER_ID,
});

console.log('Running on:', isStaging ? 'Staging' : 'Production');
console.log('Using backend:', BACKEND_CANISTER_ID);

function App() {
  const [principal, setPrincipal] = useState(null);
  const [authClient, setAuthClient] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [playerName, setPlayerName] = useState(null);
  const [authenticatedActor, setAuthenticatedActor] = useState(null);

  // Debug log whenever auth state changes
  useEffect(() => {
    console.log('Auth state changed:', {
      hasPrincipal: !!principal,
      hasAuthClient: !!authClient,
      isLoading,
      hasPlayerName: !!playerName,
      hasAuthenticatedActor: !!authenticatedActor
    });
  }, [principal, authClient, isLoading, playerName, authenticatedActor]);

  // Initialize auth client
  useEffect(() => {
    console.log('Initializing auth client...');
    AuthClient.create().then(async client => {
      console.log('Auth client created');
      setAuthClient(client);
      const isAuthenticated = await client.isAuthenticated();
      console.log('Initial auth check:', isAuthenticated);
      
      if (!isAuthenticated) {
        console.log('Not authenticated, clearing state');
        setPrincipal(null);
        setPlayerName(null);
        setAuthenticatedActor(null);
        setIsLoading(false);
        return;
      }

      try {
        const identity = client.getIdentity();
        const principalStr = identity.getPrincipal().toString();
        console.log('Got identity with principal:', principalStr);
        setPrincipal(principalStr);
        
        const agent = new HttpAgent({ identity });
        
        console.log('Creating actor with backend:', BACKEND_CANISTER_ID);
        const actor = Actor.createActor(idlFactory, {
          agent,
          canisterId: BACKEND_CANISTER_ID,
        });
        
        setAuthenticatedActor(actor);
        
        // Check player name
        const principalObj = Principal.fromText(principalStr);
        console.log('Fetching player name for principal:', principalObj.toString());
        const nameOpt = await actor.getPlayerName(principalObj);
        console.log('Player name response:', nameOpt);
        
        if (Array.isArray(nameOpt) && nameOpt.length > 0) {
          console.log('Setting player name to:', nameOpt[0]);
          setPlayerName(nameOpt[0]);
        } else {
          console.log('No player name found');
          setPlayerName(null);
        }
      } catch (error) {
        console.error("Error during authentication:", error);
        // Clear auth state on error
        setPrincipal(null);
        setPlayerName(null);
        setAuthenticatedActor(null);
      }
      
      setIsLoading(false);
    });
  }, []);

  // Add periodic auth check
  useEffect(() => {
    if (!authClient) return;

    const checkAuth = async () => {
      const isAuthenticated = await authClient.isAuthenticated();
      console.log('Periodic auth check:', isAuthenticated);
      if (!isAuthenticated) {
        console.log('No longer authenticated, clearing state');
        setPrincipal(null);
        setPlayerName(null);
        setAuthenticatedActor(null);
      }
    };

    const interval = setInterval(checkAuth, 5000); // Check every 5 seconds
    return () => clearInterval(interval);
  }, [authClient]);

  async function createAuthenticatedActor(identity) {
    const agent = new HttpAgent({ identity });
    // No need to fetch root key in production/staging
    return Actor.createActor(idlFactory, {
      agent,
      canisterId: BACKEND_CANISTER_ID,
    });
  }

  async function checkPlayerName() {
    if (!authenticatedActor) return;
    
    try {
      const principalObj = Principal.fromText(principal);
      const nameOpt = await authenticatedActor.getPlayerName(principalObj);
      
      if (Array.isArray(nameOpt) && nameOpt.length > 0) {
        setPlayerName(nameOpt[0]);
      } else {
        setPlayerName(null);
      }
    } catch (error) {
      console.error("Error checking player name:", error);
      setPlayerName(null);
    }
  }

  async function handleLogin() {
    try {
      await authClient.login();
      const identity = authClient.getIdentity();
      const principal = identity.getPrincipal().toString();
      setPrincipal(principal);
      const actor = await createAuthenticatedActor(identity);
      setAuthenticatedActor(actor);
      await actor.updateActivity(); // Update activity on login
    } catch (error) {
      console.error("Login error:", error);
    }
  }

  async function logout() {
    await authClient?.logout();
    setPrincipal(null);
    setPlayerName(null);
    setAuthenticatedActor(null);
  }

  // Render logic
  if (isLoading) {
    console.log('Rendering loading state');
    return <div>Loading...</div>;
  }

  console.log('Rendering main app with auth state:', {
    hasPrincipal: !!principal,
    hasPlayerName: !!playerName
  });

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout 
          isAuthenticated={!!principal}
          playerName={playerName}
          onLogout={logout}
          principal={principal}
        />}>
          <Route index element={<LoginPage 
            onLogin={handleLogin} 
            isAuthenticated={!!principal}
            isLoading={isLoading}
            playerName={playerName}
          />} />
          <Route path="/register" element={
            <CharacterRegistrationPage
              authenticatedActor={authenticatedActor}
              principal={principal}
              onNameSet={setPlayerName}
              onLogout={logout}
            />
          } />
          <Route path="/game" element={
            <GamePage
              isAuthenticated={!!principal}
              playerName={playerName}
              authenticatedActor={authenticatedActor}
              principal={principal}
            />
          } />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
