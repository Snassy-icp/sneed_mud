import { Principal } from "@dfinity/principal";
import { SUPPORTED_TOKENS, createICRC1Actor, formatTokenAmount, parseTokenAmount } from "./TokenConfig";

// Cache for token actors
const tokenActorCache = new Map();

// Get or create token actor
function getTokenActor(tokenSymbol, agent) {
  if (!tokenActorCache.has(tokenSymbol)) {
    const config = SUPPORTED_TOKENS[tokenSymbol];
    if (!config) throw new Error(`Unsupported token: ${tokenSymbol}`);
    tokenActorCache.set(tokenSymbol, createICRC1Actor(config.ledgerCanisterId, agent));
  }
  return tokenActorCache.get(tokenSymbol);
}

// Get balance for a specific token
export async function getTokenBalance(tokenSymbol, principal, agent) {
  if (!agent) {
    throw new Error("Agent not initialized");
  }
  
  const actor = getTokenActor(tokenSymbol, agent);
  try {
    const balance = await actor.icrc1_balance_of({
      owner: Principal.fromText(principal),
      subaccount: []
    });
    return balance;
  } catch (error) {
    console.error(`Error fetching ${tokenSymbol} balance:`, error);
    const errorMessage = error.message || 
      (error.detail ? `${error.detail} (code: ${error.code})` : "Failed to fetch balance");
    throw new Error(`Failed to fetch ${tokenSymbol} balance: ${errorMessage}`);
  }
}

// Get all token balances
export async function getAllBalances(principal, agent, hideZeroBalances = false) {
  if (!agent) {
    throw new Error("Agent not initialized");
  }

  const balances = await Promise.all(
    Object.entries(SUPPORTED_TOKENS).map(async ([symbol, config]) => {
      try {
        const balance = await getTokenBalance(symbol, principal, agent);
        return {
          symbol,
          name: config.name,
          balance,
          decimals: config.decimals,
          fee: config.fee,
          formatted: formatTokenAmount(balance, config.decimals)
        };
      } catch (error) {
        console.error(`Error fetching ${symbol} balance:`, error);
        return {
          symbol,
          name: config.name,
          balance: 0n,
          decimals: config.decimals,
          fee: config.fee,
          formatted: "0",
          error: error.message
        };
      }
    })
  );

  return hideZeroBalances 
    ? balances.filter(b => b.balance > 0n)
    : balances;
}

// Transfer tokens
export async function transferTokens(tokenSymbol, fromPrincipal, toPrincipal, amount, agent) {
  const config = SUPPORTED_TOKENS[tokenSymbol];
  if (!config) throw new Error(`Unsupported token: ${tokenSymbol}`);

  const actor = getTokenActor(tokenSymbol, agent);
  const tokenAmount = parseTokenAmount(amount, config.decimals);

  // Check if amount is too small
  if (tokenAmount <= config.fee) {
    throw new Error(`Amount must be greater than the transfer fee (${formatTokenAmount(config.fee, config.decimals)} ${tokenSymbol})`);
  }

  const result = await actor.icrc1_transfer({
    to: {
      owner: Principal.fromText(toPrincipal),
      subaccount: []
    },
    amount: tokenAmount,
    fee: [config.fee],
    memo: [],
    from_subaccount: [],
    created_at_time: []
  });

  if ("Err" in result) {
    const error = result.Err;
    if ("InsufficientFunds" in error) {
      throw new Error(`Insufficient funds. Make sure you have enough ${tokenSymbol} to cover both the amount and the transfer fee.`);
    } else if ("BadFee" in error) {
      throw new Error("Invalid fee amount");
    } else if ("TemporarilyUnavailable" in error) {
      throw new Error("Service temporarily unavailable. Please try again later.");
    } else if ("GenericError" in error) {
      throw new Error(error.GenericError.message);
    }
    throw new Error("Transfer failed");
  }

  return result.Ok; // Transaction ID
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