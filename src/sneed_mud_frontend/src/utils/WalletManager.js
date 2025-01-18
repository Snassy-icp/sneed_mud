import { Principal } from "@dfinity/principal";
import { SUPPORTED_TOKENS, createICRC1Actor, formatTokenAmount, parseTokenAmount } from "./TokenConfig";

// Get balance for a specific token by canister ID
export async function getTokenBalanceByCanisterId(canisterId, principal, agent, decimals = 8) {
  if (!agent) {
    throw new Error("Not authenticated. Please log in again.");
  }

  const actor = createICRC1Actor(canisterId, agent);
  try {
    const balance = await actor.icrc1_balance_of({
      owner: Principal.fromText(principal),
      subaccount: []
    });
    return balance;
  } catch (error) {
    console.error(`Error fetching balance for canister ${canisterId}:`, error);
    throw new Error(`Failed to fetch balance: ${error.message}`);
  }
}

// Get balance for a supported token by symbol
export async function getTokenBalance(tokenSymbol, principal, agent) {
  if (!agent) {
    throw new Error("Not authenticated. Please log in again.");
  }

  const config = SUPPORTED_TOKENS[tokenSymbol];
  if (!config) {
    throw new Error(`Unsupported token: ${tokenSymbol}`);
  }

  return getTokenBalanceByCanisterId(config.ledgerCanisterId, principal, agent);
}

// Get all token balances (both supported and registered)
export async function getAllBalances(principal, hideZeroBalances, agent, authenticatedActor) {
  const balances = [];

  // First get balances for supported tokens
  for (const [symbol, config] of Object.entries(SUPPORTED_TOKENS)) {
    try {
      const balance = await getTokenBalance(symbol, principal, agent);
      if (!hideZeroBalances || balance > 0n) {
        balances.push({
          symbol,
          name: config.name,
          balance: BigInt(balance),
          formatted: formatTokenAmount(BigInt(balance), config.decimals),
          canisterId: config.ledgerCanisterId
        });
      }
    } catch (error) {
      balances.push({
        symbol,
        name: config.name,
        balance: 0n,
        formatted: "Error",
        error: error.message,
        canisterId: config.ledgerCanisterId
      });
    }
  }

  // Then get balances for registered tokens
  try {
    // Get the list of registered tokens
    let result = await authenticatedActor.getRegisteredTokens();
    console.log("getRegisteredTokens response:", result);
    
    // If we get an error, refresh metadata and try again
    if ('err' in result) {
      console.log("Got error from getRegisteredTokens:", result.err);
      // Refresh all metadata
      await authenticatedActor.refreshTokenMetadata();
      // Try getting tokens again
      result = await authenticatedActor.getRegisteredTokens();
      console.log("getRegisteredTokens response after refresh:", result);
      if ('err' in result) {
        throw new Error(`Failed to get tokens after refresh: ${result.err}`);
      }
    }

    // Verify we have a valid response
    if (!result || typeof result !== 'object' || !('ok' in result)) {
      console.log("Invalid response:", result);
      throw new Error('Invalid response from getRegisteredTokens');
    }

    const registeredTokens = result.ok;
    if (!Array.isArray(registeredTokens)) {
      console.log("ok field is not an array:", registeredTokens);
      throw new Error('Invalid response from getRegisteredTokens: ok field is not an array');
    }

    // Process each token
    for (const token of registeredTokens) {
      // Skip if this token is already in supported tokens
      if (balances.some(b => b.canisterId === token.ledgerCanisterId.toText())) {
        continue;
      }

      const canisterId = token.ledgerCanisterId.toText();
      // Access first element of metadata array
      if (!token.metadata || !Array.isArray(token.metadata) || token.metadata.length === 0) {
        balances.push({
          symbol: "Unknown",
          name: "Unknown Token",
          balance: 0n,
          formatted: "Error",
          error: "Missing metadata",
          canisterId
        });
        continue;
      }
      const metadata = token.metadata[0];

      try {
        const balance = await getTokenBalanceByCanisterId(
          canisterId,
          principal,
          agent,
          metadata.decimals
        );
        console.log("Raw balance for", metadata.symbol, ":", balance, typeof balance);

        const bigIntBalance = BigInt(balance.toString());
        console.log("Converted balance:", bigIntBalance, typeof bigIntBalance);

        if (!hideZeroBalances || bigIntBalance > 0n) {
          balances.push({
            symbol: metadata.symbol || "Unknown",
            name: metadata.name || "Unknown Token",
            balance: bigIntBalance,
            formatted: formatTokenAmount(bigIntBalance, metadata.decimals),
            canisterId
          });
        }
      } catch (error) {
        console.error("Error processing balance for", metadata.symbol, ":", error);
        balances.push({
          symbol: metadata.symbol || "Unknown",
          name: metadata.name || "Unknown Token",
          balance: 0n,
          formatted: "Error",
          error: error.message,
          canisterId
        });
      }
    }
  } catch (error) {
    console.error("Error fetching registered tokens:", error);
  }

  return balances;
}

