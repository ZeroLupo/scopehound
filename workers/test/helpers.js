export const BASE = "http://localhost";

export function adminHeaders() {
  return { "X-Admin-Token": "test-admin-token" };
}

export function adminGet(path) {
  return new Request(BASE + path, { headers: adminHeaders() });
}

export function jsonPost(path, body, auth = true) {
  return new Request(BASE + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? adminHeaders() : {}),
    },
    body: JSON.stringify(body),
  });
}

export function formPost(path, params) {
  return new Request(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
}

export async function assertJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      `Expected JSON response but got (${response.status}): ${text.slice(0, 300)}`
    );
  }
}

export async function seedCompetitors(env) {
  await env.STATE.put(
    "config:competitors",
    JSON.stringify([
      {
        name: "TestCorp",
        website: "https://example.com",
        pages: [
          {
            id: "home",
            url: "https://example.com",
            type: "general",
            label: "Homepage",
          },
        ],
      },
    ])
  );
  await env.STATE.put(
    "config:settings",
    JSON.stringify({
      slackWebhookUrl: "https://hooks.slack.com/test",
      productHuntTopics: [],
      announcementKeywords: {},
    })
  );
}
