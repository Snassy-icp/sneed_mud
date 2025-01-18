import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import TextLog from '../components/game/TextLog';
import RoomInterface from '../components/game/RoomInterface';

function GamePage({ isAuthenticated, playerName, authenticatedActor }) {
  const [currentRoom, setCurrentRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [playersInRoom, setPlayersInRoom] = useState([]);
  const [lastMessageId, setLastMessageId] = useState(null);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!playerName) {
    return <Navigate to="/register" replace />;
  }

  // Helper functions
  function createItemSubaccount(itemId) {
    const bytes = new Array(32).fill(0);
    bytes[0] = 32;
    bytes[1] = 2;
    let n = BigInt(itemId);
    let pos = 2;
    while (n > 0n) {
      bytes[pos++] = Number(n & 0xFFn);
      n = n >> 8n;
    }
    return bytes;
  }

  function createRoomSubaccount(roomId) {
    const bytes = new Uint8Array(32);
    bytes[0] = 32;
    bytes[1] = 1;
    let n = BigInt(roomId);
    let pos = 2;
    while (n > 0n) {
      bytes[pos++] = Number(n & 0xFFn);
      n >>= 8n;
    }
    return bytes;
  }

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
        exitId.toLowerCase().startsWith(normalizedCommand) ||
        exit.name.toLowerCase().startsWith(normalizedCommand) ||
        exit.name.toLowerCase().split(' ').join(' ').startsWith(normalizedCommand) ||
        (normalizedDirection && (
          normalizedDirection === normalizedCommand ||
          (directionAlias && normalizedDirection === directionAlias)
        ))
      );
    });

    if (possibleMatches.length === 1) {
      return possibleMatches[0][0];
    }
    return null;
  }

  // Helper function to get item type name
  async function getItemTypeName(typeId) {
    try {
      const result = await authenticatedActor.getItemType(typeId);
      if ('ok' in result) {
        return result.ok.name;
      }
      return `Unknown Type ${typeId}`;
    } catch (error) {
      console.error("Error getting item type name:", error);
      return `Unknown Type ${typeId}`;
    }
  }

  // Helper function to find matching item
  async function findMatchingItem(partialName, inventoryOnly = false) {
    try {
      const inventoryResult = await authenticatedActor.getItems();
      if ('ok' in inventoryResult) {
        const items = inventoryResult.ok;
        const normalizedSearch = partialName.toLowerCase().trim();
        
        for (const item of items) {
          const itemTypeName = item.item_type.name.toLowerCase();
          if (itemTypeName.startsWith(normalizedSearch)) {
            return { id: BigInt(item.id), name: item.item_type.name };
          }
        }
      }

      if (!inventoryOnly && currentRoom) {
        const roomItemsResult = await authenticatedActor.getRoomItems(currentRoom.id);
        if ('ok' in roomItemsResult) {
          const items = roomItemsResult.ok;
          const normalizedSearch = partialName.toLowerCase().trim();
          
          const matches = items.filter(item => {
            const itemTypeName = item.item_type.name.toLowerCase();
            return itemTypeName.startsWith(normalizedSearch);
          });

          if (matches.length > 0) {
            return { id: BigInt(matches[0].id), name: matches[0].item_type.name };
          }
        }
      }

      throw new Error(`No item found matching '${partialName}'`);
    } catch (error) {
      throw error;
    }
  }

  // Helper function to format stats
  function formatStats(stats) {
    const level = Number(stats.base.level);
    const nextLevelXp = level === 1 ? 2000 : 
      Math.floor(55.6 * (level ** 2) - (471.2 * level) + 5256.5);
    const xpNeeded = nextLevelXp - Number(stats.dynamic.xp);
    
    return `Level: ${level}\n` +
           `HP: ${Number(stats.dynamic.hp)}/${Number(stats.base.maxHp)}\n` +
           `MP: ${Number(stats.dynamic.mp)}/${Number(stats.base.maxMp)}\n` +
           `XP: ${Number(stats.dynamic.xp)}/${nextLevelXp} (${xpNeeded} more needed for next level)`;
  }

  async function handleCommand(command) {
    try {
      // Handle movement commands (/go or /g)
      if (command.toLowerCase().startsWith('/go ') || command.toLowerCase().startsWith('/g ')) {
        const exitCommand = command.substring(command.indexOf(' ') + 1).trim();
        const matchingExitId = findMatchingExit(exitCommand, currentRoom?.exits);
        
        if (!matchingExitId) {
          setMessages(prev => [...prev, `No matching exit found for '${exitCommand}'`]);
          return;
        }

        try {
          const result = await authenticatedActor.useExit(matchingExitId);
          if ('ok' in result) {
            await updateCurrentRoom();
          } else if ('err' in result) {
            setMessages(prev => [...prev, `Error: ${result.err}`]);
          }
        } catch (error) {
          console.error("Error executing command:", error);
          setMessages(prev => [...prev, `Error: Failed to use exit - ${error.message || 'Unknown error'}`]);
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

      // Handle look command (/look)
      if (command.toLowerCase() === '/look' || command.toLowerCase() === '/l') {
        if (!currentRoom) {
          setMessages(prev => [...prev, "You can't see anything."]);
          return;
        }

        const roomMessages = [
          `${currentRoom.name}`,
          currentRoom.description,
          ""
        ];

        if (playersInRoom.length > 0) {
          const otherPlayers = playersInRoom.filter(([_, name]) => name !== playerName);
          if (otherPlayers.length > 0) {
            roomMessages.push("You see:");
            otherPlayers.forEach(([_, name]) => {
              roomMessages.push(`  ${name} is here.`);
            });
            roomMessages.push("");
          }
        }

        const itemsResult = await authenticatedActor.getRoomItems(currentRoom.id);
        if ('ok' in itemsResult) {
          const items = itemsResult.ok;
          if (items.length > 0) {
            roomMessages.push("You also see:");
            items.forEach(item => {
              const countStr = item.count > 1 ? ` (x${item.count})` : '';
              roomMessages.push(`  ${item.item_type.name}${countStr}`);
            });
            roomMessages.push("");
          }
        }

        if (currentRoom.exits && currentRoom.exits.length > 0) {
          roomMessages.push("Obvious exits:");
          currentRoom.exits.forEach(([_, exit]) => {
            const directionStr = exit.direction ? ` (${exit.direction})` : '';
            roomMessages.push(`  ${exit.name}${directionStr}`);
          });
        } else {
          roomMessages.push("There are no obvious exits.");
        }

        setMessages(prev => [...prev, ...roomMessages]);
        return;
      }

      // Handle stats command
      if (command === '/stats') {
        const result = await authenticatedActor.getStats();
        if ('ok' in result) {
          setMessages(prev => [...prev, formatStats(result.ok)]);
          return;
        } else {
          throw new Error(result.err);
        }
      }

      // If no command matched, show error
      setMessages(prev => [...prev, "Unknown command. Type /help for available commands."]);
    } catch (error) {
      setMessages(prev => [...prev, "Error: " + error.message]);
    }
  }

  useEffect(() => {
    if (authenticatedActor && playerName) {
      updateCurrentRoom();
      fetchMessages();
      const roomInterval = setInterval(updateCurrentRoom, 5000);
      return () => clearInterval(roomInterval);
    }
  }, [authenticatedActor, playerName]);

  useEffect(() => {
    if (authenticatedActor && playerName) {
      const messageInterval = setInterval(fetchMessages, 1000);
      return () => clearInterval(messageInterval);
    }
  }, [authenticatedActor, playerName, lastMessageId]);

  async function fetchMessages() {
    try {
      const lastIdParam = lastMessageId === null ? [] : [lastMessageId];
      const newMessages = await authenticatedActor.getMessages(lastIdParam);
      if (newMessages.length > 0) {
        newMessages.sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)));
        const currentLastId = lastMessageId === null ? -1n : lastMessageId;
        const uniqueNewMessages = newMessages.filter(msg => BigInt(msg.id) > currentLastId);
        
        if (uniqueNewMessages.length > 0) {
          setMessages(prev => [...prev, ...uniqueNewMessages.map(msg => msg.content)]);
          const newLastId = BigInt(uniqueNewMessages[uniqueNewMessages.length - 1].id);
          if (newLastId > currentLastId) {
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
        const playersResult = await authenticatedActor.getPlayersInRoom(room.id);
        if ('ok' in playersResult) {
          setPlayersInRoom(playersResult.ok);
        }
        setCurrentRoom(room);
      }
    } catch (error) {
      console.error("Error updating room:", error);
    }
  }

  return (
    <div className="game-interface">
      {currentRoom && (
        <div className="current-room">
          <h3>{currentRoom.name}</h3>
          <p>{currentRoom.description}</p>
        </div>
      )}
      <TextLog messages={messages} />
      <RoomInterface 
        onCommand={handleCommand}
        currentRoom={currentRoom}
      />
    </div>
  );
}

export default GamePage; 