// Transfer tokens (works with both supported and registered tokens)
export async function transferTokens(tokenSymbol, fromPrincipal, toPrincipal, amount, agent, authenticatedActor) {
  if (!agent) {
    throw new Error("Not authenticated. Please log in again.");
  }

  // First check if it's a supported token
  const config = SUPPORTED_TOKENS[tokenSymbol];
  let canisterId;
  let decimals;
  let fee;

  if (config) {
    canisterId = config.ledgerCanisterId;
    decimals = config.decimals;
    fee = config.fee;
  } else {
    // If not supported, check registered tokens
    let result = await authenticatedActor.getRegisteredTokens();
    console.log("getRegisteredTokens response in transfer:", result);
    
    // If we get an error, refresh metadata and try again
    if ('err' in result) {
      console.log("Got error from getRegisteredTokens in transfer:", result.err);
      // Refresh all metadata
      await authenticatedActor.refreshTokenMetadata();
      // Try getting tokens again
      result = await authenticatedActor.getRegisteredTokens();
      console.log("getRegisteredTokens response after refresh in transfer:", result);
      if ('err' in result) {
        throw new Error(`Failed to get tokens after refresh: ${result.err}`);
      }
    }

    // Verify we have a valid response
    if (!result || typeof result !== 'object' || !('ok' in result)) {
      console.log("Invalid response in transfer:", result);
      throw new Error('Invalid response from getRegisteredTokens');
    }

    const registeredTokens = result.ok;
    if (!Array.isArray(registeredTokens)) {
      console.log("ok field is not an array in transfer:", registeredTokens);
      throw new Error('Invalid response from getRegisteredTokens: ok field is not an array');
    }

    const token = registeredTokens.find(t => {
      if (!t.metadata || !Array.isArray(t.metadata) || t.metadata.length === 0) {
        return false;
      }
      return t.metadata[0].symbol === tokenSymbol;
    });

    if (!token) {
      throw new Error(`Unknown token: ${tokenSymbol}. Make sure it's registered correctly.`);
    }

    if (!token.metadata || !Array.isArray(token.metadata) || token.metadata.length === 0) {
      throw new Error(`Missing metadata for token: ${tokenSymbol}`);
    }

    canisterId = token.ledgerCanisterId.toText();
    decimals = token.metadata[0].decimals;
    fee = BigInt(token.metadata[0].fee);
  }

  const actor = createICRC1Actor(canisterId, agent);
  const balance = await getTokenBalanceByCanisterId(canisterId, fromPrincipal, agent, decimals);
  
  if (balance < amount + fee) {
    throw new Error(`Insufficient funds. Make sure you have enough ${tokenSymbol} to cover both the amount and the transfer fee.`);
  }

  const result = await actor.icrc1_transfer({
    to: { owner: Principal.fromText(toPrincipal), subaccount: [] },
    fee: [fee],
    memo: [],
    from_subaccount: [],
    created_at_time: [],
    amount: amount
  });

  if ("Err" in result) {
    throw new Error(`Transfer failed: ${JSON.stringify(result.Err)}`);
  }

  return result.Ok;
}

// Validate principal
export function isValidPrincipal(principal) {
  try {
    Principal.fromText(principal);
    return true;
  } catch {
    return false;
  }
} 