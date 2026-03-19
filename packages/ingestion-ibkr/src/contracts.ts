/**
 * CME Futures Contract Definitions
 *
 * Provides contract definitions for CME futures with auto-rolling
 * front-month expiry calculation. Supports ES, NQ, MES, MNQ, CL.
 *
 * CME futures expiry schedule:
 * - Index futures (ES, NQ, MES, MNQ): 3rd Friday of Mar, Jun, Sep, Dec
 * - Crude oil (CL): 3 business days before 25th of prior month
 *
 * Contract months use codes: H=Mar, M=Jun, U=Sep, Z=Dec, F=Jan, G=Feb, etc.
 * 
 * 
 *  Contract Definitions:                                                                                                                                                         
  
  - ES - E-mini S&P 500 (CME, multiplier 50)
  - NQ - E-mini Nasdaq 100 (CME, multiplier 20)
  - MES - Micro E-mini S&P 500 (CME, multiplier 5)
  - MNQ - Micro E-mini Nasdaq 100 (CME, multiplier 2)
  - CL - Crude Oil (NYMEX, multiplier 1000)

 */

import type { Contract } from "@stoqey/ib";
import type { FuturesContractDef, FuturesExchange } from "./types.js";

/**
 * CME month codes for futures contracts
 */
const MONTH_CODES: Record<number, string> = {
  1: "F", // January
  2: "G", // February
  3: "H", // March
  4: "J", // April
  5: "K", // May
  6: "M", // June
  7: "N", // July
  8: "Q", // August
  9: "U", // September
  10: "V", // October
  11: "X", // November
  12: "Z", // December
};

/**
 * Quarterly expiry months for index futures (Mar, Jun, Sep, Dec)
 */
const QUARTERLY_MONTHS = [3, 6, 9, 12];

/**
 * Monthly expiry months for CL (all months)
 */
const MONTHLY_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/**
 * Contract specification metadata
 */
interface ContractSpec {
  symbol: string;
  exchange: FuturesExchange;
  currency: string;
  multiplier: string;
  expiryMonths: number[];
  /** Days before expiry to roll to next contract */
  rollDaysBeforeExpiry: number;
}

/**
 * Contract specifications for supported futures
 */
const CONTRACT_SPECS: Record<string, ContractSpec> = {
  ES: {
    symbol: "ES",
    exchange: "CME",
    currency: "USD",
    multiplier: "50",
    expiryMonths: QUARTERLY_MONTHS,
    rollDaysBeforeExpiry: 7,
  },
  NQ: {
    symbol: "NQ",
    exchange: "CME",
    currency: "USD",
    multiplier: "20",
    expiryMonths: QUARTERLY_MONTHS,
    rollDaysBeforeExpiry: 7,
  },
  MES: {
    symbol: "MES",
    exchange: "CME",
    currency: "USD",
    multiplier: "5",
    expiryMonths: QUARTERLY_MONTHS,
    rollDaysBeforeExpiry: 7,
  },
  MNQ: {
    symbol: "MNQ",
    exchange: "CME",
    currency: "USD",
    multiplier: "2",
    expiryMonths: QUARTERLY_MONTHS,
    rollDaysBeforeExpiry: 7,
  },
  CL: {
    symbol: "CL",
    exchange: "NYMEX",
    currency: "USD",
    multiplier: "1000",
    expiryMonths: MONTHLY_MONTHS,
    rollDaysBeforeExpiry: 5,
  },
};

/**
 * Get the 3rd Friday of a given month/year
 */
function getThirdFriday(year: number, month: number): Date {
  // Start with the 1st of the month
  const date = new Date(year, month - 1, 1);

  // Find first Friday
  const dayOfWeek = date.getDay();
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  date.setDate(1 + daysUntilFriday);

  // Add 2 weeks to get 3rd Friday
  date.setDate(date.getDate() + 14);

  return date;
}

/**
 * Get CL expiry date (3 business days before 25th of prior month)
 */
function getCLExpiry(year: number, month: number): Date {
  // CL for delivery month M expires ~3 business days before 25th of M-1
  // If contract is for June delivery, expiry is late May
  let expiryYear = year;
  let expiryMonth = month - 1;
  if (expiryMonth === 0) {
    expiryMonth = 12;
    expiryYear--;
  }

  // Start with 25th of prior month
  const date = new Date(expiryYear, expiryMonth - 1, 25);

  // Go back 3 business days
  let businessDays = 0;
  while (businessDays < 3) {
    date.setDate(date.getDate() - 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) {
      businessDays++;
    }
  }

  return date;
}

/**
 * Get expiry date for a contract
 */
function getExpiryDate(symbol: string, year: number, month: number): Date {
  if (symbol === "CL") {
    return getCLExpiry(year, month);
  }
  return getThirdFriday(year, month);
}

/**
 * Get the next valid expiry month for a symbol
 */
