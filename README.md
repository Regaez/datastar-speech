# datastar-speech

A custom [Datastar](https://data-star.dev) action plugin that leverages the [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) in order to generate text-to-speech output.

[Live demo](https://threadgold.nz/demos/datastar-speech)

```html
<button data-on:click="@speech('hello world')">
  Listen
</button>
```

## Getting started

The plugin expects you to provide an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap) that specifies the location of the `datastar` module, then it's a simple matter of including a `<script type="module">` element for the plugin. For example:

```html
<script type="importmap">
  {
    "imports": {
      "datastar": "https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.6/bundles/datastar.js"
    }
  }
</script>
<script type="module" src="https://cdn.jsdelivr.net/gh/regaez/datastar-speech@main/datastar-speech.min.js"></script>
```

## Why use this plugin?

The [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) is generally quite clunky to use. Considering its imperative nature, asynchronous callback functions, poor queue management support, and user-agent inconsistencies; it is not particularly suited for use within the context of HTML attributes / [Datastar expressions](https://data-star.dev/guide/datastar_expressions), where one ideally wants to write concise, functional code.

The plugin attempts to smooth over some of the rough edges, simplify its use and expose the capabilities of the Web Speech API via a declarative API, enabling you to harness text-to-speech functionality more easily with Datastar.

## Documentation

The section below is a summary of the plugin's API, but it is best to [view the live demo examples and documentation page](https://threadgold.nz/demos/datastar-speech), as it is more comprehensive and the interactive nature of the examples will likely help you to better understand the behaviour of the plugin.

### Actions

The plugin adds two new actions that must be used within a [Datastar expression](https://data-star.dev/guide/datastar_expressions):

- `@speech`
- `@speechCtrl`

#### Action `@speech`

This action is the primary means to start speech, and the only way you can enqueue text, in order for it to be spoken by the Web Speech API. By default, playback will start immediately if the queue is empty or all existing items in the queue have already finished playing.

```ts
@speech(input: string|number|boolean|HTMLElement, opts?: SpeechOptions)

type SpeechOptions = {
  queue?: "append" | "immediate" | "next" | "replace"; // default "append"
  lang?: string;
  voice?: "prefer-lang" | string;
}
```
The `input` param is mandatory and must be one of type `string`, `number`, `boolean`, `HTMLElement`. The input text length [cannot exceed 32767 characters](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/text#value) (this is a limitation of the Web Speech API).

#### Action `@speechCtrl`

This action enables you to control playback, and the primary means to adjust the playback options of the `SpeechSynthesisUtterance`.

When invoked, it will automatically apply the new configuration to the existing utterance, and any future utterances. If an utterance is currently being played, it will trigger the utterance to restart immediately with the new settings; the Web Speech API does not expose the capability to change these properties on-the-fly.

```ts
@speechCtrl(command: Command, opts?: SpeechCtrlOptions)

type Command = "play" | "pause" | "reset" | "next" | "previous" | "remove" | "configure";

type SpeechCtrlOptions = {
  // Only relevant for the `play` and `remove` commands:
  index?: number;
  // The following properties are only relevant for the `configure` command:
  rate?: number;
  pitch?: number;
  volume?: number;
  voice?: string;
}
```

### Custom Events

The plugin will emit the following events in order to be able to notify you of any internal state changes within the plugin/Web Speech API:

- `datastar-speech-status`
- `datastar-speech-voices-loaded`

You can hook onto these using the standard `data-on` attribute and, if you wish, store any relevant details into your own signals to enable your UI to react to them accordingly.

#### Event `datastar-speech-status`

This custom event is dispatched on the `window` once the plugin has initialised and each time the queue, or playback state of any queued speech, has changed.

##### Properties

The following fields can be found within the `evt.detail` object:

- `isPlaying`: boolean; indicates whether an utterance is currently being played.
- `canPlay`: boolean; indicates whether it is possible to start/resume playback, i.e. an utterance is currently paused, or there is at least one utterance remaining in the queue.
- `canPause`: boolean; indicates whether it is possible to pause an utterance, i.e. an utterance is currently playing.
- `canReset`: boolean; indicates whether it is possible to stop playback and clear the utterance queue.
- `hasNext`: boolean; indicates whether there is an item in the queue after the utterance currently being played.
- `hasPrevious`: boolean; indicates whether there is an item in the queue before the utterance currently being played.
- `queue`: string[]; a list containing the text of all utterances that have been queued to play. This also includes previously-ended utterances, unless the queue has since been replaced or reset.
- `index`: number; the position within the playback queue, i.e. which utterance is currently being played, or was last played.

#### Event `datastar-speech-voices-loaded`

This custom event is dispatched on the window when the plugin has detected that the Web Speech API has finished loading the `SpeechSynthesisVoice` list.

##### Properties

Within the `evt` object:

- `detail` SpeechSynthesisVoice[]; the list of voices that are available for this user agent. Please [refer to this documentation](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice) for more information.

## License

MIT
