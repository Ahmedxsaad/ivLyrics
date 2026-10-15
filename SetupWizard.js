// First-run settings. Three short pages share the settings window's tokens and keep changes in a draft.
const SETUP_STORAGE_KEY = "ivLyrics:setup-completed";

const WizardIcons = {
  lyrics: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  translation: '<path d="m4 5 7 0M7 3v2c0 7-4 10-4 10m0-6c1 3 3 5 6 7m4 4 4-12 4 12m-6-4h4"/>',
  alignLeft: '<path d="M4 5h16M4 10h10M4 15h16M4 20h10"/>',
  alignCenter: '<path d="M4 5h16M7 10h10M4 15h16M7 20h10"/>',
  alignRight: '<path d="M4 5h16M10 10h10M4 15h16M10 20h10"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20.9 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  overlay: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4M6 9h12m-12 4h8"/>',
  externalLink: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  mic: '<rect x="8" y="2" width="8" height="12" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
};
const wizardSvg = (name, size = 20) => react.createElement("svg", {
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
  dangerouslySetInnerHTML: { __html: WizardIcons[name] || WizardIcons.lyrics },
});

const WIZARD_COLORS = {
  text: "var(--text)", muted: "var(--text-2)", subdued: "var(--text-3)",
  surface: "var(--surface)", surfaceRaised: "var(--surface-2)", surfaceSelected: "var(--accent-soft)",
  border: "var(--line-2)", borderStrong: "var(--accent-line)", accent: "var(--accent-text)",
  accentText: "var(--accent-ink)", warningSurface: "var(--warn-soft)", warningBorder: "var(--line-2)",
  warningText: "var(--warn)", dangerSurface: "var(--danger-soft)", dangerBorder: "var(--line-2)",
  dangerText: "var(--danger)", infoSurface: "var(--info-soft)", infoBorder: "var(--line-2)",
};
const wizardStepStyle = { display: "flex", flexDirection: "column", padding: "16px", minWidth: 0 };
const wizardTitleStyle = { fontSize: "18px", fontWeight: 600, color: WIZARD_COLORS.text, margin: "0 0 6px" };
const wizardSubtitleStyle = { fontSize: "13px", color: WIZARD_COLORS.muted, lineHeight: 1.6, margin: "0 0 16px" };
const wizardPanelStyle = { background: WIZARD_COLORS.surface, border: `1px solid ${WIZARD_COLORS.border}`, borderRadius: 8 };

const WizardButton = ({ children, variant = "secondary", className = "", ...props }) =>
  react.createElement("button", { type: "button", ...props, className: "wizard-button wizard-button-" + variant + " " + className }, children);
const WizardToggleVisual = ({ enabled }) => react.createElement("span", {
  className: "wizard-switch" + (enabled ? " is-on" : ""), "aria-hidden": true,
}, react.createElement("span"));
const WizardNavigation = ({ onBack, onNext, nextLabel, extraActions, hideBack = false, nextDisabled = false }) =>
  react.createElement("div", { className: "wizard-diagnostic-nav" },
    !hideBack && react.createElement(WizardButton, { onClick: onBack }, I18n.t("setupWizard.navigation.back")),
    extraActions,
    onNext && react.createElement(WizardButton, { onClick: onNext, variant: "primary", disabled: nextDisabled },
      nextLabel || I18n.t("setupWizard.navigation.next")));

