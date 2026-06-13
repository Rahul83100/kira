const Redis = require('ioredis');
const redis = new Redis(56586);
redis.flushall().then(() => {
  console.log('✅ Redis cache cleared successfully!');
  process.exit(0);
}).catch(err => {
  console.error('❌ Failed to clear Redis:', err.message);
  process.exit(1);
});
