import { action } from "datastar";

// API
// Events
const EVENT_STATUS = "datastar-speech-status";
const EVENT_VOICES_LOADED = "datastar-speech-voices-loaded";

// Params
const VOICE_LANG = "prefer-lang";
const QUEUE_REPLACE = "replace";
const QUEUE_IMMEDIATE = "immediate";
const QUEUE_NEXT = "next";
const QUEUE_APPEND = "append;";

// Internal magic numbers
const PAUSE_DURATION = 500; // "pause for breath" between two queue items
const PAUSE_TIMEOUT = 33; // TTL for pause capability detection
const STATUS_TIMEOUT = 8; // debounce rate for status updates

const synth = window.speechSynthesis;

const clamp = (value, min, max) => {
  return Math.max(min, Math.min(max, value));
};

const debounce = (fn, duration) => {
  let timer = 0;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn(...args);
      timer = 0;
    }, duration);
  };
};

function parseQueueBehaviour(input) {
  switch (input) {
    case QUEUE_REPLACE:
    case QUEUE_IMMEDIATE:
    case QUEUE_NEXT:
      return input;
    default:
      return QUEUE_APPEND;
  }
}

// Voices are loaded asynchronously, and we require them before we try to speak,
// or else no sound may play.
const loadVoices = new Promise((resolve) => {
  let voices = synth.getVoices();

  const onLoad = (v) =>
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent(EVENT_VOICES_LOADED, { detail: v }));
      resolve(v);
    }, 0);

  if (voices.length === 0) {
    synth.onvoiceschanged = () => {
      onLoad(synth.getVoices());
    };
  } else {
    onLoad(voices);
  }
});

class SpeechController {
  // Internal state
  #queue = [];
  #index = 0;
  #isQueued = false;
  #isPlaying = false;
  #isPaused = false;
  #autoplayTimeout;
  #pauseTimeout;
  #hasPauseCapability;
  // Configurable state
  #pitch = 1;
  #rate = 1;
  #volume = 1;
  #voice = null;
  #status = debounce(this.#dispatch.bind(this), STATUS_TIMEOUT);

  constructor() {
    // Speech synthesis may have been paused prior to this page
    // loading, which can cause issues with playback, thus we
    // forceably cancel any previous speech synthesis state.
    synth.cancel();

    // Emit to initialise signals hooked onto the status event
    this.#status();
  }

