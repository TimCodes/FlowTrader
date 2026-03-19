/**
 * Kraken Authentication
 *
 * Implements REST API authentication for Kraken private endpoints.
 * Uses HMAC-SHA256 signing per Kraken API specification.
 *
 * Reference: https://docs.kraken.com/api/docs/guides/authentication
 */

import crypto from "crypto";
import { krakenConfig } from "@trading/shared";

/**
 * Response from GetWebSocketsToken endpoint
 */
export interface WebSocketTokenResponse {
  error: string[];
  result?: {
    token: string;
    expires: number; // Seconds until expiration (typically 900 = 15 minutes)
  };
}

/**
 * Create the signature for a Kraken private API request
 *
 * Kraken signature = HMAC-SHA512(path + SHA256(nonce + postData), base64decode(apiSecret))
 */
function createSignature(
  path: string,
  nonce: string,
  postData: string,
  apiSecret: string
): string {
  // Create SHA256 hash of nonce + postData
  const sha256Hash = crypto
    .createHash("sha256")
    .update(nonce + postData)
    .digest();

  // Concatenate path (as Buffer) + sha256Hash
  const message = Buffer.concat([Buffer.from(path), sha256Hash]);

  // Create HMAC-SHA512 using decoded API secret
  const secretBuffer = Buffer.from(apiSecret, "base64");
  const hmac = crypto.createHmac("sha512", secretBuffer);
  hmac.update(message);

  // Return base64 encoded signature
  return hmac.digest("base64");
}

/**
 * Make an authenticated request to Kraken private API
 */
async function privateRequest<T>(
  path: string,
  data: Record<string, string> = {}
): Promise<T> {
  const apiKey = krakenConfig.apiKey;
  const apiSecret = krakenConfig.apiSecret;

  if (!apiKey || !apiSecret) {
    throw new Error("Kraken API credentials not configured");
  }

  // Generate nonce (must be increasing, using timestamp in milliseconds)
  const nonce = Date.now().toString();

  // Build POST data with nonce
  const postData = new URLSearchParams({ nonce, ...data }).toString();

  // Create signature
  const signature = createSignature(path, nonce, postData, apiSecret);

  // Make request
  const url = krakenConfig.restUrl + path;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "API-Key": apiKey,
      "API-Sign": signature,
    },
    body: postData,
  });

  if (!response.ok) {
    throw new Error(`Kraken API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Get a WebSocket authentication token
 *
 * This token is required for subscribing to authenticated WebSocket channels
 * (e.g., level3 order book). Token expires after ~15 minutes.
 *
 * @returns WebSocket auth token
 * @throws Error if API credentials are missing or request fails
 */
export async function getWebSocketToken(): Promise<string> {
  console.log("[Kraken Auth] Requesting WebSocket token...");

  const response = await privateRequest<WebSocketTokenResponse>(
    "/0/private/GetWebSocketsToken"
  );

  if (response.error && response.error.length > 0) {
    throw new Error(`Kraken API error: ${response.error.join(", ")}`);
  }

  if (!response.result?.token) {
    throw new Error("No token in Kraken response");
  }

  const expiresIn = response.result.expires;
  console.log(`[Kraken Auth] Token obtained, expires in ${expiresIn}s`);

  return response.result.token;
}

/**
 * Token manager - handles automatic token refresh
 */
export class TokenManager {
  private token: string | null = null;
  private tokenExpiry: number = 0;
  private refreshBuffer: number = 60000; // Refresh 60s before expiry
  private refreshPromise: Promise<string> | null = null;

  /**
   * Get a valid WebSocket token, refreshing if needed
   */
  async getToken(): Promise<string> {
    const now = Date.now();

    // Return cached token if still valid
    if (this.token && now < this.tokenExpiry - this.refreshBuffer) {
      return this.token;
    }

    // Prevent concurrent refresh requests
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Refresh token
    this.refreshPromise = this.refreshToken();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Force a token refresh
   */
  async refreshToken(): Promise<string> {
    const token = await getWebSocketToken();

    // Token expires in ~900 seconds (15 minutes)
    // Store with expiry timestamp
    this.token = token;
    this.tokenExpiry = Date.now() + 900 * 1000;

    return token;
  }

  /**
   * Clear cached token (e.g., on auth failure)
   */
  clearToken(): void {
    this.token = null;
    this.tokenExpiry = 0;
  }

  /**
   * Check if credentials are configured
   */
  hasCredentials(): boolean {
    return Boolean(krakenConfig.apiKey && krakenConfig.apiSecret);
  }
}

/**
 * Create a token manager instance
 */
export function createTokenManager(): TokenManager {
  return new TokenManager();
}
