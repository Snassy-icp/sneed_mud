import { useState, useEffect } from 'react';
import { sneed_mud_backend } from 'declarations/sneed_mud_backend';
import { AuthClient } from "@dfinity/auth-client";
import { Principal } from '@dfinity/principal';
import { Actor, HttpAgent } from "@dfinity/agent";
import { idlFactory } from "declarations/sneed_mud_backend/sneed_mud_backend.did.js";

function App() {
  const [greeting, setGreeting] = useState('');
  const [principal, setPrincipal] = useState(null);
  const [authClient, setAuthClient] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [playerName, setPlayerName] = useState(null);
  const [registrationError, setRegistrationError] = useState(null);
  const [registrationSuccess, setRegistrationSuccess] = useState(null);
  const [authenticatedActor, setAuthenticatedActor] = useState(null);

  useEffect(() => {
    initAuth();
  }, []);

  async function createAuthenticatedActor(identity) {
    const agent = new HttpAgent({ identity });
    // When in development, we need to whitelist the local certificate
    if (process.env.DFX_NETWORK === "local" || process.env.DFX_NETWORK === undefined) {
      agent.fetchRootKey();
    }
    const actor = Actor.createActor(idlFactory, {
      agent,
      canisterId: process.env.CANISTER_ID_SNEED_MUD_BACKEND,
    });
    setAuthenticatedActor(actor);
    return actor;
  }

  async function initAuth() {
    const client = await AuthClient.create();
    setAuthClient(client);
    
    if (await client.isAuthenticated()) {
      const identity = client.getIdentity();
      const principalId = identity.getPrincipal().toString();
      setPrincipal(principalId);
      
      // Create authenticated actor
      const actor = await createAuthenticatedActor(identity);
      
      // Check name immediately after setting principal
      try {
        const principalObj = Principal.fromText(principalId);
        const nameOpt = await actor.getPlayerName(principalObj);
        if (nameOpt && Array.isArray(nameOpt) && nameOpt.length > 0) {
          setPlayerName(nameOpt[0]);
        }
      } catch (error) {
        console.error("Error checking initial player name:", error);
      }
    }
    setIsLoading(false);
  }

  async function checkPlayerName() {
    if (!authenticatedActor) return;
    
    try {
      const principalObj = Principal.fromText(principal);
      const nameOpt = await authenticatedActor.getPlayerName(principalObj);
      
      // We either get [name] or [] from the backend
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

  async function handleNameRegistration(event) {
    event.preventDefault();
    if (!authenticatedActor) return;

    setRegistrationError(null);
    setRegistrationSuccess(null);

    const name = event.target.elements.playerName.value;
    try {
      const result = await authenticatedActor.registerPlayerName(name);
      if ('ok' in result) {
        setRegistrationSuccess(result.ok);
        setPlayerName(name);
        event.target.reset();
      } else if ('err' in result) {
        setRegistrationError(result.err);
        const existingNameMatch = result.err.match(/You already have a name: (.*)/);
        if (existingNameMatch) {
          setPlayerName(existingNameMatch[1]);
        }
      }
    } catch (error) {
      setRegistrationError("Failed to register name: " + error.message);
    }
  }

  async function loginII() {
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
  
    const identity = authClient.getIdentity();
    const principal = identity.getPrincipal().toString();
    setPrincipal(principal);
    
    // Create authenticated actor after login
    const actor = await createAuthenticatedActor(identity);
    
    // Check for existing name
    try {
      const principalObj = Principal.fromText(principal);
      const nameOpt = await actor.getPlayerName(principalObj);
      if (Array.isArray(nameOpt) && nameOpt.length > 0) {
        setPlayerName(nameOpt[0]);
      }
    } catch (error) {
      console.error("Error checking player name after login:", error);
    }
  };

  async function logout() {
    await authClient?.logout();
    setPrincipal(null);
    setPlayerName(null);
    setAuthenticatedActor(null);
  };

  
  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <main>
      <img src="/logo2.svg" alt="DFINITY logo" />
      <br />
      <br />
      {principal ? (
        <button onClick={logout}>Logout</button>
      ) : (
        <button onClick={loginII}>Login</button>
      )}
      <div>
        {principal ? `Logged in as: ${principal}` : "Not logged in"}
      </div>

      {principal && !playerName && (
        <div className="name-registration">
          <h2>Register Your Character Name</h2>
          <form onSubmit={handleNameRegistration}>
            <input
              type="text"
              id="playerName"
              name="playerName"
              placeholder="Enter your character name"
              maxLength="20"
              required
            />
            <button type="submit">Register Name</button>
          </form>
          {registrationError && (
            <div className="error">{registrationError}</div>
          )}
          {registrationSuccess && (
            <div className="success">{registrationSuccess}</div>
          )}
        </div>
      )}

      {principal && playerName && (
        <div className="player-info">
          <h2>Welcome, {playerName}!</h2>
        </div>
      )}
    </main>
  );
}

export default App;
