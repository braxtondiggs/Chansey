#!/usr/bin/env node

const { execSync } = require('child_process');

function flushRedis() {
  const nodeEnv = process.env.NODE_ENV;
  
  // Safety check - only allow in local development
  if (nodeEnv === 'production' || nodeEnv === 'staging') {
    console.log('❌ Redis FLUSHALL is only allowed in local development');
    console.log(`   Current NODE_ENV: ${nodeEnv || 'undefined'}`);
    process.exit(1);
  }

  try {
    console.log('🧹 Flushing Redis cache...');
    execSync('redis-cli FLUSHALL', { stdio: 'inherit' });
    console.log('✅ Redis cache cleared successfully');
  } catch (error) {
    console.error('❌ Failed to flush Redis cache:');
    console.error(`   ${error.message}`);
    console.log('💡 Make sure Redis is running locally');
    process.exit(1);
  }
}

flushRedis();