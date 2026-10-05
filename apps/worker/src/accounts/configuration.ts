import { accountsFromEnv } from "../config";
import type { Database } from "../database/database";
import type { AccountConfig, Env } from "../types";

/** Static Worker configuration remains the baseline; D1 contains admin metadata overrides only. */
export async function configuredAccounts(env: Env, database: Database): Promise<AccountConfig[]> {
  const accounts = new Map(accountsFromEnv(env).map(account => [account.id, account]));
  for (const account of await database.accountConfigurations()) accounts.set(account.id, account);
  return accountsFromEnv({...env,SEEDR_ACCOUNT_CONFIG:JSON.stringify([...accounts.values()])});
}
export async function configuredEnvironment(env: Env, database: Database): Promise<Env> {
  return {...env,SEEDR_ACCOUNT_CONFIG:JSON.stringify(await configuredAccounts(env,database))};
}
