import { Actor } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";

// Token configuration type
export const SUPPORTED_TOKENS = {
  ICP: {
    ledgerCanisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai", // placeholder, replace with actual
    symbol: "ICP",
    name: "Internet Computer Protocol",
    decimals: 8
  },
  DKP: {
    ledgerCanisterId: "zfcdd-tqaaa-aaaaq-aaaga-cai", // placeholder, replace with actual
    symbol: "DKP",
    name: "Dragginz",
    decimals: 8
  },
  SNEED: {
    ledgerCanisterId: "hvgxa-wqaaa-aaaaq-aacia-cai", // placeholder, replace with actual
    symbol: "SNEED",
    name: "Sneed",
    decimals: 8
  }
};

// Helper to format token amounts for display
export function formatTokenAmount(amount, decimals) {
  if (!amount) return "0";
  const amountStr = amount.toString();
  const integerPart = amountStr.slice(0, -decimals) || "0";
  const fractionalPart = amountStr.slice(-decimals).padStart(decimals, "0");
  const trimmedFractional = fractionalPart.replace(/0+$/, "");
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return trimmedFractional ? `${formattedInteger}.${trimmedFractional}` : formattedInteger;
}

// Helper to parse display amount to token units
export function parseTokenAmount(amount, decimals) {
  const [integerPart, fractionalPart = ""] = amount.toString().split(".");
  const paddedFractional = fractionalPart.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(integerPart + paddedFractional);
}

// ICRC1 interface factory
export function createICRC1Actor(canisterId, agent) {
  return Actor.createActor(
    ({ IDL }) => {
      const Account = IDL.Record({
        owner: IDL.Principal,
        subaccount: IDL.Opt(IDL.Vec(IDL.Nat8))
      });
      
      return IDL.Service({
        icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ["query"]),
        icrc1_transfer: IDL.Func([IDL.Record({
          to: Account,
          amount: IDL.Nat,
          fee: IDL.Opt(IDL.Nat),
          memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
          from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
          created_at_time: IDL.Opt(IDL.Nat64)
        })], [IDL.Variant({
          Ok: IDL.Nat,
          Err: IDL.Variant({
            InsufficientFunds: IDL.Null,
            BadFee: IDL.Null,
            TemporarilyUnavailable: IDL.Null,
            GenericError: IDL.Record({ message: IDL.Text, error_code: IDL.Nat })
          })
        })], []),
        icrc1_name: IDL.Func([], [IDL.Text], ["query"]),
        icrc1_symbol: IDL.Func([], [IDL.Text], ["query"]),
        icrc1_decimals: IDL.Func([], [IDL.Nat8], ["query"])
      });
    },
    {
      agent,
      canisterId: Principal.fromText(canisterId)
    }
  );
}

// Local storage key for wallet preferences
export const WALLET_PREFERENCES_KEY = "sneed_mud_wallet_preferences";

// Get wallet preferences from local storage
export function getWalletPreferences() {
  const stored = localStorage.getItem(WALLET_PREFERENCES_KEY);
  return stored ? JSON.parse(stored) : { hideZeroBalances: false };
}

// Save wallet preferences to local storage
export function saveWalletPreferences(preferences) {
  localStorage.setItem(WALLET_PREFERENCES_KEY, JSON.stringify(preferences));
} 