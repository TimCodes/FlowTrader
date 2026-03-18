/**
 * Redis Stream Helpers
 *
 * Typed publish/subscribe utilities for Redis Streams.
 * Uses STREAMS constants from @trading/types for key generation.
 */

import type Redis from "ioredis";
import type {
  OrderBookEvent,
  TradeEvent,
  L3OrderEvent,
  CatalystEvent,
  FeatureVector,
  OrderFlowSignal,
  CatalystSignal,
  TradeDecision,
  ExecutionReport,
} from "@trading/types";
import { STREAMS } from "@trading/types";

/**
 * Union of all publishable event types
 */
export type StreamEvent =
  | OrderBookEvent
  | TradeEvent
  | L3OrderEvent
  | CatalystEvent
  | FeatureVector
  | OrderFlowSignal
  | CatalystSignal
  | TradeDecision
  | ExecutionReport;

/**
 * Stream message as returned by XREADGROUP
 */
export interface StreamMessage<T = StreamEvent> {
  id: string;
  data: T;
}

/**
 * Consumer group configuration
 */
export interface ConsumerGroupConfig {
  stream: string;
  group: string;
  consumer: string;
  startId?: string; // Default: "0" (read all history), use "$" for new messages only
}

/**
 * XREADGROUP options
 */
export interface ReadGroupOptions {
  count?: number; // Max messages to read
  block?: number; // Block timeout in ms (0 = forever)
  noAck?: boolean; // Don't add to PEL (pending entries list)
}

/**
 * Serialize an event to Redis stream field-value pairs
 */
function serializeEvent(event: StreamEvent): string[] {
  const fields: string[] = [];
  for (const [key, value] of Object.entries(event)) {
    if (value !== undefined && value !== null) {
      // Arrays need JSON serialization
      const serialized =
        typeof value === "object" ? JSON.stringify(value) : String(value);
      fields.push(key, serialized);
    }
  }
  return fields;
}

/**
 * Deserialize Redis stream field-value pairs to an event object
 */
function deserializeEvent<T extends StreamEvent>(
  fields: string[]
): T {
  const event: Record<string, unknown> = {};

  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];

    // Try to parse as JSON (for arrays/objects), fall back to primitives
    try {
      const parsed = JSON.parse(value);
      event[key] = parsed;
    } catch {
      // Try number conversion
      const num = Number(value);
      if (!isNaN(num) && value !== "") {
        event[key] = num;
      } else {
        event[key] = value;
      }
    }
  }

  return event as T;
}

/**
 * Publish an OrderBookEvent to its stream
 */
export async function publishOrderBook(
  redis: Redis,
  event: OrderBookEvent
): Promise<string> {
  const streamKey = STREAMS.orderbook(event.symbol);
  const fields = serializeEvent(event);
  return redis.xadd(streamKey, "*", ...fields);
}

/**
 * Publish a TradeEvent to its stream
 */
export async function publishTrade(
  redis: Redis,
  event: TradeEvent
): Promise<string> {
  const streamKey = STREAMS.trades(event.symbol);
  const fields = serializeEvent(event);
  return redis.xadd(streamKey, "*", ...fields);
}

/**
 * Publish an L3OrderEvent to its stream
 */
export async function publishL3Order(
  redis: Redis,
  event: L3OrderEvent
): Promise<string> {
  const streamKey = STREAMS.l3(event.symbol);
  const fields = serializeEvent(event);
  return redis.xadd(streamKey, "*", ...fields);
}

/**
 * Publish a CatalystEvent to its stream
 */
export async function publishCatalyst(
  redis: Redis,
  event: CatalystEvent
): Promise<string> {
  const streamKey = STREAMS.news(event.symbol);
  const fields = serializeEvent(event);
  return redis.xadd(streamKey, "*", ...fields);
}

/**
 * Publish a FeatureVector to its stream
 */
export async function publishFeatures(
  redis: Redis,
  event: FeatureVector
): Promise<string> {
  const streamKey = STREAMS.features(event.symbol);
  const fields = serializeEvent(event);
  return redis.xadd(streamKey, "*", ...fields);
}

