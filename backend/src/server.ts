import { buildApp } from "./app.js";
import { startInstagramSync } from "./instagram/instagramService.js";
import { startDailyJobs } from "./jobs/daily.js";

const app = await buildApp();

const port = Number(process.env.PORT ?? 4000);

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => { app.log.info(`backend listening on :${port}`); startInstagramSync((m) => app.log.info(m)); startDailyJobs(app.log); })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
