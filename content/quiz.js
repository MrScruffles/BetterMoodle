class QuizManager {
  constructor() {
    this.isLoading = false;
    this.hasMerged = false;
  }

  init() {
    if (!this.isAttemptPage()) return;
    if (document.documentElement.dataset.bmQuizMerged === "true") return;
    this.mergeAllPages();
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

  hidePageControls(form) {
    form.querySelectorAll("input[name='previous'], input[name='next'], button[name='previous'], button[name='next']").forEach((el) => {
      el.classList.add("bm-quiz-hidden");
    });

    form.querySelectorAll(".submitbtns").forEach((el) => {
      const hasFinish = el.querySelector("input[name='finish'], button[name='finish']");
      if (!hasFinish) {
        el.classList.add("bm-quiz-hidden");
      }
    });

    document.querySelectorAll(".mod_quiz-prev-nav, .mod_quiz-next-nav").forEach((el) => {
      el.classList.add("bm-quiz-hidden");
    });
  }

  wireFinishSave(form) {
    const finishLinks = document.querySelectorAll(
      "a.endtestlink, a[href*='summary.php'], #mod_quiz_navblock a[href*='summary.php']"
    );

    finishLinks.forEach((link) => {
      if (link.dataset.bmFinishWired === "true") return;
      link.dataset.bmFinishWired = "true";

      link.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const saved = await this.saveAllAnswers(form);
        if (saved) {
          window.location.href = link.href;
        }
      }, true);
    });
  }

  async saveAllAnswers(form) {
    try {
      const action = form.getAttribute("action") || window.location.href;
      const formData = new FormData(form);

      if (!formData.has("next") && !formData.has("finish")) {
        formData.set("next", "1");
      }

      const response = await fetch(action, {
        method: "POST",
        body: formData,
        credentials: "include",
        redirect: "follow",
        cache: "no-store",
      });

      return response.ok || response.redirected;
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

  async mergeAllPages() {
    if (this.isLoading || this.hasMerged) return;
    this.isLoading = true;

    try {
      const form = this.getForm();
      if (!form) return;

      const pages = this.getPageUrls();
      if (pages.length <= 1) {
        this.hidePageControls(form);
        this.wireFinishSave(form);
        return;
      }

      this.showStatus("BetterMoodle: Loading all questions…");

      const submitbtns = this.findSubmitButtons(form);
      if (!submitbtns || !submitbtns.parentNode) {
        this.showStatus("BetterMoodle: Could not find quiz question container.");
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

      this.hidePageControls(form);
      this.wireFinishSave(form);
      this.hasMerged = true;
      document.documentElement.dataset.bmQuizMerged = "true";

      if (added > 0) {
        this.showStatus(`BetterMoodle: Showing all questions on one page (${added} loaded).`);
      } else {
        this.showStatus("BetterMoodle: All available questions are shown.");
      }
    } catch (error) {
      this.showStatus("BetterMoodle: Failed to load all questions.");
    } finally {
      this.isLoading = false;
    }
  }
}

new QuizManager().init();
