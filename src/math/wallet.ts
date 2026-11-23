import { BET_LEVELS, REFILL_AMOUNT, REFILL_DELAY_MS, START_BALANCE } from './config';

/** Shared wallet for the device. Pure functions; persistence is handled by the app layer. */
export interface Wallet {
  balance: number;
  /** Epoch ms when a refill becomes available; null when the balance is healthy. */
  refillAt: number | null;
  /** Local date (YYYY-MM-DD) the early "Wake the beast" refill was last used. */
  earlyRefillDay: string | null;
}

export const newWallet = (): Wallet => ({ balance: START_BALANCE, refillAt: null, earlyRefillDay: null });

const MIN_BET = BET_LEVELS[0];

export function canBet(w: Wallet, bet: number): boolean {
  return (BET_LEVELS as readonly number[]).includes(bet) && w.balance >= bet;
}

/** Deduct the bet and credit the win; starts the refill timer if the player is broke. */
export function settleSpin(w: Wallet, bet: number, win: number, now: number): Wallet {
  if (!canBet(w, bet)) throw new Error('Insufficient balance or invalid bet');
  const balance = w.balance - bet + win;
  const broke = balance < MIN_BET;
  return { ...w, balance, refillAt: broke ? (w.refillAt ?? now + REFILL_DELAY_MS) : null };
}

/** Apply the timed refill if it is due. */
export function tickRefill(w: Wallet, now: number): Wallet {
  if (w.refillAt !== null && now >= w.refillAt) {
    return { ...w, balance: w.balance + REFILL_AMOUNT, refillAt: null };
  }
  return w;
}

/** Once per local day, a broke player can skip the wait. */
export function earlyRefill(w: Wallet, today: string): Wallet {
  if (w.refillAt === null || w.earlyRefillDay === today) return w;
  return { ...w, balance: w.balance + REFILL_AMOUNT, refillAt: null, earlyRefillDay: today };
}
