import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
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

function AppContent() {
  const navigate = useNavigate();
  const [authClient, setAuthClient] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [principal, setPrincipal] = useState(null);
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
    AuthClient.create().then(async (client) => {
      console.log('Auth client created');
      setAuthClient(client);
      const isAuthenticated = await client.isAuthenticated();
      console.log('Initial auth check:', isAuthenticated);
      
      if (isAuthenticated) {
        const identity = client.getIdentity();
        const principal = identity.getPrincipal().toString();
        console.log('Got identity with principal:', principal);
        setPrincipal(principal);
        
        try {
          // Create actor using the helper function
          const actor = await createAuthenticatedActor(identity);
          setAuthenticatedActor(actor);
          
          // Check player name
          await checkPlayerName(actor, principal);
        } catch (error) {
          console.error("Error initializing authenticated actor:", error);
          // Clear state on error
          setPrincipal(null);
          setPlayerName(null);
          setAuthenticatedActor(null);
        }
      } else {
        console.log('Not authenticated, clearing state');
        setPrincipal(null);
        setPlayerName(null);
        setAuthenticatedActor(null);
      }
      
      setIsLoading(false);
    }).catch(error => {
      console.error("Error creating auth client:", error);
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
    // Configure host based on environment
    const host = process.env.DFX_NETWORK === "ic" ? "https://icp0.io" : undefined;
    const agent = new HttpAgent({ 
      identity,
      host 
    });
    
    // Fetch root key only in development/local environment
    if (process.env.DFX_NETWORK !== "ic") {
      await agent.fetchRootKey();
    }

    return Actor.createActor(idlFactory, {
      agent,
      canisterId: BACKEND_CANISTER_ID,
    });
  }

  async function checkPlayerName(actor, principalStr) {
    if (!actor) return;
    
    try {
      const principalObj = Principal.fromText(principalStr);
      const nameOpt = await actor.getPlayerName(principalObj);
      
      if (Array.isArray(nameOpt) && nameOpt.length > 0) {
        setPlayerName(nameOpt[0]);
        navigate('/game');
      } else {
        setPlayerName(null);
        navigate('/register');
      }
    } catch (error) {
      console.error("Error checking player name:", error);
      setPlayerName(null);
      navigate('/register');
    }
  }

  async function handleLogin() {
    try {
      const iiUrl = process.env.DFX_NETWORK === "ic" 
        ? "https://identity.ic0.app/#authorize" 
        : `http://localhost:4943?canisterId=${process.env.CANISTER_ID_INTERNET_IDENTITY}#authorize`;

      await new Promise((resolve, reject) => {
        authClient.login({
          identityProvider: iiUrl,
          maxTimeToLive: BigInt(7 * 24 * 60 * 60 * 1000 * 1000 * 1000), // 7 days in nanoseconds
          onSuccess: async () => {
            try {
              const identity = authClient.getIdentity();
              const principal = identity.getPrincipal().toString();
              setPrincipal(principal);
              
              // Create actor using the helper function
              const actor = await createAuthenticatedActor(identity);
              setAuthenticatedActor(actor);
              
              // Check if player has a name
              const principalObj = Principal.fromText(principal);
              const nameOpt = await actor.getPlayerName(principalObj);
              if (Array.isArray(nameOpt) && nameOpt.length > 0) {
                setPlayerName(nameOpt[0]);
                navigate('/game');
              } else {
                setPlayerName(null);
                navigate('/register');
              }
              
              resolve();
            } catch (error) {
              console.error("Error in login flow:", error);
              reject(error);
            }
          },
          onError: (error) => {
            console.error("Login error:", error);
            reject(error);
          }
        });
      });
    } catch (error) {
      console.error("Login error:", error);
      // Clear state on error
      setPrincipal(null);
      setPlayerName(null);
      setAuthenticatedActor(null);
    }
  }

  async function logout() {
    if (authenticatedActor) {
      try {
        await authenticatedActor.logout();
      } catch (error) {
        console.error("Error during logout:", error);
      }
    }
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
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
