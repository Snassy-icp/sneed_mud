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
    // Convert to BigInt for division
    const PERCENT_DIVISOR = 10000n;
    
    return [
      // Basic Info
      `Level ${stats.base.level} ${stats.characterClass}`,
      `XP: ${stats.dynamic.xp}/${stats.xpForNextLevel} (${stats.xpNeeded} more needed for next level)`,
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
      `Attack Speed: ${Number(BigInt(stats.attackSpeedPercent) * 100n / PERCENT_DIVISOR) / 100}% (Base: ${Number(BigInt(stats.baseAttackSpeedPercent) * 100n / PERCENT_DIVISOR) / 100}%)`,
      `Dodge Chance: ${Number(BigInt(stats.dodgeChancePercent) * 100n / PERCENT_DIVISOR) / 100}%`,
      `Critical Chance: ${Number(BigInt(stats.criticalChancePercent) * 100n / PERCENT_DIVISOR) / 100}%`
    ].join('\n');
  };

  const formatStatsForOthers = (stats) => {
    return [
      `Level ${stats.base.level} ${stats.characterClass}`,
      `HP: ${stats.dynamic.hp}/${stats.base.maxHp}`,
      `MP: ${stats.dynamic.mp}/${stats.base.maxMp}`
    ].join('\n');
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
          setMessages(prev => [...prev, ...uniqueNewMessages.map(msg => ({
            type: msg.type || 'info',
            parts: msg.parts || [{ 
              type: 'text',
              content: msg.content // Handle legacy messages
            }]
          }))]);
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
            setMessages(prev => [...prev, {
              content: `Error: ${error.message}`,
              type: 'error'
            }]);
          }
        } else {
          setMessages(prev => [...prev, {
            content: "Transfer cancelled.",
            type: 'system'
          }]);
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
            {
              content: "Wallet:",
              type: 'system'
            },
            {
              content: `Principal: ${principal}`,
              type: 'system'
            },
            ...balances.map(b => ({
              content: `${b.symbol} (${b.name}): ${b.formatted}${b.error ? ` (Error: ${b.error})` : ''}${b.needsRefresh ? ' (Metadata needs refresh - use /wallet refresh)' : ''}${b.canisterId ? ` [${b.canisterId}]` : ''}`,
              type: 'system'
            }))
          ]);
        } catch (error) {
          setMessages(prev => [...prev, {
            content: `Error fetching balances: ${error.message}`,
            type: 'error'
          }]);
        }
        return;
      }

      if (command === '/wallet hide_zero') {
        const newPreferences = { ...walletPreferences, hideZeroBalances: true };
        setWalletPreferences(newPreferences);
        saveWalletPreferences(newPreferences);
        setMessages(prev => [...prev, {
          content: "Zero balances will be hidden in wallet display",
          type: 'system'
        }]);
        return;
      }

      if (command === '/wallet show_zero') {
        const newPreferences = { ...walletPreferences, hideZeroBalances: false };
        setWalletPreferences(newPreferences);
        saveWalletPreferences(newPreferences);
        setMessages(prev => [...prev, {
          content: "All balances will be shown in wallet display",
          type: 'system'
        }]);
        return;
      }

      // Handle send command
      if (command.startsWith('/send ')) {
        const match = command.match(/^\/send (\d+\.?\d*) (\w+) to (.+)$/);
        if (!match) {
          setMessages(prev => [...prev, {
            content: "Invalid send command. Format: /send <amount> <token> to <recipient>",
            type: 'error'
          }]);
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
              setMessages(prev => [...prev, {
                content: `Unknown token: ${tokenSymbol}. Make sure it's registered and metadata is up to date.`,
                type: 'error'
              }]);
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
                setMessages(prev => [...prev, {
                  content: `Error: "${recipient}" is neither a valid player name nor a valid principal ID`,
                  type: 'error'
                }]);
                return;
              }
            }
          } catch (error) {
            setMessages(prev => [...prev, {
              content: `Error looking up recipient: ${error.message}`,
              type: 'error'
            }]);
            return;
          }

          setMessages(prev => [...prev, {
            content: `Are you sure you want to send ${amountStr} ${tokenSymbol} to ${recipientName} (principal: ${targetPrincipal})?`,
            type: 'system'
          }, {
            content: "Type 'yes' to confirm.",
            type: 'system'
          }]);

          setPendingTransfer({
            tokenSymbol,
            amount,
            targetPrincipal,
            recipientName,
            senderName: playerName
          });
        } catch (error) {
          setMessages(prev => [...prev, {
            content: `Error: ${error.message}`,
            type: 'error'
          }]);
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
          setMessages(prev => [...prev, {
            content: `Error: ${error.message}`,
            type: 'error'
          }]);
        }
        setPendingTransfer(null);
        return;
      }

      // Handle respawn command
      if (command === '/respawn') {
        try {
          const result = await authenticatedActor.respawn();
          if ('err' in result) {
            setMessages(prev => [...prev, {
              content: `Error: ${result.err}`,
              type: 'error'
            }]);
          }
          // Success message comes from backend via message polling
        } catch (error) {
          console.error("Error respawning:", error);
          setMessages(prev => [...prev, {
            content: `Error: ${error.message}`,
            type: 'error'
          }]);
        }
        return;
      }

      // Handle help command (/help or /?)
      if (command === '/help' || command === '/?') {
        setMessages(prev => [
          ...prev,
          {
            content: "Available commands:",
            type: 'system'
          },
          {
            content: "",
            type: 'system'
          },
          {
            content: "Movement:",
            type: 'system'
          },
          {
            content: "  /go <exit>, /g <exit> - Move through an exit (can use exit name, ID, or direction)",
            type: 'system'
          },
          {
            content: "",
            type: 'system'
          },
          {
            content: "Communication:",
            type: 'system'
          },
          {
            content: "  /say <message>, /s <message> - Say something to everyone in the room",
            type: 'system'
          },
          {
            content: "  /whisper <player> <message>, /w <player> <message> - Send a private message to a player",
            type: 'system'
          },
          {
            content: "",
            type: 'system'
          },
          {
            content: "Combat:",
            type: 'system'
          },
          {
            content: "  /attack <player> - Attack another player in the same room",
            type: 'system'
          },
          {
            content: "  /respawn - Return to the starting point after death (60 second cooldown)",
            type: 'system'
          },
          {
            content: "",
            type: 'system'
          },
          {
            content: "Items:",
            type: 'system'
          },
          {
            content: "  /inventory, /i - Show your inventory",
            type: 'system'
          },
          {
            content: "  /look [target], /l [target] - Look around the room or examine a specific target",
            type: 'system'
          },
          {
            content: "  /pick <item> [count], /take <item> [count] - Pick up an item from the room",
            type: 'system'
          },
          {
            content: "  /drop <item> [count] - Drop an item in the current room",
            type: 'system'
          },
          {
            content: "  /give <item> to <player> [count] - Give an item to another player",
            type: 'system'
          },
          {
            content: "",
            type: 'system'
          },
          {
            content: "Containers:",
            type: 'system'
          },
          {
            content: "  /open <container> - Open a container",
            type: 'system'
          },
          {
            content: "  /close <container> - Close a container",
            type: 'system'
          },
          {
            content: "  /put <item> in|into <container> [count] - Put an item into a container",
            type: 'system'
          },
          {
            content: "",
            type: 'system'
          },
          {
            content: "Character:",
            type: 'system'
          },
          {
            content: "  /stats - Show your character's stats (Level, HP, MP, XP)",
            type: 'system'
          },
          {
            content: "  /create - Create character stats if you don't have them",
            type: 'system'
          },
          {
            content: "",
            type: 'system'
          },
          {
            content: "Status:",
            type: 'system'
          },
          {
            content: "  /online - Show all online players",
            type: 'system'
          },
          {
            content: "  /players - Show all registered players",
            type: 'system'
          },
          {
            content: "  /afk [message] - Set yourself as AFK with optional message",
            type: 'system'
          },
          {
            content: "  /back - Return from AFK",
            type: 'system'
          },
          {
            content: "",
            type: 'system'
          },
          {
            content: "Wallet:",
            type: 'system'
          },
          {
            content: "  /wallet - Show your wallet balances and principal",
            type: 'system'
          },
          {
            content: "  /wallet hide_zero - Hide zero balances in wallet display",
            type: 'system'
          },
          {
            content: "  /wallet show_zero - Show all balances in wallet display",
            type: 'system'
          },
          {
            content: "  /send <amount> <token> to <recipient> - Send tokens to a player or principal",
            type: 'system'
          },
          {
            content: "",
            type: 'system'
          },
          {
            content: "Admin Commands (Realm Owners only):",
            type: 'system'
          },
          {
            content: "  /create_room \"Room Name\", \"Room Description\" - Create a new room",
            type: 'system'
          },
          {
            content: "  /create_exit \"Exit ID\", \"Exit Name\", \"Exit Description\", target_room_id[, \"direction\"] - Create an exit",
            type: 'system'
          },
          {
            content: "  /create_item_type \"Name\", \"Description\", is_container, container_capacity, \"icon_url\", stack_max - Create item type",
            type: 'system'
          },
          {
            content: "  /create_item \"Item Name\"|type_id [count] - Create a new item",
            type: 'system'
          },
          {
            content: "  /create_class \"Name\", \"Description\" - Create a new character class",
            type: 'system'
          },
          {
            content: "  /update_class \"Class Name\", \"attribute\", \"value\" - Update a character class attribute",
            type: 'system'
          },
          {
            content: "  /list_classes - Show all character classes and their descriptions",
            type: 'system'
          },
          {
            content: "  /show_class <name> - Show detailed information about a character class",
            type: 'system'
          },
          {
            content: "",
            type: 'system'
          },
          {
            content: "Help:",
            type: 'system'
          },
          {
            content: "  /help, /? - Show this help message",
            type: 'system'
          }
        ]);
        return;
      }

      // Handle attack command
      if (command.toLowerCase().startsWith('/attack ')) {
        const targetName = command.substring(command.indexOf(' ') + 1).trim();
        try {
          const result = await authenticatedActor.attack(targetName);
          if ('err' in result) {
            setMessages(prev => [...prev, {
              content: `Error: ${result.err}`,
              type: 'error'
            }]);
          }
          // Success message comes from backend via message polling
        } catch (error) {
          console.error("Error attacking:", error);
          setMessages(prev => [...prev, {
            content: `Error: ${error.message}`,
            type: 'error'
          }]);
        }
        return;
      }

      // Handle movement commands (/go or /g)
      if (command.toLowerCase().startsWith('/go ') || command.toLowerCase().startsWith('/g ')) {
        const exitCommand = command.substring(command.indexOf(' ') + 1).trim();
        const matchingExitId = findMatchingExit(exitCommand, currentRoom?.exits);
        
        if (!matchingExitId) {
          setMessages(prev => [...prev, {
            content: `No matching exit found for '${exitCommand}'`,
            type: 'error'
          }]);
          return;
        }

        try {
          const result = await authenticatedActor.useExit(matchingExitId);
          if ('ok' in result) {
            await updateCurrentRoom();
          } else if ('err' in result) {
            setMessages(prev => [...prev, {
              content: `Error: ${result.err}`,
              type: 'error'
            }]);
          }
        } catch (error) {
          console.error("Error executing command:", error);
          setMessages(prev => [...prev, {
            content: `Error: Failed to use exit - ${error.message || 'Unknown error'}`,
            type: 'error'
          }]);
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
              setMessages(prev => [...prev, {
                content: `Error: ${result.err}`,
                type: 'error'
              }]);
            }
          } catch (error) {
            console.error("Error saying message:", error);
            setMessages(prev => [...prev, {
              content: `Error: Failed to say message - ${error.message || 'Unknown error'}`,
              type: 'error'
            }]);
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
              setMessages(prev => [...prev, {
                content: `Error: ${result.err}`,
                type: 'error'
              }]);
            }
          } catch (error) {
            console.error("Error whispering message:", error);
            setMessages(prev => [...prev, {
              content: `Error: Failed to whisper message - ${error.message || 'Unknown error'}`,
              type: 'error'
            }]);
          }
        } else {
          setMessages(prev => [...prev, {
            content: "Error: Whisper command format is '/w <player> <message>'",
            type: 'error'
          }]);
        }
        return;
      }

      // Handle look command (/look)
      if (command.toLowerCase().startsWith('/look ') || command.toLowerCase() === '/look' || command.toLowerCase() === '/l') {
        if (!currentRoom) {
          setMessages(prev => [...prev, {
            content: "You can't see anything.",
            type: 'system'
          }]);
          return;
        }

        console.log("Current room data:", currentRoom);
        console.log("Room exits:", currentRoom.exits);

        // Check if looking at a specific target
        if (command.toLowerCase().startsWith('/look ') || command.toLowerCase().startsWith('/l ')) {
          const targetName = command.substring(command.indexOf(' ') + 1).trim();

          // First check if it's a player
          const targetPlayer = playersInRoom.find(([_, name]) => name.toLowerCase() === targetName.toLowerCase());
          if (targetPlayer) {
            try {
              const result = await authenticatedActor.lookAtPlayer(targetPlayer[1]);
              if ('ok' in result) {
                setMessages(prev => [...prev, {
                  content: `${targetPlayer[1]}`,
                  type: 'system'
                }, {
                  content: formatStatsForOthers(result.ok),
                  type: 'system'
                }]);
              } else {
                setMessages(prev => [...prev, {
                  content: `${targetPlayer[1]} is here.`,
                  type: 'system'
                }, {
                  content: result.err,
                  type: 'error'
                }]);
              }
            } catch (error) {
              console.error("Error examining player:", error);
              setMessages(prev => [...prev, {
                content: `${targetPlayer[1]} is here.`,
                type: 'system'
              }]);
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
              setMessages(prev => [...prev, {
                content: `${exit.name}${directionStr}`,
                type: 'room'
              }, {
                content: exit.description,
                type: 'room'
              }]);
              return;
            }

            // If we were looking for a direction but didn't find a matching exit
            if (directionMap[searchName] || Object.values(directionMap).includes(searchName)) {
              setMessages(prev => [...prev, {
                content: `You see no exit in that direction.`,
                type: 'system'
              }]);
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
                {
                  content: `${itemInfo.item_type.name}`,
                  type: 'item'
                },
                {
                  content: itemInfo.item_type.description,
                  type: 'system'
                },
              ];

              // Add container-specific information
              if (itemInfo.item_type.is_container) {
                messages.push({
                  content: "",
                  type: 'system'
                });
                if (itemInfo.is_open) {
                  const contentsResult = await authenticatedActor.getContainerContents(item.id);
                  if ('ok' in contentsResult) {
                    const contents = contentsResult.ok;
                    if (contents.length > 0) {
                      messages.push({
                        content: "Contents:",
                        type: 'system'
                      });
                      for (const itemId of contents) {
                        const contentItemResult = await authenticatedActor.getItem(itemId);
                        if ('ok' in contentItemResult) {
                          const contentItem = contentItemResult.ok;
                          const countStr = contentItem.count > 1 ? ` (x${contentItem.count})` : '';
                          messages.push({
                            content: `  ${contentItem.item_type.name}${countStr}`,
                            type: 'item'
                          });
                        }
                      }
                    } else {
                      messages.push({
                        content: "The container is empty.",
                        type: 'system'
                      });
                    }
                  }
                } else {
                  messages.push({
                    content: "The container is closed.",
                    type: 'system'
                  });
                }
              }

              setMessages(prev => [...prev, ...messages]);
              return;
            } else {
              setMessages(prev => [...prev, {
                content: `Error: ${itemResult.err}`,
                type: 'error'
              }]);
              return;
            }
          } catch (error) {
            console.error("Error examining item:", error);
            setMessages(prev => [...prev, {
              content: `Error: ${error.message}`,
              type: 'error'
            }]);
            return;
          }
        }

        const roomMessages = [
          {
            type: 'room',
            parts: [
              { 
                type: 'room',
                content: currentRoom.name,
                entityId: currentRoom.id,
                interactable: {
                  tooltip: 'Click to examine room',
                  actions: {
                    click: `/examine room ${currentRoom.id}`
                  }
                }
              }
            ]
          },
          {
            type: 'room',
            parts: [{ type: 'text', content: currentRoom.description }]
          }
        ];

        // Add exits section
        if (currentRoom.exits && currentRoom.exits.length > 0) {
          roomMessages.push({
            type: 'room',
            parts: [
              { type: 'text', content: '\nObvious exits:\n' },
              ...currentRoom.exits.flatMap(([exitId, exit], index) => [
                { type: 'text', content: '  ' },
                {
                  type: 'exit',
                  content: exit.direction?.length > 0 ? exit.direction[0] : exit.name,
                  entityId: exitId,
                  interactable: {
                    tooltip: exit.description || `Exit to ${exit.name}`,
                    actions: {
                      click: `/go ${exitId}`
                    }
                  }
                },
                { type: 'text', content: index < currentRoom.exits.length - 1 ? '\n' : '' }
              ])
            ]
          });
        }

        // Add items section
        if (currentRoom.items && currentRoom.items.length > 0) {
          roomMessages.push({
            type: 'room',
            parts: [
              { type: 'text', content: '\nYou see:\n' },
              ...currentRoom.items.flatMap((item, index) => [
                { type: 'text', content: '  ' },
                {
                  type: 'item',
                  content: item.name + (item.count > 1 ? ` (x${item.count})` : ''),
                  entityId: item.id,
                  interactable: {
                    tooltip: `${item.description}\n${item.isContainer ? (item.isOpen ? '[open]' : '[closed]') : ''}`,
                    actions: {
                      click: `/examine ${item.id}`
                    }
                  }
                },
                { type: 'text', content: index < currentRoom.items.length - 1 ? '\n' : '' }
              ])
            ]
          });
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
              setMessages(prev => [...prev, {
                content: "Your inventory is empty.",
                type: 'system'
              }]);
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
              {
                content: "Your inventory contains:",
                type: 'system'
              },
              ...Object.values(groupedItems).map(group => ({
                content: `  ${group.type.name}${group.count > 1 ? ` (x${group.count})` : ''}`,
                type: 'system'
              }))
            ]);
          } else if ('err' in result) {
            setMessages(prev => [...prev, {
              content: `Error: ${result.err}`,
              type: 'error'
            }]);
          }
        } catch (error) {
          console.error("Error getting inventory:", error);
          setMessages(prev => [...prev, {
            content: `Error: Failed to get inventory - ${error.message || 'Unknown error'}`,
            type: 'error'
          }]);
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
            setMessages(prev => [...prev, {
              content: "Error: Drop command format is '/drop <item>' or '/drop <item> <count>'",
              type: 'error'
            }]);
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
              setMessages(prev => [...prev, {
                content: `Error: ${result.err}`,
                type: 'error'
              }]);
            }
            // Success message comes from backend via message polling
          } catch (error) {
            console.error("Error dropping item:", error);
            setMessages(prev => [...prev, {
              content: `Error: ${error.message}`,
              type: 'error'
            }]);
          }
        } catch (error) {
          setMessages(prev => [...prev, {
            content: "Error: Drop command format is '/drop <item>' or '/drop <item> <count>'",
            type: 'error'
          }]);
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
            setMessages(prev => [...prev, {
              content: "Error: Pick command format is '/pick <item>' or '/pick <item> <count>'",
              type: 'error'
            }]);
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
              setMessages(prev => [...prev, {
                content: `Error: ${result.err}`,
                type: 'error'
              }]);
            }
            // Success message comes from backend via message polling
          } catch (error) {
            console.error("Error picking up item:", error);
            setMessages(prev => [...prev, {
              content: `Error: ${error.message}`,
              type: 'error'
            }]);
          }
        } catch (error) {
          setMessages(prev => [...prev, {
            content: "Error: Pick command format is '/pick <item>' or '/pick <item> <count>'",
            type: 'error'
          }]);
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
            setMessages(prev => [...prev, {
              content: "Error: Give command format is '/give <item> to <player>' or '/give <item> to <player> <count>'",
              type: 'error'
            }]);
            return;
          }
          
          const [_, itemStr, targetPlayerName, countStr] = matches;
          const count = countStr ? parseInt(countStr) : 1;
          
          try {
            // First check if target player is in the room (exact match)
            const targetPlayer = playersInRoom.find(([_, name]) => name === targetPlayerName);
            
            if (!targetPlayer) {
              setMessages(prev => [...prev, {
                content: `Error: ${targetPlayerName} is not in the room`,
                type: 'error'
              }]);
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
              setMessages(prev => [...prev, {
                content: `Error: ${result.err}`,
                type: 'error'
              }]);
            }
            // Success message comes from backend via message polling
          } catch (error) {
            console.error("Error giving item:", error);
            setMessages(prev => [...prev, {
              content: `Error: ${error.message}`,
              type: 'error'
            }]);
          }
        } catch (error) {
          setMessages(prev => [...prev, {
            content: "Error: Give command format is '/give <item> to <player>' or '/give <item> to <player> <count>'",
            type: 'error'
          }]);
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
              setMessages(prev => [...prev, {
                content: `${item.name} is now open`,
                type: 'system'
              }]);
            } else {
              // If it returned false, it was open, so toggle it back
              const secondResult = await authenticatedActor.toggleContainer(item.id);
              if ('ok' in secondResult) {
                setMessages(prev => [...prev, {
                  content: `${item.name} is already open`,
                  type: 'system'
                }]);
              }
            }
          } else if ('err' in result) {
            setMessages(prev => [...prev, {
              content: `Error: ${result.err}`,
              type: 'error'
            }]);
          }
        } catch (error) {
          console.error("Error opening container:", error);
          setMessages(prev => [...prev, {
            content: `Error: ${error.message}`,
            type: 'error'
          }]);
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
              setMessages(prev => [...prev, {
                content: `${item.name} is now closed`,
                type: 'system'
              }]);
            } else {
              // If it returned true, it was closed, so toggle it back
              const secondResult = await authenticatedActor.toggleContainer(item.id);
              if ('ok' in secondResult) {
                setMessages(prev => [...prev, {
                  content: `${item.name} is already closed`,
                  type: 'system'
                }]);
              }
            }
          } else if ('err' in result) {
            setMessages(prev => [...prev, {
              content: `Error: ${result.err}`,
              type: 'error'
            }]);
          }
        } catch (error) {
          console.error("Error closing container:", error);
          setMessages(prev => [...prev, {
            content: `Error: ${error.message}`,
            type: 'error'
          }]);
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
            setMessages(prev => [...prev, {
              content: "Error: Put command format is '/put <item> in <container>' or '/put <item> in <container> <count>'",
              type: 'error'
            }]);
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
              setMessages(prev => [...prev, {
                content: `Error: ${result.err}`,
                type: 'error'
              }]);
            }
          } catch (error) {
            console.error("Error putting item in container:", error);
            setMessages(prev => [...prev, {
              content: `Error: ${error.message}`,
              type: 'error'
            }]);
          }
        } catch (error) {
          setMessages(prev => [...prev, {
            content: "Error: Put command format is '/put <item> in <container>' or '/put <item> in <container> <count>'",
            type: 'error'
          }]);
        }
        return;
      }

      // Handle stats command
      if (command === '/stats') {
        const stats = await authenticatedActor.getStats();
        if ('ok' in stats) {
          setMessages(prev => [...prev, {
            content: formatStats(stats.ok),
            type: 'system'
          }]);
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
            setMessages(prev => [...prev, {
              content: `Error: ${result.err}`,
              type: 'error'
            }]);
          }
          // Success message comes from backend via message polling
        } catch (error) {
          console.error("Error creating character:", error);
          setMessages(prev => [...prev, {
            content: `Error: ${error.message}`,
            type: 'error'
          }]);
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
            setMessages(prev => [...prev, {
              content: 'Error: Create room command format is \'/create_room "Room Name", "Room Description"\'',
              type: 'error'
            }]);
            return;
          }
          
          const [_, name, description] = matches;
          try {
            const result = await authenticatedActor.createRoom(name, description);
            if ('err' in result) {
              setMessages(prev => [...prev, {
                content: `Error: ${result.err}`,
                type: 'error'
              }]);
            } else {
              const roomId = result.ok;
              setMessages(prev => [...prev, {
                content: `Successfully created room "${name}" (ID: ${roomId})`,
                type: 'system'
              }]);
            }
          } catch (error) {
            console.error("Error creating room:", error);
            setMessages(prev => [...prev, {
              content: `Error: ${error.message}`,
              type: 'error'
            }]);
          }
        } catch (error) {
          setMessages(prev => [...prev, {
            content: 'Error: Create room command format is \'/create_room "Room Name", "Room Description"\'',
            type: 'error'
          }]);
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
            setMessages(prev => [...prev, {
              content: 'Error: Create exit command format is \'/create_exit "Exit ID", "Exit Name", "Exit Description", target_room_id[, "direction"]\'',
              type: 'error'
            }]);
            return;
          }
          
          const [_, exitId, name, description, targetRoomId, direction] = matches;
          try {
            if (!currentRoom) {
              setMessages(prev => [...prev, {
                content: 'Error: You must be in a room to create an exit',
                type: 'error'
              }]);
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
              setMessages(prev => [...prev, {
                content: `Error: ${result.err}`,
                type: 'error'
              }]);
            } else {
              setMessages(prev => [...prev, {
                content: `Successfully created exit "${name}" (ID: ${exitId}) leading to room ${targetRoomId}${direction ? ` in direction ${direction}` : ''}`,
                type: 'system'
              }]);
            }
          } catch (error) {
            console.error("Error creating exit:", error);
            setMessages(prev => [...prev, {
              content: `Error: ${error.message}`,
              type: 'error'
            }]);
          }
        } catch (error) {
          setMessages(prev => [...prev, {
            content: 'Error: Create exit command format is \'/create_exit "Exit ID", "Exit Name", "Exit Description", target_room_id[, "direction"]\'',
            type: 'error'
          }]);
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
            setMessages(prev => [...prev, {
              content: "Error: Create item type command format is '/create_item_type \"Name\", \"Description\", is_container, container_capacity, \"icon_url\", stack_max'\nFor non-containers, use 'null' as the container_capacity. For containers, use a number.",
              type: 'error'
            }]);
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
                setMessages(prev => [...prev, {
                  content: `Error: An item type with the name "${name}" already exists (ID: ${existingType.id})`,
                  type: 'error'
                }]);
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
              setMessages(prev => [...prev, {
                content: `Successfully created item type ${name} with ID ${result.ok}`,
                type: 'system'
              }]);
            } else if ('err' in result) {
              setMessages(prev => [...prev, {
                content: `Error: ${result.err}`,
                type: 'error'
              }]);
            }
          } catch (error) {
            console.error("Error creating item type:", error);
            setMessages(prev => [...prev, {
              content: `Error: Failed to create item type - ${error.message || 'Unknown error'}`,
              type: 'error'
            }]);
          }
        } catch (error) {
          setMessages(prev => [...prev, {
            content: "Error: Create item type command format is '/create_item_type \"Name\", \"Description\", is_container, container_capacity, \"icon_url\", stack_max'\nFor non-containers, use 'null' as the container_capacity. For containers, use a number.",
            type: 'error'
          }]);
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
            setMessages(prev => [...prev, {
              content: "Error: Create item command format is '/create_item \"Item Name\" [count]' or '/create_item type_id [count]'",
              type: 'error'
            }]);
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
                setMessages(prev => [...prev, {
                  content: `Error: No item type found with name "${quotedName}"`,
                  type: 'error'
                }]);
                return;
              }
              typeId = matchingType.id;
              console.log("Found type ID from name:", typeId);
            } else {
              setMessages(prev => [...prev, {
                content: `Error: Failed to get item types`,
                type: 'error'
              }]);
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
            setMessages(prev => [...prev, {
              content: `Error: ${typeResult.err}`,
              type: 'error'
            }]);
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
            setMessages(prev => [...prev, {
              content: `Successfully created ${typeName}${countStr} with ID ${result.ok}`,
              type: 'system'
            }]);
          } else if ('err' in result) {
            setMessages(prev => [...prev, {
              content: `Error: ${result.err}`,
              type: 'error'
            }]);
          }
        } catch (error) {
          console.error("Error creating item:", error);
          setMessages(prev => [...prev, {
            content: "Error: Invalid command format. Use '/create_item \"Item Name\" [count]' or '/create_item type_id [count]'",
            type: 'error'
          }]);
        }
        return;
      }

      // Add new command handlers for token management
      if (command.startsWith('/wallet register')) {
        const matches = command.match(/^\/wallet register ([a-z0-9-]+)$/);
        if (!matches) {
          setMessages(prev => [...prev, {
            content: 'Usage: /wallet register <canister_id>',
            type: 'error'
          }]);
          return;
        }

        const canisterId = matches[1];
        try {
          const result = await authenticatedActor.registerToken(Principal.fromText(canisterId));
          if ('err' in result) {
            setMessages(prev => [...prev, {
              content: `Error registering token: ${result.err}`,
              type: 'error'
            }]);
          } else {
            setMessages(prev => [...prev, {
              content: `Successfully registered token ledger ${canisterId}`,
              type: 'system'
            }]);
          }
        } catch (e) {
          setMessages(prev => [...prev, {
            content: `Error registering token: ${e.message}`,
            type: 'error'
          }]);
        }
        return;
      }

      if (command.startsWith('/wallet unregister')) {
        const matches = command.match(/^\/wallet unregister ([a-z0-9-]+)$/);
        if (!matches) {
          setMessages(prev => [...prev, {
            content: 'Usage: /wallet unregister <canister_id>',
            type: 'error'
          }]);
          return;
        }

        const canisterId = matches[1];
        try {
          const result = await authenticatedActor.unregisterToken(Principal.fromText(canisterId));
          if ('err' in result) {
            setMessages(prev => [...prev, {
              content: `Error unregistering token: ${result.err}`,
              type: 'error'
            }]);
          } else {
            setMessages(prev => [...prev, {
              content: `Successfully unregistered token ledger ${canisterId}`,
              type: 'system'
            }]);
          }
        } catch (e) {
          setMessages(prev => [...prev, {
            content: `Error unregistering token: ${e.message}`,
            type: 'error'
          }]);
        }
        return;
      }

      if (command === '/wallet tokens') {
        try {
          const tokens = await authenticatedActor.getRegisteredTokens();
          if (tokens.length === 0) {
            setMessages(prev => [...prev, {
              content: 'No registered tokens found',
              type: 'system'
            }]);
          } else {
            setMessages(prev => [...prev, {
              content: 'Registered tokens:',
              type: 'system'
            }]);
            for (const token of tokens) {
              const { metadata, ledgerCanisterId } = token;
              const staleWarning = await authenticatedActor.hasStaleMetadata() ? ' (metadata needs refresh)' : '';
              setMessages(prev => [...prev, {
                content: `${metadata.name} (${metadata.symbol}) - ${ledgerCanisterId.toText()}${staleWarning}`,
                type: 'system'
              }]);
            }
          }
        } catch (e) {
          setMessages(prev => [...prev, {
            content: `Error listing tokens: ${e.message}`,
            type: 'error'
          }]);
        }
        return;
      }

      if (command.startsWith('/wallet refresh')) {
        const matches = command.match(/^\/wallet refresh ([a-z0-9-]+)$/);
        if (!matches) {
          setMessages(prev => [...prev, {
            content: 'Usage: /wallet refresh <canister_id>',
            type: 'error'
          }]);
          return;
        }

        const canisterId = matches[1];
        try {
          const result = await authenticatedActor.refreshTokenMetadata(Principal.fromText(canisterId));
          if ('err' in result) {
            setMessages(prev => [...prev, {
              content: `Error refreshing token metadata: ${result.err}`,
              type: 'error'
            }]);
          } else {
            setMessages(prev => [...prev, {
              content: `Successfully refreshed metadata for token ledger ${canisterId}`,
              type: 'system'
            }]);
          }
        } catch (e) {
          setMessages(prev => [...prev, {
            content: `Error refreshing token metadata: ${e.message}`,
            type: 'error'
          }]);
        }
        return;
      }

      // Handle create_class command
      if (command.toLowerCase().startsWith('/create_class ')) {
        const argsString = command.substring(command.indexOf(' ') + 1).trim();
        
        try {
          // Match format: "Name", "Description"
          const matches = argsString.match(/^"([^"]+)"\s*,\s*"([^"]+)"$/);
          if (!matches) {
            setMessages(prev => [...prev, {
              content: 'Error: Create class command format is \'/create_class "Class Name", "Class Description"\'',
              type: 'error'
            }]);
            return;
          }
          
          const [_, name, description] = matches;
          try {
            const result = await authenticatedActor.createCharacterClass(name, description);
            if ('err' in result) {
              setMessages(prev => [...prev, {
                content: `Error: ${result.err}`,
                type: 'error'
              }]);
            } else {
              setMessages(prev => [...prev, {
                content: `Successfully created character class "${name}"`,
                type: 'system'
              }]);
            }
          } catch (error) {
            console.error("Error creating character class:", error);
            setMessages(prev => [...prev, {
              content: `Error: ${error.message}`,
              type: 'error'
            }]);
          }
        } catch (error) {
          setMessages(prev => [...prev, {
            content: 'Error: Create class command format is \'/create_class "Class Name", "Class Description"\'',
            type: 'error'
          }]);
        }
        return;
      }

      // Handle show_class command
      if (command.toLowerCase().startsWith('/show_class ')) {
        const className = command.substring(command.indexOf(' ') + 1).trim();
        try {
          const result = await authenticatedActor.showCharacterClass(className);
          if ('ok' in result) {
            const characterClass = result.ok;
            const baseStats = characterClass.baseStats;
            const growthRates = characterClass.growthRates;
            
            setMessages(prev => [...prev, {
              content: `Character Class: ${characterClass.name}`,
              type: 'system'
            }, {
              content: characterClass.description,
              type: 'system'
            }, {
              content: "",
              type: 'system'
            }, {
              content: "Base Stats:",
              type: 'system'
            }, {
              content: `HP: ${baseStats.baseHp}`,
              type: 'system'
            }, {
              content: `MP: ${baseStats.baseMp}`,
              type: 'system'
            }, {
              content: `Physical Attack: ${baseStats.basePhysicalAttack}`,
              type: 'system'
            }, {
              content: `Physical Defense: ${baseStats.basePhysicalDefense}`,
              type: 'system'
            }, {
              content: `Magic Attack: ${baseStats.baseMagicAttack}`,
              type: 'system'
            }, {
              content: `Magic Defense: ${baseStats.baseMagicDefense}`,
              type: 'system'
            }, {
              content: `Attack Speed: ${baseStats.baseAttackSpeed}`,
              type: 'system'
            }, {
              content: "",
              type: 'system'
            }, {
              content: "Primary Attributes:",
              type: 'system'
            }, {
              content: `Strength: ${baseStats.strength}`,
              type: 'system'
            }, {
              content: `Dexterity: ${baseStats.dexterity}`,
              type: 'system'
            }, {
              content: `Constitution: ${baseStats.constitution}`,
              type: 'system'
            }, {
              content: `Intelligence: ${baseStats.intelligence}`,
              type: 'system'
            }, {
              content: `Wisdom: ${baseStats.wisdom}`,
              type: 'system'
            }, {
              content: "",
              type: 'system'
            }, {
              content: "Growth Rates:",
              type: 'system'
            }, {
              content: `HP per Level: ${growthRates.hpPerLevel}`,
              type: 'system'
            }, {
              content: `MP per Level: ${growthRates.mpPerLevel}`,
              type: 'system'
            }, {
              content: `HP per Constitution: ${growthRates.hpPerCon}`,
              type: 'system'
            }, {
              content: `MP per Wisdom: ${growthRates.mpPerWis}`,
              type: 'system'
            }, {
              content: `Physical Attack per Strength: ${growthRates.physicalAttackPerStr}`,
              type: 'system'
            }, {
              content: `Physical Defense per Constitution: ${growthRates.physicalDefensePerCon}`,
              type: 'system'
            }, {
              content: `Magic Attack per Intelligence: ${growthRates.magicAttackPerInt}`,
              type: 'system'
            }, {
              content: `Magic Defense per Wisdom: ${growthRates.magicDefensePerWis}`,
              type: 'system'
            }, {
              content: `Attack Speed per Dexterity: ${growthRates.attackSpeedPerDex}`,
              type: 'system'
            }]);
          } else {
            setMessages(prev => [...prev, {
              content: `Error: ${result.err}`,
              type: 'error'
            }]);
          }
        } catch (error) {
          console.error("Error showing character class:", error);
          setMessages(prev => [...prev, {
            content: `Error: ${error.message}`,
            type: 'error'
          }]);
        }
        return;
      }

      // Handle list_classes command
      if (command === '/list_classes') {
        try {
          const result = await authenticatedActor.listCharacterClasses();
          if ('ok' in result) {
            const classes = result.ok;
            if (classes.length === 0) {
              setMessages(prev => [...prev, {
                content: "No character classes available.",
                type: 'system'
              }]);
            } else {
              setMessages(prev => [
                ...prev,
                {
                  content: "Available Character Classes:",
                  type: 'system'
                },
                ...classes.map(c => ({
                  content: `${c.name} - ${c.description}`,
                  type: 'system'
                }))
              ]);
            }
          } else {
            setMessages(prev => [...prev, {
              content: `Error: ${result.err}`,
              type: 'error'
            }]);
          }
        } catch (error) {
          console.error("Error listing character classes:", error);
          setMessages(prev => [...prev, {
            content: `Error: ${error.message}`,
            type: 'error'
          }]);
        }
        return;
      }

      // Handle update_class command
      if (command.toLowerCase().startsWith('/update_class ')) {
        const argsString = command.substring(command.indexOf(' ') + 1).trim();
        
        try {
          // Match format: "Class Name", "attribute", "value"
          const matches = argsString.match(/^"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"$/);
          if (!matches) {
            setMessages(prev => [...prev, {
              content: 'Error: Update class command format is \'/update_class "Class Name", "attribute", "value"\'',
              type: 'error'
            }]);
            return;
          }
          
          const [_, className, attribute, value] = matches;
          try {
            const result = await authenticatedActor.updateCharacterClass(className, attribute, value);
            if ('err' in result) {
              setMessages(prev => [...prev, {
                content: `Error: ${result.err}`,
                type: 'error'
              }]);
            } else {
              setMessages(prev => [...prev, {
                content: `Successfully updated ${attribute} for character class "${className}"`,
                type: 'system'
              }]);
            }
          } catch (error) {
            console.error("Error updating character class:", error);
            setMessages(prev => [...prev, {
              content: `Error: ${error.message}`,
              type: 'error'
            }]);
          }
        } catch (error) {
          setMessages(prev => [...prev, {
            content: 'Error: Update class command format is \'/update_class "Class Name", "attribute", "value"\'',
            type: 'error'
          }]);
        }
        return;
      }

      // Handle AFK command
      if (command.toLowerCase().startsWith('/afk')) {
        try {
          const message = command.substring(4).trim(); // Get everything after '/afk'
          const result = await authenticatedActor.setAfk(message);
          if ('err' in result) {
            setMessages(prev => [...prev, {
              content: result.err,
              type: 'error'
            }]);
          }
        } catch (error) {
          setMessages(prev => [...prev, {
            content: "Error setting AFK status: " + error.message,
            type: 'error'
          }]);
        }
        return;
      }

      // Handle back command
      if (command === '/back') {
        try {
          const result = await authenticatedActor.returnFromAfk();
          if ('err' in result) {
            setMessages(prev => [...prev, {
              content: result.err,
              type: 'error'
            }]);
          }
        } catch (error) {
          setMessages(prev => [...prev, {
            content: "Error returning from AFK: " + error.message,
            type: 'error'
          }]);
        }
        return;
      }

      // Inside the handleCommand function, add these new cases:

      if (command === '/online') {
        try {
          const result = await authenticatedActor.getOnlinePlayers();
          if ('ok' in result) {
            const players = result.ok;
            if (players.length === 0) {
              setMessages(prev => [...prev, {
                content: "No players currently online.",
                type: 'system'
              }]);
            } else {
              setMessages(prev => [
                ...prev,
                {
                  content: "Online Players:",
                  type: 'system'
                },
                ...players.map(p => ({
                  content: `${p.name} (${p.characterClass})${p.status === 'Afk' ? p.afkMessage ? ': ' + p.afkMessage : '' : ''}`,
                  type: 'system'
                }))
              ]);
            }
          } else {
            setMessages(prev => [...prev, {
              content: `Error: ${result.err}`,
              type: 'error'
            }]);
          }
        } catch (error) {
          console.error("Error getting online players:", error);
          setMessages(prev => [...prev, {
            content: `Error: ${error.message}`,
            type: 'error'
          }]);
        }
        return;
      }

      if (command === '/players') {
        try {
          const result = await authenticatedActor.getAllPlayers();
          if ('ok' in result) {
            const players = result.ok;
            if (players.length === 0) {
              setMessages(prev => [...prev, {
                content: "No registered players found.",
                type: 'system'
              }]);
            } else {
              setMessages(prev => [
                ...prev,
                {
                  content: "All Players:",
                  type: 'system'
                },
                ...players.map(p => ({
                  content: `${p.name} (${p.characterClass}) - ${p.status === 'Online' ? 'Online' : p.status === 'Afk' ? 'AFK' : 'Offline'}${p.status === 'Afk' && p.afkMessage ? ': ' + p.afkMessage : ''}`,
                  type: 'system'
                }))
              ]);
            }
          } else {
            setMessages(prev => [...prev, {
              content: `Error: ${result.err}`,
              type: 'error'
            }]);
          }
        } catch (error) {
          console.error("Error getting all players:", error);
          setMessages(prev => [...prev, {
            content: `Error: ${error.message}`,
            type: 'error'
          }]);
        }
        return;
      }

      // If no command matched, show error
      setMessages(prev => [...prev, {
        content: "Unknown command. Type /help for available commands.",
        type: 'error'
      }]);
    } catch (error) {
      setMessages(prev => [...prev, {
        content: "Error: " + error.message,
        type: 'error'
      }]);
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
      <TextLog 
        messages={messages} 
        onCommand={handleCommand}
      />
      <RoomInterface 
        onCommand={handleCommand}
        currentRoom={currentRoom}
      />
    </div>
  );
}

export default GamePage; 