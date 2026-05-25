# Compose mode · with timeline — concept

A variant of the Compose screen that adds a **read-only timeline strip** at the bottom. This document explains what the timeline is, what it isn't, and why it stops where it does. Companion to `COMPOSE.md`.

---

## Why this exists

The original Compose spec said: *no timeline*. The reason wasn't that timelines are impossible — it was that giving the user a timeline invites them to edit on it. Drag a clip to retime. Drag a layer up to a different track. Razor-tool a cut. *That is how a focused tool becomes a generic NLE,* and a generic NLE is a different product.

But composing a 38-second video without any spatial view of time is harder than it needs to be. The user thinks in *moments* — "the modem-dial SFX comes right before the line about MySpace" — and a stack of text fields and number inputs makes those temporal relationships invisible. Voiceover ranges, SFX placements, hook duration, segment widths — these are all things the brain wants to *see*, not compute.

So the question is: can I give the user a view of time without giving them a timeline editor? The answer is yes — by making the timeline strictly **a display, not an edit surface**.

---

## What the timeline is

A horizontal strip at the bottom of the Compose screen showing the composition laid out in time. Five stacked tracks:

- **Segments** — colored blocks proportional to duration, in order, with kind tag (YOUTUBE / LOCAL / IMAGE) and label inside each
- **Hook** — a single amber bar over the first ~1.5 seconds
- **Voice** — the voiceover waveform with dashed vertical lines at each manual range boundary
- **Music** — the bed music waveform in muted gray
- **SFX** — numbered green dots at each spot SFX timestamp, with the file name beside them

Above the tracks: a 1-second-resolution ruler, a zoom control (`fit / − / +`), and a hint label.

**Hover anywhere** on the timeline and three things happen at once:
- A vertical indigo playhead line crosses all five tracks
- A floating 9:16 frame thumbnail appears above the playhead showing the frame at that moment, pulled from the last render
- A timecode badge `14.2s` sits below the thumbnail
- The main 9:16 preview in the center column updates to the same frame, with a `Frame at 14.2s · hovered from timeline below` caption

This is **scrubbing**, but only of the already-rendered video. There is no live re-render. The hover just walks the cached frames of the last successful render.

---

## What you can do on the timeline

**One thing.** You can grab a segment block and drag it horizontally to reorder.

That's it. Not a typo, not "we'll add more later" — the design choice is that reordering is the only direct-manipulation gesture available on the timeline itself. When you drag a segment, the others slide to make room. A vertical drop indicator shows where it will land. Release to commit.

Reordering is the one place direct manipulation genuinely beats the rails — you can see the consequence of the new order immediately, in the same view, by the segment widths.

Everything else — trimming, transitions, voice ranges, captions, SFX placement, music gain — still happens **in the right rail or the segments rail**. The timeline shows you the result. The rails change the result.

---

## What you deliberately cannot do

This list matters more than the things you can. Read it carefully — every refusal here is intentional.

- **No drag to trim.** Segment block edges are not resize handles. To trim, expand the segment in the left rail and use the In/Out fields.
- **No drag to retime.** A 6-second image segment does not become a 10-second image segment because you stretched its block. To change duration, edit the segment.
- **No playhead drag for editing.** The playhead follows the mouse on hover, but it does not split, mark, or commit anything. It is a *cursor for previewing*, not an edit tool.
- **No layer stack.** You cannot drag overlays around. Hook + captions are global, applied by the renderer.
- **No SFX drag to reposition.** SFX timestamps are edited in the Spot SFX panel on the right rail. The timeline shows where they sit; it does not let you move them.
- **No voice range handle drag on the timeline.** Voice ranges are edited on the dedicated waveform editor inside the Voiceover panel — which is the *right place* for that gesture, since aligning to a waveform is the one situation where dragging genuinely beats typing.
- **No razor tool, no keyframes, no curves, no in-track effects.** Not now, not later.
- **No live re-render on hover.** The hover frame comes from the *last render*. If you change something in the rails, you must press Render preview to see it in the timeline.

If any of these refusals feel arbitrary, re-read the first section. The whole reason the timeline can exist at all is that it doesn't try to be an editor.

---

## How it changes the rest of the screen

The timeline addition slightly reshapes the layout:

- The center column's composition diagram is **removed** — the timeline at the bottom does that job better, with more horizontal space.
- The center column shrinks to just the preview + a small "frame at Xs · hovered from timeline below" caption + a callout explaining the read-only model.
- The header carries the standard editor chrome — a breadcrumb back to Compose (`← Compose › Editor`), the composition title, the niche, and a Draft status pill — plus an extra `IV · TIMELINE` badge to mark the iteration.
- The footer with `Render` and `Render & upload` buttons goes away — only **Render preview** at the top header now triggers renders.
- The top-right `Save draft` button becomes a small **split dropdown** with two actions:
  - **Save draft** (default, ⌘S) — keep working, stays in the Compose list as a draft
  - **Finalize video** (⇧⌘S) — render final at 1080×1920 and move to Uploaded

The right rail is unchanged from the standard Compose screen — all settings (Output length, Hook, Voiceover, Captions, Bed music, Spot SFX) are still there at full fidelity. That redundancy is intentional: the rails edit the values, the timeline shows the consequences.

---

## When this view helps

The timeline view is most useful when:

- You're checking pacing — "does the hook hold long enough before the first cut?"
- You're spot-placing SFX — "is the modem dial actually landing on the GeoCities segment, not earlier?"
- You're verifying voiceover alignment — "is range 3 ending where segment 3 ends, or do I have a gap?"
- You're reordering segments — "does the Wayback Machine bit work better at the start or the end?"

The rails-only Compose editor is more useful when:

- You're authoring — picking presets, writing the hook, typing the script
- You're trimming — nudging in/out points segment by segment
- You're auditioning style choices — caption preset, transition preset, music track

Both views render to the same composition. They are not separate modes; they are two ways to look at the same thing. In a real build these would be a toggle on the same screen — they're shown here as two separate editor variants so you can compare the layouts side by side.

---

## The principle behind it

Tools that give you spatial views of complex artifacts are good. Tools that turn every spatial view into an editable surface are how products grow into bloat. The discipline of the original Compose was *the rails are where decisions get made*. The discipline of this variant is *the rails are still where decisions get made — the timeline just shows you what they look like in time.*

Direct manipulation is a tool, not a value. Use it where it genuinely helps (reordering segments, dragging voiceover range handles on the waveform) and refuse it everywhere else. The refusal is what keeps the product narrow enough to be good at one thing.
