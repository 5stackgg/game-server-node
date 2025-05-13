import IORedis, { RedisOptions } from "ioredis";

const redisOptions: RedisOptions = {
  db: 1,
  host: process.env.REDIS_HOST || "redis",
  port: process.env.REDIS_SERVICE_PORT
    ? parseInt(process.env.REDIS_SERVICE_PORT)
    : undefined,
  password: process.env.REDIS_PASSWORD,
};

const redis = new IORedis(redisOptions);

export default redis;
