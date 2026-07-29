(() => {
  "use strict";

  const STORAGE_KEY = "aif-c01-study-state-v1";
  const app = document.querySelector("#app");
  const toast = document.querySelector("#toast");
  const installButton = document.querySelector("#install-button");
  const networkState = document.querySelector("#network-state");

  let questions = [];
  let questionMap = new Map();
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

  function getStats() {
    const attempts = Object.values(state.attempts);
    return {
      attempted: attempts.length,
      correct: attempts.filter((attempt) => attempt.correct).length,
      wrong: state.wrongIds.length
    };
  }

  function renderHome() {
    const stats = getStats();
    const percentage = Math.round((stats.attempted / questions.length) * 100);
    app.innerHTML = `
      <div class="workspace home-layout">
        <section class="hero">
          <h1>把 420 道题，练成判断力。</h1>
          <p class="hero-copy">
            题目来自 452 题 PDF。普通选择题已转成可交互练习；32 道图片型 HOTSPOT 题单独保留，避免错误结构化。
          </p>
          <div class="progress-track" aria-label="总进度 ${percentage}%">
            <span style="width:${percentage}%"></span>
          </div>
          <p class="progress-caption">${stats.attempted} / ${questions.length} 已作答 · ${percentage}%</p>
          <ol class="action-list">
            <li>
              <button class="action-row" type="button" data-action="practice" data-testid="start-practice">
                <span class="index">01</span>
                <span><strong>单题练习</strong><small>顺序作答，提交后立即看解析</small></span>
                <span class="arrow" aria-hidden="true">›</span>
              </button>
            </li>
            <li>
              <button class="action-row" type="button" data-action="quiz">
                <span class="index">02</span>
                <span><strong>随机测试</strong><small>自定题量，完成后查看成绩</small></span>
                <span class="arrow" aria-hidden="true">›</span>
              </button>
            </li>
            <li>
              <button class="action-row" type="button" data-action="wrong">
                <span class="index">03</span>
                <span><strong>错题回练</strong><small>${stats.wrong} 道题等待复习</small></span>
                <span class="arrow" aria-hidden="true">›</span>
              </button>
            </li>
          </ol>
        </section>
        <aside aria-label="学习概览">
          <div class="stat-sheet">
            <div class="stat"><strong>${questions.length}</strong><span>可交互题</span></div>
            <div class="stat"><strong>${stats.attempted}</strong><span>已作答</span></div>
            <div class="stat"><strong>${stats.correct}</strong><span>当前答对</span></div>
            <div class="stat"><strong>${stats.wrong}</strong><span>错题</span></div>
          </div>
          <p class="dataset-note">
            <strong>为什么不是 452 道？</strong><br>
            原 PDF 有 32 道 HOTSPOT 图片交互题。参考 App 同样只纳入 420 道标准题；本原型保留了这些题的文本与页码，后续需重建图片控件。
          </p>
        </aside>
      </div>`;
  }

  function renderBrowse() {
    const query = (route.query || "").trim().toLowerCase();
    const filtered = query
      ? questions.filter(
          (question) =>
            String(question.id) === query ||
            question.prompt.toLowerCase().includes(query) ||
            question.options.some((option) => option.text.toLowerCase().includes(query))
        )
      : questions;
    const page = Math.max(1, Number(route.page) || 1);
    const pageSize = 30;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

    app.innerHTML = `
      <div class="workspace">
        <header class="view-heading">
          <div><h1>题目浏览</h1><p>${filtered.length} 道匹配题目</p></div>
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
              const status = attempt ? (attempt.correct ? "已答对" : "待复习") : "未作答";
              return `<li>
                <button class="question-link" type="button" data-open-question="${question.id}">
                  <span class="question-number">Q${question.id}</span>
                  <span class="question-title">${escapeHtml(excerpt(question.prompt))}</span>
                  <span class="question-status">${status}</span>
                </button>
              </li>`;
            })
            .join("")}
        </ol>
        <div class="question-actions">
          <button class="button button-secondary" type="button" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button>
          <span class="progress-caption">第 ${page} / ${totalPages} 页</span>
          <button class="button button-secondary" type="button" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>下一页</button>
        </div>
      </div>`;
  }

  function renderQuestion({
    question,
    origin,
    index = 0,
    total = questions.length,
    submitted = false,
    selected = [],
    title = "单题练习"
  }) {
    const inputType = question.multiple ? "checkbox" : "radio";
    const answerCorrect = submitted && isSameAnswer(selected, question.correctAnswer);
    app.innerHTML = `
      <div class="workspace">
        <header class="view-heading">
          <div><h1>${escapeHtml(title)}</h1><p>${question.multiple ? "多选题 · 请选择所有正确答案" : "单选题"}</p></div>
        </header>
        <div class="question-shell">
          <article class="question-card" data-testid="question-card">
            <p class="question-meta">QUESTION ${question.id} · PDF 第 ${question.sourcePage} 页</p>
            <h2 class="question-prompt">${escapeHtml(question.prompt)}</h2>
            <form id="answer-form">
              <ol class="options">
                ${question.options
                  .map((option) => {
                    const chosen = selected.includes(option.label);
                    const correct = submitted && question.correctAnswer.includes(option.label);
                    const incorrect = submitted && chosen && !correct;
                    const className = correct ? "correct" : incorrect ? "incorrect" : "";
                    return `<li class="option ${className}">
                      <label>
                        <input type="${inputType}" name="answer" value="${option.label}" ${chosen ? "checked" : ""} ${submitted ? "disabled" : ""}>
                        <span class="option-letter">${option.label}</span>
                        <span>${escapeHtml(option.text)}</span>
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
                      <p>${escapeHtml(question.explanation || "原题未提供解析。")}</p>
                    </section>`
                  : ""
              }
              <div class="question-actions">
                ${
                  submitted
                    ? `<button class="button button-primary" type="button" data-next-question>下一题</button>`
                    : `<button class="button button-primary" type="submit" data-testid="submit-answer">提交答案</button>`
                }
                <button class="button button-secondary" type="button" data-action="${origin}">退出</button>
              </div>
            </form>
          </article>
          <aside class="question-aside" aria-label="本题进度">
            <dl>
              <div><dt>位置</dt><dd>${index + 1} / ${total}</dd></div>
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
      index,
      total: questions.length,
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
      index: 0,
      total: 1,
      submitted: route.submitted,
      selected: route.selected || [],
      title: route.origin === "wrong" ? "错题回练" : "题目浏览"
    });
  }

  function renderQuizSetup() {
    app.innerHTML = `
      <div class="workspace">
        <header class="view-heading">
          <div><h1>随机测试</h1><p>从 420 道标准题中不重复抽取</p></div>
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
      index: quizSession.index,
      total: quizSession.ids.length,
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
                        <span class="question-title">${escapeHtml(excerpt(question.prompt))}</span>
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
            total: quizSession.ids.length,
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
      if (window.confirm("确定清空错题本吗？学习进度仍会保留。")) {
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
    installButton.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      installButton.hidden = true;
      return;
    }
    showToast("iPhone：请用 Safari 的“分享 → 添加到主屏幕”");
  });

  window.addEventListener("appinstalled", () => {
    installButton.hidden = true;
    showToast("安装完成");
  });

  Promise.all([
    fetch("./data/questions.json").then((response) => {
      if (!response.ok) throw new Error(`题库加载失败：${response.status}`);
      return response.json();
    }),
    "serviceWorker" in navigator
      ? navigator.serviceWorker.register("./sw.js")
      : Promise.resolve()
  ])
    .then(([data]) => {
      questions = data;
      questionMap = new Map(questions.map((question) => [question.id, question]));
      render();
    })
    .catch((error) => {
      app.innerHTML = `<section class="empty-state"><h1>题库没有载入</h1><p>${escapeHtml(error.message)}</p></section>`;
    });
})();
