class QuizManager {
  constructor() {
    this.isLoading = false;
    this.hasMerged = false;
    this.buttonObserver = null;
  }

  init() {
    if (!this.isAttemptPage()) return;
    this.ensureLoadButton();
    this.watchForLoadButtonHost();
  }

  isAttemptPage() {
    return /\/mod\/quiz\/attempt\.php$/i.test(window.location.pathname);
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

  getForm() {
    return document.getElementById("responseform") || document.querySelector("form.questionflagsaveform") || document.querySelector("#region-main form");
  }

  createLoadButton(id = "bm-load-all-questions") {
    const button = document.createElement("button");
    button.type = "button";
    button.id = id;
    button.className = "btn btn-secondary btn-small bm-load-all-questions";
    button.textContent = "Load all questions";
    button.addEventListener("click", () => {
      this.mergeAllPages();
    });
    return button;
  }

  isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  ensureLoadButton() {
    if (this.hasMerged) return true;

    let placed = false;

    const firstQuestion = document.querySelector("#responseform .que, form .que, .que");
    if (firstQuestion && !document.getElementById("bm-load-all-questions")) {
      const bar = document.createElement("div");
      bar.id = "bm-quiz-toolbar";
      bar.className = "bm-quiz-toolbar";
      bar.appendChild(this.createLoadButton("bm-load-all-questions"));
      firstQuestion.parentNode.insertBefore(bar, firstQuestion);
      placed = true;
    }

    const finishLink = document.querySelector("a.endtestlink, #mod_quiz_navblock a[href*='summary.php']");
    if (finishLink && finishLink.parentNode && !document.getElementById("bm-load-all-questions-nav")) {
      const navButton = this.createLoadButton("bm-load-all-questions-nav");
      navButton.className = "btn btn-secondary btn-sm bm-load-all-questions bm-load-all-questions-nav";
      finishLink.parentNode.insertBefore(navButton, finishLink);
      placed = true;
    }

    const wrapper = document.getElementById("quiz-timer-wrapper");
    const hideBtn = document.getElementById("toggle-timer");
    if (this.isVisible(wrapper) && hideBtn && !document.getElementById("bm-load-all-questions-timer")) {
      const timerButton = this.createLoadButton("bm-load-all-questions-timer");
      hideBtn.insertAdjacentElement("afterend", timerButton);
      placed = true;
    }

    return placed || !!document.querySelector(".bm-load-all-questions");
  }

  watchForLoadButtonHost() {
    let tries = 0;
    const tryInject = () => {
      const done = this.ensureLoadButton();
      if (done || ++tries > 40) {
        clearInterval(poll);
        if (this.buttonObserver) {
          this.buttonObserver.disconnect();
          this.buttonObserver = null;
        }
      }
    };

    const poll = setInterval(tryInject, 250);

    this.buttonObserver = new MutationObserver(() => {
      tryInject();
    });

    if (document.body) {
      this.buttonObserver.observe(document.body, { childList: true, subtree: true });
    }

    tryInject();
  }

  getPageUrls() {
    const urls = new Map();
    const current = new URL(window.location.href);
    const attempt = current.searchParams.get("attempt");

    if (!attempt) return [];

    const navLinks = document.querySelectorAll(
      "#mod_quiz_navblock a[href*='attempt.php'], .qnbutton[href*='attempt.php'], [data-region='quiz-navigation'] a[href*='attempt.php'], .quiz-nav a[href*='attempt.php']"
    );

    navLinks.forEach((link) => {
      try {
        const url = new URL(link.href, window.location.origin);
        if (!url.hostname.endsWith("wolfware.ncsu.edu")) return;
        if (!url.pathname.includes("/mod/quiz/attempt.php")) return;
        if (url.searchParams.get("attempt") !== attempt) return;

        const page = url.searchParams.get("page") || "0";
        url.hash = "";
        urls.set(page, url.toString());
      } catch (e) {}
    });

    current.hash = "";
    const currentPage = current.searchParams.get("page") || "0";
    urls.set(currentPage, current.toString());

    if (urls.size <= 1) {
      const maxFromButtons = document.querySelectorAll(
        "#mod_quiz_navblock .qnbutton, [data-region='quiz-navigation'] .qnbutton, .qnbutton"
      ).length;

      for (let page = 0; page < maxFromButtons; page++) {
        const url = new URL(window.location.href);
        if (page === 0) {
          url.searchParams.delete("page");
        } else {
          url.searchParams.set("page", String(page));
        }
        url.hash = "";
        urls.set(String(page), url.toString());
      }
    }

    return Array.from(urls.entries())
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map((entry) => ({ page: entry[0], url: entry[1] }));
  }

  getCurrentPageKey() {
    return new URL(window.location.href).searchParams.get("page") || "0";
  }

  extractQuestions(doc) {
    return Array.from(doc.querySelectorAll(".que"));
  }

  findSubmitButtons(form) {
    return (
      form.querySelector(".submitbtns") ||
      form.querySelector("#mod_quiz-next-nav")?.closest("div") ||
      form.querySelector("input[name='next']")?.closest(".submitbtns, div") ||
      form.querySelector("button[name='next']")?.closest(".submitbtns, div") ||
      null
    );
  }

  insertBeforeSafe(node, referenceNode) {
    if (!referenceNode || !referenceNode.parentNode) {
      return false;
    }

    referenceNode.parentNode.insertBefore(node, referenceNode);
    return true;
  }

  collectSlots(form) {
    const slots = new Set();

    form.querySelectorAll("input[name], select[name], textarea[name]").forEach((el) => {
      const match = String(el.name).match(/^q\d+:(\d+)_/);
      if (match) {
        slots.add(match[1]);
      }
    });

    return Array.from(slots).sort((a, b) => Number(a) - Number(b));
  }

  updateSlotsField(form) {
    const slots = this.collectSlots(form);
    if (slots.length === 0) return;

    let slotsInput = form.querySelector('input[name="slots"]');
    if (!slotsInput) {
      slotsInput = document.createElement("input");
      slotsInput.type = "hidden";
      slotsInput.name = "slots";
      form.appendChild(slotsInput);
    }

    slotsInput.value = slots.join(",");
  }

  hidePageControls(form) {
    form.querySelectorAll("input[name='previous'], button[name='previous']").forEach((el) => {
      el.classList.add("bm-quiz-hidden");
    });

    const nextBtn = form.querySelector("input[name='next'], button[name='next']");
    if (nextBtn) {
      nextBtn.value = "Save all answers";
      if (nextBtn.tagName === "BUTTON") {
        nextBtn.textContent = "Save all answers";
      }
      nextBtn.classList.remove("bm-quiz-hidden");
    }

    document.querySelectorAll(".mod_quiz-prev-nav").forEach((el) => {
      el.classList.add("bm-quiz-hidden");
    });
  }

  wireFinishSave(form) {
    const finishLinks = document.querySelectorAll("a.endtestlink, #mod_quiz_navblock a[href*='summary.php']");

    finishLinks.forEach((link) => {
      if (link.dataset.bmFinishWired === "true") return;
      link.dataset.bmFinishWired = "true";

      link.addEventListener("click", async (event) => {
        if (!this.hasMerged) return;

        event.preventDefault();
        event.stopPropagation();

        this.showStatus("BetterMoodle: Saving all answers…");
        const saved = await this.saveAllAnswers(form);

        if (saved) {
          window.location.href = link.href;
          return;
        }

        this.showStatus("BetterMoodle: Could not save answers. Try “Save all answers” first.");
      }, true);
    });
  }

  async saveAllAnswers(form) {
    try {
      this.updateSlotsField(form);

      const action = form.getAttribute("action") || window.location.href;
      const formData = new FormData(form);
      formData.set("next", "Next page");

      const response = await fetch(action, {
        method: "POST",
        body: formData,
        credentials: "include",
        redirect: "manual",
        cache: "no-store",
      });

      if (response.status === 0 || response.type === "opaqueredirect") {
        return true;
      }

      return response.status >= 200 && response.status < 400;
    } catch (e) {
      return false;
    }
  }

  showStatus(message) {
    let status = document.getElementById("bm-quiz-status");
    if (!status) {
      status = document.createElement("div");
      status.id = "bm-quiz-status";
      status.className = "bm-quiz-status";

      const form = this.getForm();
      const submitbtns = form ? this.findSubmitButtons(form) : null;
      const host = submitbtns?.parentNode || form;

      if (host) {
        if (submitbtns && submitbtns.parentNode === host) {
          host.insertBefore(status, submitbtns);
        } else {
          host.insertBefore(status, host.firstChild);
        }
      }
    }
    status.textContent = message;
  }

  setLoadButtonState(text, disabled) {
    document.querySelectorAll(".bm-load-all-questions").forEach((button) => {
      button.textContent = text;
      button.disabled = disabled;
    });
  }

  async mergeAllPages() {
    if (this.isLoading || this.hasMerged) return;
    this.isLoading = true;
    this.setLoadButtonState("Loading…", true);

    try {
      const form = this.getForm();
      if (!form) {
        this.setLoadButtonState("Load all questions", false);
        return;
      }

      const pages = this.getPageUrls();
      if (pages.length <= 1) {
        this.showStatus("BetterMoodle: This quiz already has only one page.");
        this.setLoadButtonState("Load all questions", false);
        return;
      }

      this.showStatus("BetterMoodle: Loading all questions…");

      const submitbtns = this.findSubmitButtons(form);
      if (!submitbtns || !submitbtns.parentNode) {
        this.showStatus("BetterMoodle: Could not find quiz question container.");
        this.setLoadButtonState("Load all questions", false);
        return;
      }

      const parent = submitbtns.parentNode;
      const currentPage = this.getCurrentPageKey();
      const questionsByPage = new Map();
      const seenIds = new Set();

      const currentQuestions = Array.from(parent.querySelectorAll(":scope > .que"));
      questionsByPage.set(currentPage, currentQuestions);
      currentQuestions.forEach((q) => {
        if (q.id) seenIds.add(q.id);
      });

      for (const page of pages) {
        if (page.page === currentPage) continue;

        const result = await this.fetchPage(page.url);
        if (!result.ok) continue;

        const doc = this.parseHtml(result.html);
        const questions = this.extractQuestions(doc)
          .filter((question) => !question.id || !seenIds.has(question.id))
          .map((question) => {
            const clone = document.importNode(question, true);
            clone.classList.add("bm-quiz-injected");
            if (clone.id) seenIds.add(clone.id);
            return clone;
          });

        if (questions.length === 0) continue;
        questionsByPage.set(page.page, questions);
      }

      currentQuestions.forEach((question) => question.remove());

      let added = 0;
      const orderedPages = Array.from(questionsByPage.keys()).sort((a, b) => Number(a) - Number(b));

      for (const pageKey of orderedPages) {
        const questions = questionsByPage.get(pageKey) || [];
        for (const question of questions) {
          if (!this.insertBeforeSafe(question, submitbtns)) {
            parent.appendChild(question);
          }
          if (question.classList.contains("bm-quiz-injected")) {
            added += 1;
          }
        }
      }

      this.updateSlotsField(form);
      this.hidePageControls(form);
      this.wireFinishSave(form);
      this.hasMerged = true;
      document.documentElement.dataset.bmQuizMerged = "true";
      this.setLoadButtonState("All questions loaded", true);

      if (added > 0) {
        this.showStatus(`BetterMoodle: Showing all questions on one page (${added} loaded). Use Finish attempt when done.`);
      } else {
        this.showStatus("BetterMoodle: All available questions are shown.");
      }
    } catch (error) {
      this.showStatus("BetterMoodle: Failed to load all questions.");
      this.setLoadButtonState("Load all questions", false);
    } finally {
      this.isLoading = false;
    }
  }
}

new QuizManager().init();
