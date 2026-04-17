// One-off ticket state-transition visualizer. Run with: npx tsx src/viz.ts
// Serves a single HTML page on port 4444.

import { createServer } from 'http'

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Foundry — Ticket State Machine</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0a; color: #d4d4d8; font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace; font-size: 13px; padding: 24px; line-height: 1.5; }
  h1 { font-size: 16px; color: #fafafa; margin-bottom: 4px; font-weight: 600; }
  .subtitle { color: #71717a; margin-bottom: 24px; }
  .legend { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 24px; }
  .legend-item { display: flex; align-items: center; gap: 6px; }
  .legend-dot { width: 10px; height: 10px; border-radius: 2px; }
  .graph { position: relative; width: 100%; max-width: 1000px; margin: 0 auto; }

  svg { width: 100%; height: auto; }
  .state { cursor: default; }
  .state rect { rx: 6; ry: 6; stroke-width: 1.5; }
  .state text { font-family: inherit; font-size: 12px; fill: #fafafa; font-weight: 600; }
  .state-label { font-size: 10px !important; fill: #a1a1aa !important; font-weight: 400 !important; }

  .edge line, .edge path { stroke-width: 1.2; fill: none; }
  .edge polygon { stroke-width: 0; }
  .edge-label { font-family: inherit; font-size: 9.5px; }

  /* trigger colors */
  .t-founder line, .t-founder path { stroke: #60a5fa; }
  .t-founder polygon { fill: #60a5fa; }
  .t-founder .edge-label { fill: #93bbfc; }

  .t-system line, .t-system path { stroke: #a78bfa; }
  .t-system polygon { fill: #a78bfa; }
  .t-system .edge-label { fill: #c4b5fd; }

  .t-agent line, .t-agent path { stroke: #34d399; }
  .t-agent polygon { fill: #34d399; }
  .t-agent .edge-label { fill: #6ee7b7; }

  .t-runtime line, .t-runtime path { stroke: #fbbf24; }
  .t-runtime polygon { fill: #fbbf24; }
  .t-runtime .edge-label { fill: #fcd34d; }

  .t-questionable line, .t-questionable path { stroke: #f87171; stroke-dasharray: 4 3; }
  .t-questionable polygon { fill: #f87171; }
  .t-questionable .edge-label { fill: #fca5a5; }

  .t-proposed line, .t-proposed path { stroke: #818cf8; stroke-dasharray: 6 3; }
  .t-proposed polygon { fill: #818cf8; }
  .t-proposed .edge-label { fill: #a5b4fc; }

  .section { margin-top: 32px; max-width: 1000px; margin-left: auto; margin-right: auto; }
  .section h2 { font-size: 14px; color: #fafafa; margin-bottom: 12px; border-bottom: 1px solid #27272a; padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; color: #71717a; font-weight: 500; padding: 6px 10px; border-bottom: 1px solid #27272a; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 6px 10px; border-bottom: 1px solid #18181b; vertical-align: top; }
  .tag { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 500; }
  .tag-founder { background: #1e3a5f; color: #60a5fa; }
  .tag-system { background: #2e1065; color: #a78bfa; }
  .tag-agent { background: #064e3b; color: #34d399; }
  .tag-runtime { background: #451a03; color: #fbbf24; }
  .tag-guard { background: #18181b; color: #f87171; border: 1px solid #991b1b; }
  .tag-questionable { background: #1c1917; color: #f87171; border: 1px solid #7f1d1d; }
  .tag-proposed { background: #1e1b4b; color: #818cf8; border: 1px solid #4338ca; }
  .gap { color: #f87171; }
  .ok { color: #34d399; }
  .warn { color: #fbbf24; }
  .note { color: #71717a; font-size: 11px; }
</style>
</head>
<body>

<h1>Foundry Ticket State Machine</h1>
<p class="subtitle">Current transitions, guards, gaps, and proposals</p>

<div class="legend">
  <div class="legend-item"><div class="legend-dot" style="background:#60a5fa"></div> Founder (UI)</div>
  <div class="legend-item"><div class="legend-dot" style="background:#34d399"></div> Agent (MCP)</div>
  <div class="legend-item"><div class="legend-dot" style="background:#a78bfa"></div> System (scheduler)</div>
  <div class="legend-item"><div class="legend-dot" style="background:#fbbf24"></div> Runtime (orchestrator)</div>
  <div class="legend-item"><div class="legend-dot" style="background:#f87171; opacity:0.7"></div> Questionable</div>
  <div class="legend-item"><div class="legend-dot" style="background:#818cf8; opacity:0.7"></div> Proposed</div>
</div>

<div class="graph">
<svg viewBox="0 0 960 520" xmlns="http://www.w3.org/2000/svg">

  <!-- States -->
  <g class="state" transform="translate(80,200)">
    <rect x="0" y="0" width="140" height="56" fill="#18181b" stroke="#3f3f46"/>
    <text x="70" y="28" text-anchor="middle" dominant-baseline="central">opened</text>
    <text class="state-label" x="70" y="44" text-anchor="middle">editable, dispatchable</text>
  </g>

  <g class="state" transform="translate(400,200)">
    <rect x="0" y="0" width="140" height="56" fill="#18181b" stroke="#3f3f46"/>
    <text x="70" y="28" text-anchor="middle" dominant-baseline="central">claimed</text>
    <text class="state-label" x="70" y="44" text-anchor="middle">agent working</text>
  </g>

  <g class="state" transform="translate(720,80)">
    <rect x="0" y="0" width="160" height="56" fill="#14532d" stroke="#166534"/>
    <text x="80" y="28" text-anchor="middle" dominant-baseline="central">resolved / finished</text>
    <text class="state-label" x="80" y="44" text-anchor="middle">verified, immutable</text>
  </g>

  <g class="state" transform="translate(720,200)">
    <rect x="0" y="0" width="160" height="56" fill="#451a03" stroke="#92400e"/>
    <text x="80" y="28" text-anchor="middle" dominant-baseline="central">resolved / failed</text>
    <text class="state-label" x="80" y="44" text-anchor="middle">reopenable</text>
  </g>

  <g class="state" transform="translate(720,320)">
    <rect x="0" y="0" width="160" height="56" fill="#1c1917" stroke="#44403c"/>
    <text x="80" y="28" text-anchor="middle" dominant-baseline="central">resolved / cancelled</text>
    <text class="state-label" x="80" y="44" text-anchor="middle">reopenable (no pass)</text>
  </g>

  <!-- CREATE → opened -->
  <g class="edge t-founder">
    <line x1="40" y1="228" x2="78" y2="228"/>
    <polygon points="78,224 86,228 78,232"/>
    <text class="edge-label" x="20" y="222">create</text>
  </g>

  <!-- opened → claimed (scheduler) -->
  <g class="edge t-system">
    <line x1="220" y1="220" x2="398" y2="220"/>
    <polygon points="398,216 406,220 398,224"/>
    <text class="edge-label" x="290" y="212">claim (scheduler)</text>
  </g>

  <!-- claimed → resolved/finished -->
  <g class="edge t-runtime">
    <path d="M540,210 Q640,108 718,108"/>
    <polygon points="718,104 726,108 718,112"/>
    <text class="edge-label" x="600" y="140">settle: all pass</text>
  </g>

  <!-- claimed → resolved/failed (crash) -->
  <g class="edge t-runtime">
    <line x1="540" y1="228" x2="718" y2="228"/>
    <polygon points="718,224 726,228 718,232"/>
    <text class="edge-label" x="600" y="222">crash / ticketFailOnCrash</text>
  </g>

  <!-- claimed → resolved/cancelled (founder) -->
  <g class="edge t-founder">
    <path d="M540,246 Q640,348 718,348"/>
    <polygon points="718,344 726,348 718,352"/>
    <text class="edge-label" x="590" y="310">cancel (founder UI)</text>
  </g>

  <!-- resolved/failed → opened (reopen) -->
  <g class="edge t-founder">
    <path d="M720,240 C620,280 300,310 180,258"/>
    <polygon points="182,262 176,254 186,256"/>
    <text class="edge-label" x="440" y="296">reopen (no pass verdicts)</text>
  </g>

  <!-- resolved/cancelled → opened (reopen) -->
  <g class="edge t-founder">
    <path d="M720,360 C580,410 260,370 170,258"/>
    <polygon points="172,262 164,254 174,256"/>
    <text class="edge-label" x="400" y="400">reopen (no pass verdicts)</text>
  </g>

  <!-- settle: any fail → opened -->
  <g class="edge t-runtime">
    <path d="M470,256 C470,340 280,340 200,258"/>
    <polygon points="202,262 196,254 206,256"/>
    <text class="edge-label" x="320" y="350">settle: any fail → reopen</text>
  </g>

  <!-- cancel halts dance (no state change) -->
  <g class="edge t-runtime" style="opacity: 0.5">
    <path d="M470,200 C470,170 490,160 510,170" fill="none"/>
    <polygon points="510,166 518,172 512,174"/>
    <text class="edge-label" x="440" y="162">cancel → halt dance</text>
  </g>

  <!-- QUESTIONABLE: agent ticketReopen -->
  <g class="edge t-questionable">
    <path d="M720,214 C660,180 360,160 190,198"/>
    <polygon points="192,202 184,194 194,196"/>
    <text class="edge-label" x="430" y="170">agent ticketReopen (MCP)</text>
  </g>

  <!-- QUESTIONABLE: resolved/finished → reopen blocked but agent can try -->
  <g class="edge t-questionable">
    <path d="M800,80 C800,50 820,40 850,40"/>
    <text class="edge-label" x="810" y="38">reopen blocked (pass exists)</text>
    <line x1="850" y1="40" x2="860" y2="34" stroke="#f87171" stroke-width="2"/>
    <line x1="850" y1="40" x2="860" y2="46" stroke="#f87171" stroke-width="2"/>
  </g>

  <!-- PROPOSED: fork -->
  <g class="edge t-proposed">
    <path d="M800,136 C800,180 400,460 180,258"/>
    <polygon points="182,262 174,254 184,256"/>
    <text class="edge-label" x="580" y="460">fork (new ticket, depends_on parent)</text>
  </g>

  <!-- PROPOSED: opened → cancelled directly -->
  <g class="edge t-proposed">
    <path d="M220,240 Q300,370 718,348"/>
    <polygon points="718,344 726,348 718,352"/>
    <text class="edge-label" x="380" y="370" style="fill:#a5b4fc">cancel before claim?</text>
  </g>

  <!-- GUARD annotations -->
  <g transform="translate(80,100)">
    <rect x="0" y="0" width="200" height="52" fill="#0a0a0a" stroke="#27272a" rx="4"/>
    <text style="font-size:10px; fill:#f87171" x="10" y="18">Guards on opened:</text>
    <text style="font-size:9px; fill:#a1a1aa" x="10" y="32">title/desc frozen if sessions &gt; 0</text>
    <text style="font-size:9px; fill:#a1a1aa" x="10" y="44">edit button hidden if verdicts &gt; 0</text>
  </g>

  <g transform="translate(720,400)">
    <rect x="0" y="0" width="200" height="40" fill="#0a0a0a" stroke="#27272a" rx="4"/>
    <text style="font-size:10px; fill:#f87171" x="10" y="18">Guard on reopen:</text>
    <text style="font-size:9px; fill:#a1a1aa" x="10" y="32">blocked if any verdict.pass = true</text>
  </g>

</svg>
</div>

<div class="section">
<h2>Current transitions</h2>
<table>
  <tr><th>From</th><th>To</th><th>Trigger</th><th>Guard</th><th>Notes</th></tr>
  <tr>
    <td>—</td><td>opened</td>
    <td><span class="tag tag-founder">founder</span> <span class="tag tag-agent">agent</span></td>
    <td>—</td><td>ticketCreate via UI or MCP</td>
  </tr>
  <tr>
    <td>opened</td><td>opened</td>
    <td><span class="tag tag-founder">founder</span></td>
    <td><span class="tag tag-guard">no sessions</span></td>
    <td>Edit title/description. Frozen once work started.</td>
  </tr>
  <tr>
    <td>opened</td><td>claimed</td>
    <td><span class="tag tag-system">scheduler</span></td>
    <td>agent assigned, dependency met</td>
    <td>Atomic claim via ticketClaimIfOpen</td>
  </tr>
  <tr>
    <td>claimed</td><td>resolved/finished</td>
    <td><span class="tag tag-runtime">runtime</span></td>
    <td>all verdicts pass (or no verifiers)</td>
    <td>settleTicket after verifier dance</td>
  </tr>
  <tr>
    <td>claimed</td><td>resolved/failed</td>
    <td><span class="tag tag-runtime">runtime</span></td>
    <td>producer crash</td>
    <td>withTicketFailOnCrash middleware</td>
  </tr>
  <tr>
    <td>claimed</td><td>resolved/cancelled</td>
    <td><span class="tag tag-founder">founder</span></td>
    <td>—</td>
    <td>Cancel button in UI. Dance halts on next shouldStop poll.</td>
  </tr>
  <tr>
    <td>claimed</td><td>opened</td>
    <td><span class="tag tag-runtime">runtime</span></td>
    <td>any verdict fails</td>
    <td>settleTicket reopens for next round</td>
  </tr>
  <tr>
    <td>claimed</td><td>opened</td>
    <td><span class="tag tag-system">scheduler</span></td>
    <td>stale claim (&gt;5min)</td>
    <td>schedulerRecover for orphaned sessions</td>
  </tr>
  <tr>
    <td>resolved/failed</td><td>opened</td>
    <td><span class="tag tag-founder">founder</span> <span class="tag tag-agent">agent</span></td>
    <td><span class="tag tag-guard">no pass verdicts</span></td>
    <td>Reopen button or MCP ticketReopen</td>
  </tr>
  <tr>
    <td>resolved/cancelled</td><td>opened</td>
    <td><span class="tag tag-founder">founder</span> <span class="tag tag-agent">agent</span></td>
    <td><span class="tag tag-guard">no pass verdicts</span></td>
    <td>Reopen button or MCP ticketReopen</td>
  </tr>
</table>
</div>

<div class="section">
<h2>Questionable</h2>
<table>
  <tr><th>Issue</th><th>Detail</th><th>Risk</th></tr>
  <tr>
    <td class="gap">Agent can ticketReopen</td>
    <td>MCP exposes ticketReopen to all agents. A producer could reopen its own ticket or another ticket. Guard only checks "no pass verdicts" — a failed ticket can be reopened by any agent.</td>
    <td class="warn">Agent could force retry loops, burn tokens. Should scope to founder-only or add rate limits?</td>
  </tr>
  <tr>
    <td class="gap">No cancel-before-claim</td>
    <td>Opened tickets can only become resolved via claimed. If founder creates a ticket by mistake, they can't cancel it without claiming first or deleting.</td>
    <td class="warn">Minor UX friction. Ticket sits in opened forever or needs a direct DB edit.</td>
  </tr>
  <tr>
    <td class="gap">Stale-claim recovery is time-based</td>
    <td>schedulerRecover releases claims older than cutoff. But a legitimately long-running session (large codebase, slow model) could get reclaimed.</td>
    <td class="warn">Double-dispatch: two sessions on same ticket. Both write to workspace, comments, verdicts.</td>
  </tr>
  <tr>
    <td class="gap">settle reopens bypasses ticketReopen guard</td>
    <td>When verifier fails, settleTicket calls database.ticketUpdate directly — not domain.ticketReopen. So the "no pass verdicts" guard doesn't apply to the automated reopen path.</td>
    <td class="ok">Currently correct: settle only reopens on all-fail. But if logic drifts, the guard is bypassed.</td>
  </tr>
  <tr>
    <td class="gap">No ticket deletion</td>
    <td>No delete endpoint or UI action. Tickets are permanent.</td>
    <td class="note">By design? Or missing? Junk tickets accumulate.</td>
  </tr>
  <tr>
    <td class="gap">Agent can create tickets with depends_on</td>
    <td>MCP ticketCreate allows depends_on. An agent could build arbitrarily deep chains. No depth limit.</td>
    <td class="warn">Runaway planning agents create infinite fork chains. Consider depth cap or ticket-creation throttle.</td>
  </tr>
  <tr>
    <td class="gap">resolve(cancelled) available to API callers</td>
    <td>POST /:id/resolve with outcome=cancelled is not restricted. Any authenticated caller can cancel any claimed ticket.</td>
    <td class="note">Fine for solo founder. Multi-user would need ownership checks.</td>
  </tr>
</table>
</div>

<div class="section">
<h2>Proposed additions</h2>
<table>
  <tr><th>Proposal</th><th>Transition</th><th>Why</th></tr>
  <tr>
    <td class="ok">Fork ticket</td>
    <td>resolved/finished → new opened (with depends_on)</td>
    <td>Scope change on verified work. System prompt inherits parent's resolved context. Already discussed, not yet implemented.</td>
  </tr>
  <tr>
    <td class="ok">Cancel before claim</td>
    <td>opened → resolved/cancelled</td>
    <td>Founder made a mistake, wants to kill a ticket before any agent touches it. Currently no path.</td>
  </tr>
  <tr>
    <td class="ok">Supersede</td>
    <td>opened/claimed → resolved/superseded</td>
    <td>Product agent replaces a ticket with a better-scoped one. Different from cancel (intentional replacement vs abandonment). New outcome value.</td>
  </tr>
  <tr>
    <td class="ok">Ticket archive/soft-delete</td>
    <td>resolved → archived</td>
    <td>Clean up the list view without losing history. Filter archived by default.</td>
  </tr>
  <tr>
    <td class="ok">Prompt inheritance for depends_on</td>
    <td>—</td>
    <td>withSystemPrompt reads parent ticket's resolved state into a "Builds on" section. Snapshot at claim time. Already designed, not yet implemented.</td>
  </tr>
  <tr>
    <td class="ok">Settle routes through domain ticketReopen</td>
    <td>claimed → opened (via domain, not raw DB)</td>
    <td>Ensures all reopen guards apply uniformly. Currently settle bypasses domain layer.</td>
  </tr>
</table>
</div>

<div class="section">
<h2>Guard summary</h2>
<table>
  <tr><th>Guard</th><th>Where</th><th>Enforcement</th></tr>
  <tr>
    <td>Title/desc frozen after sessions</td>
    <td>domain/tickets.ts ticketUpdate</td>
    <td><span class="ok">Backend</span> + <span class="ok">UI hides edit</span></td>
  </tr>
  <tr>
    <td>Reopen blocked if pass verdict</td>
    <td>domain/tickets.ts ticketReopen</td>
    <td><span class="ok">Backend</span> — <span class="warn">UI shows button unconditionally for resolved</span></td>
  </tr>
  <tr>
    <td>Only opened tickets are editable</td>
    <td>domain/tickets.ts assertStatus</td>
    <td><span class="ok">Backend</span> + <span class="ok">UI checks status</span></td>
  </tr>
  <tr>
    <td>Only claimed tickets can resolve</td>
    <td>domain/tickets.ts assertStatus</td>
    <td><span class="ok">Backend</span></td>
  </tr>
  <tr>
    <td>Only resolved tickets can reopen</td>
    <td>domain/tickets.ts status check</td>
    <td><span class="ok">Backend</span> + <span class="ok">UI checks status</span></td>
  </tr>
  <tr>
    <td>Atomic claim (no double-dispatch)</td>
    <td>database.ts ticketClaimIfOpen</td>
    <td><span class="ok">SQL-level</span> — <span class="warn">but stale-claim recovery can still double</span></td>
  </tr>
</table>
</div>

</body>
</html>`

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
})

server.listen(4444, '0.0.0.0', () => {
  console.log('State machine visualizer: http://0.0.0.0:4444')
})
