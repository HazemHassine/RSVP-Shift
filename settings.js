(() => {
  const DEFAULT_SETTINGS = Object.freeze({
    wpm: 300,
    color: "#ff5a67",
    opacity: 0.9,
    jumpStep: 10,
  });

  const LIMITS = Object.freeze({
    wpm: Object.freeze({ min: 50, max: 1200 }),
    opacity: Object.freeze({ min: 0.5, max: 1 }),
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
    };
  }

  globalThis.FastReaderSettings = Object.freeze({
    DEFAULT_SETTINGS,
    LIMITS,
    normalizeSettings,
  });
})();
