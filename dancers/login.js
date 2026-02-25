import { initOAuth, signIn, signOut, hasSession } from "./oauth.js";

const handleInput = document.getElementById("handleInput");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authStatus = document.getElementById("authStatus");

const DEFAULT_CLIENT_ID = "https://nebbysonder.github.io/dancers/oauth-client-metadata.json";

function setAuthStatus(message, connected) {
  if (authStatus) authStatus.textContent = `Auth: ${message}`;
  if (loginBtn) loginBtn.disabled = Boolean(connected);
  if (logoutBtn) logoutBtn.disabled = !connected;
}

loginBtn.addEventListener("click", async () => {
  const handle = handleInput.value.trim();
  if (!handle) {
    alert("Enter a Bluesky handle.");
    return;
  }
  setAuthStatus("connecting...", false);
  try {
    window.sessionStorage.setItem("bsky_client_id", DEFAULT_CLIENT_ID);
    await initOAuth(DEFAULT_CLIENT_ID);
    await signIn(handle);
    setAuthStatus("connected", true);
  } catch (err) {
    console.error(err);
    setAuthStatus("failed", false);
    alert("OAuth failed. Check console for details.");
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await signOut();
    setAuthStatus("not connected", false);
  } catch (err) {
    console.error(err);
    setAuthStatus("failed", false);
  }
});

initOAuth(DEFAULT_CLIENT_ID)
  .then((session) => {
    setAuthStatus(session ? "connected" : "not connected", Boolean(session));
  })
  .catch((err) => {
    console.error(err);
    setAuthStatus("failed", false);
  });
