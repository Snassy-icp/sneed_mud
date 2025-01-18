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
  const actor = getTokenActor(tokenSymbol, agent);
  const balance = await actor.icrc1_balance_of({
    owner: Principal.fromText(principal),
    subaccount: []
  });
  return balance;
}

// Get all token balances
export async function getAllBalances(principal, agent, hideZeroBalances = false) {
  const balances = await Promise.all(
    Object.entries(SUPPORTED_TOKENS).map(async ([symbol, config]) => {
      try {
        const balance = await getTokenBalance(symbol, principal, agent);
        return {
          symbol,
          name: config.name,
          balance,
          decimals: config.decimals,
          formatted: formatTokenAmount(balance, config.decimals)
        };
      } catch (error) {
        console.error(`Error fetching ${symbol} balance:`, error);
        return {
          symbol,
          name: config.name,
          balance: 0n,
          decimals: config.decimals,
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

  const result = await actor.icrc1_transfer({
    to: {
      owner: Principal.fromText(toPrincipal),
      subaccount: []
    },
    amount: tokenAmount,
    fee: [],
    memo: [],
    from_subaccount: [],
    created_at_time: []
  });

  if ("Err" in result) {
    const error = result.Err;
    if ("InsufficientFunds" in error) {
      throw new Error("Insufficient funds");
    } else if ("BadFee" in error) {
      throw new Error("Invalid fee");
    } else if ("TemporarilyUnavailable" in error) {
      throw new Error("Service temporarily unavailable");
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