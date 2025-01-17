import { useState, useEffect } from 'react';
import { sneed_mud_backend } from 'declarations/sneed_mud_backend';
import { AuthClient } from "@dfinity/auth-client";
import { Principal } from '@dfinity/principal';
import { Actor, HttpAgent } from "@dfinity/agent";
import { idlFactory } from "declarations/sneed_mud_backend/sneed_mud_backend.did.js";
import TextLog from './components/TextLog';
import RoomInterface from './components/RoomInterface';

function App() {
  const [greeting, setGreeting] = useState('');
  const [principal, setPrincipal] = useState(null);
  const [authClient, setAuthClient] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [playerName, setPlayerName] = useState(null);
  const [registrationError, setRegistrationError] = useState(null);
  const [registrationSuccess, setRegistrationSuccess] = useState(null);
  const [authenticatedActor, setAuthenticatedActor] = useState(null);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [playersInRoom, setPlayersInRoom] = useState([]);
  const [lastMessageId, setLastMessageId] = useState(null);

  // Direction aliases mapping
  const DIRECTION_ALIASES = {
    'n': 'north',
    's': 'south',
    'e': 'east',
    'w': 'west',
    'ne': 'northeast',
    'nw': 'northwest',
    'se': 'southeast',
    'sw': 'southwest',
  };

  // Helper function to find matching exit
  function findMatchingExit(command, exits) {
    if (!exits || exits.length === 0) return null;
    
    const normalizedCommand = command.toLowerCase().trim();
    
    // Try to match against exitId, name, or direction
    const possibleMatches = exits.filter(([exitId, exit]) => {
      // Convert direction alias if it exists
      const directionAlias = DIRECTION_ALIASES[normalizedCommand];
      const normalizedDirection = exit.direction && exit.direction.length > 0 ? exit.direction[0].toLowerCase() : null;
      
      return (
        // Match by exitId (partial match allowed)
        exitId.toLowerCase().startsWith(normalizedCommand) ||
        // Match by name (partial match allowed)
        exit.name.toLowerCase().startsWith(normalizedCommand) ||
        // Match by full name (partial words allowed)
        exit.name.toLowerCase().split(' ').join(' ').startsWith(normalizedCommand) ||
        // Match by direction
        (normalizedDirection && (
          normalizedDirection === normalizedCommand ||
          (directionAlias && normalizedDirection === directionAlias)
        ))
      );
    });

    // If exactly one match is found, return it
    if (possibleMatches.length === 1) {
      return possibleMatches[0][0]; // Return the exitId
    }
    
    return null;
  }

  useEffect(() => {
    initAuth();
  }, []);

  useEffect(() => {
    if (authenticatedActor && playerName) {
      // Initial room and message fetch
      updateCurrentRoom();
      fetchMessages();
      
      // Set up polling intervals
      const roomInterval = setInterval(updateCurrentRoom, 5000);
      
      return () => {
        clearInterval(roomInterval);
      };
    }
  }, [authenticatedActor, playerName]);

  // Separate effect for message polling
  useEffect(() => {
    if (authenticatedActor && playerName) {
      const messageInterval = setInterval(fetchMessages, 1000);
      return () => clearInterval(messageInterval);
    }
  }, [authenticatedActor, playerName, lastMessageId]);

  async function fetchMessages() {
    try {
      // Convert lastMessageId to array format for Motoko
      const lastIdParam = lastMessageId === null ? [] : [lastMessageId];
      // console.log("Fetching messages after:", lastIdParam, "lastMessageId:", lastMessageId?.toString());
      
      const newMessages = await authenticatedActor.getMessages(lastIdParam);
      if (newMessages.length > 0) {
        // Sort messages by ID to ensure order
        newMessages.sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)));
        
        // Only add messages we haven't seen yet
        const currentLastId = lastMessageId === null ? -1n : lastMessageId;
        const uniqueNewMessages = newMessages.filter(msg => BigInt(msg.id) > currentLastId);
        
        if (uniqueNewMessages.length > 0) {
          setMessages(prev => [...prev, ...uniqueNewMessages.map(msg => msg.content)]);
          // Store the new ID directly as a BigInt
          const newLastId = BigInt(uniqueNewMessages[uniqueNewMessages.length - 1].id);
          if (newLastId > currentLastId) {  // Only update if we actually have a newer message
            // console.log("Updating lastMessageId from", currentLastId.toString(), "to", newLastId.toString());
            setLastMessageId(newLastId);
          }
        }
      }
    } catch (error) {
      console.error("Error fetching messages:", error);
    }
  }

  async function updateCurrentRoom() {
    try {
      const result = await authenticatedActor.getCurrentRoom();
      if ('ok' in result) {
        const room = result.ok;
        
        // Get players in room
        const playersResult = await authenticatedActor.getPlayersInRoom(room.id);
        if ('ok' in playersResult) {
          setPlayersInRoom(playersResult.ok);
        }
        // Only update the current room after we've handled the messaging logic
        setCurrentRoom(room);
      }
    } catch (error) {
      console.error("Error updating room:", error);
    }
  }

  async function handleCommand(command) {
    // Handle create exit command (/create_exit)
    if (command.toLowerCase().startsWith('/create_exit ')) {
      if (!currentRoom) {
        setMessages(prev => [...prev, "Error: You must be in a room to create an exit"]);
        return;
      }

      const argsString = command.substring(command.indexOf(' ') + 1).trim();
      
      // Try to parse the quoted arguments and target room ID
      try {
        // Match three quoted strings followed by a number and optionally a quoted direction
        const matches = argsString.match(/"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*(\d+)(?:\s*,\s*"([^"]*)"\s*)?/);
        if (!matches) {
          setMessages(prev => [...prev, "Error: Create exit command format is '/create_exit \"Exit ID\", \"Exit Name\", \"Exit Description\", target_room_id[, \"direction\"]'"]);
          return;
        }
        
        const [_, exitId, name, description, targetRoomId, direction] = matches;
        
        try {
          const result = await authenticatedActor.addExit(
            currentRoom.id,
            exitId,
            name,
            description,
            parseInt(targetRoomId),
            direction ? [direction] : [] // Convert to optional array for Motoko
          );
          
          if ('ok' in result) {
            setMessages(prev => [...prev, `Successfully created exit '${name}' (ID: ${exitId}) to room ${targetRoomId}`]);
            // Update the room to show the new exit
            await updateCurrentRoom();
          } else if ('err' in result) {
            setMessages(prev => [...prev, `Error: ${result.err}`]);
          }
        } catch (error) {
          console.error("Error creating exit:", error);
          setMessages(prev => [...prev, `Error: Failed to create exit - ${error.message || 'Unknown error'}`]);
        }
      } catch (error) {
        setMessages(prev => [...prev, "Error: Invalid command format. Use '/create_exit \"Exit ID\", \"Exit Name\", \"Exit Description\", target_room_id[, \"direction\"]'"]);
      }
      return;
    }

    // Handle create room command (/create_room)
    if (command.toLowerCase().startsWith('/create_room ')) {
      const argsString = command.substring(command.indexOf(' ') + 1).trim();
      
      // Try to parse the quoted arguments
      try {
        const matches = argsString.match(/"([^"]*)"\s*,\s*"([^"]*)"/);
        if (!matches || matches.length < 3) {
          setMessages(prev => [...prev, "Error: Create room command format is '/create_room \"Room Name\", \"Room Description\"'"]);
          return;
        }
        
        const [_, name, description] = matches;
        try {
          const result = await authenticatedActor.createRoom(name, description);
          if ('ok' in result) {
            setMessages(prev => [...prev, `Successfully created room ${name} with ID ${result.ok}`]);
          } else if ('err' in result) {
            setMessages(prev => [...prev, `Error: ${result.err}`]);
          }
        } catch (error) {
          console.error("Error creating room:", error);
          setMessages(prev => [...prev, `Error: Failed to create room - ${error.message || 'Unknown error'}`]);
        }
      } catch (error) {
        setMessages(prev => [...prev, "Error: Invalid command format. Use '/create_room \"Room Name\", \"Room Description\"'"]);
      }
      return;
    }

    // Handle say commands (/say or /s)
    if (command.toLowerCase().startsWith('/say ') || command.toLowerCase().startsWith('/s ')) {
      const message = command.substring(command.indexOf(' ') + 1).trim();
      if (message) {
        try {
          const result = await authenticatedActor.say(message);
          if ('err' in result) {
            setMessages(prev => [...prev, `Error: ${result.err}`]);
          }
        } catch (error) {
          console.error("Error saying message:", error);
          setMessages(prev => [...prev, `Error: Failed to say message - ${error.message || 'Unknown error'}`]);
        }
      }
      return;
    }

    // Handle whisper commands (/whisper or /w)
    if (command.toLowerCase().startsWith('/whisper ') || command.toLowerCase().startsWith('/w ')) {
      const parts = command.substring(command.indexOf(' ') + 1).trim().split(' ');
      if (parts.length >= 2) {
        const targetName = parts[0];
        const message = parts.slice(1).join(' ');
        try {
          const result = await authenticatedActor.whisper(targetName, message);
          if ('err' in result) {
            setMessages(prev => [...prev, `Error: ${result.err}`]);
          }
        } catch (error) {
          console.error("Error whispering message:", error);
          setMessages(prev => [...prev, `Error: Failed to whisper message - ${error.message || 'Unknown error'}`]);
        }
      } else {
        setMessages(prev => [...prev, "Error: Whisper command format is '/w <player> <message>'"]);
      }
      return;
    }

    // Handle movement commands (/go or /g)
    if (command.toLowerCase().startsWith('/go ') || command.toLowerCase().startsWith('/g ')) {
      const exitCommand = command.substring(command.indexOf(' ') + 1).trim();
      
      // Find matching exit
      const matchingExitId = findMatchingExit(exitCommand, currentRoom?.exits);
      
      if (!matchingExitId) {
        setMessages(prev => [...prev, `No matching exit found for '${exitCommand}'`]);
        return;
      }

      try {
        console.log("Attempting to use exit:", matchingExitId);
        const result = await authenticatedActor.useExit(matchingExitId);
        if ('ok' in result) {
          console.log("Successfully used exit");
          // First update messages to get the exit messages
          await fetchMessages();
          // Then update room state
          await updateCurrentRoom();
        } else if ('err' in result) {
          console.error("Error using exit:", result.err);
          // Add error message to the game log
          setMessages(prev => [...prev, `Error: ${result.err}`]);
        }
      } catch (error) {
        console.error("Error executing command:", error);
        // Add error message to the game log
        setMessages(prev => [...prev, `Error: Failed to use exit - ${error.message || 'Unknown error'}`]);
      }
      return;
    }

    // If no command matched, show error
    setMessages(prev => [...prev, `Unknown command: ${command}. Available commands: /say (/s), /whisper (/w), /go (/g), /create_room "name", "desc", /create_exit "id", "name", "desc", target_id[, "dir"]`]);
  }

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
    <main className="game-container">
      <div className="auth-section">
        {principal ? (
          <button onClick={logout}>Logout</button>
        ) : (
          <button onClick={loginII}>Login</button>
        )}
        <div>
          {principal ? `Logged in as: ${principal}` : "Not logged in"}
        </div>
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
        <div className="game-interface">
          <div className="player-info">
            <h2>Welcome, {playerName}!</h2>
            {currentRoom && (
              <div className="current-room">
                <h3>{currentRoom.name}</h3>
                <p>{currentRoom.description}</p>
              </div>
            )}
          </div>
          <TextLog messages={messages} />
          <RoomInterface 
            onCommand={handleCommand}
            currentRoom={currentRoom}
          />
          {/* Debug display */}
          <div style={{display: 'none'}}>
            <p>Message count: {messages.length}</p>
            <p>Last message ID: {lastMessageId}</p>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
