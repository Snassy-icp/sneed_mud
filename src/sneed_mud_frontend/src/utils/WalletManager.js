import { Principal } from "@dfinity/principal";
import { SUPPORTED_TOKENS, createICRC1Actor, formatTokenAmount, parseTokenAmount } from "./TokenConfig";

// Get balance for a specific token
export async function getTokenBalance(tokenSymbol, principal, agent) {
  if (!agent) {
    throw new Error("Not authenticated. Please log in again.");
  }

  const config = SUPPORTED_TOKENS[tokenSymbol];
  if (!config) {
    throw new Error(`Unsupported token: ${tokenSymbol}`);
  }

  const actor = createICRC1Actor(config.ledgerCanisterId, agent);
  try {
    const balance = await actor.icrc1_balance_of({
      owner: Principal.fromText(principal),
      subaccount: []
    });
    return balance;
  } catch (error) {
    console.error(`Error fetching ${tokenSymbol} balance:`, error);
    throw new Error(`Failed to fetch ${tokenSymbol} balance: ${error.message}`);
  }
}

// Get all token balances
export async function getAllBalances(principal, hideZeroBalances, agent) {
  const balances = [];
  for (const [symbol, config] of Object.entries(SUPPORTED_TOKENS)) {
    try {
      const balance = await getTokenBalance(symbol, principal, agent);
      if (!hideZeroBalances || balance > 0n) {
        balances.push({
          symbol,
          name: config.name,
          balance,
          formatted: formatTokenAmount(balance, config.decimals)
        });
      }
    } catch (error) {
      balances.push({
        symbol,
        name: config.name,
        balance: 0n,
        formatted: "Error",
        error: error.message
      });
    }
  }
  return balances;
}

// Transfer tokens
export async function transferTokens(tokenSymbol, fromPrincipal, toPrincipal, amount, agent) {
  if (!agent) {
    throw new Error("Not authenticated. Please log in again.");
  }

  const config = SUPPORTED_TOKENS[tokenSymbol];
  if (!config) {
    throw new Error(`Unsupported token: ${tokenSymbol}`);
  }

  const actor = createICRC1Actor(config.ledgerCanisterId, agent);
  const balance = await getTokenBalance(tokenSymbol, fromPrincipal, agent);
  
  if (balance < amount + config.fee) {
    throw new Error(`Insufficient funds. Make sure you have enough ${tokenSymbol} to cover both the amount and the transfer fee.`);
  }

  const result = await actor.icrc1_transfer({
    to: { owner: Principal.fromText(toPrincipal), subaccount: [] },
    fee: [config.fee],
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