// Lists every registered route as "METHOD /path" (keeps auth/permissions.ts complete).
import { buildApp } from "../../src/app.js";
const app = await buildApp({ logger: false });
await app.ready();
console.log((app as unknown as { routeList: string[] }).routeList.sort().join("\n"));
process.exit(0);
