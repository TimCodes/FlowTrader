/**
 * CME Futures Market Hours Handler
 *
 * Implements futures session awareness for automated trading.
 * - CME Globex hours: Sunday 6PM ET - Friday 5PM ET
 * - Daily maintenance: 5PM-6PM ET (Mon-Thu)
 * - Holiday calendar for CME closures
 *
 * All times are in US Eastern Time (ET).
 */

/**
 * CME market session state
 */
export type MarketState =
  | "open"           // Regular trading hours
  | "closed"         // Weekend or holiday
  | "maintenance"    // Daily 5-6PM ET maintenance
  | "pre_open"       // Within 5 minutes of open
  | "pre_close";     // Within 5 minutes of close

/**
 * Market hours configuration
 */
export interface MarketHoursConfig {
  /** Timezone for market hours (default: America/New_York) */
  timezone?: string;
  /** Minutes before open to trigger pre_open state (default: 5) */
  preOpenMinutes?: number;
  /** Minutes before close to trigger pre_close state (default: 5) */
  preCloseMinutes?: number;
}

/**
 * CME holiday (full day closure)
 */
interface CMEHoliday {
  date: string; // YYYY-MM-DD format
  name: string;
}

/**
 * CME holidays for 2025-2026
 * Note: CME also has early closes (1PM ET) on some days
 */
