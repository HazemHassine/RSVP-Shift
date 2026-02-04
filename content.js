let wordQueue = [];
let currentWordIndex = 0;
let loopTimerId = null;
let isPausedReading = false;
let wordsPerMinute = 300;
let jumpSize = 10;
let savedSelectionRange = null;
let isStartingDelay = false;
let startDelayTimerId = null;
let startDelayAnimationId = null;

const START_DELAY_MS = 1000;

const defaultSettings = {
    wpm: 300,
    color: "#ff4444",
    opacity: 0.9,
    jumpStep: 10,
};

const overlay = document.createElement("div");
overlay.id = "rsvp-overlay";
overlay.innerHTML = `
  <div class="progress-container">
    <div class="progress-bar" id="rsvp-progress"></div>
  </div>

    <div id="rsvp-start-delay" aria-hidden="true"></div>

  <div id="rsvp-word-display">
    <span class="rsvp-left"></span>
    <span class="rsvp-pivot">READY</span>
    <span class="rsvp-right"></span>
  </div>
  
  <div class="rsvp-controls">
    <div class="rsvp-group">
      <label>WPM</label>
      <input type="number" id="rsvp-wpm" value="300" step="50">
      <input type="color" id="rsvp-color" value="#ff4444" style="border:none; width:30px; height:30px; cursor:pointer; background:none;">
    </div>

    <div class="rsvp-group">
      <label>Dim</label>
      <input type="range" id="rsvp-opacity" min="0.5" max="1" step="0.05" value="0.9">
    </div>

    <div class="rsvp-group">
      <label>Jump</label>
      <input type="number" id="rsvp-jump" value="10" min="1" style="width: 40px;">
    </div>
  </div>
  
  <div style="margin-top:15px; color:#666; font-size:12px;">
    Space: Pause | Arrows: Speed/Jump | Esc: Close
  </div>
`;
document.body.appendChild(overlay);
const progressBar = overlay.querySelector("#rsvp-progress");
const startDelayIndicator = overlay.querySelector("#rsvp-start-delay");
const wordDisplay = overlay.querySelector("#rsvp-word-display");
const leftSpan = overlay.querySelector(".rsvp-left");
const pivotSpan = overlay.querySelector(".rsvp-pivot");
const rightSpan = overlay.querySelector(".rsvp-right");

const wpmInput = overlay.querySelector("#rsvp-wpm");
const colorInput = overlay.querySelector("#rsvp-color");
const opacityInput = overlay.querySelector("#rsvp-opacity");
const jumpInput = overlay.querySelector("#rsvp-jump");

function applySettings(settings) {
    const resolvedWpm = Number(settings.wpm);
    const resolvedJump = Number(settings.jumpStep);
    const resolvedOpacity = Number(settings.opacity);

    wordsPerMinute = Number.isFinite(resolvedWpm) ? resolvedWpm : defaultSettings.wpm;
    jumpSize = Number.isFinite(resolvedJump) ? resolvedJump : defaultSettings.jumpStep;
    wpmInput.value = wordsPerMinute;
    jumpInput.value = jumpSize;
    colorInput.value = settings.color || defaultSettings.color;
    opacityInput.value = Number.isFinite(resolvedOpacity) ? resolvedOpacity : defaultSettings.opacity;
    pivotSpan.style.color = colorInput.value;
    if (!isPausedReading) {
        overlay.style.backgroundColor = `rgba(0, 0, 0, ${opacityInput.value})`;
    }
}

function loadSettings() {
    if (!chrome?.storage?.sync) return;
    chrome.storage.sync.get(defaultSettings, (settings) => {
        applySettings(settings);
    });
}

function renderSplitWord(word) {
    if (!word) return;

    const match = word.match(/^([^\w\d]*)([\w\d].*?)([^\w\d]*)$/);
    let prefix = "", core = word, suffix = "";

    if (match) {
        prefix = match[1]; 
        core = match[2];   
        suffix = match[3]; 
    }

    let pivotIndex = Math.ceil((core.length - 1) * 0.35);
    if (core.length === 1) pivotIndex = 0;

    const leftCore = core.slice(0, pivotIndex);
    const pivotChar = core[pivotIndex];
    const rightCore = core.slice(pivotIndex + 1);

    leftSpan.innerText = prefix + leftCore;
    pivotSpan.innerText = pivotChar;
    rightSpan.innerText = rightCore + suffix;
}

