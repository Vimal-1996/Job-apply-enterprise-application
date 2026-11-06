// Dummy Cognito settings so modules that read config at startup can be built.
// Tests override every provider that would actually talk to AWS.
process.env.COGNITO_USER_POOL_ID ??= 'us-east-1_test';
process.env.COGNITO_CLIENT_ID ??= 'test-client';
