# LadderLens

Visualize and troubleshoot SIP call flows from Ribbon SBC diagnostic exports.

LadderLens is a browser-based tool that parses Ribbon SBC Edge WebUI diagnostic logs, correlates ingress and egress call legs, and renders interactive call ladder diagrams. It targets support engineers investigating calls traversing Microsoft Teams, Ribbon SBCs, Cisco CUCM, and PSTN carriers.

**Try it now: [https://matthewmgamble.github.io/LadderLens/](https://matthewmgamble.github.io/LadderLens/)**

All processing happens locally in your browser — no server, no uploads, no data collection.

## Features

- **Interactive call ladders** — SVG call flow diagrams with color-coded arrows (green for 2xx, yellow for 1xx, red for 4xx/5xx/6xx). Click any message to inspect headers, SDP, and raw log lines.
- **Automatic leg correlation** — Correlates ingress (InviteServer) and egress (InviteClient) legs by CID across signaling groups.
- **Automated troubleshooting** — Flags error responses, timeouts, retransmissions, codec mismatches, and number rewrites with contextual explanations.
- **SMM diff view** — Compare Before-SMM and After-SMM versions of SIP messages to see exactly what the SBC's manipulation rules changed.
- **Export** — Download call ladders as SVG, PNG, standalone HTML reports, JSON data, or Markdown summaries. Built-in redaction strips sensitive fields before sharing.
- **Streaming parser** — Handles files up to 200MB via Web Worker with progress reporting. UI stays responsive during import.

## Supported Formats

- Ribbon SBC SWe **11.x** WebUI diagnostic exports
- Ribbon SBC SWe **13.x** WebUI diagnostic exports

## Getting Started

```bash
npm install
npm run dev
```

Open the local URL shown in your terminal, then drag and drop a Ribbon SBC diagnostic log file onto the page.

## Building for Production

```bash
npm run build
```

Output is in `dist/` — a static site you can host anywhere (GitHub Pages, S3, any web server). No backend required.

## Running Tests

```bash
npm test
```

## How It Works

1. **Parse** — Log lines are tokenized and SIP messages are extracted, including reassembly of multi-part MSGID blocks (v13) and classification of SMM copies.
2. **Correlate** — Messages are grouped into calls by CID. Within each call, messages are split into ingress and egress legs by session type and signaling group.
3. **Analyze** — A rule engine evaluates each call for error responses, timeouts, retransmissions, codec mismatches, and number transformations.
4. **Render** — An SVG call ladder is drawn with participant lifelines and message arrows. Selecting a message opens a detail inspector with headers, SDP, and raw log context.

## License

MIT

## Author

[Matthew Gamble](https://mgamble.ca)