/**
 * Publish an OrderFlowSignal to its stream
 */
export async function publishOrderFlowSignal(
  redis: Redis,
  event: OrderFlowSignal
): Promise<string> {
  const streamKey = STREAMS.signals.orderflow(event.symbol);
  const fields = serializeEvent(event);
  return redis.xadd(streamKey, "*", ...fields);
}

/**
 * Publish a CatalystSignal to its stream
 */
export async function publishCatalystSignal(
  redis: Redis,
  event: CatalystSignal
): Promise<string> {
  const streamKey = STREAMS.signals.catalyst(event.symbol);
  const fields = serializeEvent(event);
  return redis.xadd(streamKey, "*", ...fields);
}

/**
 * Publish a TradeDecision to its stream
 */
export async function publishDecision(
  redis: Redis,
  event: TradeDecision
): Promise<string> {
  const streamKey = STREAMS.decisions(event.symbol);
  const fields = serializeEvent(event);
  return redis.xadd(streamKey, "*", ...fields);
}

/**
 * Publish an ExecutionReport to its stream
 */
export async function publishExecution(
  redis: Redis,
  event: ExecutionReport
): Promise<string> {
  const streamKey = STREAMS.executions(event.symbol);
  const fields = serializeEvent(event);
  return redis.xadd(streamKey, "*", ...fields);
}

/**
 * Generic publish function for any event type
 */
export async function publishEvent(
  redis: Redis,
  streamKey: string,
  event: StreamEvent
): Promise<string> {
  const fields = serializeEvent(event);
  return redis.xadd(streamKey, "*", ...fields);
}

/**
 * Create a consumer group for a stream
 * Creates the stream if it doesn't exist (MKSTREAM)
 *
 * @returns true if created, false if already exists
 */
export async function createConsumerGroup(
  redis: Redis,
  config: ConsumerGroupConfig
): Promise<boolean> {
  try {
    await redis.xgroup(
      "CREATE",
      config.stream,
      config.group,
      config.startId || "0",
      "MKSTREAM"
    );
    console.log(
      `[Streams] Created consumer group "${config.group}" for stream "${config.stream}"`
    );
    return true;
  } catch (err) {
    const error = err as Error;
    if (error.message.includes("BUSYGROUP")) {
      // Group already exists - this is fine
      console.log(
        `[Streams] Consumer group "${config.group}" already exists for "${config.stream}"`
      );
      return false;
    }
    throw err;
  }
}

/**
 * Ensure consumer groups exist for all standard streams for a symbol
 */
export async function ensureConsumerGroups(
  redis: Redis,
  symbol: string,
  groupName: string,
  consumerName: string
): Promise<void> {
  const streams = [
    STREAMS.orderbook(symbol),
    STREAMS.trades(symbol),
    STREAMS.l3(symbol),
    STREAMS.news(symbol),
    STREAMS.features(symbol),
  ];

  for (const stream of streams) {
    await createConsumerGroup(redis, {
      stream,
      group: groupName,
      consumer: consumerName,
      startId: "$", // Only new messages
    });
  }
}

/**
 * Read messages from a stream using XREADGROUP
 *
 * @returns Array of messages, or empty array if timeout/no messages
 */
export async function readGroup<T extends StreamEvent>(
  redis: Redis,
  config: ConsumerGroupConfig,
  options: ReadGroupOptions = {}
): Promise<StreamMessage<T>[]> {
  const { count = 100, block = 5000, noAck = false } = options;

  const args: (string | number)[] = [
    "GROUP",
    config.group,
    config.consumer,
    "COUNT",
    count,
  ];

  if (block > 0) {
    args.push("BLOCK", block);
  }

  if (noAck) {
    args.push("NOACK");
  }

  args.push("STREAMS", config.stream, ">");

  const result = await redis.xreadgroup(...(args as [string, ...string[]]));

  if (!result || result.length === 0) {
    return [];
  }

  const messages: StreamMessage<T>[] = [];

  // Result format: [[streamKey, [[id, [field, value, ...]], ...]]]
  for (const [, streamMessages] of result) {
    for (const [id, fields] of streamMessages) {
      messages.push({
        id,
        data: deserializeEvent<T>(fields),
      });
    }
  }

  return messages;
}

