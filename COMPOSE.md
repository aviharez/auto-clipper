# Compose mode — concept

A mode for the `clipper` app, sitting alongside the existing Clip pipeline as its own top-level menu. This document only explains the idea — what I want to make and why. No implementation, no schemas, no build order.

---

## What it is

A way to **build a short vertical video from scratch**, by stitching together materials I picked myself.

The existing Clip pipeline answers: *"Someone made a 3-hour podcast — give me 8 short clips out of it."* One source goes in, many clips come out.

Compose answers a different question: *"I want to make a 38-second video about a specific idea, using footage I've gathered."* There is no single source. There is a topic, and a pile of materials.

The niche is **digital curiosity** — short narrated videos about internet history, weird software, forgotten corners of the web. The kind of content where a single video usually pulls from several places: a YouTube clip of an old TV segment, a screen recording I made myself, a screenshot of an old website, my own narration over the top.

---

## Where it lives in the app

Compose is one of three top-level menus in the sidebar, alongside the other two:

- **Clip** — auto-generated clip batches from source videos (the existing pipeline).
- **Compose** — this mode.
- **History** — everything ever produced, across both pipelines, with tabs to filter by Clip or Compose.

The three menus are siblings. None is nested under the others.

---

## How I start a composition

Click **Compose** in the sidebar. I see a list of every composition I have — drafts in progress, rendered videos not yet uploaded, and finalized uploaded ones — newest first. Each row shows the title, current status, length vs target, and when it was last edited. Open one to keep working on it, or upload one that's already rendered.

To create a new one, click **New compose**. A small popup appears with a single question: *what's this video about?* I type a working title and press Proceed. The popup closes, a new draft appears at the top of the list, and the editor opens with that draft loaded. Defaults (niche, target length) are pre-applied and editable inside the editor.

Naming up front is deliberate. It forces me to commit to an angle before I start picking footage. Untitled compositions are still possible — pressing Proceed with the field empty creates an `Untitled draft` row — but the popup nudges me toward naming the idea first.

---

## What I assemble it from

A composition is built from a small set of ingredients. Each ingredient comes from me, not from an automatic process.

**Visual segments** — the picture track of the final video. Each segment is one of:
- A trimmed piece of a **YouTube video**
- A trimmed piece of a **local video file** (a screen recording, a download, etc.)
- An **image** — a screenshot or a photo — with a chosen motion (static, or a slow slide / slow zoom so the image feels alive rather than frozen)

Segments play in order, end to end. Reorder them to change the story.

**Transitions** between segments — what happens at the join. A choice from a short list (hard cut, crossfade, whip pan, zoom punch, flash white), with an optional **sound effect** that plays through the transition (a whoosh, a click, a chime).

**A hook** — a few words painted over the first ~1.5 seconds, animated with one of a few preset animations. The thing that has to grab attention before someone scrolls past.

**A voiceover** — my own narration, uploaded as one audio file. I tell the system how to **split that file across the segments**: which slice of the audio plays during which segment. I can do this automatically (the system finds silences) or manually, by drawing range bands on the waveform.

**Subtitles** — usually I already wrote what I'm going to say. I want to paste my script as text and have it appear as subtitles, with timing taken from the voiceover. I should also be able to fall back to auto-transcribing the voiceover, or upload a `.srt` if I already have one.

**Spot sound effects** — one-shot sounds dropped at specific timestamps in the final video. A modem dial at 1.8 seconds. A keyboard click at 14.2 seconds. A magical chime at 29.5 seconds. They sit alongside the bed music, not replacing it.

**Bed music** — a quiet underscore that runs the whole video. Picked from a small library, automatically ducked under the voiceover so it never fights for attention.

**Output length** — I tell the system how long the final video should be. If my segments add up to more or less than that, the system retimes them slightly to fit the target.

---

## How I work with it

The mental model is **declare, then render**. I describe the video I want — these segments in this order, this voiceover split this way, these sound effects at these times, this hook, this music — and I press a single **Render preview** button. The backend builds the video; I watch the result; I change something; I render again.

The preview always shows the **last rendered video**, not a live re-render of every tweak. This is deliberate. I don't want a real-time canvas with knobs I can twist; I want to make decisions, see the consequence, decide again.

When I'm happy, I open the **Save draft** dropdown next to Render preview and pick **Finalize video** instead. The composition renders final at 1080×1920 and moves from Drafts to Uploaded.

A breadcrumb at the top of the editor (`← Compose › Editor`) takes me back to the list at any time. The draft is saved on its way out.

---

## Things I deliberately don't want

These are not features I forgot. They are things I am refusing to build, because they would turn a focused tool into a generic video editor.

- **No timeline I can scrub and edit on.** Times are typed in or nudged by ±0.1s / ±0.5s buttons. There is no playhead I drag, no clip I drag around to retime. (One small exception is described in `COMPOSE_TIMELINE.md` — a read-only timeline view that I can scrub and that lets me reorder segments by drag. Read it for the boundaries.)
- **No layer stack.** No "track 3 contains a logo above the captions." The hook, the captions, the picture, the audio mix — these are global, not layered.
- **No font/color/size/position controls.** Every style is **selection from a short list**. If I want a different caption look, I pick a different preset, not adjust a font.
- **No live canvas that re-renders on every keystroke.** Changing something queues a re-render. I press the button.
- **No auto-suggestion of segments.** Compose is a manual assembly tool. The "find good segments automatically" feature is what the *other* pipeline (Clip) is for.
- **No multi-user anything.** No accounts, no sharing, no comments, no team. This runs on my laptop, for me.
- **No analytics, view counts, performance dashboards.** Not the job.
- **No nested Editor / Drafts / Uploaded tabs inside the editor.** The list of compositions is its own page (the Compose menu landing). The editor is for editing one composition at a time, nothing more.

The point of this mode is that **the restraint is the feature**. A focused tool that does one job — assemble narrated curiosity shorts from materials I picked — is more useful to me than a flexible tool that can do anything but takes effort to do anything specific.

---

## How it relates to the rest of the app

Compose shares the visual language, the preset philosophy, the headless render mental model, and the upload destination with Clip. The two pipelines do not share materials — a YouTube source used inside a Compose draft is not a "job" in the Clip sense, and a clip auto-generated from a source video doesn't show up as a Compose segment.

They are two ways to end up at the same place: a finished vertical short, ready to upload. The History menu is where I see them both side by side after the fact.
