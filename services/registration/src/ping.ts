import pg from "pg";
import { Redis } from "ioredis";

const db = new pg.Client({
    connectionString: process.env.DATABASE_URL,
});
await db.connect();

const { rows } = await db.query("select now() as now");
console.log("postgres ok", rows[0].now);
await db.end();

const redis = new Redis(process.env.REDIS_URL!);
console.log("redis ok", await redis.ping());
redis.disconnect();