function ensureSetupWizardStyles() {
  if (document.getElementById("ivLyrics-setup-styles")) return;
  const style = document.createElement("style");
  style.id = "ivLyrics-setup-styles";
  style.textContent = getSettingsSurfaceTokenCss(".ivlyrics-setup-shell") + `
#ivLyrics-setup-wizard-overlay { padding: 24px; }
.ivlyrics-fluent-shell.ivlyrics-setup-shell {
  display: flex; flex-direction: column; width: min(760px, 100%); max-width: 100%;
  max-height: min(820px, calc(100dvh - 48px)); min-height: 0;
  color: var(--text); background: var(--bg); border: 1px solid var(--line-2);
  border-radius: 12px !important; box-shadow: var(--shadow-3); font-family: var(--font);
}
.ivlyrics-setup-shell * { box-sizing: border-box; }
.ivlyrics-setup-shell button, .ivlyrics-setup-shell select { font: inherit; }
.ivlyrics-setup-shell button { cursor: pointer; }
.ivlyrics-setup-shell button:disabled { cursor: default; opacity: .5; }
.ivlyrics-setup-shell :is(button, select):focus-visible { outline: 2px solid var(--accent-text); outline-offset: 3px; }
.setup-wizard-container { display: flex; flex-direction: column; min-height: 0; width: 100%; }
.wizard-topbar { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px 0; gap: 12px; }
.wizard-brand { display: flex; align-items: center; gap: 9px; color: var(--text-2); font-size: 14px; font-weight: 600; }
.wizard-top-actions { display: flex; align-items: center; gap: 12px; }
.wizard-theme { display: flex; padding: 2px; gap: 2px; background: var(--surface-3); border: 1px solid var(--line-2); border-radius: 8px; }
.wizard-icon-button { display: grid; place-items: center; width: 40px; height: 40px; background: transparent; color: var(--text-3); border: 0; border-radius: 6px; flex-shrink: 0; }
.wizard-icon-button[aria-pressed="true"] { color: var(--text); background: var(--surface); box-shadow: var(--shadow-1); }
.wizard-icon-button:hover { color: var(--text); background: var(--surface-3); }
.wizard-intro { padding: 20px 28px 0; }
.wizard-intro h1 { margin: 0; font-size: 25px; font-weight: 650; line-height: 1.35; letter-spacing: -.025em; }
.wizard-intro p { margin: 8px 0 0; font-size: 14px; color: var(--text-2); line-height: 1.65; max-width: 60ch; }
.wizard-intro h1.wizard-welcome-copy { font-size: clamp(28px, 3.3vw, 38px); line-height: 1.3; }
.wizard-welcome-copy { display: grid; }
.wizard-welcome-copy > span { grid-area: 1 / 1; opacity: 0; pointer-events: none; transition: opacity 180ms ease-out; }
.wizard-welcome-copy > span.is-current { opacity: 1; }
.wizard-progress { display: flex; list-style: none; gap: 8px; padding: 0 28px; margin: 24px 0 0; }
.wizard-progress li { flex: 1; min-width: 0; }
.wizard-progress button { border: 0; border-top: 2px solid var(--line-2); background: transparent; padding: 12px 0; min-height: 44px; width: 100%; text-align: start; color: var(--text-3); font-size: 13px; display: flex; gap: 8px; align-items: center; }
.wizard-progress button[aria-current="step"] { border-color: var(--accent); color: var(--text); font-weight: 600; }
.wizard-progress li.is-done button { border-color: var(--accent-line); color: var(--text-2); }
.wizard-step-number { color: var(--text-3); font-size: 12px; font-variant-numeric: tabular-nums; }
.wizard-pages { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 12px 28px 28px; }
.wizard-page { display: flex; flex-direction: column; gap: 20px; animation: wizard-page-in 160ms ease-out; }
.wizard-page h2 { font-size: 16px; line-height: 1.5; margin: 0; font-weight: 600; outline: none; }
.wizard-card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; min-width: 0; }
.wizard-field { display: flex; flex-direction: column; gap: 9px; padding: 16px; min-width: 0; }
.wizard-field + .wizard-field { border-top: 1px solid var(--line); }
.wizard-field > span, .wizard-label { font-size: 13px; font-weight: 550; color: var(--text-2); }
.wizard-field select { width: 100%; min-height: 44px; padding: 10px 12px; color: var(--text); background: var(--surface-2); border: 1px solid var(--line-2); border-radius: 6px; }
.wizard-note { margin: 0; font-size: 13px; line-height: 1.65; color: var(--text-2); }
.wizard-preview { display: flex; flex-direction: column; gap: 6px; padding: 18px 20px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); }
.wizard-preview strong { font-size: 18px; font-weight: 600; }
.wizard-preview span { font-size: 14px; color: var(--text-3); }
.wizard-display-layout { display: grid; grid-template-columns: 1fr 1.35fr; gap: 20px; align-items: stretch; }
.wizard-scene { padding: 22px; min-height: 230px; border-radius: 10px; display: flex; flex-direction: column; justify-content: center; background: #263431; color: #fff; overflow: hidden; }
.wizard-scene[data-mode="colorful"] { background: linear-gradient(145deg, #535d70, #263c40); }
.wizard-scene[data-mode="gradient"] { background: linear-gradient(145deg, #67533f, #294346); }
.wizard-scene[data-mode="blurGradient"] { background: radial-gradient(at 10% 20%, #796246, transparent 90%), #223c3b; }
.wizard-scene[data-mode="solid"] { background: #161619; }
.wizard-scene[data-mode="none"] { background: var(--bg); color: var(--text); border: 1px solid var(--line-2); }
.wizard-scene[data-mode="none"] p { color: var(--text-3); }
.wizard-scene[data-mode="video"] { background: linear-gradient(155deg, #23363c, #24302c); }
.wizard-scene p { color: rgba(255,255,255,.68); font-size: 15px; margin: 0 0 10px; }
.wizard-scene strong { font-size: 24px; line-height: 1.5; }
.wizard-display-controls { display: flex; flex-direction: column; gap: 10px; }
.wizard-options { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 6px; }
.wizard-option { min-width: 0; min-height: 44px; padding: 10px 8px; display: flex; justify-content: center; align-items: center; gap: 7px; background: var(--surface); border: 1px solid var(--line-2); border-radius: 6px; color: var(--text-2); font-size: 12px !important; text-align: center; }
.wizard-option[aria-checked="true"] { border-color: var(--accent-line); background: var(--accent-soft); color: var(--accent-text); }
.wizard-option:hover { border-color: var(--line-3); color: var(--text); }
.wizard-backgrounds { grid-template-columns: repeat(2,minmax(0,1fr)); }
.wizard-backgrounds .wizard-option { flex-direction: column; gap: 8px; }
.wizard-swatch { width: 100%; height: 26px; border-radius: 3px; flex-shrink: 0; }
.wizard-toggle { display: flex; align-items: center; gap: 14px; border: 0; padding: 14px 16px; width: 100%; background: transparent; color: var(--text); text-align: start; min-height: 66px; }
.wizard-toggle + .wizard-toggle { border-top: 1px solid var(--line); }
.wizard-toggle:hover { background: var(--surface-2); }
.wizard-toggle-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.wizard-toggle-copy strong { font-size: 14px; font-weight: 550; }
.wizard-toggle-copy span { font-size: 12px; color: var(--text-3); line-height: 1.5; }
.wizard-toggle > svg { color: var(--text-3); flex-shrink: 0; }
.wizard-switch { display: inline-flex; width: 40px; height: 24px; border: 1px solid var(--line-2); border-radius: 999px; background: var(--switch-off); padding: 2px; flex-shrink: 0; }
.wizard-switch > span { width: 18px; height: 18px; border-radius: 50%; background: white; transition: transform 160ms ease-out; }
.wizard-switch.is-on { background: var(--accent); border-color: var(--accent); }
.wizard-switch.is-on > span { transform: translateX(14px); }
.wizard-diagnostic { border: 1px solid var(--line-2); border-radius: 8px; background: var(--surface); min-width: 0; }
.wizard-diagnostic-nav { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.wizard-diagnostic .wizard-button { padding-inline: 12px !important; min-width: 0; }
.wizard-footer { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 16px 28px; border-top: 1px solid var(--line); background: var(--bg); flex-wrap: wrap; }
.wizard-footer-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.wizard-button { min-height: 44px; padding: 10px 18px; border: 1px solid var(--line-2); border-radius: 6px; background: var(--surface); color: var(--text); font-size: 13px; font-weight: 550; line-height: 1.4; transition: background 120ms ease-out; }
.wizard-button:hover { background: var(--surface-3); }
.wizard-button-primary { color: var(--ink-text); background: var(--ink); border-color: transparent; }
.wizard-button-primary:hover { background: var(--ink); opacity: .85; }
.wizard-button-ghost { background: transparent; color: var(--text-2); border-color: transparent; }
@keyframes wizard-page-in { from { opacity: .4; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (max-width: 600px) {
  #ivLyrics-setup-wizard-overlay { padding: 12px; }
  .ivlyrics-fluent-shell.ivlyrics-setup-shell { max-height: calc(100dvh - 24px); }
  .wizard-topbar { padding: 12px 16px 0; }
  .wizard-intro { padding: 16px 20px 0; }
  .wizard-intro h1 { font-size: 22px; }
  .wizard-progress { padding-inline: 20px; margin-top: 18px; }
  .wizard-progress button { font-size: 12px; }
  .wizard-pages { padding: 8px 20px 20px; }
  .wizard-footer { padding: 12px 20px; }
  .wizard-display-layout { grid-template-columns: 1fr; }
  .wizard-scene { min-height: 130px; }
  .wizard-backgrounds { grid-template-columns: repeat(3,minmax(0,1fr)); }
}
@media (max-height: 590px) {
  .wizard-intro { padding-top: 12px; }
  .wizard-intro p { display: none; }
  .wizard-progress { margin-top: 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .ivlyrics-setup-shell *, .ivlyrics-setup-shell *::before, .ivlyrics-setup-shell *::after { animation: none !important; transition: none !important; }
}
`;
  document.head.appendChild(style);
}