/**
 * Acknowledge processed messages
 */
export async function acknowledgeMessages(
  redis: Redis,
  stream: string,
  group: string,
  messageIds: string[]
): Promise<number> {
  if (messageIds.length === 0) return 0;
  return redis.xack(stream, group, ...messageIds);
}

/**
 * Get pending messages for a consumer (messages delivered but not ACKed)
 */
export async function getPendingMessages(
  redis: Redis,
  stream: string,
  group: string,
  consumer?: string,
  count: number = 100
): Promise<{ id: string; consumer: string; idleTime: number; deliveryCount: number }[]> {
  const args: (string | number)[] = [stream, group];

  if (consumer) {
    args.push("-", "+", count, consumer);
  } else {
    args.push("-", "+", count);
  }

  const result = await redis.xpending(...(args as [string, string]));

  if (!result || !Array.isArray(result) || result.length === 0) {
    return [];
  }

  // If we got summary info (no consumer filter), we need extended info
  if (typeof result[0] === "number") {
    // This is summary: [count, minId, maxId, [[consumer, count], ...]]
    // We need to call again with range
    const extendedResult = await redis.xpending(
      stream,
      group,
      "-",
      "+",
      count
    );

    if (!extendedResult || !Array.isArray(extendedResult)) {
      return [];
    }

    return (extendedResult as [string, string, number, number][]).map(
      ([id, consumerName, idleTime, deliveryCount]) => ({
        id,
        consumer: consumerName,
        idleTime,
        deliveryCount,
      })
    );
  }

  return (result as [string, string, number, number][]).map(
    ([id, consumerName, idleTime, deliveryCount]) => ({
      id,
      consumer: consumerName,
      idleTime,
      deliveryCount,
    })
  );
}

/**
 * Claim pending messages that have been idle too long
 * Useful for recovering from crashed consumers
 */
export async function claimPendingMessages<T extends StreamEvent>(
  redis: Redis,
  stream: string,
  group: string,
  consumer: string,
  minIdleTime: number,
  messageIds: string[]
): Promise<StreamMessage<T>[]> {
  if (messageIds.length === 0) return [];

  const result = await redis.xclaim(
    stream,
    group,
    consumer,
    minIdleTime,
    ...messageIds
  );

  if (!result || result.length === 0) {
    return [];
  }

  return (result as [string, string[]][]).map(([id, fields]) => ({
    id,
    data: deserializeEvent<T>(fields),
  }));
}

/**
 * Get stream info (length, first/last entry, etc.)
 */
export async function getStreamInfo(
  redis: Redis,
  stream: string
): Promise<{
  length: number;
  firstEntry: string | null;
  lastEntry: string | null;
  groups: number;
} | null> {
  try {
    const info = await redis.xinfo("STREAM", stream);

    // Parse the flat array response
    const infoMap = new Map<string, unknown>();
    for (let i = 0; i < info.length; i += 2) {
      infoMap.set(info[i] as string, info[i + 1]);
    }

    return {
      length: infoMap.get("length") as number,
      firstEntry: (infoMap.get("first-entry") as string[] | null)?.[0] || null,
      lastEntry: (infoMap.get("last-entry") as string[] | null)?.[0] || null,
      groups: infoMap.get("groups") as number,
    };
  } catch (err) {
    const error = err as Error;
    if (error.message.includes("no such key")) {
      return null;
    }
    throw err;
  }
}

/**
 * Trim stream to approximate max length (for memory management)
 */
export async function trimStream(
  redis: Redis,
  stream: string,
  maxLength: number,
  approximate: boolean = true
): Promise<number> {
  if (approximate) {
    return redis.xtrim(stream, "MAXLEN", "~", maxLength);
  }
  return redis.xtrim(stream, "MAXLEN", maxLength);
}
