(() => {
  if (document.getElementById("rsvp-overlay")) return;

  const { DEFAULT_SETTINGS, normalizeSettings } = globalThis.FastReaderSettings;
  const SUMMARY_DURATION_MS = 5000;
  const CONTROLS_HIDE_DELAY_MS = 1800;
  const FEEDBACK_DURATION_MS = 850;
  const WORD_CHARACTER = /[\p{L}\p{N}]/u;

  const state = {
    words: [],
    sentences: [],
    paragraphs: [],
    durationSuffix: [],
    index: 0,
    timerId: null,
    summaryTimerId: null,
    toastTimerId: null,
    feedbackTimerId: null,
    controlsTimerId: null,
    startDelayTimerId: null,
    startDelayAnimationId: null,
    isStarting: false,
    isPaused: false,
    isFinished: false,
    isScrubbing: false,
    resumeAfterScrub: false,
    helpVisible: false,
    settings: { ...DEFAULT_SETTINGS },
    savedSelection: null,
    savedScroll: null,
    previousFocus: null,
    activeStartedAt: null,
    activeElapsedMs: 0,
  };

  const overlay = document.createElement("div");
  overlay.id = "rsvp-overlay";
  overlay.tabIndex = -1;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "RSVP Shift");
  overlay.innerHTML = `
    <div class="rsvp-topbar rsvp-reader-chrome">
      <div id="rsvp-status" role="status" aria-live="polite">Ready</div>
      <div class="rsvp-window-actions">
        <button type="button" id="rsvp-top-pause" class="rsvp-action-button">Pause</button>
        <button type="button" id="rsvp-close" class="rsvp-action-button rsvp-close-button" aria-label="Close RSVP Shift" title="Close (Esc)">×</button>
      </div>
    </div>

    <div class="rsvp-progress-shell rsvp-reader-chrome">
      <div class="rsvp-progress-container">
        <div class="rsvp-progress-bar" id="rsvp-progress"></div>
        <input id="rsvp-scrubber" type="range" min="0" max="1" step="1" value="0" aria-label="Reading position" />
      </div>
      <div class="rsvp-progress-meta">
        <span id="rsvp-position">0 / 0</span>
        <span id="rsvp-remaining">~0:00 remaining</span>
      </div>
    </div>

    <main class="rsvp-stage">
      <div id="rsvp-start-delay" aria-hidden="true"></div>
      <div id="rsvp-paused-label">Paused</div>

      <div id="rsvp-line">
        <div id="rsvp-context-previous" class="rsvp-context" aria-hidden="true"></div>
        <div id="rsvp-word-display" aria-label="Ready">
          <span class="rsvp-left"></span>
          <span class="rsvp-pivot">READY</span>
          <span class="rsvp-right"></span>
        </div>
        <div id="rsvp-context-next" class="rsvp-context" aria-hidden="true"></div>
      </div>

      <div id="rsvp-feedback" role="status" aria-live="polite"></div>
      <div id="rsvp-summary" role="status" aria-live="polite"></div>

      <div class="rsvp-controls rsvp-reader-chrome" aria-label="Reader controls">
        <button type="button" id="rsvp-back" class="rsvp-control-button" title="Jump backward (Left arrow)">← 10</button>
        <button type="button" id="rsvp-control-pause" class="rsvp-control-button rsvp-resume-button">Pause</button>
        <button type="button" id="rsvp-forward" class="rsvp-control-button" title="Jump forward (Right arrow)">10 →</button>
        <span class="rsvp-control-divider" aria-hidden="true"></span>
        <label class="rsvp-control">
          <span>Speed</span>
          <span class="rsvp-input-with-unit">
            <input type="number" id="rsvp-wpm" value="300" min="50" max="1200" step="25" inputmode="numeric" />
            <small>WPM</small>
          </span>
        </label>
        <label class="rsvp-control">
          <span>Size</span>
          <span class="rsvp-input-with-unit">
            <input type="number" id="rsvp-font-size" value="68" min="32" max="120" step="2" inputmode="numeric" />
            <small>PX</small>
          </span>
        </label>
      </div>

      <div id="rsvp-help" class="rsvp-help" aria-hidden="true">
        <span><kbd>Space</kbd> pause</span>
        <span><kbd>↑</kbd><kbd>↓</kbd> speed</span>
        <span><kbd>←</kbd><kbd>→</kbd> words</span>
        <span><kbd>Shift</kbd> + <kbd>←</kbd>/<kbd>→</kbd> sentence</span>
        <span><kbd>Home</kbd> restart</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </main>
  `;

  const toast = document.createElement("div");
  toast.id = "rsvp-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  document.body.append(overlay, toast);

  const progressBar = overlay.querySelector("#rsvp-progress");
  const scrubber = overlay.querySelector("#rsvp-scrubber");
  const positionDisplay = overlay.querySelector("#rsvp-position");
  const remainingDisplay = overlay.querySelector("#rsvp-remaining");
  const statusDisplay = overlay.querySelector("#rsvp-status");
  const startDelayIndicator = overlay.querySelector("#rsvp-start-delay");
  const wordDisplay = overlay.querySelector("#rsvp-word-display");
  const previousContext = overlay.querySelector("#rsvp-context-previous");
  const nextContext = overlay.querySelector("#rsvp-context-next");
  const feedbackDisplay = overlay.querySelector("#rsvp-feedback");
  const summaryDisplay = overlay.querySelector("#rsvp-summary");
  const leftSpan = overlay.querySelector(".rsvp-left");
  const pivotSpan = overlay.querySelector(".rsvp-pivot");
  const rightSpan = overlay.querySelector(".rsvp-right");
  const topPauseButton = overlay.querySelector("#rsvp-top-pause");
  const controlPauseButton = overlay.querySelector("#rsvp-control-pause");
  const closeButton = overlay.querySelector("#rsvp-close");
  const backButton = overlay.querySelector("#rsvp-back");
  const forwardButton = overlay.querySelector("#rsvp-forward");
  const wpmInput = overlay.querySelector("#rsvp-wpm");
  const fontSizeInput = overlay.querySelector("#rsvp-font-size");
  const helpDisplay = overlay.querySelector("#rsvp-help");

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
    const previousSettings = state.settings;
    state.settings = normalizeSettings({ ...state.settings, ...settings });
    wpmInput.value = String(state.settings.wpm);
    fontSizeInput.value = String(state.settings.fontSize);
    backButton.textContent = `← ${state.settings.jumpStep}`;
    forwardButton.textContent = `${state.settings.jumpStep} →`;
    overlay.style.setProperty("--rsvp-pivot-color", state.settings.color);
    overlay.style.setProperty("--rsvp-dim", String(state.settings.opacity));
    overlay.style.setProperty("--rsvp-font-size", `${state.settings.fontSize}px`);
    overlay.dataset.context = state.settings.contextPreview;
    overlay.dataset.focusStyle = state.settings.focusStyle;
    overlay.dataset.guides = state.settings.fixationGuides;
    overlay.dataset.backgroundMode = state.settings.backgroundMode;
    rebuildTimingPlan();
    if (state.words.length) renderCurrentWord();
    const timingChanged = previousSettings.wpm !== state.settings.wpm
      || previousSettings.smartTiming !== state.settings.smartTiming
      || previousSettings.punctuationPauses !== state.settings.punctuationPauses;
    if (timingChanged && isReaderActive() && !state.isPaused && !state.isStarting && !state.isFinished) {
      scheduleCurrentWord();
    }
    if (isReaderActive()) showReaderChrome();
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
    state.toastTimerId = setTimeout(() => toast.classList.remove("visible"), 2800);
  }

  function showFeedback(message) {
    clearTimeout(state.feedbackTimerId);
    feedbackDisplay.textContent = message;
    feedbackDisplay.classList.add("visible");
    state.feedbackTimerId = setTimeout(() => {
      feedbackDisplay.classList.remove("visible");
    }, FEEDBACK_DURATION_MS);
  }

  function scheduleChromeHide() {
    clearTimeout(state.controlsTimerId);
    if (!state.settings.autoHideControls || state.isPaused || state.isStarting || state.helpVisible) return;
    state.controlsTimerId = setTimeout(() => {
      if (isFormControl(document.activeElement) && overlay.contains(document.activeElement)) return;
      overlay.classList.remove("chrome-visible");
    }, CONTROLS_HIDE_DELAY_MS);
  }

  function showReaderChrome() {
    if (!isReaderActive()) return;
    overlay.classList.add("chrome-visible");
    scheduleChromeHide();
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
      return { left: "", pivot: characters[0] || "", right: characters.slice(1).join("") };
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

  function renderContext() {
    previousContext.textContent = state.index > 0 ? state.words[state.index - 1].text : "";
    nextContext.textContent = state.index < state.words.length - 1 ? state.words[state.index + 1].text : "";
  }

  function normalizeText(text) {
    return text
      .replace(/\u00ad/gu, "")
      .replace(/[‐‑‒–—―]/gu, " - ")
      .replace(/[^\S\r\n]+/gu, " ")
      .replace(/\r\n?/gu, "\n")
      .trim();
  }

  function segmentSentences(paragraph) {
    if (globalThis.Intl?.Segmenter) {
      const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
      return [...segmenter.segment(paragraph)].map((part) => part.segment.trim()).filter(Boolean);
    }
    return paragraph.match(/[^.!?…]+(?:[.!?…]+["'’”»)\]]*|$)/gu)?.map((part) => part.trim()).filter(Boolean)
      || [paragraph];
  }

  function parseDocument(text) {
    const words = [];
    const sentences = [];
    const paragraphs = [];
    const paragraphTexts = text.split(/\n+/gu).map((paragraph) => paragraph.trim()).filter(Boolean);

    paragraphTexts.forEach((paragraphText, paragraphIndex) => {
      const paragraphStart = words.length;
      for (const sentenceText of segmentSentences(paragraphText)) {
        const sentenceIndex = sentences.length;
        const sentenceStart = words.length;
        for (const match of sentenceText.matchAll(/\S+/gu)) {
          words.push({
            text: match[0],
            sentenceIndex,
            paragraphIndex,
            endsSentence: false,
            endsParagraph: false,
          });
        }
        if (words.length > sentenceStart) {
          words[words.length - 1].endsSentence = true;
          sentences.push({ start: sentenceStart, end: words.length - 1, paragraphIndex });
        }
      }
      if (words.length > paragraphStart) {
        words[words.length - 1].endsParagraph = true;
        paragraphs.push({ start: paragraphStart, end: words.length - 1 });
      }
    });

    return { words, sentences, paragraphs };
  }

  function looksLikeCode(text) {
    const signals = [
      /(?:^|\s)(?:const|let|var|function|class|import|export|return|await)\s/u,
      /[{};]\s*(?:\n|$)/u,
      /=>|===|!==|<\/?[a-z][^>]*>/iu,
      /^\s{2,}\S/mu,
    ];
    return signals.filter((pattern) => pattern.test(text)).length >= 2;
  }

  function isTextControl(element) {
    if (element instanceof HTMLTextAreaElement) return true;
    if (!(element instanceof HTMLInputElement)) return false;
    return ["text", "search", "url", "email", "tel"].includes(element.type);
  }

  function captureSelection() {
    const focusedElement = document.activeElement;
    state.savedSelection = null;

    if (isTextControl(focusedElement)) {
      const start = focusedElement.selectionStart;
      const end = focusedElement.selectionEnd;
      if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
        state.savedSelection = { kind: "control", element: focusedElement, start, end };
        return focusedElement.value.slice(start, end);
      }
    }

    const selection = window.getSelection();
    const selectedText = selection?.toString() || "";
    if (selectedText.trim() && selection.rangeCount > 0) {
      state.savedSelection = { kind: "range", range: selection.getRangeAt(0).cloneRange() };
    }
    return selectedText;
  }

  function restorePageContext() {
    const savedSelection = state.savedSelection;
    try {
      if (savedSelection?.kind === "control" && savedSelection.element.isConnected) {
        savedSelection.element.focus({ preventScroll: true });
        savedSelection.element.setSelectionRange(savedSelection.start, savedSelection.end);
      } else if (savedSelection?.kind === "range") {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(savedSelection.range);
      }
    } catch {
      // The source page may have changed while the reader was open.
    }

    if (state.savedScroll) window.scrollTo(state.savedScroll.x, state.savedScroll.y);
  }

  function getPunctuationFactors() {
    return {
      off: { comma: 1, semicolon: 1, sentence: 1, paragraph: 1 },
      light: { comma: 1.2, semicolon: 1.3, sentence: 1.5, paragraph: 2 },
      normal: { comma: 1.35, semicolon: 1.45, sentence: 1.75, paragraph: 2.25 },
      strong: { comma: 1.5, semicolon: 1.65, sentence: 2.1, paragraph: 2.75 },
    }[state.settings.punctuationPauses];
  }

  function getWordDelayMs(word) {
    const baseDelay = 60000 / state.settings.wpm;
    const coreLength = Array.from(word.text).filter((character) => WORD_CHARACTER.test(character)).length;
    let multiplier = 1;

    if (state.settings.smartTiming) {
      if (coreLength > 12) multiplier = 1.25;
      else if (coreLength > 8) multiplier = 1.12;
    }

    const factors = getPunctuationFactors();
    const punctuationTarget = word.text.replace(/[\p{Pe}\p{Pf}"'’”»]+$/gu, "");
    if (/[,，]$/u.test(punctuationTarget)) multiplier = Math.max(multiplier, factors.comma);
    if (/[;:；：]$/u.test(punctuationTarget)) multiplier = Math.max(multiplier, factors.semicolon);
    if (word.endsSentence || /[.!?…]$/u.test(punctuationTarget)) {
      multiplier = Math.max(multiplier, factors.sentence);
    }
    if (word.endsParagraph) multiplier = Math.max(multiplier, factors.paragraph);
    return baseDelay * multiplier;
  }

  function rebuildTimingPlan() {
    state.durationSuffix = new Array(state.words.length + 1).fill(0);
    for (let index = state.words.length - 1; index >= 0; index -= 1) {
      state.durationSuffix[index] = state.durationSuffix[index + 1] + getWordDelayMs(state.words[index]);
    }
  }

  function formatRemaining(milliseconds) {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function updateProgress() {
    const total = state.words.length;
    const boundedIndex = total ? Math.min(state.index, total - 1) : 0;
    const percentage = total > 1 ? (boundedIndex / (total - 1)) * 100 : total ? 100 : 0;
    progressBar.style.width = `${percentage}%`;
    scrubber.max = String(Math.max(total - 1, 1));
    if (!state.isScrubbing) scrubber.value = String(boundedIndex);
    scrubber.setAttribute("aria-valuetext", `Word ${boundedIndex + 1} of ${total}`);
    positionDisplay.textContent = `${boundedIndex + 1} / ${total} · ${Math.round(percentage)}%`;
    remainingDisplay.textContent = `~${formatRemaining(state.durationSuffix[boundedIndex] || 0)} remaining`;
  }

  function updateStatus() {
    if (!isReaderActive()) return;
    if (state.isFinished) statusDisplay.textContent = "Finished";
    else if (state.isStarting) statusDisplay.textContent = `${state.words.length} words · ~${formatRemaining(state.durationSuffix[0] || 0)}`;
    else statusDisplay.textContent = `${state.isPaused ? "Paused · " : ""}${state.settings.wpm} WPM`;
  }

  function renderCurrentWord() {
    if (!state.words.length) return;
    state.index = Math.min(Math.max(state.index, 0), state.words.length - 1);
    renderWord(state.words[state.index]);
    renderContext();
    updateProgress();
    updateStatus();
  }

  function renderReadyState() {
    leftSpan.textContent = "";
    pivotSpan.textContent = "READY";
    rightSpan.textContent = "";
    wordDisplay.setAttribute("aria-label", "Ready");
    previousContext.textContent = "";
    nextContext.textContent = "";
    summaryDisplay.textContent = "";
    summaryDisplay.classList.remove("visible");
    progressBar.style.width = "0%";
    scrubber.value = "0";
    positionDisplay.textContent = `0 / ${state.words.length}`;
    remainingDisplay.textContent = `~${formatRemaining(state.durationSuffix[0] || 0)} total`;
    updateStatus();
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

  function updatePauseControls() {
    const label = state.isPaused ? "Resume" : "Pause";
    for (const button of [topPauseButton, controlPauseButton]) {
      button.textContent = label;
      button.setAttribute("aria-pressed", String(state.isPaused));
    }
  }

  function finishReading() {
    clearReadingTimer();
    recordActiveTime();
    state.isFinished = true;
    state.index = state.words.length;
    overlay.classList.remove("paused");
    overlay.classList.add("finished", "chrome-visible");
    topPauseButton.disabled = true;
    controlPauseButton.disabled = true;
    previousContext.textContent = "";
    nextContext.textContent = "";
    leftSpan.textContent = "";
    pivotSpan.textContent = "DONE";
    rightSpan.textContent = "";
    progressBar.style.width = "100%";
    scrubber.value = scrubber.max;

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
    startDelayIndicator.textContent = "";
    startDelayIndicator.style.removeProperty("--rsvp-start-progress");
  }

  function beginPlayback() {
    cancelStartDelay();
    state.activeStartedAt = performance.now();
    scheduleCurrentWord();
    scheduleChromeHide();
  }

  function beginStartDelay() {
    const delayMs = state.settings.startDelay * 1000;
    if (!delayMs) {
      beginPlayback();
      return;
    }

    state.isStarting = true;
    startDelayIndicator.classList.add("active");
    renderReadyState();
    const startedAt = performance.now();

    const updateDelayProgress = (now) => {
      const elapsed = now - startedAt;
      const progress = Math.min(elapsed / delayMs, 1);
      const secondsLeft = Math.max(1, Math.ceil((delayMs - elapsed) / 1000));
      startDelayIndicator.textContent = String(secondsLeft);
      startDelayIndicator.style.setProperty("--rsvp-start-progress", `${progress * 360}deg`);
      if (progress < 1) state.startDelayAnimationId = requestAnimationFrame(updateDelayProgress);
    };

    state.startDelayAnimationId = requestAnimationFrame(updateDelayProgress);
    state.startDelayTimerId = setTimeout(beginPlayback, delayMs);
  }

  function startReading() {
    state.previousFocus = document.activeElement;
    state.savedScroll = { x: window.scrollX, y: window.scrollY };
    const selectedText = normalizeText(captureSelection());
    const documentModel = parseDocument(selectedText);

    if (!documentModel.words.length) {
      showToast("Select some text first", "error");
      return { ok: false, active: false, error: "Select some text on the page first." };
    }

    clearTimeout(state.summaryTimerId);
    Object.assign(state, documentModel);
    state.index = 0;
    state.isPaused = false;
    state.isFinished = false;
    state.helpVisible = false;
    state.activeStartedAt = null;
    state.activeElapsedMs = 0;
    rebuildTimingPlan();
    overlay.classList.remove("paused", "finished", "help-visible");
    overlay.classList.add("active", "chrome-visible");
    helpDisplay.setAttribute("aria-hidden", "true");
    topPauseButton.disabled = false;
    controlPauseButton.disabled = false;
    updatePauseControls();
    renderReadyState();
    overlay.focus({ preventScroll: true });
    beginStartDelay();
    if (looksLikeCode(selectedText)) showToast("This looks like source code — RSVP works best with prose");
    return { ok: true, active: true };
  }

  function stopReading() {
    if (!isReaderActive()) return { ok: true, active: false };
    clearReadingTimer();
    clearTimeout(state.summaryTimerId);
    clearTimeout(state.controlsTimerId);
    cancelStartDelay();
    recordActiveTime();
    overlay.classList.remove("active", "paused", "finished", "chrome-visible", "help-visible");
    summaryDisplay.classList.remove("visible");
    feedbackDisplay.classList.remove("visible");
    state.isPaused = false;
    state.isFinished = false;
    state.helpVisible = false;
    helpDisplay.setAttribute("aria-hidden", "true");
    restorePageContext();

    if (state.previousFocus?.isConnected && state.savedSelection?.kind !== "control") {
      try {
        state.previousFocus.focus({ preventScroll: true });
      } catch {
        // Some page elements cannot be programmatically focused.
      }
    }
    if (state.savedScroll) window.scrollTo(state.savedScroll.x, state.savedScroll.y);
    return { ok: true, active: false };
  }

  function setPaused(shouldPause, options = {}) {
    if (!isReaderActive() || state.isFinished || state.isPaused === shouldPause) return;

    if (shouldPause) {
      clearReadingTimer();
      if (state.isStarting) {
        cancelStartDelay();
        renderCurrentWord();
      }
      recordActiveTime();
      state.isPaused = true;
      overlay.classList.add("paused", "chrome-visible");
      clearTimeout(state.controlsTimerId);
    } else {
      state.isPaused = false;
      overlay.classList.remove("paused");
      state.activeStartedAt = performance.now();
      scheduleCurrentWord();
      scheduleChromeHide();
    }

    updatePauseControls();
    updateStatus();
    if (options.feedback) showFeedback(options.feedback);
  }

  function toggleReading() {
    return isReaderActive() ? stopReading() : startReading();
  }

  function prepareNavigation() {
    if (state.isFinished) {
      clearTimeout(state.summaryTimerId);
      state.isFinished = false;
      overlay.classList.remove("finished");
      summaryDisplay.classList.remove("visible");
      topPauseButton.disabled = false;
      controlPauseButton.disabled = false;
    }
  }

  function navigateTo(index, feedback) {
    if (!state.words.length) return;
    prepareNavigation();
    state.index = Math.min(state.words.length - 1, Math.max(0, index));
    renderCurrentWord();
    if (!state.isPaused) scheduleCurrentWord();
    showFeedback(feedback);
  }

  function jumpBy(amount) {
    const target = Math.min(state.words.length - 1, Math.max(0, state.index + amount));
    const actualJump = target - state.index;
    if (actualJump) navigateTo(target, `${actualJump > 0 ? "+" : ""}${actualJump} words`);
  }

  function jumpSentence(direction) {
    if (!state.words.length) return;
    const currentWord = state.words[Math.min(state.index, state.words.length - 1)];
    const targetSentenceIndex = Math.min(
      state.sentences.length - 1,
      Math.max(0, currentWord.sentenceIndex + direction),
    );
    const targetSentence = state.sentences[targetSentenceIndex];
    if (targetSentence) navigateTo(targetSentence.start, direction < 0 ? "Previous sentence" : "Next sentence");
  }

  function restartSelection() {
    prepareNavigation();
    state.activeElapsedMs = 0;
    state.activeStartedAt = state.isPaused ? null : performance.now();
    navigateTo(0, "Restarted selection");
  }

  function changeSpeed(delta) {
    applySettings({ wpm: state.settings.wpm + delta });
    persistSettings({ wpm: state.settings.wpm });
    showFeedback(`${state.settings.wpm} WPM`);
  }

  function toggleHelp() {
    state.helpVisible = !state.helpVisible;
    overlay.classList.toggle("help-visible", state.helpVisible);
    helpDisplay.setAttribute("aria-hidden", String(!state.helpVisible));
    if (state.helpVisible) showReaderChrome();
    else scheduleChromeHide();
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
      if (isFormControl(event.target)) return;

      const isHelpKey = event.key === "?" || (event.code === "Slash" && event.shiftKey);
      const handled = ["Space", "ArrowUp", "ArrowDown", "ArrowRight", "ArrowLeft", "Home"].includes(event.code)
        || isHelpKey;
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.code === "Space") setPaused(!state.isPaused);
      if (event.code === "ArrowUp") changeSpeed(25);
      if (event.code === "ArrowDown") changeSpeed(-25);
      if (event.code === "ArrowRight" && event.shiftKey) jumpSentence(1);
      else if (event.code === "ArrowRight") jumpBy(state.settings.jumpStep);
      if (event.code === "ArrowLeft" && event.shiftKey) jumpSentence(-1);
      else if (event.code === "ArrowLeft") jumpBy(-state.settings.jumpStep);
      if (event.code === "Home") restartSelection();
      if (isHelpKey) toggleHelp();
    },
    true,
  );

  overlay.addEventListener("pointermove", showReaderChrome);
  overlay.addEventListener("focusin", showReaderChrome);
  topPauseButton.addEventListener("click", () => setPaused(!state.isPaused));
  controlPauseButton.addEventListener("click", () => setPaused(!state.isPaused));
  closeButton.addEventListener("click", stopReading);
  backButton.addEventListener("click", () => jumpBy(-state.settings.jumpStep));
  forwardButton.addEventListener("click", () => jumpBy(state.settings.jumpStep));

  wpmInput.addEventListener("change", (event) => {
    applySettings({ wpm: event.target.value });
    persistSettings({ wpm: state.settings.wpm });
    showFeedback(`${state.settings.wpm} WPM`);
  });

  fontSizeInput.addEventListener("input", (event) => applySettings({ fontSize: event.target.value }));
  fontSizeInput.addEventListener("change", () => persistSettings({ fontSize: state.settings.fontSize }));

  scrubber.addEventListener("pointerdown", () => {
    state.isScrubbing = true;
    state.resumeAfterScrub = !state.isPaused && !state.isFinished;
    setPaused(true);
    showReaderChrome();
  });

  scrubber.addEventListener("input", (event) => {
    if (!state.isScrubbing && !state.isPaused) setPaused(true);
    prepareNavigation();
    state.index = Math.min(state.words.length - 1, Math.max(0, Number(event.target.value)));
    renderCurrentWord();
  });

  scrubber.addEventListener("pointerup", () => {
    const shouldResume = state.resumeAfterScrub;
    state.isScrubbing = false;
    state.resumeAfterScrub = false;
    showFeedback(`${Math.round((state.index / Math.max(state.words.length - 1, 1)) * 100)}%`);
    if (shouldResume) setPaused(false);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && isReaderActive() && !state.isPaused && !state.isFinished) setPaused(true);
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
