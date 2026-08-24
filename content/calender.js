class CalendarManager {
  constructor() {
    this.storageKey = "bm_completed_events";
    this.completedEvents = new Set();
    this.checkTimeout = null;
    this.isChecking = false;
    this.userName = null;
  }

  async init() {
    await this.loadEvents();
    this.userName = this.resolveUserName();
    this.observeDOM();
    this.processEvents();
  }

  async loadEvents() {
    return new Promise((resolve) => {
      chrome.storage.sync.get([this.storageKey], (result) => {
        this.completedEvents = new Set(result[this.storageKey] || []);
        resolve();
      });
    });
  }

  async saveEvents() {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ [this.storageKey]: Array.from(this.completedEvents) }, resolve);
    });
  }

  resolveUserName() {
    const userMenu = document.querySelector(".usermenu, .userbutton");
    if (!userMenu) return null;

    const img = userMenu.querySelector("img[alt]");
    if (img && img.alt) {
      return img.alt.replace(/^Picture of\s+/i, "").trim().toLowerCase();
    }

    const nameEl = userMenu.querySelector(".usertext, .usertext-name");
    if (nameEl) {
      return nameEl.textContent.trim().toLowerCase();
    }

    return null;
  }

  getEventIdentifier(element) {
    const link = element.tagName.toLowerCase() === "a" ? element : element.querySelector("a");
    if (!link) {
      const text = element.textContent.trim();
      return text ? `nolink:::${text}` : null;
    }

    try {
      const url = new URL(link.href, window.location.origin);
      url.hash = "";
      return url.toString();
    } catch (e) {
      return link.getAttribute("href");
    }
  }

  isFetchableUrl(url) {
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.protocol !== "https:") return false;
      if (!parsed.hostname.endsWith("wolfware.ncsu.edu")) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  fetchPage(url) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "fetchPage", url }, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve({ ok: false });
          return;
        }
        resolve(response);
      });
    });
  }

  parseHtml(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }

  processEvents() {
    const events = document.querySelectorAll(".maincalendar .eventname, .calendarmonth .eventname, [data-region='event-item'] .eventname");
    if (events.length === 0) return;

    events.forEach((eventNameEl) => {
      const container = eventNameEl.closest("li") || eventNameEl.closest("a") || eventNameEl;
      const eventId = this.getEventIdentifier(container);
      if (!eventId) return;

      if (this.completedEvents.has(eventId)) {
        container.classList.add("bm-completed");
      }
    });

    clearTimeout(this.checkTimeout);
    this.checkTimeout = setTimeout(() => this.autoCheckEvents(), 1000);
  }

  async autoCheckEvents() {
    if (this.isChecking) return;
    this.isChecking = true;

    const events = document.querySelectorAll(".maincalendar .eventname, .calendarmonth .eventname, [data-region='event-item'] .eventname");

    for (const eventNameEl of events) {
      const container = eventNameEl.closest("li") || eventNameEl.closest("a") || eventNameEl;
      const eventId = this.getEventIdentifier(container);
      if (!eventId) continue;
      if (this.completedEvents.has(eventId)) continue;
      if (container.dataset.bmChecked === "true") continue;

      const link = container.tagName.toLowerCase() === "a" ? container : container.querySelector("a");
      if (!link || !link.href || !this.isFetchableUrl(link.href)) continue;

      container.dataset.bmChecked = "true";

      const first = await this.fetchPage(link.href);
      if (!first.ok) {
        delete container.dataset.bmChecked;
        continue;
      }

      let doc = this.parseHtml(first.html);
      let urlToFetch = link.href;

      if (urlToFetch.includes("calendar/view.php") || urlToFetch.includes("calendar/event.php")) {
        const eventName = eventNameEl.textContent.trim().toLowerCase();
        const links = Array.from(doc.querySelectorAll('a[href*="/mod/"]'));
        let matchedLink = links.find((l) => {
          const linkText = l.textContent.trim().toLowerCase();
          return linkText.includes(eventName) || eventName.includes(linkText);
        });

        if (!matchedLink) {
          matchedLink = links.find((l) => this.isFetchableUrl(l.href));
        }

        if (matchedLink && this.isFetchableUrl(matchedLink.href)) {
          const second = await this.fetchPage(matchedLink.href);
          if (!second.ok) {
            delete container.dataset.bmChecked;
            continue;
          }
          doc = this.parseHtml(second.html);
        }
      }

      if (this.checkIfPageIsDone(doc)) {
        container.classList.add("bm-completed");
        this.completedEvents.add(eventId);
        await this.saveEvents();
      }

      await this.delay(250);
    }

    this.isChecking = false;
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  checkIfPageIsDone(doc) {
    const pageText = (doc.body ? doc.body.textContent : "").replace(/\s+/g, " ").toLowerCase();

    const badges = doc.querySelectorAll(".badge-success, .btn-success, .text-success, .label-success, .bg-success");
    for (const badge of badges) {
      const text = badge.textContent.trim().toLowerCase();
      if ((text === "done" || text.includes("done") || text.includes("completed")) && !text.includes("mark as done")) {
        return true;
      }
    }

    if (pageText.includes("submitted for grading")) {
      return true;
    }

    if (
      pageText.includes("your final grade for this quiz is") ||
      pageText.includes("no more attempts are allowed") ||
      pageText.includes("status finished")
    ) {
      return true;
    }

    if (this.userName) {
      const isForum = pageText.includes("add a new discussion topic") || doc.querySelector(".forumheaderlist, .discussion-list");
      if (isForum) {
        const authors = doc.querySelectorAll(".author, .starter, .lastpost, td, .media-body");
        for (const author of authors) {
          if (author.textContent.toLowerCase().includes(this.userName)) {
            return true;
          }
        }
      }
    }

    const completionImages = doc.querySelectorAll('img[src*="completion-auto-y"], img[src*="completion-manual-y"]');
    if (completionImages.length > 0) {
      return true;
    }

    return false;
  }

  observeDOM() {
    const observer = new MutationObserver(() => {
      this.processEvents();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

new CalendarManager().init();
