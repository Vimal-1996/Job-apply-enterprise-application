import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __DEFAULT_API_URL__: JSON.stringify('http://localhost:3000'),
    __DEFAULT_COGNITO_DOMAIN__: JSON.stringify('https://example.auth.us-east-1.amazoncognito.com'),
    __DEFAULT_CLIENT_ID__: JSON.stringify('testclientid123'),
  },
});