const wizardBackgroundOptions = [
  ["colorful", "colorful"], ["gradient", "gradient"], ["blurGradient", "blur-gradient-background"],
  ["solid", "solid-background"], ["video", "video-background"], ["none", null],
];
const getWizardBackgroundLabel = (background) => I18n.t(background === "none" ? "settingsUi.background.none" : "setupWizard.theme.backgrounds." + background);
function getWizardBackground(visual) {
  if (visual["video-background"]) return "video";
  if (visual["solid-background"]) return "solid";
  if (visual["blur-gradient-background"]) return "blurGradient";
  if (visual.colorful) return "colorful";
  return visual["gradient-background"] ? "gradient" : "none";
}
const WizardToggleRow = ({ icon, title, description, enabled, onToggle }) =>
  react.createElement("button", { type: "button", className: "wizard-toggle", role: "switch",
    "aria-checked": enabled, onClick: onToggle },
    wizardSvg(icon), react.createElement("span", { className: "wizard-toggle-copy" },
      react.createElement("strong", null, title),
      description && react.createElement("span", null, description)),
    react.createElement(WizardToggleVisual, { enabled }));

// These two greetings are intentionally bilingual. Form labels and the saved
// language never rotate; screen readers keep one stable, localized heading.
const WIZARD_WELCOME_COPY = {
  en: { greeting: "Hello", instruction: "Choose your language to get started." },
  ko: { greeting: "안녕하세요", instruction: "사용할 언어를 선택해주세요." },
};
const getWizardWelcomeLanguage = (language) => /^ko(?:[-_]|$)/i.test(language || "") ? "ko" : "en";
const useWizardWelcomeLanguage = (active, language, settled) => {
  const initialLanguage = getWizardWelcomeLanguage(language);
  const [welcomeLanguage, setWelcomeLanguage] = useState(initialLanguage);
  react.useEffect(() => {
    if (!active || settled) return;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let timer = null;
    const refresh = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
      if (document.hidden || motion?.matches) {
        setWelcomeLanguage(initialLanguage);
        return;
      }
      timer = setInterval(() => setWelcomeLanguage((value) => value === "ko" ? "en" : "ko"), 3500);
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    motion?.addEventListener?.("change", refresh);
    return () => {
      if (timer !== null) clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      motion?.removeEventListener?.("change", refresh);
    };
  }, [active, initialLanguage, settled]);
  return settled ? initialLanguage : welcomeLanguage;
};
const WizardWelcomeText = ({ tag, field, language, ...props }) =>
  react.createElement(tag, { ...props, className: "wizard-welcome-copy" },
    ["en", "ko"].map((code) => react.createElement("span", {
      key: code, lang: code, "aria-hidden": true,
      className: code === language ? "is-current" : "",
    }, WIZARD_WELCOME_COPY[code][field])));