const CME_HOLIDAYS: CMEHoliday[] = [
  // 2025
  { date: "2025-01-01", name: "New Year's Day" },
  { date: "2025-01-20", name: "MLK Day" },
  { date: "2025-02-17", name: "Presidents Day" },
  { date: "2025-04-18", name: "Good Friday" },
  { date: "2025-05-26", name: "Memorial Day" },
  { date: "2025-06-19", name: "Juneteenth" },
  { date: "2025-07-04", name: "Independence Day" },
  { date: "2025-09-01", name: "Labor Day" },
  { date: "2025-11-27", name: "Thanksgiving" },
  { date: "2025-12-25", name: "Christmas" },
  // 2026
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-01-19", name: "MLK Day" },
  { date: "2026-02-16", name: "Presidents Day" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-05-25", name: "Memorial Day" },
  { date: "2026-06-19", name: "Juneteenth" },
  { date: "2026-07-03", name: "Independence Day (observed)" },
  { date: "2026-09-07", name: "Labor Day" },
  { date: "2026-11-26", name: "Thanksgiving" },
  { date: "2026-12-25", name: "Christmas" },
];

/**
 * Convert a Date to time components in the specified market timezone
 * (default: US Eastern Time).
 */
function toEasternTime(
  date: Date,
  timeZone: string = "America/New_York",
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
  dateString: string;
} {
  // Use Intl to get components in the specified timezone
  const etFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const parts = etFormatter.formatToParts(date);
  const getPart = (type: string) =>
    parts.find((p) => p.type === type)?.value || "";

  const year = parseInt(getPart("year"));
  const month = parseInt(getPart("month"));
  const day = parseInt(getPart("day"));
  const hour = parseInt(getPart("hour"));
  const minute = parseInt(getPart("minute"));

  // Get day of week (0 = Sunday, 6 = Saturday)
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayOfWeek = dayNames.indexOf(getPart("weekday"));

  const dateString = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return { year, month, day, hour, minute, dayOfWeek, dateString };
}

/**
 * Get minutes since midnight ET
 */
function getMinutesSinceMidnight(hour: number, minute: number): number {
  return hour * 60 + minute;
}

/**
 * CME Futures Market Hours Handler
 */
export class MarketHoursHandler {
  private config: Required<MarketHoursConfig>;
  private holidaySet: Set<string>;

  constructor(config: MarketHoursConfig = {}) {
    this.config = {
      timezone: config.timezone ?? "America/New_York",
      preOpenMinutes: config.preOpenMinutes ?? 5,
      preCloseMinutes: config.preCloseMinutes ?? 5,
    };

    // Build holiday lookup set
    this.holidaySet = new Set(CME_HOLIDAYS.map((h) => h.date));
  }

  /**
   * Check if a date is a CME holiday
   */
  isHoliday(date: Date = new Date()): boolean {
    const et = toEasternTime(date);
    return this.holidaySet.has(et.dateString);
  }

  /**
   * Get holiday name if date is a holiday
   */
  getHolidayName(date: Date = new Date()): string | null {
    const et = toEasternTime(date);
    const holiday = CME_HOLIDAYS.find((h) => h.date === et.dateString);
    return holiday?.name ?? null;
  }

  /**
   * Check if currently in daily maintenance window (5-6 PM ET, Mon-Thu)
   */
  isMaintenanceWindow(date: Date = new Date()): boolean {
    const et = toEasternTime(date);

    // Maintenance is Mon-Thu only
    if (et.dayOfWeek < 1 || et.dayOfWeek > 4) {
      return false;
    }

    // 5PM-6PM ET (17:00-18:00)
    return et.hour === 17;
  }

  /**
   * Check if market is in weekend closure
   * Weekend: Friday 5PM ET - Sunday 6PM ET
   */
  isWeekendClosed(date: Date = new Date()): boolean {
    const et = toEasternTime(date);
    const minutes = getMinutesSinceMidnight(et.hour, et.minute);

    // Saturday: always closed
    if (et.dayOfWeek === 6) {
      return true;
    }

    // Sunday: closed until 6PM ET (18:00 = 1080 minutes)
    if (et.dayOfWeek === 0 && minutes < 1080) {
      return true;
    }

    // Friday: closed after 5PM ET (17:00 = 1020 minutes)
    if (et.dayOfWeek === 5 && minutes >= 1020) {
      return true;
    }

    return false;
  }

  /**
   * Get current market state
   */
  getMarketState(date: Date = new Date()): MarketState {
    // Check holiday first
    if (this.isHoliday(date)) {
      return "closed";
    }

    // Check weekend closure
    if (this.isWeekendClosed(date)) {
      return "closed";
    }

    // Check maintenance window
    if (this.isMaintenanceWindow(date)) {
      return "maintenance";
    }

    const et = toEasternTime(date);
    const minutes = getMinutesSinceMidnight(et.hour, et.minute);

    // Check pre-open (Sunday approaching 6PM)
    if (et.dayOfWeek === 0) {
      const openMinutes = 1080; // 6PM = 18:00
      if (
        minutes >= openMinutes - this.config.preOpenMinutes &&
        minutes < openMinutes
      ) {
        return "pre_open";
      }
    }

    // Check pre-open (Mon-Thu approaching 6PM after maintenance)
    if (et.dayOfWeek >= 1 && et.dayOfWeek <= 4) {
      const openMinutes = 1080; // 6PM = 18:00
      if (
        minutes >= openMinutes - this.config.preOpenMinutes &&
        minutes < openMinutes
      ) {
        return "pre_open";
      }
    }

    // Check pre-close (Friday approaching 5PM)
    if (et.dayOfWeek === 5) {
      const closeMinutes = 1020; // 5PM = 17:00
      if (
        minutes >= closeMinutes - this.config.preCloseMinutes &&
        minutes < closeMinutes
      ) {
        return "pre_close";
      }
    }

    // Check pre-close (Mon-Thu approaching 5PM maintenance)
    if (et.dayOfWeek >= 1 && et.dayOfWeek <= 4) {
      const closeMinutes = 1020; // 5PM = 17:00
      if (
        minutes >= closeMinutes - this.config.preCloseMinutes &&
        minutes < closeMinutes
      ) {
        return "pre_close";
      }
    }

    return "open";
  }

  /**
   * Check if market is currently open for trading
   */
  isMarketOpen(date: Date = new Date()): boolean {
    const state = this.getMarketState(date);
    return state === "open" || state === "pre_close";
  }

  /**
   * Get time until next market open (in milliseconds)
   * Returns 0 if market is already open
   */
  getTimeUntilOpen(date: Date = new Date()): number {
    if (this.isMarketOpen(date)) {
      return 0;
    }

    const et = toEasternTime(date);
    let targetDate = new Date(date);

    // If weekend (Saturday or Sunday before 6PM)
    if (et.dayOfWeek === 6) {
      // Move to Sunday
      targetDate.setDate(targetDate.getDate() + 1);
    }

    if (et.dayOfWeek === 0 || et.dayOfWeek === 6) {
      // Set to 6PM ET on Sunday
      // This is approximate - proper implementation needs timezone library
      const etDate = new Date(
        targetDate.toLocaleString("en-US", { timeZone: "America/New_York" })
      );
      etDate.setHours(18, 0, 0, 0);

      // Find the difference
      const now = new Date(
        date.toLocaleString("en-US", { timeZone: "America/New_York" })
      );
      return Math.max(0, etDate.getTime() - now.getTime());
    }

    // If in maintenance (5-6PM Mon-Thu), wait until 6PM
    if (this.isMaintenanceWindow(date)) {
      const msUntilSixPM = (60 - et.minute) * 60 * 1000;
      return msUntilSixPM;
    }

    // If holiday or other non-weekend, non-maintenance closure,
    // calculate time until next trading day 6PM ET.
    // This is simplified - proper implementation would check next non-holiday day.
    const nowEt = new Date(
      date.toLocaleString("en-US", { timeZone: "America/New_York" })
    );

    // Start from the next calendar day in ET.
    const nextEt = new Date(nowEt);
    nextEt.setDate(nextEt.getDate() + 1);

    // Skip Saturdays (no Sunday 6PM open derived from a Saturday date).
    while (nextEt.getDay() === 6) {
      nextEt.setDate(nextEt.getDate() + 1);
    }

    // Set target open time to 6PM ET on that day.
    nextEt.setHours(18, 0, 0, 0);

    return Math.max(0, nextEt.getTime() - nowEt.getTime());
  }

  /**
   * Get time until next market close (in milliseconds)
   * Returns 0 if market is already closed
   */
  getTimeUntilClose(date: Date = new Date()): number {
    if (!this.isMarketOpen(date)) {
      return 0;
    }

    const et = toEasternTime(date);
    const minutes = getMinutesSinceMidnight(et.hour, et.minute);

    // Friday close at 5PM (1020 minutes)
    if (et.dayOfWeek === 5) {
      const closeMinutes = 1020;
      return Math.max(0, (closeMinutes - minutes) * 60 * 1000);
    }

    // Mon-Thu close at 5PM for maintenance (1020 minutes)
    if (et.dayOfWeek >= 1 && et.dayOfWeek <= 4 && minutes < 1020) {
      const closeMinutes = 1020;
      return Math.max(0, (closeMinutes - minutes) * 60 * 1000);
    }

    // Sunday after 6PM - calculate time until next day's maintenance
    // This is simplified
    return 24 * 60 * 60 * 1000; // Default to 24 hours
  }

  /**
   * Get next market event (open, close, or maintenance)
   */
  getNextEvent(date: Date = new Date()): {
    event: "open" | "close" | "maintenance_start" | "maintenance_end";
    time: Date;
    description: string;
  } {
    const state = this.getMarketState(date);
    const et = toEasternTime(date);

    if (state === "closed") {
      // Weekend or holiday - next event is open
      return {
        event: "open",
        time: new Date(date.getTime() + this.getTimeUntilOpen(date)),
        description: "Market opens",
      };
    }

    if (state === "maintenance") {
      return {
        event: "maintenance_end",
        time: new Date(date.getTime() + (60 - et.minute) * 60 * 1000),
        description: "Maintenance ends",
      };
    }

    if (state === "pre_close" || state === "open") {
      // Next event is close (or maintenance start)
      if (et.dayOfWeek === 5) {
        return {
          event: "close",
          time: new Date(date.getTime() + this.getTimeUntilClose(date)),
          description: "Weekend close",
        };
      } else {
        return {
          event: "maintenance_start",
          time: new Date(date.getTime() + this.getTimeUntilClose(date)),
          description: "Daily maintenance",
        };
      }
    }

    return {
      event: "open",
      time: new Date(date.getTime() + this.getTimeUntilOpen(date)),
      description: "Market opens",
    };
  }

  /**
   * Get human-readable market status
   */
  getStatusMessage(date: Date = new Date()): string {
    const state = this.getMarketState(date);
    const holiday = this.getHolidayName(date);

    if (holiday) {
      return `Market closed for ${holiday}`;
    }

    switch (state) {
      case "open":
        return "Market is open";
      case "closed":
        return "Market is closed (weekend)";
      case "maintenance":
        return "Market in daily maintenance (5-6 PM ET)";
      case "pre_open":
        return "Market opening soon";
      case "pre_close":
        return "Market closing soon";
      default:
        return "Unknown market state";
    }
  }

  /**
   * Add a custom holiday
   */
  addHoliday(date: string, name: string): void {
    this.holidaySet.add(date);
    CME_HOLIDAYS.push({ date, name });
  }

  /**
   * Get all holidays for a year
   */
  getHolidays(year: number): CMEHoliday[] {
    return CME_HOLIDAYS.filter((h) => h.date.startsWith(`${year}-`));
  }
}

/**
 * Create a market hours handler
 */
export function createMarketHoursHandler(
  config?: MarketHoursConfig
): MarketHoursHandler {
  return new MarketHoursHandler(config);
}

/**
 * Convenience function to check if market is open now
 */
export function isMarketOpenNow(): boolean {
  return new MarketHoursHandler().isMarketOpen();
}

/**
 * Convenience function to get current market state
 */
export function getMarketStateNow(): MarketState {
  return new MarketHoursHandler().getMarketState();
}
