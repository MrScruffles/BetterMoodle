class BackgroundManager {
  constructor() {
    this.init();
  }

  init() {
    chrome.runtime.onInstalled.addListener(this.onInstalled.bind(this));
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
  }

  onInstalled() {
    console.log("BetterMoodle extension installed");
  }

  handleMessage(request, sender, sendResponse) {
    if (request.type === "fetchPage") {
      this.fetchPage(request.url).then(sendResponse);
      return true;
    }

    return false;
  }

  async fetchPage(url) {
    try {
      const parsed = new URL(url);

      if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("wolfware.ncsu.edu")) {
        return { ok: false };
      }

      const response = await fetch(parsed.toString(), {
        credentials: "include",
        redirect: "follow",
        cache: "no-store",
      });

      if (!response.ok) {
        return { ok: false };
      }

      const html = await response.text();
      return { ok: true, html };
    } catch (error) {
      return { ok: false };
    }
  }
}

new BackgroundManager();
