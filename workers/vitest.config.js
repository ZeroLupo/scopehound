import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          kvNamespaces: ["STATE"],
          bindings: {
            ADMIN_TOKEN: "test-admin-token",
            SLACK_WEBHOOK_URL: "https://hooks.slack.com/test",
          },
        },
      },
    },
  },
});
