(() => {
  "use strict";

  const STORAGE_KEY = "aif-c01-study-state-v1";
  const LANGUAGE_KEY = "aif-c01-question-language";
  const app = document.querySelector("#app");
  const toast = document.querySelector("#toast");
  const installButton = document.querySelector("#install-button");
  const installHelp = document.querySelector("#install-help");
  const confirmInstall = document.querySelector("#confirm-install");
  const networkState = document.querySelector("#network-state");
  const languageSwitch = document.querySelector("#language-switch");

  let questions = [];
  let questionMap = new Map();
  let chineseQuestions = new Map();
  let language = "en";
  let deferredInstallPrompt = null;
  let route = { name: "home" };
  let quizSession = null;
  let state = loadState();

  function loadState() {
    const fallback = {
      attempts: {},
      wrongIds: [],
      lastPracticeId: 1,
      quizHistory: []
    };
    try {
      return { ...fallback, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
    } catch {
      return fallback;
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function displayQuestion(question) {
    return language === "zh" ? chineseQuestions.get(question.id) || question : question;
  }

  function updateLanguageButtons() {
    for (const button of languageSwitch.querySelectorAll("[data-language]")) {
      button.disabled = false;
      button.setAttribute("aria-pressed", String(button.dataset.language === language));
    }
  }

  languageSwitch.addEventListener("click", (event) => {
    const next = event.target.closest("[data-language]")?.dataset.language;
    if (!next || next === language || !questions.length) return;
    const answerForm = app.querySelector("#answer-form");
    if (answerForm) {
      const selected = Array.from(answerForm.querySelectorAll('input[name="answer"]:checked'), (input) => input.value);
      if (route.name === "quiz-question" && !quizSession.submitted) quizSession.selected = selected;
      else if (!route.submitted && route.name !== "quiz-question") route.selected = selected;
    }
    const search = app.querySelector("#question-search")?.value;
    const count = app.querySelector("#quiz-count")?.value;
    language = next;
    try { localStorage.setItem(LANGUAGE_KEY, language); } catch { /* Preference is optional. */ }
    updateLanguageButtons();
    render();
    if (search !== undefined) app.querySelector("#question-search").value = search;
    if (count !== undefined) app.querySelector("#quiz-count").value = count;
  });

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function excerpt(value, length = 150) {
    const flat = value.replace(/\s+/g, " ").trim();
    return flat.length > length ? `${flat.slice(0, length).trim()}…` : flat;
  }

  function isSameAnswer(selected, correct) {
    return [...selected].sort().join("") === [...correct].sort().join("");
  }

  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    window.setTimeout(() => {
      toast.hidden = true;
    }, 2400);
  }

  function navigate(name, params = {}) {
    route = { name, ...params };
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setActiveNav(name) {
    document.querySelectorAll(".dock button").forEach((button) => {
      const action = button.dataset.action;
      const active =
        action === name ||
        (name === "question" && action === route.origin) ||
        (name === "quiz-question" && action === "quiz") ||
        (name === "quiz-result" && action === "quiz");
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  function renderHome() {
    app.innerHTML = `
      <div class="workspace">
          <ol class="action-list">
            <li>
              <button class="action-row" type="button" data-action="practice" data-testid="start-practice">
                <span class="index">01</span>
                <strong>单题练习</strong>
                <span class="arrow" aria-hidden="true">›</span>
              </button>
            </li>
            <li>
              <button class="action-row" type="button" data-action="quiz">
                <span class="index">02</span>
                <strong>随机测试</strong>
                <span class="arrow" aria-hidden="true">›</span>
              </button>
            </li>
            <li>
              <button class="action-row" type="button" data-action="wrong">
                <span class="index">03</span>
                <strong>错题回练</strong>
                <span class="arrow" aria-hidden="true">›</span>
              </button>
            </li>
          </ol>
      </div>`;
  }

  function renderBrowse() {
    const query = (route.query || "").trim().toLowerCase();
    const filtered = query
      ? questions.filter(
          (question) =>
            String(question.id) === query ||
            [question, chineseQuestions.get(question.id)].some(
              (entry) => entry && (entry.prompt.toLowerCase().includes(query) ||
                entry.options.some((option) => option.text.toLowerCase().includes(query)))
            )
        )
      : questions;
    const page = Math.max(1, Number(route.page) || 1);
    const pageSize = 30;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

    app.innerHTML = `
      <div class="workspace">
        <header class="view-heading">
          <h1>题目浏览</h1>
        </header>
        <form class="toolbar" id="search-form">
          <label class="field" for="question-search">按题号或关键词查找
            <input id="question-search" name="query" type="search" value="${escapeHtml(route.query || "")}">
          </label>
          <button class="button button-secondary" type="submit">查找题目</button>
        </form>
        <ol class="question-index">
          ${visible
            .map((question) => {
              const attempt = state.attempts[question.id];
              let status = "未作答";
              if (attempt) {
                if (attempt.correct) status = "已答对";
                else status = state.wrongIds.includes(question.id) ? "待复习" : "上次答错";
              }
              return `<li>
                <button class="question-link" type="button" data-open-question="${question.id}">
                  <span class="question-number">Q${question.id}</span>
                  <span class="question-title" lang="${language}">${escapeHtml(excerpt(displayQuestion(question).prompt))}</span>
                  <span class="question-status">${status}</span>
                </button>
              </li>`;
            })
            .join("")}
        </ol>
        <div class="question-actions">
          <button class="button button-secondary" type="button" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button>
          <span class="progress-caption">第 ${page} 页</span>
          <button class="button button-secondary" type="button" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>下一页</button>
        </div>
      </div>`;
  }

  function renderQuestion({
    question,
    origin,
    submitted = false,
    selected = [],
    title = "单题练习"
  }) {
    const inputType = question.multiple ? "checkbox" : "radio";
    const answerCorrect = submitted && isSameAnswer(selected, question.correctAnswer);
    const display = displayQuestion(question);
    app.innerHTML = `
      <div class="workspace">
        <header class="view-heading">
          <div><h1${origin === "practice" ? ' class="practice-heading"' : ""}>${escapeHtml(title)}</h1><p>${question.multiple ? "多选题 · 请选择所有正确答案" : "单选题"}</p></div>
        </header>
        <div class="question-shell">
          <article class="question-card" data-testid="question-card">
            <p class="question-meta">QUESTION ${question.id}</p>
            <h2 class="question-prompt" lang="${language}">${escapeHtml(display.prompt)}</h2>
            <form id="answer-form">
              <ol class="options">
                ${display.options
                  .map((option) => {
                    const chosen = selected.includes(option.label);
                    const correct = submitted && question.correctAnswer.includes(option.label);
                    const incorrect = submitted && chosen && !correct;
                    const className = correct ? "correct" : incorrect ? "incorrect" : "";
                    return `<li class="option ${className}">
                      <label>
                        <input type="${inputType}" name="answer" value="${option.label}" ${chosen ? "checked" : ""} ${submitted ? "disabled" : ""}>
                        <span class="option-letter">${option.label}</span>
                        <span lang="${language}">${escapeHtml(option.text)}</span>
                      </label>
                    </li>`;
                  })
                  .join("")}
              </ol>
              ${
                submitted
                  ? `<section class="answer-panel" data-testid="answer-feedback">
                      <p class="verdict ${answerCorrect ? "good" : "bad"}">${answerCorrect ? "✓ 回答正确" : `✕ 回答错误 · 正确答案 ${question.correctAnswer.join("")}`}</p>
                      <h2>解析</h2>
                      <p lang="${display.explanation ? language : "zh"}">${escapeHtml(display.explanation || "原题未提供解析。")}</p>
                    </section>`
                  : ""
              }
              <div class="question-actions">
                ${
                  submitted
                    ? `<button class="button button-primary" type="button" data-next-question>下一题</button>`
                    : `<button class="button button-primary" type="submit" data-testid="submit-answer">提交答案</button>`
                }
                <button class="button button-secondary" type="button" data-action="home">退出</button>
              </div>
            </form>
          </article>
          <aside class="question-aside" aria-label="本题进度">
            <dl>
              <div><dt>题型</dt><dd>${question.multiple ? "多选" : "单选"}</dd></div>
              <div><dt>错题本</dt><dd>${state.wrongIds.includes(question.id) ? "已收录" : "未收录"}</dd></div>
            </dl>
          </aside>
        </div>
      </div>`;
  }

  function renderPractice() {
    const startIndex = Math.max(
      0,
      questions.findIndex((question) => question.id === Number(state.lastPracticeId))
    );
    const index = Number.isInteger(route.index) ? route.index : startIndex;
    const question = questions[Math.max(0, Math.min(index, questions.length - 1))];
    renderQuestion({
      question,
      origin: "practice",
      submitted: route.submitted,
      selected: route.selected || [],
      title: "单题练习"
    });
  }

  function renderReviewQuestion() {
    const question = questionMap.get(Number(route.id));
    renderQuestion({
      question,
      origin: route.origin || "browse",
      submitted: route.submitted,
      selected: route.selected || [],
      title: route.origin === "wrong" ? "错题回练" : "题目浏览"
    });
  }

  function renderQuizSetup() {
    app.innerHTML = `
      <div class="workspace">
        <header class="view-heading">
          <div><h1>随机测试</h1><p>随机抽题，题目不重复</p></div>
        </header>
        <form id="quiz-setup" class="setup">
          <h2>测试设置</h2>
          <label class="field" for="quiz-count">题目数量
            <select id="quiz-count" name="count">
              <option value="5">5 题</option>
              <option value="10" selected>10 题</option>
              <option value="20">20 题</option>
              <option value="50">50 题</option>
            </select>
          </label>
          <button class="button button-primary" type="submit" data-testid="start-quiz">生成随机测试</button>
        </form>
      </div>`;
  }

  function renderQuizQuestion() {
    if (!quizSession) {
      navigate("quiz");
      return;
    }
    const id = quizSession.ids[quizSession.index];
    renderQuestion({
      question: questionMap.get(id),
      origin: "quiz",
      submitted: quizSession.submitted,
      selected: quizSession.selected || [],
      title: "随机测试"
    });
  }

  function renderQuizResult() {
    const result = quizSession;
    if (!result) {
      navigate("quiz");
      return;
    }
    const score = Math.round((result.correct / result.ids.length) * 100);
    app.innerHTML = `
      <div class="workspace">
        <header class="view-heading">
          <div><h1>测试完成</h1><p>本次随机抽取 ${result.ids.length} 道题</p></div>
        </header>
        <section class="result-sheet" aria-label="测试成绩">
          <div class="stat"><strong>${score}%</strong><span>得分</span></div>
          <div class="stat"><strong>${result.correct}</strong><span>答对</span></div>
          <div class="stat"><strong>${result.ids.length - result.correct}</strong><span>答错</span></div>
        </section>
        <div class="question-actions">
          <button class="button button-primary" type="button" data-action="quiz">再做一组</button>
          <button class="button button-secondary" type="button" data-action="wrong">复习错题</button>
        </div>
      </div>`;
  }

  function renderWrong() {
    const wrongQuestions = state.wrongIds
      .map((id) => questionMap.get(Number(id)))
      .filter(Boolean);
    app.innerHTML = `
      <div class="workspace">
        <header class="view-heading">
          <div><h1>错题回练</h1><p>${wrongQuestions.length} 道题等待复习</p></div>
        </header>
        ${
          wrongQuestions.length
            ? `<ol class="question-index">
                ${wrongQuestions
                  .map(
                    (question) => `<li>
                      <button class="question-link" type="button" data-open-wrong="${question.id}">
                        <span class="question-number">Q${question.id}</span>
                        <span class="question-title" lang="${language}">${escapeHtml(excerpt(displayQuestion(question).prompt))}</span>
                        <span class="question-status">重新作答</span>
                      </button>
                    </li>`
                  )
                  .join("")}
              </ol>
              <div class="question-actions">
                <button class="button button-secondary" type="button" data-clear-wrong>清空错题本</button>
              </div>`
            : `<section class="empty-state">
                <h2>错题本是空的</h2>
                <p>在练习或测试中答错的题会自动出现在这里；重新答对后会自动移除。</p>
                <button class="button button-primary" type="button" data-action="practice">开始练习</button>
              </section>`
        }
      </div>`;
  }

  function render() {
    languageSwitch.hidden = route.name === "home";
    setActiveNav(route.name);
    if (route.name === "home") renderHome();
    else if (route.name === "browse") renderBrowse();
    else if (route.name === "practice") renderPractice();
    else if (route.name === "question") renderReviewQuestion();
    else if (route.name === "quiz") renderQuizSetup();
    else if (route.name === "quiz-question") renderQuizQuestion();
    else if (route.name === "quiz-result") renderQuizResult();
    else if (route.name === "wrong") renderWrong();
    else renderHome();
  }

  function recordAnswer(question, selected) {
    const correct = isSameAnswer(selected, question.correctAnswer);
    state.attempts[question.id] = {
      correct,
      selected,
      updatedAt: new Date().toISOString()
    };
    if (correct) {
      state.wrongIds = state.wrongIds.filter((id) => Number(id) !== question.id);
    } else if (!state.wrongIds.includes(question.id)) {
      state.wrongIds.push(question.id);
    }
    saveState();
    return correct;
  }

  app.addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.target.id === "search-form") {
      const data = new FormData(event.target);
      navigate("browse", { query: String(data.get("query") || ""), page: 1 });
      return;
    }
    if (event.target.id === "quiz-setup") {
      const count = Number(new FormData(event.target).get("count"));
      quizSession = {
        ids: shuffle(questions.map((question) => question.id)).slice(0, count),
        index: 0,
        correct: 0,
        submitted: false,
        selected: []
      };
      navigate("quiz-question");
      return;
    }
    if (event.target.id === "answer-form") {
      const selected = [...new FormData(event.target).getAll("answer")];
      if (!selected.length) {
        showToast("请先选择答案");
        return;
      }
      if (route.name === "practice") {
        const question = questions[route.index ?? questions.findIndex((item) => item.id === Number(state.lastPracticeId))];
        recordAnswer(question, selected);
        state.lastPracticeId = question.id;
        saveState();
        route = { ...route, submitted: true, selected };
      } else if (route.name === "question") {
        const question = questionMap.get(Number(route.id));
        recordAnswer(question, selected);
        route = { ...route, submitted: true, selected };
      } else if (route.name === "quiz-question") {
        const question = questionMap.get(quizSession.ids[quizSession.index]);
        const correct = recordAnswer(question, selected);
        if (correct) quizSession.correct += 1;
        quizSession.submitted = true;
        quizSession.selected = selected;
      }
      render();
    }
  });

  document.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      const action = actionButton.dataset.action;
      if (["home", "browse", "practice", "quiz", "wrong"].includes(action)) {
        navigate(action);
      }
      return;
    }

    const questionButton = event.target.closest("[data-open-question]");
    if (questionButton) {
      navigate("question", { id: Number(questionButton.dataset.openQuestion), origin: "browse" });
      return;
    }

    const wrongButton = event.target.closest("[data-open-wrong]");
    if (wrongButton) {
      navigate("question", { id: Number(wrongButton.dataset.openWrong), origin: "wrong" });
      return;
    }

    const pageButton = event.target.closest("[data-page]");
    if (pageButton && !pageButton.disabled) {
      navigate("browse", { query: route.query || "", page: Number(pageButton.dataset.page) });
      return;
    }

    if (event.target.closest("[data-next-question]")) {
      if (route.name === "practice") {
        const currentIndex = route.index ?? questions.findIndex((item) => item.id === Number(state.lastPracticeId));
        const nextIndex = (currentIndex + 1) % questions.length;
        state.lastPracticeId = questions[nextIndex].id;
        saveState();
        navigate("practice", { index: nextIndex });
      } else if (route.name === "question") {
        navigate(route.origin || "browse");
      } else if (route.name === "quiz-question") {
        quizSession.index += 1;
        quizSession.submitted = false;
        quizSession.selected = [];
        if (quizSession.index >= quizSession.ids.length) {
          state.quizHistory.unshift({
            correct: quizSession.correct,
            completedAt: new Date().toISOString()
          });
          state.quizHistory = state.quizHistory.slice(0, 10);
          saveState();
          navigate("quiz-result");
        } else {
          render();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }
      return;
    }

    if (event.target.closest("[data-clear-wrong]")) {
      if (window.confirm("清空错题列表？答题记录和练习位置会保留。")) {
        state.wrongIds = [];
        saveState();
        render();
      }
    }
  });

  function updateNetworkState() {
    const online = navigator.onLine;
    networkState.textContent = online ? "在线" : "离线可用";
    networkState.classList.toggle("offline", !online);
  }

  window.addEventListener("online", updateNetworkState);
  window.addEventListener("offline", updateNetworkState);
  updateNetworkState();

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    confirmInstall.hidden = false;
  });

  installButton.addEventListener("click", () => installHelp.showModal());

  confirmInstall.addEventListener("click", async () => {
    const prompt = deferredInstallPrompt;
    if (!prompt) return;
    deferredInstallPrompt = null;
    confirmInstall.hidden = true;
    installHelp.close();
    try {
      await prompt.prompt();
    } catch {
      installHelp.showModal();
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    confirmInstall.hidden = true;
    installButton.textContent = "安装说明";
    showToast("安装完成");
  });

  function fetchQuestions(path) {
    return fetch(path).then((response) => {
      if (!response.ok) throw new Error(`题库加载失败：${response.status}`);
      return response.json();
    });
  }

  if ("serviceWorker" in navigator) {
    let controller = navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      const next = navigator.serviceWorker.controller;
      if (controller && next && next !== controller) {
        document.querySelector("#update-notice").hidden = false;
      }
      controller = next;
    });
    navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("离线缓存未启用", error));
  }

  Promise.all([fetchQuestions("./data/questions.json"), fetchQuestions("./data/questions.zh.json")])
    .then(([data, translations]) => {
      questions = data;
      questionMap = new Map(questions.map((question) => [question.id, question]));
      chineseQuestions = new Map(translations.map((question) => [question.id, question]));
      try { language = localStorage.getItem(LANGUAGE_KEY) === "zh" ? "zh" : "en"; } catch { /* Use the default. */ }
      updateLanguageButtons();
      render();
    })
    .catch((error) => {
      app.innerHTML = `<section class="empty-state"><h1>题库没有载入</h1><p>${escapeHtml(error.message)}</p></section>`;
    });
})();
