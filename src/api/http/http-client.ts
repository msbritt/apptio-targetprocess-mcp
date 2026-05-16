import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { setTimeout } from 'node:timers/promises';
import { URLSearchParams, URL } from 'node:url';

export interface RetryConfig {
  maxRetries: number;
  delayMs: number;
  backoffFactor: number;
}

export interface HttpClientConfig {
  baseUrl: string;
  retry?: RetryConfig;
}

export interface AuthConfig {
  type: 'basic' | 'apikey';
  token: string;
}

export interface ApiErrorResponse {
  Message?: string;
  ErrorMessage?: string;
  Description?: string;
}

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  queryParams?: URLSearchParams;
}

/**
 * HTTP client for TargetProcess API with retry logic and authentication
 * Handles all HTTP operations with configurable retry strategies
 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly retryConfig: RetryConfig;
  private readonly authConfig: AuthConfig;

  constructor(config: HttpClientConfig, authConfig: AuthConfig) {
    this.baseUrl = config.baseUrl;
    this.authConfig = authConfig;
    this.retryConfig = config.retry || {
      maxRetries: 3,
      delayMs: 1000,
      backoffFactor: 2
    };
  }

  /**
   * Execute HTTP request with retry logic
   */
  async request<T>(
    endpoint: string,
    options: HttpRequestOptions = {}
  ): Promise<T> {
    const url = this.buildUrl(endpoint, options.queryParams);
    const headers = this.buildHeaders(options.headers);
    
    const requestOptions = {
      method: options.method || 'GET',
      headers,
      body: options.body
    };

    return await this.executeWithRetry(async () => {
      const response = await globalThis.fetch(url, requestOptions);
      return await this.handleApiResponse<T>(response, `${options.method || 'GET'} ${endpoint}`);
    }, `${options.method || 'GET'} ${endpoint}`);
  }

  /**
   * GET request
   */
  async get<T>(endpoint: string, queryParams?: URLSearchParams): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET', queryParams });
  }

  /**
   * POST request
   */
  async post<T>(endpoint: string, data?: any, queryParams?: URLSearchParams): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
      queryParams,
      headers: data ? { 'Content-Type': 'application/json' } : undefined
    });
  }

  /**
   * PUT request
   */
  async put<T>(endpoint: string, data?: any, queryParams?: URLSearchParams): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
      queryParams,
      headers: data ? { 'Content-Type': 'application/json' } : undefined
    });
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string, queryParams?: URLSearchParams): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE', queryParams });
  }

  /**
   * Execute operation with retry logic
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    let lastError: Error | null = null;
    let delay = this.retryConfig.delayMs;

    for (let attempt = 1; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // Don't retry 4xx client errors (message format: "... failed: 4xx - ...")
        if (error instanceof McpError) {
          const statusMatch = error.message.match(/: (\d{3})[ -]/);
          if (statusMatch) {
            const status = parseInt(statusMatch[1]);
            if (status >= 400 && status < 500) throw error;
          }
        }

        if (attempt === this.retryConfig.maxRetries) {
          break;
        }

        // Wait before retrying
        await setTimeout(delay);
        delay *= this.retryConfig.backoffFactor;
      }
    }

    throw new McpError(
      ErrorCode.InvalidRequest,
      `Failed to ${context} after ${this.retryConfig.maxRetries} attempts: ${lastError?.message}`
    );
  }

  /**
   * Handle API response with error parsing
   */
  async handleApiResponse<T>(
    response: globalThis.Response,
    context: string
  ): Promise<T> {
    if (!response.ok) {
      const errorMessage = await this.extractErrorMessage(response);
      throw new McpError(
        ErrorCode.InvalidRequest,
        `${context} failed: ${response.status} - ${errorMessage}`
      );
    }
    return await response.json() as T;
  }

  /**
   * Extract error message from response
   */
  private async extractErrorMessage(response: globalThis.Response): Promise<string> {
    try {
      const data = await response.json() as ApiErrorResponse;
      return data.Message || data.ErrorMessage || data.Description || response.statusText;
    } catch {
      return response.statusText;
    }
  }

  /**
   * Build complete URL with query parameters
   */
  private buildUrl(endpoint: string, queryParams?: URLSearchParams): string {
    let url = `${this.baseUrl}/${endpoint.replace(/^\//, '')}`;
    
    if (queryParams && queryParams.toString()) {
      url += `?${queryParams.toString()}`;
    }
    
    return url;
  }

  /**
   * Build headers with authentication
   */
  private buildHeaders(additionalHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      ...additionalHeaders
    };

    // Add authentication header for basic auth
    // Note: API key auth uses query parameter (access_token) per TP API requirements
    if (this.authConfig.type === 'basic') {
      headers['Authorization'] = `Basic ${this.authConfig.token}`;
    }

    return headers;
  }

  /**
   * Get the base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Get retry configuration
   */
  getRetryConfig(): RetryConfig {
    return { ...this.retryConfig };
  }

  /**
   * Download binary content (for attachments)
   */
  async downloadBinary(url: string): Promise<ArrayBuffer> {
    // Validate URL belongs to the configured domain to prevent SSRF.
    // Note: this check compares hostnames at request time and does not
    // protect against DNS rebinding attacks, where a hostname resolves
    // differently between this check and the actual fetch. This is an
    // accepted limitation — attachment URLs come from the TP API response,
    // not from untrusted user input, so the practical risk is negligible.
    try {
      const parsed = new URL(url);
      const baseUrlParsed = new URL(this.baseUrl);
      if (parsed.hostname !== baseUrlParsed.hostname) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Attachment URL hostname "${parsed.hostname}" does not match configured domain "${baseUrlParsed.hostname}"`
        );
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Attachment URL must use http or https protocol, got "${parsed.protocol}"`
        );
      }
    } catch (e) {
      if (e instanceof McpError) throw e;
      throw new McpError(ErrorCode.InvalidRequest, `Invalid attachment URL: ${url}`);
    }

    return await this.executeWithRetry(async () => {
      const response = await globalThis.fetch(url, {
        headers: this.buildHeaders()
      });

      if (!response.ok) {
        const errorMessage = await this.extractErrorMessage(response);
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Download failed: ${response.status} - ${errorMessage}`
        );
      }

      return await response.arrayBuffer();
    }, `download binary from ${new URL(url).pathname}`);
  }

  /**
   * Check if the client is configured properly
   */
  isConfigured(): boolean {
    return !!(this.baseUrl && this.authConfig.token);
  }

  /**
   * Test connection to the API
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.get('/EntityTypes?format=json&take=1');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get authentication type
   */
  getAuthType(): 'basic' | 'apikey' {
    return this.authConfig.type;
  }

  /**
   * Create a new HttpClient with different auth config
   */
  withAuth(authConfig: AuthConfig): HttpClient {
    return new HttpClient(
      { baseUrl: this.baseUrl, retry: this.retryConfig },
      authConfig
    );
  }
}