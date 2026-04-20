// Jest setup file - runs before all tests
import 'dotenv/config';

// Validate required environment variables for tests
const hasBasicAuth = process.env.TP_USERNAME && process.env.TP_PASSWORD;
const hasApiKeyAuth = process.env.TP_API_KEY;

if (!process.env.TP_DOMAIN || (!hasBasicAuth && !hasApiKeyAuth)) {
  console.warn('⚠️  Missing required environment variables for tests. Provide either (TP_USERNAME + TP_PASSWORD) or TP_API_KEY, along with TP_DOMAIN.');
}