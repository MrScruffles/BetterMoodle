class CalendarManager {
  constructor() {
    this.storageKey = "bm_completed_events";
    this.completedEvents = new Set();
    this.checkTimeout = null;
  }

  async init() {
    await this.loadEvents();
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

  getEventIdentifier(element) {
    const link = element.tagName.toLowerCase() === 'a' ? element : element.querySelector("a");
    if (!link) {
        const text = element.textContent.trim();
        return text ? `nolink:::${text}` : null;
    }
    
    try {
      const url = new URL(link.href, window.location.origin);
      url.hash = '';
      return url.toString();
    } catch (e) {
      return link.getAttribute("href");
    }
  }

  processEvents() {
    const events = document.querySelectorAll(".eventname, [data-region='event-item']");
    
    events.forEach((eventNameEl) => {
      const container = eventNameEl.closest("li") || eventNameEl.closest("a") || eventNameEl;
      
      const eventId = this.getEventIdentifier(container);
      if (!eventId) return;

      // Apply saved completion state immediately
      if (this.completedEvents.has(eventId)) {
        container.classList.add("bm-completed");
      }
    });

    clearTimeout(this.checkTimeout);
    this.checkTimeout = setTimeout(() => this.autoCheckEvents(), 1000);
  }

  async autoCheckEvents() {
    const events = document.querySelectorAll(".eventname, [data-region='event-item']");
    
    for (const eventNameEl of events) {
      const container = eventNameEl.closest("li") || eventNameEl.closest("a") || eventNameEl;
      
      const eventId = this.getEventIdentifier(container);
      if (!eventId) continue;

      if (this.completedEvents.has(eventId)) continue;

      if (container.dataset.bmChecked === "true") continue;
      container.dataset.bmChecked = "true";

      const link = container.tagName.toLowerCase() === 'a' ? container : container.querySelector("a");
      if (!link || !link.href) continue;

      try {
        let urlToFetch = link.href;
        
        // Only fetch if it's a same-origin URL to avoid CORS issues
        if (!urlToFetch.startsWith(window.location.origin)) continue;

        let response = await fetch(urlToFetch);
        let text = await response.text();
        let parser = new DOMParser();
        let doc = parser.parseFromString(text, 'text/html');
        
        // If it's a calendar day view, try to find the actual activity link
        if (urlToFetch.includes('calendar/view.php')) {
            const eventName = eventNameEl.textContent.trim().toLowerCase();
            const links = Array.from(doc.querySelectorAll('a[href*="/mod/"]'));
            
            // Try to find the specific link for this event
            let matchedLink = links.find(l => {
                const linkText = l.textContent.trim().toLowerCase();
                return linkText.includes(eventName) || eventName.includes(linkText);
            });
            
            if (!matchedLink && links.length > 0) {
                matchedLink = links[0]; // fallback to first mod link
            }

            if (matchedLink && matchedLink.href.startsWith(window.location.origin)) {
                urlToFetch = matchedLink.href;
                response = await fetch(urlToFetch);
                text = await response.text();
                doc = parser.parseFromString(text, 'text/html');
            }
        }
        
        if (this.checkIfPageIsDone(doc)) {
          container.classList.add("bm-completed");
          this.completedEvents.add(eventId);
          this.saveEvents();
        }
      } catch (error) {
        console.error("BetterMoodle: Error checking event completion:", error);
      }
    }
  }

  checkIfPageIsDone(doc) {
    const pageText = (doc.body ? doc.body.textContent : '').replace(/\s+/g, ' ').toLowerCase();

    // 1. Check for standard Moodle "Done" badges
    const badges = doc.querySelectorAll('.badge-success, .btn-success, .text-success, .label-success, .bg-success');
    for (const badge of badges) {
      const text = badge.textContent.trim().toLowerCase();
      if ((text === 'done' || text.includes('done') || text.includes('completed')) && !text.includes('mark as done')) {
        return true;
      }
    }

    // 2. Check for Assignment "Submitted for grading"
    if (pageText.includes('submitted for grading')) {
      return true;
    }

    // 3. Check for Quiz completion
    if (pageText.includes('your final grade for this quiz is') || 
        pageText.includes('no more attempts are allowed') || 
        pageText.includes('status finished')) {
      return true;
    }

    const userMenu = document.querySelector('.usermenu, .userbutton');
    if (userMenu) {
        let userName = '';
        const img = userMenu.querySelector('img[alt]');
        if (img && img.alt) {
            userName = img.alt.replace('Picture of ', '').trim().toLowerCase();
        } else {
            const nameEl = userMenu.querySelector('.usertext, .userbutton, .usertext-name');
            if (nameEl) userName = nameEl.textContent.trim().toLowerCase();
        }

        if (userName) {
            const authors = doc.querySelectorAll('.author, .starter, .lastpost, td, .media-body');
            for (const author of authors) {
                if (author.textContent.toLowerCase().includes(userName)) {
                    if (pageText.includes('add a new discussion topic') || doc.querySelector('.forumheaderlist, .discussion-list')) {
                        return true;
                    }
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