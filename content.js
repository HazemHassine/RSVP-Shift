(() => {
  if (document.getElementById("rsvp-overlay")) return;

  const { DEFAULT_SETTINGS, normalizeSettings } = globalThis.FastReaderSettings;
  const START_DELAY_MS = 900;
  const SUMMARY_DURATION_MS = 5000;
  const WORD_CHARACTER = /[\p{L}\p{N}]/u;

  const state = {
    words: [],
    index: 0,
    timerId: null,
    summaryTimerId: null,
    toastTimerId: null,
    startDelayTimerId: null,
    startDelayAnimationId: null,
    isStarting: false,
    isPaused: false,
    isFinished: false,
    settings: { ...DEFAULT_SETTINGS },
    savedSelection: null,
    previousFocus: null,
    activeStartedAt: null,
    activeElapsedMs: 0,
  };

  const overlay = document.createElement("div");
  overlay.id = "rsvp-overlay";
  overlay.tabIndex = -1;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Fast Reader");
  overlay.innerHTML = `
    <div class="rsvp-topbar">
      <div id="rsvp-status" role="status" aria-live="polite">Ready</div>
      <div class="rsvp-window-actions">
        <button type="button" id="rsvp-pause" class="rsvp-action-button">Pause</button>
        <button type="button" id="rsvp-close" class="rsvp-action-button rsvp-close-button" aria-label="Close Fast Reader" title="Close (Esc)">×</button>
      </div>
    </div>

    <div class="rsvp-progress-container" role="progressbar" aria-label="Reading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="rsvp-progress-bar" id="rsvp-progress"></div>
    </div>

    <main class="rsvp-stage">
      <div id="rsvp-start-delay" aria-hidden="true"></div>

      <div id="rsvp-line">
        <div id="rsvp-word-display" aria-label="Ready">
          <span class="rsvp-left"></span>
          <span class="rsvp-pivot">READY</span>
          <span class="rsvp-right"></span>
        </div>
        <div id="rsvp-preview" aria-hidden="true"></div>
      </div>

      <div id="rsvp-summary" role="status" aria-live="polite"></div>

      <div class="rsvp-controls" aria-label="Reader settings">
        <label class="rsvp-control">
          <span>Speed</span>
          <span class="rsvp-input-with-unit">
            <input type="number" id="rsvp-wpm" value="300" min="50" max="1200" step="50" inputmode="numeric" />
            <small>WPM</small>
          </span>
        </label>

        <label class="rsvp-control">
          <span>Dim</span>
          <input type="range" id="rsvp-opacity" min="0.5" max="1" step="0.05" value="0.9" />
        </label>

        <label class="rsvp-control rsvp-color-control">
          <span>Pivot</span>
          <input type="color" id="rsvp-color" value="#ff5a67" />
        </label>

        <label class="rsvp-control">
          <span>Jump</span>
          <input type="number" id="rsvp-jump" value="10" min="1" max="100" step="1" inputmode="numeric" />
        </label>
      </div>
    </main>

    <div class="rsvp-key-hints" aria-hidden="true">
      <span><kbd>Space</kbd> pause</span>
      <span><kbd>↑</kbd><kbd>↓</kbd> speed</span>
      <span><kbd>←</kbd><kbd>→</kbd> jump</span>
      <span><kbd>Esc</kbd> close</span>
    </div>
  `;

  const toast = document.createElement("div");
  toast.id = "rsvp-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");

  document.body.append(overlay, toast);

  const progressContainer = overlay.querySelector(".rsvp-progress-container");
  const progressBar = overlay.querySelector("#rsvp-progress");
  const statusDisplay = overlay.querySelector("#rsvp-status");
  const startDelayIndicator = overlay.querySelector("#rsvp-start-delay");
  const wordDisplay = overlay.querySelector("#rsvp-word-display");
  const previewDisplay = overlay.querySelector("#rsvp-preview");
  const summaryDisplay = overlay.querySelector("#rsvp-summary");
  const leftSpan = overlay.querySelector(".rsvp-left");
  const pivotSpan = overlay.querySelector(".rsvp-pivot");
  const rightSpan = overlay.querySelector(".rsvp-right");
  const pauseButton = overlay.querySelector("#rsvp-pause");
  const closeButton = overlay.querySelector("#rsvp-close");
  const wpmInput = overlay.querySelector("#rsvp-wpm");
  const colorInput = overlay.querySelector("#rsvp-color");
  const opacityInput = overlay.querySelector("#rsvp-opacity");
  const jumpInput = overlay.querySelector("#rsvp-jump");

  function isReaderActive() {
    return overlay.classList.contains("active");
  }

  function persistSettings(patch) {
    try {
      chrome.storage.sync.set(patch);
    } catch {
      // The extension may have been reloaded while this page was open.
    }
  }

  function applySettings(settings) {
    state.settings = normalizeSettings({ ...state.settings, ...settings });
    wpmInput.value = String(state.settings.wpm);
    jumpInput.value = String(state.settings.jumpStep);
    colorInput.value = state.settings.color;
    opacityInput.value = String(state.settings.opacity);
    overlay.style.setProperty("--rsvp-pivot-color", state.settings.color);
    overlay.style.setProperty("--rsvp-dim", String(state.settings.opacity));
    updateStatus();
  }

  function loadSettings() {
    try {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
        if (!chrome.runtime.lastError) applySettings(settings);
      });
    } catch {
      applySettings(DEFAULT_SETTINGS);
    }
  }

  function showToast(message, tone = "neutral") {
    clearTimeout(state.toastTimerId);
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.classList.add("visible");
    state.toastTimerId = setTimeout(() => {
      toast.classList.remove("visible");
    }, 2600);
  }

  function getPivotIndex(length) {
    if (length <= 1) return 0;
    if (length <= 5) return 1;
    if (length <= 9) return 2;
    if (length <= 13) return 3;
    return 4;
  }

  function splitWord(word) {
    const characters = Array.from(word);
    const firstCoreIndex = characters.findIndex((character) => WORD_CHARACTER.test(character));
    let lastCoreIndex = -1;

    for (let index = characters.length - 1; index >= 0; index -= 1) {
      if (WORD_CHARACTER.test(characters[index])) {
        lastCoreIndex = index;
        break;
      }
    }

    if (firstCoreIndex === -1 || lastCoreIndex === -1) {
      return {
        left: "",
        pivot: characters[0] || "",
        right: characters.slice(1).join(""),
      };
    }

    const prefix = characters.slice(0, firstCoreIndex);
    const core = characters.slice(firstCoreIndex, lastCoreIndex + 1);
    const suffix = characters.slice(lastCoreIndex + 1);
    const pivotIndex = Math.min(getPivotIndex(core.length), core.length - 1);

    return {
      left: [...prefix, ...core.slice(0, pivotIndex)].join(""),
      pivot: core[pivotIndex],
      right: [...core.slice(pivotIndex + 1), ...suffix].join(""),
    };
  }

  function renderWord(word) {
    if (!word) return;
    const parts = splitWord(word.text);
    leftSpan.textContent = parts.left;
    pivotSpan.textContent = parts.pivot;
    rightSpan.textContent = parts.right;
    wordDisplay.setAttribute("aria-label", word.text);
  }

  function updatePreview() {
    const preview = state.words
      .slice(state.index + 1, state.index + 4)
      .map((word) => word.text)
      .join(" ");
    previewDisplay.textContent = preview;
  }

  function updateProgress() {
    const total = state.words.length;
    const completed = total ? Math.min(state.index + 1, total) : 0;
    const percentage = total ? (completed / total) * 100 : 0;
    progressBar.style.width = `${percentage}%`;
    progressContainer.setAttribute("aria-valuenow", String(Math.round(percentage)));
  }

  function updateStatus() {
    if (!isReaderActive()) return;

    if (state.isFinished) {
      statusDisplay.textContent = "Finished";
      return;
    }

    const total = state.words.length;
    const position = total ? Math.min(state.index + 1, total) : 0;
    const prefix = state.isPaused ? "Paused · " : "";
    statusDisplay.textContent = `${prefix}${position} / ${total} · ${state.settings.wpm} WPM`;
  }

  function renderCurrentWord() {
    if (!state.words.length) return;
    state.index = Math.min(Math.max(state.index, 0), state.words.length - 1);
    renderWord(state.words[state.index]);
    updatePreview();
    updateProgress();
    updateStatus();
  }

  function renderReadyState() {
    leftSpan.textContent = "";
    pivotSpan.textContent = "READY";
    rightSpan.textContent = "";
    wordDisplay.setAttribute("aria-label", "Ready");
    previewDisplay.textContent = "";
    summaryDisplay.textContent = "";
    summaryDisplay.classList.remove("visible");
    progressBar.style.width = "0%";
    progressContainer.setAttribute("aria-valuenow", "0");
    statusDisplay.textContent = `${state.words.length} words · ${state.settings.wpm} WPM`;
  }

  function normalizeText(text) {
    return text
      .replace(/\u00ad/gu, "")
      .replace(/[‐‑‒–—―]/gu, " - ")
      .replace(/[^\S\r\n]+/gu, " ")
      .trim();
  }

  function tokenizeText(text) {
    const words = [];
    const matches = [...text.matchAll(/\S+/gu)];

    matches.forEach((match, index) => {
      if (index > 0) {
        const previous = matches[index - 1];
        const gapStart = previous.index + previous[0].length;
        const gap = text.slice(gapStart, match.index);
        if (/\n\s*\n/u.test(gap)) words[index - 1].endsParagraph = true;
      }
      words.push({ text: match[0], endsParagraph: false });
    });

    return words;
  }

  function isTextControl(element) {
    if (element instanceof HTMLTextAreaElement) return true;
    if (!(element instanceof HTMLInputElement)) return false;
    return ["text", "search", "url", "email", "tel"].includes(element.type);
  }

  function captureSelection() {
    const focusedElement = document.activeElement;

    if (isTextControl(focusedElement)) {
      const start = focusedElement.selectionStart;
      const end = focusedElement.selectionEnd;
      if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
        state.savedSelection = {
          kind: "control",
          element: focusedElement,
          start,
          end,
        };
        return focusedElement.value.slice(start, end);
      }
    }

    const selection = window.getSelection();
    const selectedText = selection?.toString() || "";
    if (selectedText.trim() && selection.rangeCount > 0) {
      state.savedSelection = {
        kind: "range",
        range: selection.getRangeAt(0).cloneRange(),
      };
    }
    return selectedText;
  }

  function restoreSelection() {
    const savedSelection = state.savedSelection;
    if (!savedSelection) return;

    try {
      if (savedSelection.kind === "control" && savedSelection.element.isConnected) {
        savedSelection.element.focus({ preventScroll: true });
        savedSelection.element.setSelectionRange(savedSelection.start, savedSelection.end);
      } else if (savedSelection.kind === "range") {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(savedSelection.range);
      }
    } catch {
      // The source page may have changed while the reader was open.
    }
  }

  function getWordDelayMs(word) {
    const baseDelay = 60000 / state.settings.wpm;
    const coreLength = Array.from(word.text).filter((character) => WORD_CHARACTER.test(character)).length;
    let multiplier = coreLength > 12 ? 1.3 : coreLength > 8 ? 1.15 : 1;
    const punctuationTarget = word.text.replace(/[\p{Pe}\p{Pf}"'’”»]+$/gu, "");

    if (/[.!?…]$/u.test(punctuationTarget)) multiplier = Math.max(multiplier, 2.4);
    else if (/[,;:]$/u.test(punctuationTarget)) multiplier = Math.max(multiplier, 1.7);
    else if (/[-‐‑‒–—―]$/u.test(punctuationTarget)) multiplier = Math.max(multiplier, 1.4);
    if (word.endsParagraph) multiplier = Math.max(multiplier, 3);

    return baseDelay * multiplier;
  }

  function clearReadingTimer() {
    clearTimeout(state.timerId);
    state.timerId = null;
  }

  function recordActiveTime() {
    if (state.activeStartedAt !== null) {
      state.activeElapsedMs += performance.now() - state.activeStartedAt;
      state.activeStartedAt = null;
    }
  }

  function formatDuration(milliseconds) {
    const totalSeconds = Math.max(1, Math.round(milliseconds / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  function finishReading() {
    clearReadingTimer();
    recordActiveTime();
    state.isFinished = true;
    state.index = state.words.length;
    overlay.classList.remove("paused");
    overlay.classList.add("finished");
    pauseButton.disabled = true;
    previewDisplay.textContent = "";
    leftSpan.textContent = "";
    pivotSpan.textContent = "DONE";
    rightSpan.textContent = "";
    progressBar.style.width = "100%";
    progressContainer.setAttribute("aria-valuenow", "100");

    const actualWpm = Math.round((state.words.length / Math.max(state.activeElapsedMs, 1)) * 60000);
    summaryDisplay.textContent = `${state.words.length} words in ${formatDuration(state.activeElapsedMs)} · about ${actualWpm} WPM`;
    summaryDisplay.classList.add("visible");
    updateStatus();

    clearTimeout(state.summaryTimerId);
    state.summaryTimerId = setTimeout(stopReading, SUMMARY_DURATION_MS);
  }

  function scheduleCurrentWord() {
    clearReadingTimer();
    if (state.isStarting || state.isPaused || state.isFinished || !isReaderActive()) return;
    if (state.index >= state.words.length) {
      finishReading();
      return;
    }

    renderCurrentWord();
    state.timerId = setTimeout(() => {
      state.index += 1;
      scheduleCurrentWord();
    }, getWordDelayMs(state.words[state.index]));
  }

  function cancelStartDelay() {
    clearTimeout(state.startDelayTimerId);
    cancelAnimationFrame(state.startDelayAnimationId);
    state.startDelayTimerId = null;
    state.startDelayAnimationId = null;
    state.isStarting = false;
    startDelayIndicator.classList.remove("active");
    startDelayIndicator.style.removeProperty("--rsvp-start-progress");
  }

  function beginStartDelay() {
    state.isStarting = true;
    pauseButton.disabled = true;
    startDelayIndicator.classList.add("active");
    renderReadyState();
    const startedAt = performance.now();

    const updateDelayProgress = (now) => {
      const progress = Math.min((now - startedAt) / START_DELAY_MS, 1);
      startDelayIndicator.style.setProperty("--rsvp-start-progress", `${progress * 360}deg`);
      if (progress < 1) {
        state.startDelayAnimationId = requestAnimationFrame(updateDelayProgress);
      }
    };

    state.startDelayAnimationId = requestAnimationFrame(updateDelayProgress);
    state.startDelayTimerId = setTimeout(() => {
      cancelStartDelay();
      pauseButton.disabled = false;
      state.activeStartedAt = performance.now();
      scheduleCurrentWord();
    }, START_DELAY_MS);
  }

  function startReading() {
    const selectedText = normalizeText(captureSelection());
    const words = tokenizeText(selectedText);

    if (!words.length) {
      showToast("Select some text first", "error");
      return { ok: false, active: false, error: "Select some text on the page first." };
    }

    clearTimeout(state.summaryTimerId);
    state.previousFocus = document.activeElement;
    state.words = words;
    state.index = 0;
    state.isPaused = false;
    state.isFinished = false;
    state.activeStartedAt = null;
    state.activeElapsedMs = 0;
    overlay.classList.remove("paused", "finished");
    overlay.classList.add("active");
    pauseButton.textContent = "Pause";
    pauseButton.setAttribute("aria-pressed", "false");
    pauseButton.disabled = false;
    overlay.focus({ preventScroll: true });
    beginStartDelay();
    return { ok: true, active: true };
  }

  function stopReading() {
    if (!isReaderActive()) return { ok: true, active: false };
    clearReadingTimer();
    clearTimeout(state.summaryTimerId);
    cancelStartDelay();
    recordActiveTime();
    overlay.classList.remove("active", "paused", "finished");
    summaryDisplay.classList.remove("visible");
    pauseButton.disabled = false;
    state.isPaused = false;
    state.isFinished = false;
    restoreSelection();

    if (state.previousFocus?.isConnected && state.savedSelection?.kind !== "control") {
      try {
        state.previousFocus.focus({ preventScroll: true });
      } catch {
        // Some page elements cannot be programmatically focused.
      }
    }

    return { ok: true, active: false };
  }

  function setPaused(shouldPause, message = "") {
    if (!isReaderActive() || state.isStarting || state.isFinished || state.isPaused === shouldPause) return;

    if (shouldPause) {
      clearReadingTimer();
      recordActiveTime();
      state.isPaused = true;
      overlay.classList.add("paused");
      pauseButton.textContent = "Resume";
      pauseButton.setAttribute("aria-pressed", "true");
      renderCurrentWord();
    } else {
      state.isPaused = false;
      overlay.classList.remove("paused");
      pauseButton.textContent = "Pause";
      pauseButton.setAttribute("aria-pressed", "false");
      state.activeStartedAt = performance.now();
      scheduleCurrentWord();
    }

    updateStatus();
    if (message) showToast(message);
  }

  function toggleReading() {
    return isReaderActive() ? stopReading() : startReading();
  }

  function jumpBy(amount) {
    if (!state.words.length || state.isFinished) return;
    const previousIndex = state.index;
    state.index = Math.min(state.words.length - 1, Math.max(0, state.index + amount));
    const actualJump = state.index - previousIndex;
    renderCurrentWord();
    if (!state.isPaused) scheduleCurrentWord();
    if (actualJump) showJumpDelta(actualJump);
  }

  function showJumpDelta(amount) {
    const indicator = document.createElement("div");
    indicator.className = `rsvp-jump-indicator${amount < 0 ? " backward" : ""}`;
    indicator.textContent = `${amount > 0 ? "+" : ""}${amount}`;
    overlay.appendChild(indicator);
    setTimeout(() => indicator.remove(), 750);
  }

  function changeSpeed(delta) {
    applySettings({ wpm: state.settings.wpm + delta });
    persistSettings({ wpm: state.settings.wpm });
    if (!state.isPaused) scheduleCurrentWord();
  }

  function isFormControl(element) {
    return element instanceof Element && Boolean(element.closest("input, button, select, textarea"));
  }

  function trapFocus(event) {
    const focusable = [...overlay.querySelectorAll("button:not([disabled]), input:not([disabled])")]
      .filter((element) => {
        const styles = getComputedStyle(element);
        return element.offsetParent !== null && styles.visibility !== "hidden" && styles.display !== "none";
      });
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!overlay.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (!isReaderActive()) return;
      if (event.code === "Tab") {
        trapFocus(event);
        return;
      }
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        stopReading();
        return;
      }
      if (state.isStarting || isFormControl(event.target)) return;

      const handledCodes = ["Space", "ArrowUp", "ArrowDown", "ArrowRight", "ArrowLeft"];
      if (!handledCodes.includes(event.code)) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.code === "Space") setPaused(!state.isPaused);
      if (event.code === "ArrowUp") changeSpeed(50);
      if (event.code === "ArrowDown") changeSpeed(-50);
      if (event.code === "ArrowRight") jumpBy(state.settings.jumpStep);
      if (event.code === "ArrowLeft") jumpBy(-state.settings.jumpStep);
    },
    true,
  );

  pauseButton.addEventListener("click", () => setPaused(!state.isPaused));
  closeButton.addEventListener("click", stopReading);

  wpmInput.addEventListener("change", (event) => {
    applySettings({ wpm: event.target.value });
    persistSettings({ wpm: state.settings.wpm });
  });

  colorInput.addEventListener("input", (event) => {
    applySettings({ color: event.target.value });
  });
  colorInput.addEventListener("change", () => persistSettings({ color: state.settings.color }));

  opacityInput.addEventListener("input", (event) => {
    applySettings({ opacity: event.target.value });
  });
  opacityInput.addEventListener("change", () => persistSettings({ opacity: state.settings.opacity }));

  jumpInput.addEventListener("change", (event) => {
    applySettings({ jumpStep: event.target.value });
    persistSettings({ jumpStep: state.settings.jumpStep });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && isReaderActive() && !state.isPaused && !state.isStarting && !state.isFinished) {
      setPaused(true, "Paused while this tab was inactive");
    }
  });

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync") return;
      const patch = {};
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (changes[key]) patch[key] = changes[key].newValue;
      }
      if (Object.keys(patch).length) applySettings(patch);
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.action === "toggle") sendResponse(toggleReading());
      if (message.action === "get-state") {
        sendResponse({ ok: true, active: isReaderActive(), paused: state.isPaused });
      }
      if (message.action === "update-settings" && message.settings) {
        applySettings(message.settings);
        sendResponse({ ok: true, active: isReaderActive() });
      }
    });
  } catch {
    // Existing tabs can temporarily retain an invalidated extension context after reload.
  }

  loadSettings();
})();
