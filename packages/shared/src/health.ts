/**
 * Health Check Service
 *
 * Lightweight HTTP server that reports health status of:
 * - Redis connection
 * - TimescaleDB connection
 * - Registered services (ingestion, storage, etc.)
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import type { Server } from "http";
import type Redis from "ioredis";
import { healthCheckConfig } from "./config.js";
import { checkRedisHealth, getRedisInfo } from "./redis.js";

/**
 * Service health status
 */
export interface ServiceHealth {
  name: string;
  status: "healthy" | "unhealthy" | "unknown";
  latencyMs?: number;
  details?: Record<string, unknown>;
  lastCheck: number;
}

/**
 * Overall health response
 */
export interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: number;
  uptime: number;
  services: ServiceHealth[];
}

/**
 * Health check function type
 */
export type HealthChecker = () => Promise<ServiceHealth>;

/**
 * Health Check Server
 */
export class HealthCheckServer {
  private server: Server | null = null;
  private startTime: number = Date.now();
  private checkers: Map<string, HealthChecker> = new Map();
  private cachedHealth: HealthResponse | null = null;
  private cacheValidMs: number = 1000; // Cache health for 1 second

  /**
   * Register a health checker for a service
   */
  registerChecker(name: string, checker: HealthChecker): void {
    this.checkers.set(name, checker);
    console.log(`[Health] Registered checker: ${name}`);
  }

  /**
   * Remove a health checker
   */
  unregisterChecker(name: string): void {
    this.checkers.delete(name);
  }

  /**
   * Register Redis health checker
   */
  registerRedis(redis: Redis, name: string = "redis"): void {
    this.registerChecker(name, async () => {
      const start = Date.now();
      try {
        const healthy = await checkRedisHealth(redis);
        const info = healthy ? await getRedisInfo(redis) : {};
        return {
          name,
          status: healthy ? "healthy" : "unhealthy",
          latencyMs: Date.now() - start,
          details: {
            version: info.redis_version,
            connectedClients: info.connected_clients,
          },
          lastCheck: Date.now(),
        };
      } catch (err) {
        return {
          name,
          status: "unhealthy",
          latencyMs: Date.now() - start,
          details: { error: (err as Error).message },
          lastCheck: Date.now(),
        };
      }
    });
  }

  /**
   * Register TimescaleDB health checker
   * Accepts a health check function to avoid circular dependency
   */
  registerDatabase(
    checkFn: () => Promise<boolean>,
    infoFn?: () => Promise<Record<string, unknown>>,
    name: string = "timescaledb"
  ): void {
    this.registerChecker(name, async () => {
      const start = Date.now();
      try {
        const healthy = await checkFn();
        const info = healthy && infoFn ? await infoFn() : {};
        return {
          name,
          status: healthy ? "healthy" : "unhealthy",
          latencyMs: Date.now() - start,
          details: info,
          lastCheck: Date.now(),
        };
      } catch (err) {
        return {
          name,
          status: "unhealthy",
          latencyMs: Date.now() - start,
          details: { error: (err as Error).message },
          lastCheck: Date.now(),
        };
      }
    });
  }

  /**
   * Register a generic service checker
   */
  registerService(
    name: string,
    checkFn: () => Promise<{ healthy: boolean; details?: Record<string, unknown> }>
  ): void {
    this.registerChecker(name, async () => {
      const start = Date.now();
      try {
        const result = await checkFn();
        return {
          name,
          status: result.healthy ? "healthy" : "unhealthy",
          latencyMs: Date.now() - start,
          details: result.details,
          lastCheck: Date.now(),
        };
      } catch (err) {
        return {
          name,
          status: "unhealthy",
          latencyMs: Date.now() - start,
          details: { error: (err as Error).message },
          lastCheck: Date.now(),
        };
      }
    });
  }

  /**
   * Run all health checks
   */
  async checkHealth(): Promise<HealthResponse> {
    // Return cached result if still valid
    if (
      this.cachedHealth &&
      Date.now() - this.cachedHealth.timestamp < this.cacheValidMs
    ) {
      return this.cachedHealth;
    }

    const services: ServiceHealth[] = [];

    // Run all checkers in parallel
    const checkerPromises = Array.from(this.checkers.entries()).map(
      async ([name, checker]) => {
        try {
          return await checker();
        } catch (err) {
          return {
            name,
            status: "unhealthy" as const,
            details: { error: (err as Error).message },
            lastCheck: Date.now(),
          };
        }
      }
    );

    const results = await Promise.all(checkerPromises);
    services.push(...results);

    // Determine overall status
    const unhealthyCount = services.filter((s) => s.status === "unhealthy").length;
    let status: "healthy" | "degraded" | "unhealthy";

    if (unhealthyCount === 0) {
      status = "healthy";
    } else if (unhealthyCount < services.length) {
      status = "degraded";
    } else {
      status = "unhealthy";
    }

    const response: HealthResponse = {
      status,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      services,
    };

    this.cachedHealth = response;
    return response;
  }

  /**
   * Handle HTTP request
   */
  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    // Only handle GET requests to health path
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname === healthCheckConfig.path) {
      const health = await this.checkHealth();
      const statusCode = health.status === "healthy" ? 200 :
                        health.status === "degraded" ? 200 : 503;

      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify(health, null, 2));
      return;
    }

    if (url.pathname === "/ready") {
      // Kubernetes readiness probe - simple check
      const health = await this.checkHealth();
      const ready = health.status !== "unhealthy";

      res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ready }));
      return;
    }

    if (url.pathname === "/live") {
      // Kubernetes liveness probe - always return OK if server is running
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ alive: true }));
      return;
    }

    // 404 for unknown paths
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  /**
   * Start the health check server
   */
  start(port: number = healthCheckConfig.port): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          console.error("[Health] Request error:", err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        });
      });

      this.server.on("error", reject);

      this.server.listen(port, () => {
        console.log(`[Health] Server listening on port ${port}`);
        console.log(`[Health] Endpoints: /health, /ready, /live`);
        resolve();
      });
    });
  }

  /**
   * Stop the health check server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log("[Health] Server stopped");
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

/**
 * Create a new health check server instance
 */
export function createHealthCheckServer(): HealthCheckServer {
  return new HealthCheckServer();
}
