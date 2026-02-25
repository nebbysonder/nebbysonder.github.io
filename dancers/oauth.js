import { BrowserOAuthClient } from "https://unpkg.com/@atproto/oauth-client-browser@0.3.28/dist/index.js?module";
import { Agent } from "https://unpkg.com/@atproto/api@0.16.2/dist/index.js?module";

const HANDLE_RESOLVER = "https://bsky.social";
let oauthClient = null;
let agent = null;
let session = null;

async function createClient(clientId) {
  if (oauthClient) return oauthClient;
  if (!clientId) {
    throw new Error("Missing client ID URL.");
  }
  oauthClient = await BrowserOAuthClient.load({
    clientId,
    handleResolver: HANDLE_RESOLVER,
  });
  return oauthClient;
}

export async function initOAuth(clientId) {
  if (!clientId) return null;
  const client = await createClient(clientId);
  const result = await client.init();
  if (result?.session) {
    session = result.session;
    agent = new Agent(session);
  }
  return session;
}

export async function signIn(handle) {
  const clientId = window.sessionStorage.getItem("bsky_client_id");
  const client = await createClient(clientId);
  const result = await client.signIn(handle);
  session = result.session;
  agent = new Agent(session);
  return session;
}

export async function signOut() {
  if (!oauthClient) return;
  await oauthClient.signOut();
  session = null;
  agent = null;
}

export function hasSession() {
  return Boolean(session);
}

export async function resolveFeedUri(feedHandle, feedSlug) {
  if (!agent) throw new Error("Not authenticated.");
  const resolved = await agent.com.atproto.identity.resolveHandle({ handle: feedHandle });
  return `at://${resolved.data.did}/app.bsky.feed.generator/${feedSlug}`;
}

export async function fetchFeed({ feedUri, limit = 20, cursor = null }) {
  if (!agent) throw new Error("Not authenticated.");
  const response = await agent.app.bsky.feed.getFeed({
    feed: feedUri,
    limit,
    cursor,
  });
  return response.data;
}