  #hasNext() {
    return this.#index < this.#queue.length - 1;
  }

  #hasPrevious() {
    return this.#index > 0;
  }

  #onUtterancePlay() {
    this.#isPlaying = true;
    this.#isQueued = false;
    this.#isPaused = false;
    this.#status();
  }

  #onUtterancePause(hasPauseCapability = true) {
    this.#hasPauseCapability = hasPauseCapability;
    this.#isPaused = true;
    this.#isPlaying = false;
    clearTimeout(this.#pauseTimeout);
    this.#status();
  }

  #onUtteranceEnd() {
    this.#isPlaying = false;

    if (!this.#isPaused && !this.#isQueued && this.#hasNext()) {
      // We wait before triggering the next item to play
      // in order to give the text-to-speech playback a
      // "natural-feeling pause" between items.
      this.#autoplayTimeout = setTimeout(() => {
        this.#autoplayTimeout = undefined;
        this.next();
      }, PAUSE_DURATION);
    }

    this.#status();
  }

  #dispatch() {
    window.dispatchEvent(
      new CustomEvent(EVENT_STATUS, {
        detail: {
          isPlaying: this.#isPlaying,
          canPlay: this.#queue.length > 0 && !this.#isPlaying,
          canPause: this.#isPlaying,
          canReset: this.#queue.length > 0,
          hasNext: this.#hasNext(),
          hasPrevious: this.#hasPrevious(),
          queue: this.#queue.map((u) => u.text),
          index: this.#index,
        },
      }),
    );
  }

  add(text, { queue, ...opts }) {
    let item = { text, opts };
    switch (queue) {
      case QUEUE_REPLACE:
        this.#queue = [item];
        this.#index = 0;
        break;
      case QUEUE_IMMEDIATE:
        this.#queue = [
          ...this.#queue.slice(0, this.#index),
          item,
          ...this.#queue.slice(this.#index),
        ];
        break;
      case QUEUE_NEXT:
        this.#index < this.#queue.length - 1
          ? (this.#queue = [
              ...this.#queue.slice(0, this.#index + 1),
              item,
              ...this.#queue.slice(this.#index + 1),
            ])
          : this.#queue.push(item);
        break;
      case QUEUE_APPEND:
        this.#queue.push(item);
        break;
    }

    if ([QUEUE_IMMEDIATE, QUEUE_REPLACE].includes(queue)) {
      this.#play(true);
    } else {
      if (!this.#isQueued && !this.#isPlaying) {
        this.#queue.length < 2 ? this.#play() : this.next();
      }
    }

    this.#status();
  }

  #play(forceChange = false) {
    if (!this.#queue.length) {
      return;
    }

    let {
      text,
      opts: { lang, voice },
    } = this.#queue[this.#index];

    let u = new SpeechSynthesisUtterance(text);
    u.pitch = this.#pitch;
    u.rate = this.#rate;
    u.volume = this.#volume;
    u.voice =
      voice === VOICE_LANG ? (lang ? null : this.#voice) : voice || this.#voice;
    u.lang =
      lang || document.documentElement.lang || navigator.language || null;

    u.onstart = this.#onUtterancePlay.bind(this);
    u.onresume = this.#onUtterancePlay.bind(this);
    u.onpause = () => this.#onUtterancePause();
    u.onend = this.#onUtteranceEnd.bind(this);
    u.onerror = this.#onUtteranceEnd.bind(this);

    this.#isQueued = true;
    const start = () => synth.speak(u);

    if (forceChange) {
      this.#autoplayTimeout && clearTimeout(this.#autoplayTimeout);
      synth.cancel();
      loadVoices.then(start);
    } else if (!this.#isPlaying && this.#queue.length) {
      if (synth.paused && synth.speaking) {
        synth.resume();
      } else {
        loadVoices.then(start);
      }
    }
  }

  #stop() {
    this.#isPlaying = false;
    synth.cancel();
    this.#status();
  }

  configure({ pitch, rate, volume, voice } = {}) {
    if (typeof pitch === "number") {
      this.#pitch = clamp(pitch, 0, 2);
    }

    if (typeof rate === "number") {
      this.#rate = clamp(rate, 0.1, 10);
    }

    if (typeof volume === "number") {
      this.#volume = clamp(volume, 0, 1);
    }

    if (typeof voice === "string") {
      loadVoices.then((voices) => {
        this.#voice = voices.find((v) => v.name === voice) ?? null;
        this.#isPlaying && this.#play(true);
      });
    } else {
      this.#isPlaying && this.#play(true);
    }
  }

  next() {
    if (this.#hasNext()) {
      this.#index++;
      this.#play(true);
    }
  }

  pause() {
    if (!this.#isPlaying) return;

    // Some browsers, like Firefox on Android, don't support pausing
    // so we need to check if pause actually happens after first attempt
    if (typeof this.#hasPauseCapability === "undefined") {
      // The timeout will be cancelled by the utterance if it responds to the pause event
      this.#pauseTimeout = setTimeout(() => {
        this.#onUtterancePause(false);
        synth.cancel();
      }, PAUSE_TIMEOUT);
    }

    if (this.#hasPauseCapability === false) {
      this.#onUtterancePause(false);
      synth.cancel();
    } else {
      synth.pause();
    }

    this.#status();
  }

  play({ index } = {}) {
    if (typeof index !== "number" || index >= this.#queue.length) {
      this.#play();
      return;
    }

    this.#index = index;
    this.#play(true);
  }

  previous() {
    if (this.#hasPrevious()) {
      this.#index--;
      this.#play(true);
    }
  }

  remove({ index } = {}) {
    if (typeof index !== "number" || index >= this.#queue.length) return;
    this.#queue.splice(index, 1);

    if (index < this.#index) {
      this.#index--;
    } else if (this.#index === index) {
      if (index > 0 && index >= this.#queue.length) {
        this.#index--;
      }
      if (index < this.#queue.length) {
        this.#play(true);
      } else {
        this.#stop();
      }
    }

    this.#status();
  }

  reset() {
    this.#isPlaying = false;
    this.#index = 0;
    this.#queue = [];
    synth.cancel();
    this.#status();
  }
}

action({
  name: "speech",
  apply: ({ error }, input, opts = {}) => {
    if (typeof synth === "undefined") {
      throw error("SpeechSynthesisUnsupported");
    }

    let text = "";

    if (typeof input === "string") {
      text = input;
    } else if (typeof input === "boolean") {
      text = String(input);
    } else if (typeof input === "number") {
      text = input.toLocaleString(navigator.languages);
    } else if (input instanceof HTMLElement) {
      // An HTML element may contain multiple child nodes with text content. This content
      // tends to be separated by newlines, which are ignored by many speech synthesis voices,
      // resulting in a strange reading rhythym; replacing these with periods seems to
      // create a more natural reading flow.
      text = input.innerText.replaceAll("\n", ". ");
    } else {
      throw error("InvalidInputType");
    }

    text = text.trim();

    if (text.length > 32767) {
      throw error("MaxInputLengthExceeded");
    }

    if (typeof opts.lang !== "undefined" && typeof opts.lang !== "string") {
      throw error("InvalidLangType");
    }

    loadVoices.then((voices) => {
      let voice =
        opts.voice === VOICE_LANG
          ? VOICE_LANG
          : voices.find((v) => v.name === opts.voice);

      SPEECH_CONTROLLER.add(text, {
        queue: parseQueueBehaviour(opts?.queue),
        lang: opts.lang,
        voice,
      });
    });
  },
});

action({
  name: "speechCtrl",
  apply: ({ error }, action, opts = {}) => {
    if (typeof opts !== "object") {
      throw error("InvalidOptionsType");
    }

    switch (action) {
      case "configure":
      case "next":
      case "pause":
      case "play":
      case "previous":
      case "remove":
      case "reset":
        SPEECH_CONTROLLER[action](opts);
        return;
      default:
        throw error("InvalidAction");
    }
  },
});

// As the status event is emitted in the constructor, we initialise
// this _after_ declaring the Datastar actions in order to avoid
// any `data-on` handlers running before the actions exist
const SPEECH_CONTROLLER = new SpeechController();
