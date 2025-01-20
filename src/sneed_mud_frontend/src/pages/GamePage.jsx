import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import TextLog from '../components/game/TextLog';
import RoomInterface from '../components/game/RoomInterface';
import { getAllBalances, transferTokens, isValidPrincipal } from '../utils/WalletManager';
import { getWalletPreferences, saveWalletPreferences, SUPPORTED_TOKENS, parseTokenAmount, formatTokenAmount } from '../utils/TokenConfig';
import { HttpAgent } from "@dfinity/agent";
import { AuthClient } from "@dfinity/auth-client";

function GamePage({ isAuthenticated, playerName, authenticatedActor, principal }) {
  if (!principal) {
    return <Navigate to="/" replace />;
  }

  if (!playerName) {
    return <Navigate to="/register" replace />;
  }

  const [currentRoom, setCurrentRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [playersInRoom, setPlayersInRoom] = useState([]);
  const [lastMessageId, setLastMessageId] = useState(null);
  const [pendingTransfer, setPendingTransfer] = useState(null);
  const [walletPreferences, setWalletPreferences] = useState(() => getWalletPreferences());
  const [authClient, setAuthClient] = useState(null);

  // Initialize auth client
  useEffect(() => {
    AuthClient.create().then(client => {
      setAuthClient(client);
    });
  }, []);

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
      // First check inventory
      const inventoryResult = await authenticatedActor.getItems();
      if ('ok' in inventoryResult) {
        const items = inventoryResult.ok;
        const normalizedSearch = partialName.toLowerCase().trim();
        
        // Helper function to recursively search containers
        async function searchContainer(containerItems) {
          let matches = [];
          
          // Check each item in this container
          for (const item of containerItems) {
            const itemTypeName = item.item_type.name.toLowerCase();
            if (itemTypeName.startsWith(normalizedSearch)) {
              matches.push({ id: BigInt(item.id), name: item.item_type.name });
            }
            
            // If this is an open container, search its contents
            if (item.item_type.is_container && item.is_open) {
              const contentsResult = await authenticatedActor.getContainerContents(BigInt(item.id));
              if ('ok' in contentsResult) {
                const contents = contentsResult.ok;
                // Get details for each item in the container
                for (const itemId of contents) {
                  const itemResult = await authenticatedActor.getItem(BigInt(itemId));
                  if ('ok' in itemResult) {
                    const nestedMatches = await searchContainer([itemResult.ok]);
                    matches = matches.concat(nestedMatches);
                  }
                }
              }
            }
          }
          return matches;
        }

        // Start the recursive search from inventory items
        const matches = await searchContainer(items);

        // If we have any matches, return the first one
        if (matches.length > 0) {
          return matches[0];
        }
      }

      // If not found in inventory and we're not restricted to inventory, check room
      if (!inventoryOnly && currentRoom) {
        const roomItemsResult = await authenticatedActor.getRoomItems(currentRoom.id);
        if ('ok' in roomItemsResult) {
          const items = roomItemsResult.ok;
          const normalizedSearch = partialName.toLowerCase().trim();
          
          // Filter items whose names start with the partial name
          const matches = items.filter(item => {
            const itemTypeName = item.item_type.name.toLowerCase();
            return itemTypeName.startsWith(normalizedSearch);
          });

          // Return the first match if any are found
          if (matches.length > 0) {
            return { id: BigInt(matches[0].id), name: matches[0].item_type.name };
          }
        }
      }

      // Try parsing as ID if no name matches
      const id = parseInt(partialName);
      if (!isNaN(id)) {
        return { id: BigInt(id), name: await getItemTypeName(id) };
      }
      throw new Error(`No item found matching '${partialName}'`);
    } catch (error) {
      throw error;
    }
  }

  const formatStats = (stats) => {
    const nextLevelXp = calculateXpForNextLevel(stats.base.level);
    const xpNeeded = nextLevelXp - stats.dynamic.xp;
    
    return [
      // Basic Info
      `Level: ${stats.base.level}`,
      `XP: ${stats.dynamic.xp}/${nextLevelXp} (${xpNeeded} more needed for next level)`,
      '',
      // Current Status
      `HP: ${stats.dynamic.hp}/${stats.base.maxHp}`,
      `MP: ${stats.dynamic.mp}/${stats.base.maxMp}`,
      '',
      // Primary Attributes
      `Strength: ${stats.base.strength}`,
      `Dexterity: ${stats.base.dexterity}`,
      `Constitution: ${stats.base.constitution}`,
      `Intelligence: ${stats.base.intelligence}`,
      `Wisdom: ${stats.base.wisdom}`,
      '',
      // Combat Stats
      `Physical Attack: ${stats.base.physicalAttack} (Base: ${stats.base.basePhysicalAttack})`,
      `Physical Defense: ${stats.base.physicalDefense} (Base: ${stats.base.basePhysicalDefense})`,
      `Magic Attack: ${stats.base.magicAttack} (Base: ${stats.base.baseMagicAttack})`,
      `Magic Defense: ${stats.base.magicDefense} (Base: ${stats.base.baseMagicDefense})`,
      '',
      // Combat Modifiers
      `Attack Speed: ${stats.base.attackSpeed / 100}% (Base: ${stats.base.baseAttackSpeed / 100}%)`,
      `Dodge Chance: ${stats.base.dodgeChance / 100}%`,
      `Critical Chance: ${stats.base.criticalChance / 100}%`
    ].join('\n');
  };

  const formatStatsForOthers = (stats) => {
    return [
      `Level ${stats.base.level} character`,
      `HP: ${stats.dynamic.hp}/${stats.base.maxHp}`,
      `MP: ${stats.dynamic.mp}/${stats.base.maxMp}`
    ].join('\n');
  };

  // Helper function to calculate XP needed for next level
  const calculateXpForNextLevel = (level) => {
    return Math.floor(2000 * Math.pow(1.1, level - 1));
  };

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

  // Helper function to recursively get container contents
  async function getContainerContentsRecursive(containerId, depth = 0) {
    if (depth > 5) return []; // Prevent infinite recursion, limit depth to 5 levels
    
    console.log("Getting contents for container:", containerId);
    const contentsResult = await authenticatedActor.getContainerContents(BigInt(containerId));
    console.log("Raw contents result:", contentsResult);
    
    if (!('ok' in contentsResult)) {
      console.log("Error getting container contents:", contentsResult);
      return [];
    }
    
    const contents = contentsResult.ok;
    console.log("Raw contents array:", contents);
    const messages = [];
    
    if (contents.length > 0) {
      // Group contents by type
      const groupedContents = new Map();
      for (const itemId of contents) {
        console.log("Getting item details for:", itemId);
        const itemResult = await authenticatedActor.getItem(BigInt(itemId));
        console.log("Item result:", itemResult);
        if ('ok' in itemResult) {
          const containerItem = itemResult.ok;
          console.log("Container item:", containerItem);
          const key = containerItem.item_type.name;
          const count = groupedContents.get(key)?.count || 0n;  // Initialize as BigInt
          groupedContents.set(key, {
            id: containerItem.id,
            count: count + BigInt(containerItem.count),  // Convert and add as BigInt
            isContainer: containerItem.item_type.is_container,
            isOpen: containerItem.is_open,
            type: containerItem.item_type
          });
        }
      }
      
      // Display grouped contents
      for (const [name, info] of groupedContents) {
        const countStr = info.count > 1n ? ` (x${info.count})` : '';  // Compare with BigInt
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
    if (isAuthenticated && authenticatedActor && playerName) {
      updateCurrentRoom();
      fetchMessages();
      const roomInterval = setInterval(updateCurrentRoom, 5000);
      return () => clearInterval(roomInterval);
    }
  }, [isAuthenticated, authenticatedActor, playerName]);

  useEffect(() => {
    if (isAuthenticated && authenticatedActor && playerName) {
      const messageInterval = setInterval(fetchMessages, 1000);
      return () => clearInterval(messageInterval);
    }
  }, [isAuthenticated, authenticatedActor, playerName, lastMessageId]);

  async function handleCommand(command) {
    try {
      // Handle pending transfer confirmation
      if (pendingTransfer && (command.toLowerCase() === 'yes' || command.toLowerCase() === 'no')) {
        if (command.toLowerCase() === 'yes') {
          try {
            const { tokenSymbol, targetPrincipal, amount, recipientName, senderName } = pendingTransfer;
            const identity = authClient.getIdentity();
            const agent = new HttpAgent({ identity });
            if (process.env.NODE_ENV !== "production") {
              await agent.fetchRootKey();
            }
            const txId = await transferTokens(
              tokenSymbol,
              principal,
              targetPrincipal,
              amount,
              agent
            );

            // Send personalized messages to both parties
            try {
              const formattedAmount = formatTokenAmount(amount, SUPPORTED_TOKENS[tokenSymbol].decimals);
              await authenticatedActor.notifyTokenTransfer(
                Principal.fromText(principal),
                Principal.fromText(targetPrincipal),
                senderName,
                recipientName,
                formattedAmount,
                tokenSymbol,
                txId.toString()
              );
            } catch (error) {
              console.error("Error sending system messages:", error);
            }

          } catch (error) {
            setMessages(prev => [...prev, `Error: ${error.message}`]);
          }
        } else {
          setMessages(prev => [...prev, "Transfer cancelled."]);
        }
        setPendingTransfer(null);
        return;
      }

      // Handle wallet commands
      if (command === '/wallet') {
        try {
          const identity = authClient.getIdentity();
          const agent = new HttpAgent({ identity });
          if (process.env.NODE_ENV !== "production") {
            await agent.fetchRootKey();
          }
          const balances = await getAllBalances(
            principal,
            walletPreferences.hideZeroBalances,
            agent,
            authenticatedActor
          );
          setMessages(prev => [
            ...prev,
            "Wallet:",
            `Principal: ${principal}`,
            ...balances.map(b => {
              const errorStr = b.error ? ` (Error: ${b.error})` : '';
              const refreshStr = b.needsRefresh ? ' (Metadata needs refresh - use /wallet refresh)' : '';
              const canisterStr = b.canisterId ? ` [${b.canisterId}]` : '';
              return `${b.symbol} (${b.name}): ${b.formatted}${errorStr}${refreshStr}${canisterStr}`;
            })
          ]);
        } catch (error) {
          setMessages(prev => [...prev, `Error fetching balances: ${error.message}`]);
        }
        return;
      }

      if (command === '/wallet hide_zero') {
        const newPreferences = { ...walletPreferences, hideZeroBalances: true };
        setWalletPreferences(newPreferences);
        saveWalletPreferences(newPreferences);
        setMessages(prev => [...prev, "Zero balances will be hidden in wallet display"]);
        return;
      }

      if (command === '/wallet show_zero') {
        const newPreferences = { ...walletPreferences, hideZeroBalances: false };
        setWalletPreferences(newPreferences);
        saveWalletPreferences(newPreferences);
        setMessages(prev => [...prev, "All balances will be shown in wallet display"]);
        return;
      }

      // Handle send command
      if (command.startsWith('/send ')) {
        const match = command.match(/^\/send (\d+\.?\d*) (\w+) to (.+)$/);
        if (!match) {
          setMessages(prev => [...prev, "Invalid send command. Format: /send <amount> <token> to <recipient>"]);
          return;
        }

        const [, amountStr, tokenSymbol, recipient] = match;
        
        try {
          // First check if it's a supported token to get decimals
          let decimals = 8; // Default
          const config = SUPPORTED_TOKENS[tokenSymbol];
          if (config) {
            decimals = config.decimals;
          } else {
            // If not supported, check registered tokens
            const registeredTokens = await authenticatedActor.getRegisteredTokens();
            const token = registeredTokens.find(t => 
              t.metadata && t.metadata.symbol === tokenSymbol
            );
            if (!token || !token.metadata) {
              setMessages(prev => [...prev, `Unknown token: ${tokenSymbol}. Make sure it's registered and metadata is up to date.`]);
              return;
            }
            decimals = token.metadata.decimals;
          }

          const amount = parseTokenAmount(amountStr, decimals);
          let targetPrincipal;
          let recipientName = recipient;

          // First try to get the principal if it's a player name
          try {
            const playerResult = await authenticatedActor.getPrincipalByName(recipient);
            if ('ok' in playerResult) {
              targetPrincipal = playerResult.ok.toText();
              recipientName = recipient; // Keep the player name
            } else {
              // Not a player name, check if it's a valid principal
              try {
                Principal.fromText(recipient);
                targetPrincipal = recipient;
                recipientName = recipient; // Just use the principal as the name if not a player
              } catch (error) {
                setMessages(prev => [...prev, `Error: "${recipient}" is neither a valid player name nor a valid principal ID`]);
                return;
              }
            }
          } catch (error) {
            setMessages(prev => [...prev, `Error looking up recipient: ${error.message}`]);
            return;
          }

          setMessages(prev => [...prev, 
            `Are you sure you want to send ${amountStr} ${tokenSymbol} to ${recipientName} (principal: ${targetPrincipal})?`,
            "Type 'yes' to confirm."
          ]);

          setPendingTransfer({
            tokenSymbol,
            amount,
            targetPrincipal,
            recipientName,
            senderName: playerName
          });
        } catch (error) {
          setMessages(prev => [...prev, `Error: ${error.message}`]);
        }
        return;
      }

      // Handle transfer confirmation
      if (command === 'yes' && pendingTransfer) {
        try {
          const identity = authClient.getIdentity();
          const agent = new HttpAgent({ identity });
          if (process.env.NODE_ENV !== "production") {
            await agent.fetchRootKey();
          }

          const txId = await transferTokens(
            pendingTransfer.tokenSymbol,
            principal,
            pendingTransfer.targetPrincipal,
            pendingTransfer.amount,
            agent,
            authenticatedActor
          );

          // Send personalized messages to both parties
          try {
            // Get decimals for formatting
            let decimals = 8; // Default
            const config = SUPPORTED_TOKENS[pendingTransfer.tokenSymbol];
            if (config) {
              decimals = config.decimals;
            } else {
              const registeredTokens = await authenticatedActor.getRegisteredTokens();
              const token = registeredTokens.find(t => 
                t.metadata && t.metadata.symbol === pendingTransfer.tokenSymbol
              );
              if (token && token.metadata) {
                decimals = token.metadata.decimals;
              }
            }

            const formattedAmount = formatTokenAmount(pendingTransfer.amount, decimals);
            await authenticatedActor.notifyTokenTransfer(
              Principal.fromText(principal),
              Principal.fromText(pendingTransfer.targetPrincipal),
              pendingTransfer.senderName,
              pendingTransfer.recipientName,
              formattedAmount,
              pendingTransfer.tokenSymbol,
              txId.toString()
            );
          } catch (error) {
            console.error("Error sending system messages:", error);
          }

        } catch (error) {
          setMessages(prev => [...prev, `Error: ${error.message}`]);
        }
        setPendingTransfer(null);
        return;
      }

      // Handle respawn command
      if (command === '/respawn') {
        try {
          const result = await authenticatedActor.respawn();
          if ('err' in result) {
            setMessages(prev => [...prev, `Error: ${result.err}`]);
          }
          // Success message comes from backend via message polling
        } catch (error) {
          console.error("Error respawning:", error);
          setMessages(prev => [...prev, `Error: ${error.message}`]);
        }
        return;
      }

      // Handle help command (/help or /?)
      if (command === '/help' || command === '/?') {
        setMessages(prev => [...prev, `Available commands:

Movement:
  /go <exit>, /g <exit> - Move through an exit (can use exit name, ID, or direction)

Communication:
  /say <message>, /s <message> - Say something to everyone in the room
  /whisper <player> <message>, /w <player> <message> - Send a private message to a player

Combat:
  /attack <player> - Attack another player in the same room
  /respawn - Return to the starting point after death (60 second cooldown)

Items:
  /inventory, /i - Show your inventory
  /look [target], /l [target] - Look around the room or examine a specific target (item, player, or exit)
  /pick <item> [count], /take <item> [count] - Pick up an item from the room
  /drop <item> [count] - Drop an item in the current room
  /give <item> to <player> [count] - Give an item to another player

Containers:
  /open <container> - Open a container
  /close <container> - Close a container
  /put <item> in|into <container> [count] - Put an item into a container

Character:
  /stats - Show your character's stats (Level, HP, MP, XP)
  /create - Create character stats if you don't have them

Wallet:
  /wallet - Show your wallet balances and principal
  /wallet hide_zero - Hide zero balances in wallet display
  /wallet show_zero - Show all balances in wallet display
  /send <amount> <token> to <recipient> - Send tokens to a player or principal

Admin Commands (Realm Owners only):
  /create_room "Room Name", "Room Description" - Create a new room
  /create_exit "Exit ID", "Exit Name", "Exit Description", target_room_id[, "direction"] - Create an exit in current room
  /create_item_type "Name", "Description", is_container, container_capacity, "icon_url", stack_max - Create a new item type
  /create_item "Item Name"|type_id [count] - Create a new item

Help:
  /help, /? - Show this help message`]);
        return;
      }

      // Handle attack command
      if (command.toLowerCase().startsWith('/attack ')) {
        const targetName = command.substring(command.indexOf(' ') + 1).trim();
        try {
          const result = await authenticatedActor.attack(targetName);
          if ('err' in result) {
            setMessages(prev => [...prev, `Error: ${result.err}`]);
          }
          // Success message comes from backend via message polling
        } catch (error) {
          console.error("Error attacking:", error);
          setMessages(prev => [...prev, `Error: ${error.message}`]);
        }
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

        // Check if looking at a specific target
        if (command.toLowerCase().startsWith('/look ') || command.toLowerCase().startsWith('/l ')) {
          const targetName = command.substring(command.indexOf(' ') + 1).trim();

          // First check if it's a player
          const targetPlayer = playersInRoom.find(([_, name]) => name.toLowerCase() === targetName.toLowerCase());
          if (targetPlayer) {
            try {
              const result = await authenticatedActor.lookAtPlayer(targetPlayer[1]);
              if ('ok' in result) {
                setMessages(prev => [...prev, 
                  `${targetPlayer[1]}`,
                  formatStatsForOthers(result.ok)
                ]);
              } else {
                setMessages(prev => [...prev, 
                  `${targetPlayer[1]} is here.`,
                  result.err
                ]);
              }
            } catch (error) {
              console.error("Error examining player:", error);
              setMessages(prev => [...prev, `${targetPlayer[1]} is here.`]);
            }
            return;
          }

          // Then check if it's an exit
          if (currentRoom.exits) {
            // Map common direction abbreviations
            const directionMap = {
              'n': 'north',
              's': 'south',
              'e': 'east',
              'w': 'west',
              'ne': 'northeast',
              'nw': 'northwest',
              'se': 'southeast',
              'sw': 'southwest',
              'u': 'up',
              'd': 'down'
            };

            const searchName = targetName.toLowerCase();
            const expandedDirection = directionMap[searchName] || searchName;

            const matchingExit = currentRoom.exits.find(([_, exit]) => {
              const exitName = exit.name.toLowerCase();
              const exitDirection = typeof exit.direction === 'string' ? exit.direction.toLowerCase() : '';
              
              return exitName.includes(expandedDirection) || exitDirection.includes(expandedDirection);
            });
            if (matchingExit) {
              const [_, exit] = matchingExit;
              const directionStr = typeof exit.direction === 'string' ? ` (${exit.direction})` : '';
              setMessages(prev => [...prev, 
                `${exit.name}${directionStr}`,
                exit.description
              ]);
              return;
            }

            // If we were looking for a direction but didn't find a matching exit
            if (directionMap[searchName] || Object.values(directionMap).includes(searchName)) {
              setMessages(prev => [...prev, `You see no exit in that direction.`]);
              return;
            }
          }

          // Finally check if it's an item
          try {
            // Find matching item in room or inventory
            const item = await findMatchingItem(targetName, false);
            const itemResult = await authenticatedActor.getItem(item.id);
            
            if ('ok' in itemResult) {
              const itemInfo = itemResult.ok;
              const messages = [
                `${itemInfo.item_type.name}`,
                itemInfo.item_type.description,
              ];

              // Add container-specific information
              if (itemInfo.item_type.is_container) {
                messages.push("");
                if (itemInfo.is_open) {
                  const contentsResult = await authenticatedActor.getContainerContents(item.id);
                  if ('ok' in contentsResult) {
                    const contents = contentsResult.ok;
                    if (contents.length > 0) {
                      messages.push("Contents:");
                      for (const itemId of contents) {
                        const contentItemResult = await authenticatedActor.getItem(itemId);
                        if ('ok' in contentItemResult) {
                          const contentItem = contentItemResult.ok;
                          const countStr = contentItem.count > 1 ? ` (x${contentItem.count})` : '';
                          messages.push(`  ${contentItem.item_type.name}${countStr}`);
                        }
                      }
                    } else {
                      messages.push("The container is empty.");
                    }
                  }
                } else {
                  messages.push("The container is closed.");
                }
              }

              setMessages(prev => [...prev, ...messages]);
              return;
            } else {
              setMessages(prev => [...prev, `Error: ${itemResult.err}`]);
              return;
            }
          } catch (error) {
            console.error("Error examining item:", error);
            setMessages(prev => [...prev, `Error: ${error.message}`]);
            return;
          }
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
        console.log("Put command args:", argsString);
        
        try {
          // Match format: item in|into container [count]
          const matches = argsString.match(/^(.+?)\s+(?:in|into)\s+(.+?)(?:\s+(\d+))?$/);
          console.log("Regex matches:", matches);
          if (!matches) {
            setMessages(prev => [...prev, "Error: Put command format is '/put <item> in <container>' or '/put <item> in <container> <count>'"]);
            return;
          }
          
          const [_, itemStr, containerStr, countStr] = matches;
          console.log("Parsed values:", { itemStr, containerStr, countStr });
          const count = countStr ? parseInt(countStr) : 1;
          
          try {
            // Find matching item (inventory only)
            const item = await findMatchingItem(itemStr, true);
            console.log("Found item:", item);
            
            // Find matching container
            const container = await findMatchingItem(containerStr);
            console.log("Found container:", container);
            
            // Create target account (container's account)
            const targetAccount = {
              owner: await authenticatedActor.getCanisterPrincipal(),
              subaccount: [createItemSubaccount(container.id)]
            };
            console.log("Target account:", targetAccount);

            // Transfer item to container
            const result = await authenticatedActor.transferItem(
              item.id,
              targetAccount,
              count === item.count ? [] : [count]
            );
            console.log("Transfer result:", result);
            
            if ('err' in result) {
              setMessages(prev => [...prev, `Error: ${result.err}`]);
            }
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
        const stats = await authenticatedActor.getStats();
        if ('ok' in stats) {
          setMessages(prev => [...prev, formatStats(stats.ok)]);
        } else {
          throw new Error(stats.err);
        }
        return;
      }

      // Handle create character command
      if (command === '/create') {
        try {
          const result = await authenticatedActor.createCharacter();
          if ('err' in result) {
            setMessages(prev => [...prev, `Error: ${result.err}`]);
          }
          // Success message comes from backend via message polling
        } catch (error) {
          console.error("Error creating character:", error);
          setMessages(prev => [...prev, `Error: ${error.message}`]);
        }
        return;
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
            } else {
              const roomId = result.ok;
              setMessages(prev => [...prev, `Successfully created room "${name}" (ID: ${roomId})`]);
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
            if (!currentRoom) {
              setMessages(prev => [...prev, 'Error: You must be in a room to create an exit']);
              return;
            }

            const result = await authenticatedActor.addExit(
              currentRoom.id,
              exitId,
              name, 
              description,
              BigInt(targetRoomId),
              direction ? [direction] : []
            );
            
            if ('err' in result) {
              setMessages(prev => [...prev, `Error: ${result.err}`]);
            } else {
              setMessages(prev => [...prev, `Successfully created exit "${name}" (ID: ${exitId}) leading to room ${targetRoomId}${direction ? ` in direction ${direction}` : ''}`]);
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

      // Add new command handlers for token management
      if (command.startsWith('/wallet register')) {
        const matches = command.match(/^\/wallet register ([a-z0-9-]+)$/);
        if (!matches) {
          setMessages(prev => [...prev, 'Usage: /wallet register <canister_id>']);
          return;
        }

        const canisterId = matches[1];
        try {
          const result = await authenticatedActor.registerToken(Principal.fromText(canisterId));
          if ('err' in result) {
            setMessages(prev => [...prev, `Error registering token: ${result.err}`]);
          } else {
            setMessages(prev => [...prev, `Successfully registered token ledger ${canisterId}`]);
          }
        } catch (e) {
          setMessages(prev => [...prev, `Error registering token: ${e.message}`]);
        }
        return;
      }

      if (command.startsWith('/wallet unregister')) {
        const matches = command.match(/^\/wallet unregister ([a-z0-9-]+)$/);
        if (!matches) {
          setMessages(prev => [...prev, 'Usage: /wallet unregister <canister_id>']);
          return;
        }

        const canisterId = matches[1];
        try {
          const result = await authenticatedActor.unregisterToken(Principal.fromText(canisterId));
          if ('err' in result) {
            setMessages(prev => [...prev, `Error unregistering token: ${result.err}`]);
          } else {
            setMessages(prev => [...prev, `Successfully unregistered token ledger ${canisterId}`]);
          }
        } catch (e) {
          setMessages(prev => [...prev, `Error unregistering token: ${e.message}`]);
        }
        return;
      }

      if (command === '/wallet tokens') {
        try {
          const tokens = await authenticatedActor.getRegisteredTokens();
          if (tokens.length === 0) {
            setMessages(prev => [...prev, 'No registered tokens found']);
          } else {
            setMessages(prev => [...prev, 'Registered tokens:']);
            for (const token of tokens) {
              const { metadata, ledgerCanisterId } = token;
              const staleWarning = await authenticatedActor.hasStaleMetadata() ? ' (metadata needs refresh)' : '';
              setMessages(prev => [...prev, `${metadata.name} (${metadata.symbol}) - ${ledgerCanisterId.toText()}${staleWarning}`]);
            }
          }
        } catch (e) {
          setMessages(prev => [...prev, `Error listing tokens: ${e.message}`]);
        }
        return;
      }

      if (command.startsWith('/wallet refresh')) {
        const matches = command.match(/^\/wallet refresh ([a-z0-9-]+)$/);
        if (!matches) {
          setMessages(prev => [...prev, 'Usage: /wallet refresh <canister_id>']);
          return;
        }

        const canisterId = matches[1];
        try {
          const result = await authenticatedActor.refreshTokenMetadata(Principal.fromText(canisterId));
          if ('err' in result) {
            setMessages(prev => [...prev, `Error refreshing token metadata: ${result.err}`]);
          } else {
            setMessages(prev => [...prev, `Successfully refreshed metadata for token ledger ${canisterId}`]);
          }
        } catch (e) {
          setMessages(prev => [...prev, `Error refreshing token metadata: ${e.message}`]);
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