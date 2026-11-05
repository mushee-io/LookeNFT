import { Pool, type PoolClient } from "pg";

let pool: Pool | undefined;

/** Server only: fail closed if the database is not provisioned. */
export function getDb(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be configured for wallet authentication");
  if (!pool) pool = new Pool({ connectionString: url, max: 8, idleTimeoutMillis: 15_000, connectionTimeoutMillis: 5_000 });
  return pool;
}

export async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getDb().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
