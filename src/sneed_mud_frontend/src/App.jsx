import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { sneed_mud_backend } from 'declarations/sneed_mud_backend';
import { AuthClient } from "@dfinity/auth-client";
import { Principal } from '@dfinity/principal';
import { Actor, HttpAgent } from "@dfinity/agent";
import { idlFactory } from "declarations/sneed_mud_backend/sneed_mud_backend.did.js";
import Layout from './components/layout/Layout';
import LoginPage from './pages/LoginPage';
import CharacterRegistrationPage from './pages/CharacterRegistrationPage';
import GamePage from './pages/GamePage';

function App() {
  const [principal, setPrincipal] = useState(null);
  const [authClient, setAuthClient] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [playerName, setPlayerName] = useState(null);
  const [authenticatedActor, setAuthenticatedActor] = useState(null);

  // Initialize auth client
  useEffect(() => {
    AuthClient.create().then(async client => {
      setAuthClient(client);
      const isAuthenticated = await client.isAuthenticated();
      
      if (!isAuthenticated) {
        // Clear all auth state if not authenticated
        setPrincipal(null);
        setPlayerName(null);
        setAuthenticatedActor(null);
        setIsLoading(false);
        return;
      }

      try {
        const identity = client.getIdentity();
        const principalStr = identity.getPrincipal().toString();
        setPrincipal(principalStr);
        
        const agent = new HttpAgent({ identity });
        if (process.env.NODE_ENV !== "production") {
          await agent.fetchRootKey();
        }
        
        const actor = Actor.createActor(idlFactory, {
          agent,
          canisterId: process.env.CANISTER_ID_SNEED_MUD_BACKEND,
        });
        
        setAuthenticatedActor(actor);
        
        // Check player name
        const principalObj = Principal.fromText(principalStr);
        const nameOpt = await actor.getPlayerName(principalObj);
        if (Array.isArray(nameOpt) && nameOpt.length > 0) {
          setPlayerName(nameOpt[0]);
        } else {
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
      if (!isAuthenticated) {
        // Clear auth state if no longer authenticated
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
    if (process.env.NODE_ENV !== "production") {
      await agent.fetchRootKey();
    }
    return Actor.createActor(idlFactory, {
      agent,
      canisterId: process.env.CANISTER_ID_SNEED_MUD_BACKEND,
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

  async function loginII() {
    if (!authClient) return;

    try {
      const iiUrl = process.env.DFX_NETWORK === "ic" 
        ? "https://identity.ic0.app/#authorize" 
        : `http://localhost:4943?canisterId=${process.env.CANISTER_ID_INTERNET_IDENTITY}#authorize`;
    
      await new Promise((resolve, reject) => {
        authClient.login({
          identityProvider: iiUrl,
          onSuccess: resolve,
          onError: reject,
        });
      });
    
      const isAuthenticated = await authClient.isAuthenticated();
      if (!isAuthenticated) {
        throw new Error("Authentication failed");
      }

      const identity = authClient.getIdentity();
      const principalStr = identity.getPrincipal().toString();
      setPrincipal(principalStr);
      
      const agent = new HttpAgent({ identity });
      if (process.env.NODE_ENV !== "production") {
        await agent.fetchRootKey();
      }
      
      const actor = Actor.createActor(idlFactory, {
        agent,
        canisterId: process.env.CANISTER_ID_SNEED_MUD_BACKEND,
      });
      
      setAuthenticatedActor(actor);
      
      const principalObj = Principal.fromText(principalStr);
      const nameOpt = await actor.getPlayerName(principalObj);
      if (Array.isArray(nameOpt) && nameOpt.length > 0) {
        setPlayerName(nameOpt[0]);
      } else {
        setPlayerName(null);
      }
    } catch (error) {
      console.error("Login failed:", error);
      // Clear all auth state on error
      setPrincipal(null);
      setPlayerName(null);
      setAuthenticatedActor(null);
      throw error;
    }
  }

  async function logout() {
    await authClient?.logout();
    setPrincipal(null);
    setPlayerName(null);
    setAuthenticatedActor(null);
  }

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout isAuthenticated={!!principal} playerName={playerName} onLogout={logout} />}>
          <Route index element={<LoginPage isAuthenticated={!!principal} isLoading={isLoading} login={loginII} playerName={playerName} />} />
          <Route path="login" element={<LoginPage isAuthenticated={!!principal} isLoading={isLoading} login={loginII} playerName={playerName} />} />
          <Route path="register" element={<CharacterRegistrationPage isAuthenticated={!!principal} playerName={playerName} authenticatedActor={authenticatedActor} setPlayerName={setPlayerName} />} />
          <Route path="game" element={<GamePage isAuthenticated={!!principal} playerName={playerName} authenticatedActor={authenticatedActor} principal={principal} />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
