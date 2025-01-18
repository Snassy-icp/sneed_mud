import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import TextLog from '../components/game/TextLog';
import RoomInterface from '../components/game/RoomInterface';

function GamePage({ isAuthenticated, playerName, authenticatedActor, principal }) {
  const [currentRoom, setCurrentRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [playersInRoom, setPlayersInRoom] = useState([]);
  const [lastMessageId, setLastMessageId] = useState(null);

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

  async function handleCommand(command) {
    try {
      // Handle help command (/help or /?)
      if (command === '/help' || command === '/?') {
        setMessages(prev => [...prev, `Available commands:

Movement:
  /go <exit>, /g <exit> - Move through an exit (can use exit name, ID, or direction)

Communication:
  /say <message>, /s <message> - Say something to everyone in the room
  /whisper <player> <message>, /w <player> <message> - Send a private message to a player

Items:
  /inventory, /i - Show your inventory
  /look [item], /l [item] - Look around the room or examine a specific item
  /pick <item> [count], /take <item> [count] - Pick up an item from the room
  /drop <item> [count] - Drop an item in the current room
  /give <item> to <player> [count] - Give an item to another player

Containers:
  /open <container> - Open a container
  /close <container> - Close a container
  /put <item> in|into <container> - Put an item into a container

Admin Commands (Realm Owners only):
  /create_room "Room Name", "Room Description" - Create a new room
  /create_exit "Exit ID", "Exit Name", "Exit Description", target_room_id[, "direction"] - Create an exit in current room
  /create_item_type "Name", "Description", is_container, container_capacity, "icon_url", stack_max - Create a new item type
  /create_item "Item Name"|type_id [count] - Create a new item

Help:
  /help, /? - Show this help message`]);
        return;
      }

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
      if (command.toLowerCase().startsWith('/look ') || command.toLowerCase() === '/look' || command.toLowerCase() === '/l') {
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

      // Handle inventory command (/inventory)
      if (command.toLowerCase() === '/inventory' || command.toLowerCase() === '/i') {
        try {
          const result = await authenticatedActor.getItems();
          if ('ok' in result) {
            const items = result.ok;
            if (items.length === 0) {
              setMessages(prev => [...prev, "Your inventory is empty."]);
              return;
            }

            // Group items by type and count
            const groupedItems = items.reduce((acc, item) => {
              const key = `${item.item_type.id}-${item.item_type.name}`;
              if (!acc[key]) {
                acc[key] = {
                  type: item.item_type,
                  count: item.count,
                  isOpen: item.is_open
                };
              } else {
                acc[key].count += item.count;
              }
              return acc;
            }, {});

            // Format the inventory message
            setMessages(prev => [
              ...prev,
              "Your inventory contains:",
              ...Object.values(groupedItems).map(group => {
                const countStr = group.count > 1 ? ` (x${group.count})` : '';
                const containerStatus = group.type.is_container ? 
                  ` [${group.isOpen ? 'open' : 'closed'}]` : 
                  '';
                return `  ${group.type.name}${countStr}${containerStatus}`;
              })
            ]);
          } else if ('err' in result) {
            setMessages(prev => [...prev, `Error: ${result.err}`]);
          }
        } catch (error) {
          console.error("Error getting inventory:", error);
          setMessages(prev => [...prev, `Error: Failed to get inventory - ${error.message || 'Unknown error'}`]);
        }
        return;
      }

      // Handle drop command (/drop)
      if (command.toLowerCase().startsWith('/drop ')) {
        const argsString = command.substring(command.indexOf(' ') + 1).trim();
        
        try {
          // Match format: item [count]
          const matches = argsString.match(/^(.+?)(?:\s+(\d+))?$/);
          if (!matches) {
            setMessages(prev => [...prev, "Error: Drop command format is '/drop <item>' or '/drop <item> <count>'"]);
            return;
          }
          
          const [_, itemStr, countStr] = matches;
          const count = countStr ? parseInt(countStr) : 1;
          
          try {
            // Find matching item (inventory only)
            const item = await findMatchingItem(itemStr, true);
            
            // Create room account
            const targetAccount = {
              owner: await authenticatedActor.getCanisterPrincipal(),
              subaccount: [createRoomSubaccount(currentRoom.id)]
            };

            // Transfer item to room
            const result = await authenticatedActor.transferItem(
              item.id,
              targetAccount,
              count === item.count ? [] : [count]
            );
            
            if ('err' in result) {
              setMessages(prev => [...prev, `Error: ${result.err}`]);
            }
            // Success message comes from backend via message polling
          } catch (error) {
            console.error("Error dropping item:", error);
            setMessages(prev => [...prev, `Error: ${error.message}`]);
          }
        } catch (error) {
          setMessages(prev => [...prev, "Error: Drop command format is '/drop <item>' or '/drop <item> <count>'"]);
        }
        return;
      }

      // Handle pick/take commands (/pick or /take)
      if (command.toLowerCase().startsWith('/pick ') || command.toLowerCase().startsWith('/take ')) {
        const argsString = command.substring(command.indexOf(' ') + 1).trim();
        
        try {
          // Match format: item [count]
          const matches = argsString.match(/^(.+?)(?:\s+(\d+))?$/);
          if (!matches) {
            setMessages(prev => [...prev, "Error: Pick command format is '/pick <item>' or '/pick <item> <count>'"]);
            return;
          }
          
          const [_, itemStr, countStr] = matches;
          const count = countStr ? parseInt(countStr) : 1;
          
          try {
            // Find matching item in room
            const item = await findMatchingItem(itemStr, false);
            
            // Create target account (player's inventory)
            const targetAccount = {
              owner: Principal.fromText(principal),
              subaccount: []
            };

            // Transfer item to inventory
            const result = await authenticatedActor.transferItem(
              item.id,
              targetAccount,
              count === item.count ? [] : [count]
            );
            
            if ('err' in result) {
              setMessages(prev => [...prev, `Error: ${result.err}`]);
            }
            // Success message comes from backend via message polling
          } catch (error) {
            console.error("Error picking up item:", error);
            setMessages(prev => [...prev, `Error: ${error.message}`]);
          }
        } catch (error) {
          setMessages(prev => [...prev, "Error: Pick command format is '/pick <item>' or '/pick <item> <count>'"]);
        }
        return;
      }

      // Handle give command (/give)
      if (command.toLowerCase().startsWith('/give ')) {
        const argsString = command.substring(command.indexOf(' ') + 1).trim();
        
        try {
          // Match format: item to player [count]
          const matches = argsString.match(/^(.+?)\s+to\s+(.+?)(?:\s+(\d+))?$/);
          if (!matches) {
            setMessages(prev => [...prev, "Error: Give command format is '/give <item> to <player>' or '/give <item> to <player> <count>'"]);
            return;
          }
          
          const [_, itemStr, targetPlayerName, countStr] = matches;
          const count = countStr ? parseInt(countStr) : 1;
          
          try {
            // First check if target player is in the room (exact match)
            const targetPlayer = playersInRoom.find(([_, name]) => name === targetPlayerName);
            
            if (!targetPlayer) {
              setMessages(prev => [...prev, `Error: ${targetPlayerName} is not in the room`]);
              return;
            }

            // Find matching item (inventory only)
            const item = await findMatchingItem(itemStr, true);
            
            // Create target account (player's inventory)
            const targetAccount = {
              owner: targetPlayer[0],
              subaccount: []
            };

            // Transfer item to target player
            const result = await authenticatedActor.transferItem(
              item.id,
              targetAccount,
              count === item.count ? [] : [count]
            );
            
            if ('err' in result) {
              setMessages(prev => [...prev, `Error: ${result.err}`]);
            }
            // Success message comes from backend via message polling
          } catch (error) {
            console.error("Error giving item:", error);
            setMessages(prev => [...prev, `Error: ${error.message}`]);
          }
        } catch (error) {
          setMessages(prev => [...prev, "Error: Give command format is '/give <item> to <player>' or '/give <item> to <player> <count>'"]);
        }
        return;
      }

      // Handle open container command (/open)
      if (command.toLowerCase().startsWith('/open ')) {
        const partialName = command.substring(command.indexOf(' ') + 1).trim();
        
        try {
          const item = await findMatchingItem(partialName);
          const result = await authenticatedActor.toggleContainer(item.id);
          if ('ok' in result) {
            const isOpen = result.ok;
            if (isOpen) {
              setMessages(prev => [...prev, `${item.name} is now open`]);
            } else {
              // If it returned false, it was open, so toggle it back
              const secondResult = await authenticatedActor.toggleContainer(item.id);
              if ('ok' in secondResult) {
                setMessages(prev => [...prev, `${item.name} is already open`]);
              }
            }
          } else if ('err' in result) {
            setMessages(prev => [...prev, `Error: ${result.err}`]);
          }
        } catch (error) {
          console.error("Error opening container:", error);
          setMessages(prev => [...prev, `Error: ${error.message}`]);
        }
        return;
      }

      // Handle close container command (/close)
      if (command.toLowerCase().startsWith('/close ')) {
        const partialName = command.substring(command.indexOf(' ') + 1).trim();
        
        try {
          const item = await findMatchingItem(partialName);
          const result = await authenticatedActor.toggleContainer(item.id);
          if ('ok' in result) {
            const isOpen = result.ok;
            if (!isOpen) {
              setMessages(prev => [...prev, `${item.name} is now closed`]);
            } else {
              // If it returned true, it was closed, so toggle it back
              const secondResult = await authenticatedActor.toggleContainer(item.id);
              if ('ok' in secondResult) {
                setMessages(prev => [...prev, `${item.name} is already closed`]);
              }
            }
          } else if ('err' in result) {
            setMessages(prev => [...prev, `Error: ${result.err}`]);
          }
        } catch (error) {
          console.error("Error closing container:", error);
          setMessages(prev => [...prev, `Error: ${error.message}`]);
        }
        return;
      }

      // Handle put command (/put)
      if (command.toLowerCase().startsWith('/put ')) {
        const argsString = command.substring(command.indexOf(' ') + 1).trim();
        
        try {
          // Match format: item in|into container [count]
          const matches = argsString.match(/^(.+?)\s+(?:in|into)\s+(.+?)(?:\s+(\d+))?$/);
          if (!matches) {
            setMessages(prev => [...prev, "Error: Put command format is '/put <item> in <container>' or '/put <item> in <container> <count>'"]);
            return;
          }
          
          const [_, itemStr, containerStr, countStr] = matches;
          const count = countStr ? parseInt(countStr) : 1;
          
          try {
            // Find matching item (inventory only)
            const item = await findMatchingItem(itemStr, true);
            
            // Find matching container
            const container = await findMatchingItem(containerStr);
            
            // Create target account (container's account)
            const targetAccount = {
              owner: await authenticatedActor.getCanisterPrincipal(),
              subaccount: [createItemSubaccount(container.id)]
            };

            // Transfer item to container
            const result = await authenticatedActor.transferItem(
              item.id,
              targetAccount,
              count === item.count ? [] : [count]
            );
            
            if ('err' in result) {
              setMessages(prev => [...prev, `Error: ${result.err}`]);
            }
            // Success message comes from backend via message polling
          } catch (error) {
            console.error("Error putting item in container:", error);
            setMessages(prev => [...prev, `Error: ${error.message}`]);
          }
        } catch (error) {
          setMessages(prev => [...prev, "Error: Put command format is '/put <item> in <container>' or '/put <item> in <container> <count>'"]);
        }
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

      // Handle create_room command
      if (command.toLowerCase().startsWith('/create_room ')) {
        const argsString = command.substring(command.indexOf(' ') + 1).trim();
        
        try {
          // Match format: "Room Name", "Room Description"
          const matches = argsString.match(/^"([^"]+)"\s*,\s*"([^"]+)"$/);
          if (!matches) {
            setMessages(prev => [...prev, 'Error: Create room command format is \'/create_room "Room Name", "Room Description"\'']);
            return;
          }
          
          const [_, name, description] = matches;
          try {
            const result = await authenticatedActor.createRoom(name, description);
            if ('err' in result) {
              setMessages(prev => [...prev, `Error: ${result.err}`]);
            }
          } catch (error) {
            console.error("Error creating room:", error);
            setMessages(prev => [...prev, `Error: ${error.message}`]);
          }
        } catch (error) {
          setMessages(prev => [...prev, 'Error: Create room command format is \'/create_room "Room Name", "Room Description"\'']);
        }
        return;
      }

      // Handle create_exit command
      if (command.toLowerCase().startsWith('/create_exit ')) {
        const argsString = command.substring(command.indexOf(' ') + 1).trim();
        
        try {
          // Match format: "Exit ID", "Exit Name", "Exit Description", target_room_id[, "direction"]
          const matches = argsString.match(/^"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*(\d+)(?:\s*,\s*"([^"]+)")?$/);
          if (!matches) {
            setMessages(prev => [...prev, 'Error: Create exit command format is \'/create_exit "Exit ID", "Exit Name", "Exit Description", target_room_id[, "direction"]\'']);
            return;
          }
          
          const [_, exitId, name, description, targetRoomId, direction] = matches;
          try {
            const result = await authenticatedActor.createExit(
              exitId,
              name,
              description,
              BigInt(targetRoomId),
              direction ? [direction] : []
            );
            if ('err' in result) {
              setMessages(prev => [...prev, `Error: ${result.err}`]);
            }
          } catch (error) {
            console.error("Error creating exit:", error);
            setMessages(prev => [...prev, `Error: ${error.message}`]);
          }
        } catch (error) {
          setMessages(prev => [...prev, 'Error: Create exit command format is \'/create_exit "Exit ID", "Exit Name", "Exit Description", target_room_id[, "direction"]\'']);
        }
        return;
      }

      // Handle create_item_type command
      if (command.toLowerCase().startsWith('/create_item_type ')) {
        const argsString = command.substring(command.indexOf(' ') + 1).trim();
        
        try {
          // Match format: "Name", "Description", is_container, container_capacity, "icon_url", stack_max
          const matches = argsString.match(/^"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*(true|false)\s*,\s*(\d+|null)\s*,\s*"([^"]+)"\s*,\s*(\d+)$/);
          if (!matches) {
            setMessages(prev => [...prev, "Error: Create item type command format is '/create_item_type \"Name\", \"Description\", is_container, container_capacity, \"icon_url\", stack_max'\nFor non-containers, use 'null' as the container_capacity. For containers, use a number."]);
            return;
          }
          
          const [_, name, description, isContainer, containerCapacity, iconUrl, stackMax] = matches;
          try {
            // First check if an item type with this name already exists
            const itemTypesResult = await authenticatedActor.getItemTypes();
            if ('ok' in itemTypesResult) {
              const existingType = itemTypesResult.ok.find(type => 
                type.name.toLowerCase() === name.toLowerCase()
              );
              if (existingType) {
                setMessages(prev => [...prev, `Error: An item type with the name "${name}" already exists (ID: ${existingType.id})`]);
                return;
              }
            }

            const result = await authenticatedActor.createItemType(
              name,
              description,
              isContainer === 'true',
              containerCapacity === 'null' ? [] : [parseInt(containerCapacity)],
              iconUrl,
              parseInt(stackMax)
            );
            if ('ok' in result) {
              setMessages(prev => [...prev, `Successfully created item type ${name} with ID ${result.ok}`]);
            } else if ('err' in result) {
              setMessages(prev => [...prev, `Error: ${result.err}`]);
            }
          } catch (error) {
            console.error("Error creating item type:", error);
            setMessages(prev => [...prev, `Error: Failed to create item type - ${error.message || 'Unknown error'}`]);
          }
        } catch (error) {
          setMessages(prev => [...prev, "Error: Create item type command format is '/create_item_type \"Name\", \"Description\", is_container, container_capacity, \"icon_url\", stack_max'\nFor non-containers, use 'null' as the container_capacity. For containers, use a number."]);
        }
        return;
      }

      // Handle create item command (/create_item)
      if (command.toLowerCase().startsWith('/create_item ')) {
        const argsString = command.substring(command.indexOf(' ') + 1).trim();
        console.log("Create item args:", argsString);
        
        try {
          // Match either "item name" count or typeId count
          const matches = argsString.match(/^(?:"([^"]+)"|(\d+))(?:\s+(\d+))?$/);
          if (!matches) {
            console.log("No regex match for create_item args");
            setMessages(prev => [...prev, "Error: Create item command format is '/create_item \"Item Name\" [count]' or '/create_item type_id [count]'"]);
            return;
          }
          
          console.log("Regex matches:", matches);
          const [_, quotedName, typeIdStr, count] = matches;
          console.log("Parsed values:", { quotedName, typeIdStr, count });
          let typeId;

          // First determine the type ID either from name or direct ID
          if (quotedName) {
            // Search by name
            const typesResult = await authenticatedActor.getItemTypes();
            if ('ok' in typesResult) {
              const matchingType = typesResult.ok.find(type => 
                type.name.toLowerCase() === quotedName.toLowerCase()
              );
              if (!matchingType) {
                setMessages(prev => [...prev, `Error: No item type found with name "${quotedName}"`]);
                return;
              }
              typeId = matchingType.id;
              console.log("Found type ID from name:", typeId);
            } else {
              setMessages(prev => [...prev, `Error: Failed to get item types`]);
              return;
            }
          } else {
            // Use provided type ID
            typeId = parseInt(typeIdStr);
            console.log("Using provided type ID:", typeId);
          }

          // Verify the type exists and get its name
          const typeResult = await authenticatedActor.getItemType(typeId);
          if ('err' in typeResult) {
            setMessages(prev => [...prev, `Error: ${typeResult.err}`]);
            return;
          }
          const typeName = typeResult.ok.name;
          console.log("Found type name:", typeName);

          // Create the item
          const result = await authenticatedActor.createItem(
            typeId,
            count ? [parseInt(count)] : []
          );
          console.log("Create item result:", result);
          if ('ok' in result) {
            const countStr = count ? ` (x${count})` : '';
            setMessages(prev => [...prev, `Successfully created ${typeName}${countStr} with ID ${result.ok}`]);
          } else if ('err' in result) {
            setMessages(prev => [...prev, `Error: ${result.err}`]);
          }
        } catch (error) {
          console.error("Error creating item:", error);
          setMessages(prev => [...prev, "Error: Invalid command format. Use '/create_item \"Item Name\" [count]' or '/create_item type_id [count]'"]);
        }
        return;
      }

      // If no command matched, show error
      setMessages(prev => [...prev, "Unknown command. Type /help for available commands."]);
    } catch (error) {
      setMessages(prev => [...prev, "Error: " + error.message]);
    }
  }

  // Render section
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!playerName) {
    return <Navigate to="/register" replace />;
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