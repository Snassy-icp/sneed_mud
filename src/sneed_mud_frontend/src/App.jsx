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

  // Helper function to create item subaccount
  function createItemSubaccount(itemId) {
    // Convert itemId to bytes
    const bytes = [];
    let n = BigInt(itemId);
    // Add type byte (2 for item ownership)
    bytes.push(0); // Version byte
    bytes.push(2); // Type byte for item ownership
    
    // Add item ID bytes (big-endian)
    while (n > 0n) {
      bytes.unshift(Number(n & 0xFFn));
      n = n >> 8n;
    }
    
    // Pad to 32 bytes
    while (bytes.length < 32) {
      bytes.unshift(0);
    }
    
    return Array.from(bytes); // Return as regular array of numbers
  }

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

  // Helper function to find matching item by partial name
  async function findMatchingItem(partialName) {
    try {
      const result = await authenticatedActor.getItems();
      if ('ok' in result) {
        const items = result.ok;
        const normalizedSearch = partialName.toLowerCase().trim();
        
        // Filter items whose names start with the partial name
        const matches = items.filter(item => {
          const itemTypeName = item.item_type.name.toLowerCase();
          return itemTypeName.startsWith(normalizedSearch);
        });

        // Return the ID if exactly one match is found
        if (matches.length === 1) {
          return { id: matches[0].id, name: matches[0].item_type.name };
        } else if (matches.length > 1) {
          throw new Error(`Multiple matches found: ${matches.map(m => m.item_type.name).join(', ')}`);
        }
      }
      // Try parsing as ID if no name matches
      const id = parseInt(partialName);
      if (!isNaN(id)) {
        return { id, name: await getItemTypeName(id) };
      }
      throw new Error(`No item found matching '${partialName}'`);
    } catch (error) {
      throw error;
    }
  }

  // Helper function to recursively get container contents
  async function getContainerContentsRecursive(containerId, depth = 0) {
    if (depth > 5) return []; // Prevent infinite recursion, limit depth to 5 levels
    
    const contentsResult = await authenticatedActor.getContainerContents(containerId);
    if (!('ok' in contentsResult)) return [];
    
    const contents = contentsResult.ok;
    const messages = [];
    
    if (contents.length > 0) {
      // Group contents by type
      const groupedContents = new Map();
      for (const itemId of contents) {
        const itemResult = await authenticatedActor.getItems();
        if ('ok' in itemResult) {
          const containerItem = itemResult.ok.find(i => i.id === itemId);
          if (containerItem) {
            const key = containerItem.item_type.name;
            const count = groupedContents.get(key)?.count || 0;
            groupedContents.set(key, {
              id: containerItem.id,
              count: count + containerItem.count,
              isContainer: containerItem.item_type.is_container,
              isOpen: containerItem.is_open,
              type: containerItem.item_type
            });
          }
        }
      }
      
      // Display grouped contents
      for (const [name, info] of groupedContents) {
        const countStr = info.count > 1 ? ` (x${info.count})` : '';
        const containerStatus = info.isContainer ? 
          ` [${info.isOpen ? 'open' : 'closed'}]` : 
          '';
        const indent = '  '.repeat(depth + 1);
        messages.push(`${indent}${name}${countStr}${containerStatus}`);
        
        // Recursively get contents of nested containers
        if (info.isContainer && info.isOpen) {
          const nestedContents = await getContainerContentsRecursive(info.id, depth + 1);
          if (nestedContents.length > 0) {
            messages.push(...nestedContents);
          } else if (depth < 5) { // Only show "empty" message if we haven't hit depth limit
            messages.push(`${indent}  (empty)`);
          }
        }
      }
    } else {
      const indent = '  '.repeat(depth + 1);
      messages.push(`${indent}(empty)`);
    }
    
    return messages;
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

    // Handle create item type command (/create_item_type)
    if (command.toLowerCase().startsWith('/create_item_type ')) {
      const argsString = command.substring(command.indexOf(' ') + 1).trim();
      
      // Try to parse the quoted arguments
      try {
        // Match format: "name", "description", is_container, container_capacity, "icon_url", stack_max
        const matches = argsString.match(/"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*(true|false)\s*,\s*(\d+|null)\s*,\s*"([^"]*)"\s*,\s*(\d+)/);
        if (!matches || matches.length < 7) {
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
      
      try {
        // Match either "item name" count or typeId count
        const matches = argsString.match(/(?:"([^"]+)"|\b(\d+)\b)(?:\s*,?\s*(\d+)?)?/);
        if (!matches) {
          setMessages(prev => [...prev, "Error: Create item command format is '/create_item \"Item Name\" [count]' or '/create_item type_id [count]'"]);
          return;
        }
        
        const [_, quotedName, typeIdStr, count] = matches;
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
          } else {
            setMessages(prev => [...prev, `Error: Failed to get item types`]);
            return;
          }
        } else {
          // Use provided type ID
          typeId = parseInt(typeIdStr);
        }

        // Verify the type exists and get its name
        const typeResult = await authenticatedActor.getItemType(typeId);
        if ('err' in typeResult) {
          setMessages(prev => [...prev, `Error: ${typeResult.err}`]);
          return;
        }
        const typeName = typeResult.ok.name;

        // Create the item
        const result = await authenticatedActor.createItem(
          typeId,
          count ? [parseInt(count)] : []
        );
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

    // Handle move item command (/put)
    if (command.toLowerCase().startsWith('/put ')) {
      const argsString = command.substring(command.indexOf(' ') + 1).trim();
      
      try {
        // Match format: item (in|into) container
        const matches = argsString.match(/^(.+?)\s+(in|into)\s+(.+)$/i);
        if (!matches) {
          setMessages(prev => [...prev, "Error: Put command format is '/put <item> in|into <container>'"]);
          return;
        }
        
        const [_, itemStr, preposition, containerStr] = matches;
        
        try {
          // Find matching items
          const [item, container] = await Promise.all([
            findMatchingItem(itemStr),
            findMatchingItem(containerStr)
          ]);

          const targetAccount = {
            owner: await authenticatedActor.getCanisterPrincipal(),
            subaccount: [createItemSubaccount(container.id)]
          };

          const result = await authenticatedActor.transferItem(
            item.id,
            targetAccount,
            [] // No count support in this syntax
          );
          
          if ('ok' in result) {
            setMessages(prev => [...prev, `You put ${item.name} into ${container.name}`]);
          } else if ('err' in result) {
            setMessages(prev => [...prev, `Error: ${result.err}`]);
          }
        } catch (error) {
          console.error("Error moving item:", error);
          setMessages(prev => [...prev, `Error: ${error.message}`]);
        }
      } catch (error) {
        setMessages(prev => [...prev, "Error: Put command format is '/put <item> in|into <container>'"]);
      }
      return;
    }

    // Handle open container command (/open)
    if (command.toLowerCase().startsWith('/open ')) {
      const partialName = command.substring(command.indexOf(' ') + 1).trim();
      
      try {
        const item = await findMatchingItem(partialName);
        // First check if container is already open
        const result = await authenticatedActor.toggleContainer(item.id);
        if ('ok' in result) {
          const isOpen = result.ok;
          if (isOpen) {
            setMessages(prev => [...prev, `${item.name} is now open`]);
          } else {
            // If it returned false, it was already open, so toggle it back
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
        // First check if container is already closed
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
          // Remove the explicit fetchMessages call since the polling will handle it
          // await fetchMessages();
          // Just update the room state
          await updateCurrentRoom();
        } else if ('err' in result) {
          console.error("Error using exit:", result.err);
          setMessages(prev => [...prev, `Error: ${result.err}`]);
        }
      } catch (error) {
        console.error("Error executing command:", error);
        setMessages(prev => [...prev, `Error: Failed to use exit - ${error.message || 'Unknown error'}`]);
      }
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

    // Handle look command (/look)
    if (command.toLowerCase().startsWith('/look ') || command.toLowerCase() === '/look' || command.toLowerCase() === '/l') {
      try {
        // If no argument, show room
        if (command.toLowerCase() === '/look' || command.toLowerCase() === '/l') {
          // Display room information
          if (!currentRoom) {
            setMessages(prev => [...prev, "You can't see anything."]);
            return;
          }

          // Start with room description
          const roomMessages = [
            `${currentRoom.name}`,
            currentRoom.description,
            ""  // Empty line for spacing
          ];

          // Add players in room
          if (playersInRoom.length > 0) {
            const otherPlayers = playersInRoom.filter(([principal, name]) => name !== playerName);
            if (otherPlayers.length > 0) {
              roomMessages.push("You see:");
              otherPlayers.forEach(([_, name]) => {
                roomMessages.push(`  ${name} is here.`);
              });
              roomMessages.push("");  // Empty line for spacing
            }
          }

          // Add items in room
          const itemsResult = await authenticatedActor.getRoomItems(currentRoom.id);
          if ('ok' in itemsResult) {
            const items = itemsResult.ok;
            if (items.length > 0) {
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

              roomMessages.push("You also see:");
              Object.values(groupedItems).forEach(group => {
                const countStr = group.count > 1 ? ` (x${group.count})` : '';
                const containerStatus = group.type.is_container ? 
                  ` [${group.isOpen ? 'open' : 'closed'}]` : 
                  '';
                roomMessages.push(`  ${group.type.name}${countStr}${containerStatus}`);
              });
              roomMessages.push("");  // Empty line for spacing
            }
          }

          // Add exits
          if (currentRoom.exits && currentRoom.exits.length > 0) {
            roomMessages.push("Obvious exits:");
            currentRoom.exits.forEach(([exitId, exit]) => {
              const directionStr = exit.direction ? ` (${exit.direction})` : '';
              roomMessages.push(`  ${exit.name}${directionStr}`);
            });
          } else {
            roomMessages.push("There are no obvious exits.");
          }

          // Update the message log with all room information
          setMessages(prev => [...prev, ...roomMessages]);
          return;
        }

        // Look at specific item
        const itemName = command.substring(command.indexOf(' ') + 1).trim();
        
        // First check inventory
        const inventoryResult = await authenticatedActor.getItems();
        if ('ok' in inventoryResult) {
          const items = inventoryResult.ok;
          const normalizedSearch = itemName.toLowerCase().trim();
          
          // Find matching items in inventory
          const inventoryMatches = items.filter(item => 
            item.item_type.name.toLowerCase().includes(normalizedSearch)
          );

          if (inventoryMatches.length === 1) {
            const item = inventoryMatches[0];
            const messages = [
              `${item.item_type.name}${item.count > 1 ? ` (x${item.count})` : ''}`,
              item.item_type.description
            ];

            if (item.item_type.is_container) {
              messages.push(`The container is ${item.is_open ? 'open' : 'closed'}.`);
              
              if (item.is_open) {
                messages.push("It contains:");
                const contents = await getContainerContentsRecursive(item.id);
                messages.push(...contents);
              }
            }
            
            setMessages(prev => [...prev, ...messages]);
            return;
          } else if (inventoryMatches.length > 1) {
            setMessages(prev => [...prev, `Multiple matches in your inventory: ${inventoryMatches.map(i => i.item_type.name).join(', ')}`]);
            return;
          }
        }

        // If not found in inventory, check room
        if (currentRoom) {
          const roomItemsResult = await authenticatedActor.getRoomItems(currentRoom.id);
          if ('ok' in roomItemsResult) {
            const items = roomItemsResult.ok;
            const normalizedSearch = itemName.toLowerCase().trim();
            
            // Find matching items in room
            const roomMatches = items.filter(item => 
              item.item_type.name.toLowerCase().includes(normalizedSearch)
            );

            if (roomMatches.length === 1) {
              const item = roomMatches[0];
              const messages = [
                `${item.item_type.name}${item.count > 1 ? ` (x${item.count})` : ''}`,
                item.item_type.description
              ];

              if (item.item_type.is_container) {
                messages.push(`The container is ${item.is_open ? 'open' : 'closed'}.`);
                
                if (item.is_open) {
                  messages.push("It contains:");
                  const contents = await getContainerContentsRecursive(item.id);
                  messages.push(...contents);
                }
              }
              
              setMessages(prev => [...prev, ...messages]);
              return;
            } else if (roomMatches.length > 1) {
              setMessages(prev => [...prev, `Multiple matches in the room: ${roomMatches.map(i => i.item_type.name).join(', ')}`]);
              return;
            }
          }
        }

        setMessages(prev => [...prev, `You don't see '${itemName}' anywhere.`]);
      } catch (error) {
        console.error("Error looking at item:", error);
        setMessages(prev => [...prev, `Error: Failed to look at item - ${error.message || 'Unknown error'}`]);
      }
      return;
    }

    // Handle help command (/help or /?)
    if (command.toLowerCase() === '/help' || command.toLowerCase() === '/?') {
      setMessages(prev => [...prev,
        "Available commands:",
        "  /help, /? - Show this help message",
        "  /look, /l - Look around the room",
        "  /say <message>, /s <message> - Say something to everyone in the room",
        "  /whisper <player> <message>, /w <player> <message> - Send a private message to a player",
        "  /go <exit>, /g <exit> - Move through an exit (can use exit name, ID, or direction)",
        "  /inventory, /i - Check your inventory",
        "  /create_room \"<name>\" \"<description>\" - Create a new room",
        "  /create_exit \"<exit_id>\" \"<name>\" \"<description>\" <target_room_id> [\"<direction>\"] - Create an exit",
        "  /create_item_type \"<name>\" \"<description>\" <is_container> <container_capacity> \"<icon_url>\" <stack_max> - Create an item type",
        "  /create_item <type_id> [count] - Create an item of the specified type",
        "  /put <item> in|into <container> - Put an item into a container",
        "  /open <container> - Open a container",
        "  /close <container> - Close a container"
      ]);
      return;
    }

    // If no command matched, show error
    setMessages(prev => [...prev, `Unknown command: ${command}. Available commands: /say (/s), /whisper (/w), /go (/g), /create_room, /create_exit, /create_item_type, /create_item, /put, /open, /close, /inventory (/i), /help (/?)`]);
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