// Video Test step - Check if YouTube embed requires login
const VideoTestStep = ({ onNext, onBack, onNeedHelper, onSkip }) => {
  const [loginRequired, setLoginRequired] = useState(null);
  const [playerReady, setPlayerReady] = useState(false);
  const playerContainerRef = react.useRef(null);
  const playerRef = react.useRef(null);
  const playerIdRef = react.useRef("yt-wizard-player-" + Math.random().toString(36).substr(2, 9));

  const handleYes = () => {
    setLoginRequired(true);
  };

  const handleNo = () => {
    // No login required, skip helper steps
    onSkip();
  };

  const handleInstallHelper = () => {
    if (typeof VideoHelperService !== "undefined") {
      VideoHelperService.openDownloadPage();
    } else {
      window.open("https://ivlis.kr/ivLyrics/extensions/#helper", "_blank");
    }
  };

  // Initialize YouTube Player API
  react.useEffect(() => {
    const playerId = playerIdRef.current;
    let isMounted = true;
    let retryTimer = null;
    let apiReadyCallback = null;
    const previousApiReadyCallback = window.onYouTubeIframeAPIReady;

    const createPlayer = () => {
      retryTimer = null;
      if (!isMounted || !playerContainerRef.current || playerRef.current) return;
      if (!window.YT || !window.YT.Player) {
        // Wait for YT API to load
        retryTimer = setTimeout(createPlayer, 200);
        return;
      }

      // Create container div if not exists
      if (playerContainerRef.current && !document.getElementById(playerId)) {
        const div = document.createElement("div");
        div.id = playerId;
        div.style.width = "100%";
        div.style.height = "100%";
        playerContainerRef.current.appendChild(div);
      }

      try {
        playerRef.current = new window.YT.Player(playerId, {
          videoId: "9bZkp7q19f0",
          host: "https://www.youtube-nocookie.com",
          playerVars: {
            rel: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            playsinline: 1,
            fs: 0,
            disablekb: 1,
            origin: window.location.origin,
            autoplay: 0,
            controls: 1,
          },
          events: {
            onReady: () => {
              setPlayerReady(true);
            },
            onError: (e) => {
              console.warn("[VideoTestStep] Player error:", e.data);
            },
          },
        });
      } catch (e) {
        console.error("[VideoTestStep] Failed to create player:", e);
      }
    };

    // Load YouTube IFrame API if not loaded
    if (!window.YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName("script")[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

      apiReadyCallback = (...args) => {
        try {
          if (typeof previousApiReadyCallback === "function") {
            previousApiReadyCallback.apply(window, args);
          }
        } finally {
          createPlayer();
        }
      };
      window.onYouTubeIframeAPIReady = apiReadyCallback;
    } else {
      createPlayer();
    }

    // Cleanup
    return () => {
      isMounted = false;
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      if (apiReadyCallback && window.onYouTubeIframeAPIReady === apiReadyCallback) {
        window.onYouTubeIframeAPIReady = previousApiReadyCallback;
      }
      if (playerRef.current && typeof playerRef.current.destroy === "function") {
        try {
          playerRef.current.destroy();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      playerRef.current = null;
      setPlayerReady(false);
    };
  }, []);

  const renderVideoTestHelperMessage = () => react.createElement(
      "div",
      {
        style: {
          textAlign: "center",
          padding: "16px 20px",
          background: WIZARD_COLORS.warningSurface,
          borderRadius: 6,
          border: `1px solid ${WIZARD_COLORS.warningBorder}`,
          marginBottom: "16px",
        },
      },
      react.createElement(
        "p",
        {
          style: {
            fontSize: "14px",
            fontWeight: "600",
            color: WIZARD_COLORS.warningText,
            marginBottom: "8px",
          },
        },
        I18n.t("setupWizard.videoTest.helperRequired")
      ),
      react.createElement(
        "p",
        {
          style: {
            fontSize: "12px",
            color: WIZARD_COLORS.muted,
            marginBottom: "16px",
          },
        },
        I18n.t("setupWizard.videoTest.helperDesc")
      ),
      react.createElement(
        WizardButton,
        {
          onClick: handleInstallHelper,
          variant: "secondary",
          style: {
            padding: "12px 24px",
            fontSize: "13px",
            fontWeight: "600",
            color: WIZARD_COLORS.warningText,
            background: WIZARD_COLORS.warningSurface,
            borderColor: WIZARD_COLORS.warningBorder,
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "12px",
          },
        },
        react.createElement("svg", {
          width: 16,
          height: 16,
          viewBox: "0 0 24 24",
          fill: "currentColor",
          dangerouslySetInnerHTML: { __html: WizardIcons.externalLink },
        }),
        I18n.t("setupWizard.videoTest.installHelper")
      )
    );

  const renderVideoTestPlayerContainer = () =>
    react.createElement(
      "div",
      {
        ref: playerContainerRef,
        style: {
          width: "100%",
          maxWidth: "400px",
          margin: "0 auto 20px",
          aspectRatio: "16/9",
          borderRadius: 6,
          overflow: "hidden",
          background: "rgba(0, 0, 0, 0.3)",
          border: `1px solid ${WIZARD_COLORS.border}`,
        },
      }
    );

  const renderVideoTestQuestion = () =>
    react.createElement(
      "div",
      {
        style: {
          textAlign: "center",
          marginBottom: "16px",
        },
      },
      react.createElement(
        "p",
        {
          style: {
            fontSize: "14px",
            fontWeight: "500",
            color: WIZARD_COLORS.text,
            marginBottom: "12px",
          },
        },
        I18n.t("setupWizard.videoTest.question")
      ),
      // Yes/No buttons
      loginRequired === null &&
      react.createElement(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "center",
            gap: "12px",
          },
        },
        react.createElement(
          WizardButton,
          {
            onClick: handleYes,
            style: {
              padding: "10px 32px",
              fontSize: "14px",
              color: WIZARD_COLORS.dangerText,
              background: WIZARD_COLORS.dangerSurface,
              borderColor: WIZARD_COLORS.dangerBorder,
            },
          },
          I18n.t("setupWizard.videoTest.yes")
        ),
        react.createElement(
          WizardButton,
          {
            onClick: handleNo,
            style: {
              padding: "10px 32px",
              fontSize: "14px",
              color: WIZARD_COLORS.accent,
              background: WIZARD_COLORS.surfaceSelected,
              borderColor: WIZARD_COLORS.borderStrong,
            },
          },
          I18n.t("setupWizard.videoTest.no")
        )
      )
    );

  return react.createElement(
    "div",
    {
      className: "wizard-step video-test-step",
      style: wizardStepStyle,
    },
    react.createElement(
      "h2",
      { style: wizardTitleStyle },
      I18n.t("setupWizard.videoTest.title")
    ),
    react.createElement(
      "p",
      { style: { ...wizardSubtitleStyle, marginBottom: "20px" } },
      I18n.t("setupWizard.videoTest.subtitle")
    ),
    // YouTube Player container
    renderVideoTestPlayerContainer(),
    // Question section
    renderVideoTestQuestion(),
    // Helper required message (shown when loginRequired is true)
    loginRequired === true && renderVideoTestHelperMessage(),
    // Spacer
    react.createElement("div", { style: { flex: 1 } }),
    react.createElement(WizardNavigation, {
      onBack,
      onNext: loginRequired === true ? onNeedHelper : null,
      extraActions: react.createElement(
        WizardButton,
        {
          onClick: onSkip,
          variant: "ghost",
        },
        I18n.t("setupWizard.videoTest.skip")
      ),
    })
  );
};

// Video Helper Test step - Test helper program with the same video
const VideoHelperTestStep = ({ onNext, onBack, onSkip, helperEnabled, onHelperChange }) => {
  const [testStatus, setTestStatus] = useState("idle"); // idle, testing, downloading, success, failed
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [videoUrl, setVideoUrl] = useState(null);
  const requestRef = react.useRef({ generation: 0, abort: null });
  react.useEffect(() => () => {
    requestRef.current.generation += 1;
    requestRef.current.abort?.();
  }, []);

  const testVideoId = "9bZkp7q19f0";

  const handleEnableHelper = () => {
    requestRef.current.generation += 1;
    requestRef.current.abort?.();
    setTestStatus("idle");
    onHelperChange(!helperEnabled);
  };

  const handleTestVideo = async () => {
    const generation = ++requestRef.current.generation;
    requestRef.current.abort?.();
    const active = () => requestRef.current.generation === generation;
    if (typeof VideoHelperService === "undefined") {
      setTestStatus("failed");
      return;
    }

    setTestStatus("testing");
    setDownloadPercent(0);
    setVideoUrl(null);

    // First check if helper is available
    let available = false;
    try { available = await VideoHelperService.checkHealth(); } catch {}
    if (!active()) return;
    if (!available) {
      setTestStatus("failed");
      return;
    }

    // Request the video
    requestRef.current.abort = VideoHelperService.requestVideo(testVideoId, {
      onProgress: (data) => {
        if (!active()) return;
        setTestStatus("downloading");
        setDownloadPercent(data.percent || 0);
      },
      onComplete: (url) => {
        if (!active()) return;
        setVideoUrl(url);
        setTestStatus("success");
      },
      onError: (message) => {
        if (!active()) return;
        console.error("[VideoHelperTest] Error:", message);
        setTestStatus("failed");
      },
    });
  };

  const renderVideoHelperDownloadProgress = () => react.createElement(
      "div",
      {
        style: {
          textAlign: "center",
          marginBottom: "16px",
        },
      },
      react.createElement(
        "div",
        {
          style: {
            width: "100%",
            maxWidth: "300px",
            height: "8px",
            background: "rgba(255, 255, 255, 0.1)",
            borderRadius: 6,
            margin: "0 auto 8px",
            overflow: "hidden",
          },
        },
        react.createElement("div", {
          style: {
            width: `${downloadPercent}%`,
            height: "100%",
            background: WIZARD_COLORS.accent,
            borderRadius: 6,
            transition: "width 0.3s ease",
          },
        })
      ),
      react.createElement(
        "p",
        {
          style: {
            fontSize: "12px",
            color: WIZARD_COLORS.muted,
          },
        },
        I18n.t("setupWizard.videoHelperTest.downloading").replace("{percent}", Math.round(downloadPercent))
      )
    );

  const renderVideoHelperSuccess = () => react.createElement(
      "div",
      {
        style: {
          textAlign: "center",
          padding: "16px 20px",
          background: WIZARD_COLORS.surfaceSelected,
          borderRadius: 6,
          border: `1px solid ${WIZARD_COLORS.borderStrong}`,
          marginBottom: "16px",
        },
      },
      react.createElement(
        "p",
        {
          style: {
            fontSize: "14px",
            fontWeight: "600",
            color: WIZARD_COLORS.accent,
            marginBottom: videoUrl ? "12px" : "0",
          },
        },
        "✓ " + I18n.t("setupWizard.videoHelperTest.success")
      ),
      // Show video preview if available
      videoUrl &&
      react.createElement(
        "div",
        {
          style: {
            maxWidth: "300px",
            margin: "0 auto",
            borderRadius: 6,
            overflow: "hidden",
          },
        },
        react.createElement("video", {
          src: videoUrl,
          style: {
            width: "100%",
            borderRadius: 6,
          },
          controls: true,
          autoPlay: true,
          muted: true,
        })
      )
    );

  const renderVideoHelperFailed = () => react.createElement(
      "div",
      {
        style: {
          textAlign: "center",
          padding: "16px 20px",
          background: WIZARD_COLORS.dangerSurface,
          borderRadius: 6,
          border: `1px solid ${WIZARD_COLORS.dangerBorder}`,
          marginBottom: "16px",
        },
      },
      react.createElement(
        "p",
        {
          style: {
            fontSize: "14px",
            fontWeight: "600",
            color: WIZARD_COLORS.dangerText,
          },
        },
        "✕ " + I18n.t("setupWizard.videoHelperTest.failed")
      )
    );

  const renderVideoHelperEnableToggle = () =>
    react.createElement(
      "button",
      {
        type: "button",
        role: "switch",
        "aria-checked": helperEnabled,
        "aria-label": I18n.t("setupWizard.videoHelperTest.enableHelper"),
        onClick: handleEnableHelper,
        style: {
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          ...wizardPanelStyle,
          marginBottom: "16px",
          cursor: "pointer",
        },
      },
      react.createElement(
        "span",
        {
          style: {
            fontSize: "14px",
            fontWeight: "500",
            color: WIZARD_COLORS.text,
          },
        },
        I18n.t("setupWizard.videoHelperTest.enableHelper")
      ),
      react.createElement(WizardToggleVisual, {
        enabled: helperEnabled,
      })
    );

  const renderVideoHelperTestButton = () =>
    react.createElement(
      "div",
      {
        style: {
          textAlign: "center",
          marginBottom: "20px",
        },
      },
      react.createElement(
        WizardButton,
        {
          onClick: handleTestVideo,
          disabled: testStatus === "testing" || testStatus === "downloading",
          variant: "primary",
          style: {
            padding: "14px 32px",
            fontSize: "14px",
          },
        },
        testStatus === "testing" || testStatus === "downloading"
          ? I18n.t("setupWizard.videoHelperTest.testing")
          : I18n.t("setupWizard.videoHelperTest.testVideo")
      )
    );

  return react.createElement(
    "div",
    {
      className: "wizard-step video-helper-test-step",
      style: wizardStepStyle,
    },
    react.createElement(
      "h2",
      { style: wizardTitleStyle },
      I18n.t("setupWizard.videoHelperTest.title")
    ),
    react.createElement(
      "p",
      { style: wizardSubtitleStyle },
      I18n.t("setupWizard.videoHelperTest.subtitle")
    ),
    // Enable helper toggle
    renderVideoHelperEnableToggle(),
    // Test button
    helperEnabled &&
    renderVideoHelperTestButton(),
    // Download progress
    testStatus === "downloading" && renderVideoHelperDownloadProgress(),
    // Success message
    testStatus === "success" && renderVideoHelperSuccess(),
    // Failed message
    testStatus === "failed" && renderVideoHelperFailed(),
    // Spacer
    react.createElement("div", { style: { flex: 1 } }),
    react.createElement(WizardNavigation, {
      onBack,
      onNext,
      extraActions: react.createElement(
        WizardButton,
        {
          onClick: onSkip,
          variant: "ghost",
        },
        I18n.t("setupWizard.videoHelperTest.skip")
      ),
    })
  );
};



const SetupWizard = ({ onComplete, onDismiss, onThemeChange }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedLanguage, setSelectedLanguage] = useState(I18n.getCurrentLanguage());
  const [languageInteracted, setLanguageInteracted] = useState(false);
  const welcomeLanguage = useWizardWelcomeLanguage(currentStep === 0, selectedLanguage, languageInteracted);
  const [outputLanguage, setOutputLanguage] = useState(CONFIG.visual["translate:target-language"] || "auto");
  const [uiTheme, setUiTheme] = useState(getSettingsSurfaceTheme());
  const changedUiTheme = react.useRef(false);
  const [themeSettings, setThemeSettings] = useState(() => ({
    alignment: CONFIG.visual.alignment || "center",
    background: getWizardBackground(CONFIG.visual),
  }));
  const [overlayEnabled, setOverlayEnabled] = useState(() => {
    const stored = StorageManager.getItem("ivLyrics:overlay-enabled");
    return stored != null ? stored !== "false" : (window.OverlaySender?.enabled ?? false);
  });
  const [nowPlayingEnabled, setNowPlayingEnabled] = useState(CONFIG.visual["panel-lyrics-enabled"] !== false);
  const [pseudoKaraokeEnabled, setPseudoKaraokeEnabled] = useState(!!CONFIG.visual["spotify-fake-karaoke-enabled"]);
  const [videoHelperEnabled, setVideoHelperEnabled] = useState(!!CONFIG.visual["video-helper-enabled"]);
  const [videoCheck, setVideoCheck] = useState(null);
  const pageRef = react.useRef(null);
  const finishing = react.useRef(false);
  const steps = ["language", "appearance", "playback"];
  const languages = I18n.getAvailableLanguages();
  react.useEffect(() => {
    if (currentStep !== 0) setLanguageInteracted(true);
    pageRef.current?.scrollTo?.({ top: 0 });
    pageRef.current?.querySelector("h2")?.focus({ preventScroll: true });
  }, [currentStep]);

  const changeTheme = (theme) => {
    setUiTheme(theme);
    changedUiTheme.current = true;
    onThemeChange?.(theme);
  };
  const changeLanguage = (code) => {
    setLanguageInteracted(true);
    setSelectedLanguage(code);
    I18n.setLanguage(code);
  };
  const changeAppearance = (key, value) => {
    setThemeSettings((previous) => ({ ...previous, [key]: value }));
    if (key === "background") setVideoCheck(null);
  };
  const complete = (openSettings = false) => {
    if (finishing.current) return;
    finishing.current = true;
    const values = {
      language: selectedLanguage, "translate:target-language": outputLanguage,
      alignment: themeSettings.alignment, "overlay-enabled": overlayEnabled,
      "panel-lyrics-enabled": nowPlayingEnabled, "spotify-fake-karaoke-enabled": pseudoKaraokeEnabled,
      "video-helper-enabled": videoHelperEnabled,
    };
    const backgrounds = {
      colorful: "colorful", gradient: "gradient-background", blurGradient: "blur-gradient-background",
      solid: "solid-background", video: "video-background",
    };
    for (const [value, key] of Object.entries(backgrounds)) values[key] = themeSettings.background === value;
    for (const [key, value] of Object.entries(values)) {
      StorageManager.saveConfig(key, value);
      CONFIG.visual[key] = value;
    }
    StorageManager.setItem("ivLyrics:overlay-enabled", String(overlayEnabled));
    if (changedUiTheme.current) StorageManager.setItem("ivLyrics:settings-ui-theme", uiTheme);
    // Commit the completion marker last; leaving a page or closing never skips first-run setup.
    StorageManager.setItem(SETUP_STORAGE_KEY, "true");
    onComplete?.(openSettings);
    setTimeout(() => location.reload(), 100);
  };
  const title = (key) => react.createElement("h2", { tabIndex: -1 }, I18n.t(key));
  const languageField = (key, value, onChange, includeAuto = false) =>
    react.createElement("label", { className: "wizard-field" },
      react.createElement("span", null, I18n.t(key)),
      react.createElement("select", { value,
        onFocus: () => setLanguageInteracted(true), onPointerDown: () => setLanguageInteracted(true),
        onChange: (event) => onChange(event.target.value) },
        includeAuto && react.createElement("option", { value: "auto" }, I18n.t("settings.translationTargetLanguage.options.auto")),
        languages.map((language) => react.createElement("option", { key: language.code, value: language.code }, language.name))));

  const languagePage = () => react.createElement("section", { className: "wizard-page" },
    title("setupWizard.language.title"),
    react.createElement("div", { className: "wizard-card" },
      languageField("settings.language.label", selectedLanguage, changeLanguage),
      languageField("settings.translationTargetLanguage.label", outputLanguage, setOutputLanguage, true)),
    react.createElement("div", { className: "wizard-preview", "aria-hidden": true },
      react.createElement("strong", null, SETTINGS_LYRICS_PREVIEW_TEXT),
      react.createElement("span", null, I18n.t("settingsAdvanced.livePreview.sampleTextPhonetic")),
      react.createElement("span", null, I18n.t("settingsAdvanced.livePreview.sampleText"))),
    react.createElement("p", { className: "wizard-note" }, I18n.t("setupWizard.quick.languageHint")));

  const appearancePage = () => {
    const selectedBackgroundLabel = getWizardBackgroundLabel(themeSettings.background);
    return react.createElement("section", { className: "wizard-page" },
      title("setupWizard.theme.subtitle"),
      react.createElement("div", { className: "wizard-display-layout" },
        react.createElement("div", {
          className: "wizard-scene", "data-mode": themeSettings.background, "aria-hidden": true,
          style: { textAlign: themeSettings.alignment },
        },
          react.createElement("p", null, selectedBackgroundLabel),
          react.createElement("strong", null, I18n.t("settingsAdvanced.livePreview.sampleText")),
          react.createElement("span", null, "ivLyrics")),
        react.createElement("div", { className: "wizard-display-controls" },
          react.createElement("span", { className: "wizard-label", id: "wizard-alignment-label" }, I18n.t("setupWizard.theme.alignment")),
          react.createElement("div", { className: "wizard-options", role: "radiogroup", "aria-labelledby": "wizard-alignment-label" },
            ["left", "center", "right"].map((alignment, index) => react.createElement("button", {
              key: alignment, type: "button", className: "wizard-option", role: "radio",
              "aria-checked": themeSettings.alignment === alignment,
              tabIndex: themeSettings.alignment === alignment ? 0 : -1,
              onKeyDown: (event) => handleSettingsRadioKeys(event, ["left", "center", "right"].map((value) => ({ value })), index, (value) => changeAppearance("alignment", value)),
              onClick: () => changeAppearance("alignment", alignment),
            }, wizardSvg("align" + alignment[0].toUpperCase() + alignment.slice(1), 16),
            I18n.t("settings.alignment.options." + alignment)))),
          react.createElement("span", { className: "wizard-label", id: "wizard-background-label" }, I18n.t("setupWizard.theme.background")),
          react.createElement("div", { className: "wizard-options wizard-backgrounds", role: "radiogroup", "aria-labelledby": "wizard-background-label" },
            wizardBackgroundOptions.map(([background], index) => react.createElement("button", {
              key: background, type: "button", className: "wizard-option", role: "radio",
              "aria-checked": themeSettings.background === background,
              tabIndex: themeSettings.background === background ? 0 : -1,
              onKeyDown: (event) => handleSettingsRadioKeys(event, wizardBackgroundOptions.map(([value]) => ({ value })), index, (value) => changeAppearance("background", value)),
              onClick: () => changeAppearance("background", background),
            }, react.createElement("span", { className: "wizard-swatch wizard-scene", "data-mode": background, "aria-hidden": true, style: { minHeight: 26, padding: 0 } }),
            getWizardBackgroundLabel(background)))))),
      themeSettings.background === "video" && react.createElement(WizardButton, {
        variant: "ghost", "aria-expanded": !!videoCheck, "aria-controls": "wizard-video-check",
        onClick: () => setVideoCheck(videoCheck ? null : "video"),
      }, I18n.t("setupWizard.videoTest.title")),
      videoCheck && react.createElement("div", { className: "wizard-diagnostic", id: "wizard-video-check" },
        videoCheck === "helper"
          ? react.createElement(VideoHelperTestStep, {
              onNext: () => setVideoCheck(null), onBack: () => setVideoCheck("video"), onSkip: () => setVideoCheck(null),
              helperEnabled: videoHelperEnabled, onHelperChange: setVideoHelperEnabled,
            })
          : react.createElement(VideoTestStep, {
              onNext: () => setVideoCheck(null), onBack: () => setVideoCheck(null), onSkip: () => setVideoCheck(null),
              onNeedHelper: () => setVideoCheck("helper"),
            })));
  };
  const playbackPage = () => react.createElement("section", { className: "wizard-page" },
    title("setupWizard.complete.title"),
    react.createElement("p", { className: "wizard-note" }, I18n.t("setupWizard.complete.subtitle")),
    react.createElement("div", { className: "wizard-card" },
      react.createElement(WizardToggleRow, { icon: "panel", title: I18n.t("setupWizard.nowPlayingTip.enabled"),
        description: I18n.t("setupWizard.nowPlayingTip.subtitle"), enabled: nowPlayingEnabled,
        onToggle: () => setNowPlayingEnabled((value) => !value) }),
      react.createElement(WizardToggleRow, { icon: "overlay", title: I18n.t("setupWizard.overlayTip.title"),
        description: I18n.t("setupWizard.overlayTip.requiresApp"), enabled: overlayEnabled,
        onToggle: () => setOverlayEnabled((value) => !value) }),
      react.createElement(WizardToggleRow, { icon: "mic", title: I18n.t("setupWizard.pseudoKaraokeTip.title"),
        description: I18n.t("setupWizard.pseudoKaraokeTip.subtitle"), enabled: pseudoKaraokeEnabled,
        onToggle: () => setPseudoKaraokeEnabled((value) => !value) })),
    overlayEnabled && react.createElement(WizardButton, {
      variant: "ghost", onClick: () => window.open(window.OverlaySender?.getDownloadUrl?.() || "https://ivlis.kr/ivLyrics/extensions/#overlay", "_blank", "noopener,noreferrer"),
    }, I18n.t("setupWizard.overlayTip.downloadApp")));

  return react.createElement("div", { className: "setup-wizard-container" },
    react.createElement("header", { className: "wizard-topbar" },
      react.createElement("span", { className: "wizard-brand" }, wizardSvg("lyrics"), "ivLyrics"),
      react.createElement("div", { className: "wizard-top-actions" },
        react.createElement("div", { className: "wizard-theme", role: "group", "aria-label": I18n.t("settingsUi.theme.selector") },
          ["light", "dark"].map((theme) => react.createElement("button", {
            key: theme, type: "button", className: "wizard-icon-button", "aria-pressed": uiTheme === theme,
            title: I18n.t("settingsUi.theme." + theme), "aria-label": I18n.t("settingsUi.theme." + theme),
            onClick: () => changeTheme(theme),
          }, wizardSvg(theme === "light" ? "sun" : "moon", 18)))),
        react.createElement("button", { type: "button", className: "wizard-icon-button", onClick: onDismiss,
          title: I18n.t("buttons.close"), "aria-label": I18n.t("buttons.close") }, wizardSvg("close", 20)))),
    react.createElement("div", { className: "wizard-intro", "data-welcome-language": currentStep === 0 ? welcomeLanguage : undefined },
      currentStep === 0
        ? react.createElement(WizardWelcomeText, { tag: "h1", field: "greeting", language: welcomeLanguage,
            id: "ivlyrics-setup-title", "aria-label": I18n.t("setupWizard.language.title") })
        : react.createElement("h1", { id: "ivlyrics-setup-title" }, I18n.t("setupWizard.quick.title")),
      currentStep === 0 && !languageInteracted
        ? react.createElement(WizardWelcomeText, { tag: "p", field: "instruction", language: welcomeLanguage,
            id: "ivlyrics-setup-description", "aria-label": I18n.t("setupWizard.quick.subtitle") })
        : react.createElement("p", { id: "ivlyrics-setup-description" }, I18n.t("setupWizard.quick.subtitle"))),
    react.createElement("ol", { className: "wizard-progress", "aria-label": I18n.t("setupWizard.quick.title") },
      steps.map((step, index) => react.createElement("li", { key: step, className: index < currentStep ? "is-done" : "" },
        react.createElement("button", { type: "button", onClick: () => setCurrentStep(index),
          "aria-current": currentStep === index ? "step" : undefined },
          react.createElement("span", { className: "wizard-step-number", "aria-hidden": true }, index < currentStep ? "✓" : "0" + (index + 1)),
          I18n.t("setupWizard.quick." + step))))),
    react.createElement("main", { className: "wizard-pages", ref: pageRef, key: currentStep },
      [languagePage, appearancePage, playbackPage][currentStep]()),
    react.createElement("footer", { className: "wizard-footer" },
      react.createElement(WizardButton, { variant: "ghost", onClick: currentStep ? () => setCurrentStep(currentStep - 1) : onDismiss },
        I18n.t(currentStep ? "setupWizard.navigation.back" : "setupWizard.apiKey.skip")),
      react.createElement("div", { className: "wizard-footer-actions" },
        currentStep === 2 && react.createElement(WizardButton, { onClick: () => complete(true) }, I18n.t("setupWizard.complete.openSettings")),
        react.createElement(WizardButton, { variant: "primary", onClick: () => currentStep < 2 ? setCurrentStep(currentStep + 1) : complete() },
          I18n.t(currentStep === 2 ? "setupWizard.complete.startNow" : "setupWizard.navigation.next")))));
};

