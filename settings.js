(() => {
  const DEFAULT_SETTINGS = Object.freeze({
    wpm: 300,
    fontSize: 68,
    color: "#48e6b0",
    opacity: 0.9,
    jumpStep: 10,
    smartTiming: true,
    punctuationPauses: "normal",
    contextPreview: "off",
    focusStyle: "color",
    fixationGuides: "minimal",
    backgroundMode: "dim",
    startDelay: 1,
    autoHideControls: true,
    calibrationSeen: false,
  });

  const LIMITS = Object.freeze({
    wpm: Object.freeze({ min: 50, max: 1200 }),
    fontSize: Object.freeze({ min: 32, max: 120 }),
    opacity: Object.freeze({ min: 0, max: 1 }),
    jumpStep: Object.freeze({ min: 1, max: 100 }),
  });

  function clampNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function normalizeSettings(settings = {}) {
    const color = /^#[0-9a-f]{6}$/i.test(settings.color)
      ? settings.color.toLowerCase()
      : DEFAULT_SETTINGS.color;

    return {
      wpm: Math.round(
        clampNumber(
          settings.wpm,
          DEFAULT_SETTINGS.wpm,
          LIMITS.wpm.min,
          LIMITS.wpm.max,
        ),
      ),
      fontSize: Math.round(
        clampNumber(
          settings.fontSize,
          DEFAULT_SETTINGS.fontSize,
          LIMITS.fontSize.min,
          LIMITS.fontSize.max,
        ),
      ),
      color,
      opacity: clampNumber(
        settings.opacity,
        DEFAULT_SETTINGS.opacity,
        LIMITS.opacity.min,
        LIMITS.opacity.max,
      ),
      jumpStep: Math.round(
        clampNumber(
          settings.jumpStep,
          DEFAULT_SETTINGS.jumpStep,
          LIMITS.jumpStep.min,
          LIMITS.jumpStep.max,
        ),
      ),
      smartTiming: typeof settings.smartTiming === "boolean"
        ? settings.smartTiming
        : DEFAULT_SETTINGS.smartTiming,
      punctuationPauses: ["off", "light", "normal", "strong"].includes(settings.punctuationPauses)
        ? settings.punctuationPauses
        : DEFAULT_SETTINGS.punctuationPauses,
      contextPreview: ["off", "previous", "both"].includes(settings.contextPreview)
        ? settings.contextPreview
        : DEFAULT_SETTINGS.contextPreview,
      focusStyle: ["color", "underline", "marker", "none"].includes(settings.focusStyle)
        ? settings.focusStyle
        : DEFAULT_SETTINGS.focusStyle,
      fixationGuides: ["off", "minimal", "full"].includes(settings.fixationGuides)
        ? settings.fixationGuides
        : DEFAULT_SETTINGS.fixationGuides,
      backgroundMode: ["dim", "solid"].includes(settings.backgroundMode)
        ? settings.backgroundMode
        : DEFAULT_SETTINGS.backgroundMode,
      startDelay: [0, 1, 3].includes(Number(settings.startDelay))
        ? Number(settings.startDelay)
        : DEFAULT_SETTINGS.startDelay,
      autoHideControls: typeof settings.autoHideControls === "boolean"
        ? settings.autoHideControls
        : DEFAULT_SETTINGS.autoHideControls,
      calibrationSeen: typeof settings.calibrationSeen === "boolean"
        ? settings.calibrationSeen
        : DEFAULT_SETTINGS.calibrationSeen,
    };
  }

  globalThis.FastReaderSettings = Object.freeze({
    DEFAULT_SETTINGS,
    LIMITS,
    normalizeSettings,
  });
})();