function renderReadyState() {
    leftSpan.innerText = "";
    pivotSpan.innerText = "READY";
    rightSpan.innerText = "";
}

function showStartDelayIndicator() {
    startDelayIndicator.classList.add("active");
}

function hideStartDelayIndicator() {
    startDelayIndicator.classList.remove("active");
    startDelayIndicator.style.removeProperty("--progress");
}

function cancelStartDelay() {
    if (startDelayTimerId) {
        clearTimeout(startDelayTimerId);
        startDelayTimerId = null;
    }
    if (startDelayAnimationId) {
        cancelAnimationFrame(startDelayAnimationId);
        startDelayAnimationId = null;
    }
    isStartingDelay = false;
    hideStartDelayIndicator();
}

function beginStartDelay(onComplete) {
    isStartingDelay = true;
    showStartDelayIndicator();
    renderReadyState();

    const startTimestamp = performance.now();
    const updateProgress = (now) => {
        const elapsed = now - startTimestamp;
        const progress = Math.min(elapsed / START_DELAY_MS, 1);
        startDelayIndicator.style.setProperty("--progress", `${progress * 360}deg`);
        if (progress < 1) {
            startDelayAnimationId = requestAnimationFrame(updateProgress);
        }
    };

    startDelayAnimationId = requestAnimationFrame(updateProgress);
    startDelayTimerId = setTimeout(() => {
        cancelStartDelay();
        onComplete();
    }, START_DELAY_MS);
}

function getWordDelayMs(word) {
    const baseDelayMs = 60000 / wordsPerMinute;
    const lastChar = word.slice(-1);

    if (lastChar === ',' || lastChar === ')') return baseDelayMs * 2;
    if ([".", "!", "?", ";"].includes(lastChar)) return baseDelayMs * 2.5;
    if (word === "-") return baseDelayMs * 1.5;

    return baseDelayMs;
}

function showJumpDelta(text) {
    const indicator = document.createElement("div");
    indicator.className = "jump-indicator";
    indicator.innerText = text;
    if (text.startsWith("-")) {
        indicator.style.color = "#ff4444";
    }
    overlay.appendChild(indicator);
    setTimeout(() => {
        indicator.remove();
    }, 800);
}

function sanitizeText(text) {
    text = text.replace(/\[[^\]]*\]/g, "");
    text = text.replace(/[—–]/g, " - ");
    return text;
}

function startReading() {
    const selection = window.getSelection();
    let selectedText = selection.toString().trim();

    if (!selectedText) {
        alert("Select text first!");
        return;
    }

    selectedText = sanitizeText(selectedText);
    
    if (selection.rangeCount > 0) {
        savedSelectionRange = selection.getRangeAt(0).cloneRange();
    }

    wordQueue = selectedText.split(/\s+/);
    currentWordIndex = 0;
    isPausedReading = false;
    
    overlay.style.backgroundColor = `rgba(0, 0, 0, ${opacityInput.value})`;
    pivotSpan.style.color = colorInput.value;
    overlay.classList.add("active");
    
    overlay.tabIndex = -1;
    overlay.focus();

    beginStartDelay(scheduleNextWord);
}

function stopReading() {
    clearTimeout(loopTimerId);
    cancelStartDelay();
    overlay.classList.remove("active");
    wordDisplay.classList.remove("ghost");

    if (savedSelectionRange) {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(savedSelectionRange);
    }
}

