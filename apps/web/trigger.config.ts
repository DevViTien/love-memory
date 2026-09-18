import { defineConfig } from "@trigger.dev/sdk";

const project = process.env["TRIGGER_PROJECT_REF"];
if (!project) throw new Error("TRIGGER_PROJECT_REF is required to run or deploy Trigger.dev jobs.");

export default defineConfig({
  build: {
    conditions: ["react-server"],
    external: ["sharp"],
  },
  dirs: ["./src/trigger"],
  maxDuration: 300,
  project,
  runtime: "node",
});
