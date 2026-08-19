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
    return true;
  }
}

new BackgroundManager();