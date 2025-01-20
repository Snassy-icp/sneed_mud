import { useState, useEffect } from 'react';
import { AuthClient } from "@dfinity/auth-client";
import { Actor, HttpAgent } from "@dfinity/agent";
import { Principal } from '@dfinity/principal';
import { idlFactory as mainIdlFactory } from "declarations/sneed_mud_backend/sneed_mud_backend.did.js";
import { idlFactory as stagingIdlFactory } from "declarations/sneed_mud_backend_staging/sneed_mud_backend_staging.did.js";
import config from '../config.json';

const isStaging = config.environment === 'staging';
const idlFactory = isStaging ? stagingIdlFactory : mainIdlFactory;

export function useAuth() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [principal, setPrincipal] = useState(null);
  const [playerName, setPlayerName] = useState(null);
  const [authClient, setAuthClient] = useState(null);
  const [authenticatedActor, setAuthenticatedActor] = useState(null);

  useEffect(() => {
    initAuth();
  }, []);

  async function createAuthenticatedActor(identity) {
    const agent = new HttpAgent({ identity });
    if (process.env.DFX_NETWORK === "local" || process.env.DFX_NETWORK === undefined) {
      agent.fetchRootKey();
    }
    
    // Ensure the identity is still valid
    if (!authClient.isAuthenticated()) {
      throw new Error("Session expired");
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
      try {
        const identity = client.getIdentity();
        const principalId = identity.getPrincipal().toString();
        setPrincipal(principalId);
        setIsAuthenticated(true);
        
        const actor = await createAuthenticatedActor(identity);
        
        try {
          const principalObj = Principal.fromText(principalId);
          const nameOpt = await actor.getPlayerName(principalObj);
          if (nameOpt && Array.isArray(nameOpt) && nameOpt.length > 0) {
            setPlayerName(nameOpt[0]);
          }
        } catch (error) {
          console.error("Error checking initial player name:", error);
          // If we get a signature error, try to re-authenticate
          if (error.toString().includes("Invalid signature")) {
            console.log("Session expired, logging out...");
            await logout();
          }
        }
      } catch (error) {
        console.error("Error during authentication:", error);
        // Clear invalid auth state
        await logout();
      }
    }
    setIsLoading(false);
  }

  async function login() {
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
    setIsAuthenticated(true);
    
    const actor = await createAuthenticatedActor(identity);
    
    try {
      const principalObj = Principal.fromText(principal);
      const nameOpt = await actor.getPlayerName(principalObj);
      if (Array.isArray(nameOpt) && nameOpt.length > 0) {
        setPlayerName(nameOpt[0]);
        await actor.updateActivity();  // Update activity status when logged in with existing name
      }
    } catch (error) {
      console.error("Error checking player name after login:", error);
    }
  }

  async function logout() {
    if (authenticatedActor) {
      try {
        await authenticatedActor.logout();
      } catch (error) {
        console.error("Error during backend logout:", error);
      }
    }
    await authClient?.logout();
    setPrincipal(null);
    setPlayerName(null);
    setAuthenticatedActor(null);
    setIsAuthenticated(false);
  }

  return {
    isLoading,
    isAuthenticated,
    principal,
    playerName,
    authenticatedActor,
    login,
    logout,
    setPlayerName
  };
} 