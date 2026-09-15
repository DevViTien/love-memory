# Template workspace

Each template is an independent workspace under `templates/<template-id>` and must provide:

```text
template.manifest.json
dist/build-metrics.json
```

`template.manifest.json` follows `@love-memory/template-sdk`. The build must measure and write these
gzip/runtime metrics after producing the artifact:

```json
{
  "initialJsKbGzip": 100,
  "initialMediaKb": 500,
  "maxTextureMb": 32
}
```

The root Vitest suite discovers every template directory, validates its manifest and fails CI when
the measured artifact exceeds any declared budget. A published template artifact is immutable.
