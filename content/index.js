if (typeof importScripts === "function") {
  importScripts("calender.js");
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  return MessageHandler.handle(request, sender, sendResponse);
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("CatWatcher extension installed");
});