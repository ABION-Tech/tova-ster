import { runTimedEmails } from "../../src/jobs/emails.js";
const now = process.argv[2] ? new Date(process.argv[2]) : new Date();
runTimedEmails(now).then((r) => { console.log("RESULT", JSON.stringify(r)); process.exit(0); });
