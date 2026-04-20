// Test configuration using environment variables only
export const testConfig = {
  domain: process.env.TP_DOMAIN!,
  username: process.env.TP_USERNAME,
  password: process.env.TP_PASSWORD,
  apiKey: process.env.TP_API_KEY,
  apiUrl: `https://${process.env.TP_DOMAIN!}`,
  apiV1Url: `https://${process.env.TP_DOMAIN!}/api/v1`,
  userId: process.env.TP_USER_ID!,
  userEmail: process.env.TP_USER_EMAIL!
};

// Validate required environment variables
if (!testConfig.domain) {
  throw new Error('Missing required environment variable: TP_DOMAIN');
}
if (!(testConfig.username && testConfig.password) && !testConfig.apiKey) {
  throw new Error('Missing authentication: provide either (TP_USERNAME + TP_PASSWORD) or TP_API_KEY');
}
if (!testConfig.userId || !testConfig.userEmail) {
  throw new Error('Missing required environment variables: TP_USER_ID, TP_USER_EMAIL');
}

// Helper to get expected URL for tests
export const getExpectedUrl = (path: string): string => {
  return `${testConfig.apiV1Url}${path.startsWith('/') ? path : '/' + path}`;
};