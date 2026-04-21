const path = require("path");
const { chromium } = require("playwright");

async function main() {
  const userDataDir = path.join(__dirname, ".tmp-extension-profile");
  const extensionPath = path.join(__dirname, "../..");

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });

  try {
    const background = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
    console.log(`Loaded extension service worker: ${background.url()}`);
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