function openSetupWizard() {
  if (document.getElementById("ivLyrics-setup-wizard-overlay")) return;
  const dom = window.ivLyricsEnsureReactDOM?.()
    || (typeof reactDOM !== "undefined" ? reactDOM : window.Spicetify?.ReactDOM ?? window.ReactDOM);
  if (!dom?.render) return;
  ensureSetupWizardStyles();
  const previousLanguage = I18n.getCurrentLanguage();
  let completed = false;
  let host;
  host = createFluentModalHost({
    overlayId: "ivLyrics-setup-wizard-overlay", shellClassName: "ivlyrics-setup-shell",
    closeOnBackdrop: false,
    onBeforeClose: () => {
      dom.unmountComponentAtNode?.(host.shell);
      if (!completed) I18n.setLanguage(previousLanguage);
    },
  });
  host.shell.setAttribute("aria-labelledby", "ivlyrics-setup-title");
  host.shell.setAttribute("aria-describedby", "ivlyrics-setup-description");
  const complete = (openSettings) => {
    completed = true;
    if (openSettings) localStorage.setItem("ivLyrics:return-to-settings", "true");
    host.closeModal(true);
  };
  dom.render(react.createElement(SetupWizard, {
    onComplete: complete, onDismiss: () => host.closeModal(),
    onThemeChange: (theme) => { host.overlay.dataset.uiTheme = theme; host.shell.dataset.uiTheme = theme; },
  }), host.shell);
}
function isSetupNeeded() {
  return !StorageManager.getItem(SETUP_STORAGE_KEY);
}
