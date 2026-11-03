# pisim

Scenario player for the Pi production ecosystem. It replays timed requests against the **real** services (picomposer, pigateway, pimatrix, ...) so you can test them, including the generative UI, without hardware. The services do not know they are being simulated: they receive ordinary requests, and there is no sim mode or sim flag inside any of them.

Zero dependencies, Node >= 20, ESM.

```bash
# start picomposer locally (npm run dev), then:
node bin/pisim.mjs run scenarios/normal-service.jsonl --out pisim-out
```

Steps with `save` write the response (for example the rendered `/gui/1` page) to `--out`, so each scenario leaves a series of screen snapshots to open in a browser. `--no-timing` ignores `at` and runs the steps back to back.

## Scenario format (JSONL)

```
{"at":3000,"label":"Director advises","target":"picomposer","path":"/api/v1/ingest/event","body":{"type":"advisory","data":{"id":"a1","cutToInput":2}}}
{"at":3100,"target":"picomposer","path":"/gui/1","save":"after-advisory.html"}
```

`at` is ms from start. `method` defaults to POST with a body, else GET. `headers` is optional. `#` lines and blanks are ignored.

## Targets and safety

Targets default to the ecosystem's local ports and can be overridden with `PISIM_TARGET_<NAME>=http://host:port`. A target that is not localhost is refused unless you pass `--allow-remote`, so a scenario cannot act on the real Pi by accident. Exit code 2 means a step failed or answered 4xx/5xx.

## Samples

`scenarios/`: `normal-service`, `operator-takes-over`, `failures` (picomposer ingest events and prompts).

## Fake liturgos-auditor (VTT replay)

```bash
node bin/pisim.mjs auditor samples/demo.vtt --port 8090 --speed 1 [--loop] [--lang fi] [--api-key k]
```

Speaks the auditor's live-session API (`POST /v1/live`, `GET /v1/live/{id}`, `/events` SSE with `Last-Event-ID`, `DELETE`, `/status`, `/health`) and replays the cues of a VTT/SRT file as `transcript` events at their times (`sequence`, `text`, `language`, `start`, `end`, `wall_start`, `wall_end`, `delay_seconds`), then ends the session (`--loop` repeats). `delivery.mode=push` is honoured for local receivers only. Nothing is transcribed and the `source` URL is ignored.

Point the real services at it: pivoice `auditor.url=http://127.0.0.1:8090` (pull mode), pigateway `PIGATEWAY_AUDITOR_URL=http://127.0.0.1:8090`. pivoice's own client was checked against it (three cues received); the chain through pigateway and picomposer was not run end to end. pivoice telemetry (speech/music classification) is not simulated, so activity-triggered sessions still need a session opened by hand.

## Not built yet

A `pisim up` that starts the whole stack in simulation. pigateway simulates its own devices (ATEM, matrix, encoder, cameras) in `PIGATEWAY_MODE=simulation`, so pisim does not fake it. Unverified against the real Pi.