function getNextExpiryMonth(
  spec: ContractSpec,
  fromDate: Date = new Date()
): { year: number; month: number } {
  const currentYear = fromDate.getFullYear();
  const currentMonth = fromDate.getMonth() + 1;

  // Check current year's remaining months
  for (const month of spec.expiryMonths) {
    if (month >= currentMonth) {
      const expiry = getExpiryDate(spec.symbol, currentYear, month);
      // Add roll buffer
      const rollDate = new Date(expiry);
      rollDate.setDate(rollDate.getDate() - spec.rollDaysBeforeExpiry);

      if (fromDate < rollDate) {
        return { year: currentYear, month };
      }
    }
  }

  // Next year's first expiry month
  const nextMonth = spec.expiryMonths[0];
  return { year: currentYear + 1, month: nextMonth };
}

/**
 * Format expiry as YYYYMM
 */
function formatExpiry(year: number, month: number): string {
  return `${year}${month.toString().padStart(2, "0")}`;
}

/**
 * Build local symbol (e.g., "MESH5" for March 2025 ES)
 */
function buildLocalSymbol(symbol: string, year: number, month: number): string {
  const monthCode = MONTH_CODES[month];
  const yearDigit = year % 10;
  return `${symbol}${monthCode}${yearDigit}`;
}

/**
 * Get contract definition for a futures symbol with auto-rolling front month
 */
export function getFrontMonthContract(
  symbol: string,
  referenceDate: Date = new Date()
): FuturesContractDef {
  const spec = CONTRACT_SPECS[symbol];
  if (!spec) {
    throw new Error(`Unknown futures symbol: ${symbol}`);
  }

  const { year, month } = getNextExpiryMonth(spec, referenceDate);

  return {
    symbol: spec.symbol,
    secType: "FUT",
    exchange: spec.exchange,
    currency: spec.currency,
    lastTradeDateOrContractMonth: formatExpiry(year, month),
    multiplier: spec.multiplier,
    localSymbol: buildLocalSymbol(spec.symbol, year, month),
  };
}

/**
 * Get contract definition for a specific expiry
 */
export function getContractForExpiry(
  symbol: string,
  year: number,
  month: number
): FuturesContractDef {
  const spec = CONTRACT_SPECS[symbol];
  if (!spec) {
    throw new Error(`Unknown futures symbol: ${symbol}`);
  }

  if (!spec.expiryMonths.includes(month)) {
    throw new Error(
      `Invalid expiry month ${month} for ${symbol}. Valid months: ${spec.expiryMonths.join(", ")}`
    );
  }

  return {
    symbol: spec.symbol,
    secType: "FUT",
    exchange: spec.exchange,
    currency: spec.currency,
    lastTradeDateOrContractMonth: formatExpiry(year, month),
    multiplier: spec.multiplier,
    localSymbol: buildLocalSymbol(spec.symbol, year, month),
  };
}

/**
 * Build IBKR Contract object from definition
 */
export function buildContract(def: FuturesContractDef): Contract {
  return {
    symbol: def.symbol,
    secType: def.secType,
    exchange: def.exchange,
    currency: def.currency,
    lastTradeDateOrContractMonth: def.lastTradeDateOrContractMonth,
    multiplier: def.multiplier,
    localSymbol: def.localSymbol,
  } as Contract;
}

/**
 * Get front-month Contract objects for multiple symbols
 */
export function getFrontMonthContracts(
  symbols: string[],
  referenceDate: Date = new Date()
): Map<string, Contract> {
  const contracts = new Map<string, Contract>();

  for (const symbol of symbols) {
    const def = getFrontMonthContract(symbol, referenceDate);
    contracts.set(symbol, buildContract(def));
  }

  return contracts;
}

/**
 * Get expiry info for a symbol
 */
export function getExpiryInfo(
  symbol: string,
  referenceDate: Date = new Date()
): {
  year: number;
  month: number;
  monthCode: string;
  localSymbol: string;
  expiryDate: Date;
  daysToExpiry: number;
  shouldRoll: boolean;
} {
  const spec = CONTRACT_SPECS[symbol];
  if (!spec) {
    throw new Error(`Unknown futures symbol: ${symbol}`);
  }

  const { year, month } = getNextExpiryMonth(spec, referenceDate);
  const expiryDate = getExpiryDate(symbol, year, month);
  const daysToExpiry = Math.ceil(
    (expiryDate.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  const shouldRoll = daysToExpiry <= spec.rollDaysBeforeExpiry;

  return {
    year,
    month,
    monthCode: MONTH_CODES[month],
    localSymbol: buildLocalSymbol(symbol, year, month),
    expiryDate,
    daysToExpiry,
    shouldRoll,
  };
}

/**
 * List all supported futures symbols
 */
export function getSupportedSymbols(): string[] {
  return Object.keys(CONTRACT_SPECS);
}

/**
 * Check if a symbol is supported
 */
export function isSymbolSupported(symbol: string): boolean {
  return symbol in CONTRACT_SPECS;
}

/**
 * Get contract spec for a symbol
 */
export function getContractSpec(symbol: string): ContractSpec | undefined {
  return CONTRACT_SPECS[symbol];
}
