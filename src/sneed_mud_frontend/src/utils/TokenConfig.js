import { Actor, HttpAgent } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";

// Create ICRC1 actor
export function createICRC1Actor(canisterId, agent) {
  if (!agent) {
    throw new Error("Agent is required to create ICRC1 actor");
  }

  return Actor.createActor(
    ({ IDL }) => {
      const Account = IDL.Record({
        owner: IDL.Principal,
        subaccount: IDL.Opt(IDL.Vec(IDL.Nat8))
      });
      const TransferArgs = IDL.Record({
        to: Account,
        fee: IDL.Opt(IDL.Nat),
        memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
        from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
        created_at_time: IDL.Opt(IDL.Nat64),
        amount: IDL.Nat
      });
      const TransferError = IDL.Variant({
        GenericError: IDL.Record({ message: IDL.Text, error_code: IDL.Nat }),
        TemporarilyUnavailable: IDL.Record({}),
        BadBurn: IDL.Record({ min_burn_amount: IDL.Nat }),
        Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
        BadFee: IDL.Record({}),
        CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
        TooOld: IDL.Record({}),
        InsufficientFunds: IDL.Record({})
      });
      return IDL.Service({
        icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ["query"]),
        icrc1_transfer: IDL.Func([TransferArgs], [IDL.Variant({ Ok: IDL.Nat, Err: TransferError })], [])
      });
    },
    {
      agent,
      canisterId: Principal.fromText(canisterId)
    }
  );
}

// Token configuration
export const SUPPORTED_TOKENS = {
  ICP: {
    ledgerCanisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
    symbol: "ICP",
    name: "Internet Computer Protocol",
    decimals: 8,
    fee: 10000n // 0.0001 ICP
  },
  DKP: {
    ledgerCanisterId: "zfcdd-tqaaa-aaaaq-aaaga-cai",
    symbol: "DKP",
    name: "Dragon Kill Points",
    decimals: 8,
    fee: 10000n // 0.0001 DKP
  },
  SNEED: {
    ledgerCanisterId: "hvgxa-wqaaa-aaaaq-aacia-cai",
    symbol: "SNEED",
    name: "Sneed",
    decimals: 8,
    fee: 1000n // 0.00001 SNEED
  }
};

// Format token amount for display
export function formatTokenAmount(amount, decimals) {
  const amountStr = amount.toString();
  if (amountStr.length <= decimals) {
    return "0." + "0".repeat(decimals - amountStr.length) + amountStr.replace(/0+$/, '');
  }
  const integerPart = amountStr.slice(0, -decimals);
  const decimalPart = amountStr.slice(-decimals).replace(/0+$/, '');
  // Add commas to integer part
  const formattedIntegerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return formattedIntegerPart + (decimalPart ? "." + decimalPart : "");
}

// Parse token amount from string
export function parseTokenAmount(amount, decimals) {
  const [integerPart = "0", decimalPart = ""] = amount.toString().split(".");
  const paddedDecimalPart = decimalPart.padEnd(decimals, "0");
  if (paddedDecimalPart.length > decimals) {
    throw new Error(`Too many decimal places (max ${decimals})`);
  }
  return BigInt(integerPart + paddedDecimalPart);
}

// Get wallet preferences from local storage
export function getWalletPreferences() {
  const prefs = localStorage.getItem("walletPreferences");
  return prefs ? JSON.parse(prefs) : { hideZeroBalances: false };
}

// Save wallet preferences to local storage
export function saveWalletPreferences(prefs) {
  localStorage.setItem("walletPreferences", JSON.stringify(prefs));
} 