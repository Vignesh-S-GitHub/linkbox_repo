import type { Env } from "../types";
import type { Database } from "./database";
import { MockDatabase } from "./mock-database";
import { D1MetadataDatabase } from "./d1-database";
import { ApiProblem } from "../utils/magnet";
let mockDatabase: MockDatabase | undefined;
export function databaseFor(env:Env):Database {
  if(env.SEEDR_MODE==="mock"){mockDatabase ??=new MockDatabase();return mockDatabase;}
  if (!env.DB) throw new ApiProblem(503, "database_unavailable", "Metadata storage is not configured. Please try again later.");
  return new D1MetadataDatabase(env.DB);
}
