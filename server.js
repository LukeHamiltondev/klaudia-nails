import { config, loadSalon } from "./src/config.js";
import { createApp } from "./src/app.js";

const { server } = createApp({ config, loadSalon });
server.listen(config.port, () => {
  console.log(`Nails by Klaudia running on ${config.publicUrl} (port ${config.port})`);
  if (!config.adminPassword) console.warn("ADMIN_PASSWORD is not set, so Klaudia's diary at /admin is locked.");
  const todo = JSON.stringify(loadSalon()).match(/PLACEHOLDER/g);
  if (todo) console.warn(`config/salon.json still has ${todo.length} PLACEHOLDER value(s). See OWNER-SETUP.md.`);
});