function scheduleNextWord() {
    clearTimeout(loopTimerId);
    wordDisplay.classList.remove("ghost");

    if (isStartingDelay) return;

    if (isPausedReading) {
        const currentWord = wordQueue[currentWordIndex];
        renderSplitWord(currentWord);
        leftSpan.innerText = ""; 
        rightSpan.innerText = " (PAUSED)";
        return;
    }

    if (currentWordIndex >= wordQueue.length) {
        stopReading();
        return;
    }

    const currentWord = wordQueue[currentWordIndex];
    renderSplitWord(currentWord);

    const progressPercent = ((currentWordIndex + 1) / wordQueue.length) * 100;
    progressBar.style.width = `${progressPercent}%`;

    const baseDelayMs = 60000 / wordsPerMinute;
    const totalDelayMs = getWordDelayMs(currentWord);
    const extraDelayMs = totalDelayMs - baseDelayMs;

    loopTimerId = setTimeout(() => {
        if (extraDelayMs > 50) {
            wordDisplay.classList.add("ghost");

            loopTimerId = setTimeout(() => {
                wordDisplay.classList.remove("ghost");
                currentWordIndex++;
                scheduleNextWord();
            }, extraDelayMs);

        } else {
            currentWordIndex++;
            scheduleNextWord();
        }
    }, baseDelayMs);
}

document.addEventListener("keydown", (e) => {
    if (!overlay.classList.contains("active")) return;

    if (isStartingDelay && e.code !== "Escape") {
        return;
    }

    switch (e.code) {
        case "Escape":
            stopReading();
            break;

        case "Space":
            e.preventDefault();
            isPausedReading = !isPausedReading;

            if (isPausedReading) {
                overlay.style.backgroundColor = `rgba(0, 0, 0, 0.3)`;
                overlay.style.backdropFilter = "blur(0px)";
                scheduleNextWord();
            } else {
                overlay.style.backgroundColor = `rgba(0, 0, 0, ${opacityInput.value})`;
                overlay.style.backdropFilter = "blur(5px)";
                scheduleNextWord();
            }
            break;

        case "ArrowUp":
            e.preventDefault();
            wordsPerMinute += 50;
            wpmInput.value = wordsPerMinute;
            chrome.storage?.sync?.set({ wpm: wordsPerMinute });
            break;

        case "ArrowDown":
            e.preventDefault();
            wordsPerMinute = Math.max(50, wordsPerMinute - 50);
            wpmInput.value = wordsPerMinute;
            chrome.storage?.sync?.set({ wpm: wordsPerMinute });
            break;

        case "ArrowRight":
            e.preventDefault();
            currentWordIndex = Math.min(wordQueue.length - 1, currentWordIndex + jumpSize);
            renderSplitWord(wordQueue[currentWordIndex]);
            showJumpDelta("+" + jumpSize);
            progressBar.style.width = `${((currentWordIndex + 1) / wordQueue.length) * 100}%`;
            break;

        case "ArrowLeft":
            e.preventDefault();
            currentWordIndex = Math.max(0, currentWordIndex - jumpSize);
            renderSplitWord(wordQueue[currentWordIndex]);
            showJumpDelta("-" + jumpSize);
            progressBar.style.width = `${((currentWordIndex + 1) / wordQueue.length) * 100}%`;
            break;
    }
});

wpmInput.addEventListener("change", (e) => {
    const value = Number(e.target.value);
    wordsPerMinute = Number.isFinite(value) ? value : defaultSettings.wpm;
    wpmInput.value = wordsPerMinute;
    chrome.storage?.sync?.set({ wpm: wordsPerMinute });
});

colorInput.addEventListener("input", (e) => {
    pivotSpan.style.color = e.target.value;
    chrome.storage?.sync?.set({ color: e.target.value });
});

opacityInput.addEventListener("input", (e) => {
    if (!isPausedReading) {
        overlay.style.backgroundColor = `rgba(0, 0, 0, ${e.target.value})`;
    }
    const value = Number(e.target.value);
    chrome.storage?.sync?.set({ opacity: Number.isFinite(value) ? value : defaultSettings.opacity });
});

jumpInput.addEventListener("change", (e) => {
    const value = Number(e.target.value);
    jumpSize = Number.isFinite(value) ? value : defaultSettings.jumpStep;
    jumpInput.value = jumpSize;
    chrome.storage?.sync?.set({ jumpStep: jumpSize });
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "toggle") {
        if (overlay.classList.contains("active")) {
            stopReading();
        } else {
            startReading();
        }
    }

    if (msg.action === "update-settings" && msg.settings) {
        applySettings({ ...defaultSettings, ...msg.settings });
    }
});

loadSettings();