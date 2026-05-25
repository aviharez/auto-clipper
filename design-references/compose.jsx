// compose.jsx — Compose: build a vertical video from scratch by stitching
// segments from multiple source kinds (YouTube, local video, image).
// User can drive captions from own script and split own voiceover across
// segments. Spot SFX can be dropped at timestamps.
// Same restraint as the rest of the app: preset selection, ±nudge trims,
// headless render — no NLE.

const COMPOSITION = {
  title: "The internet's weirdest forgotten subdomains",
  niche: 'digital curiosity',
  targetSec: 38,
  hookText: "they don't make websites like this anymore",
};

const SEGMENTS = [
  {
    n: 1, kind: 'yt',
    label: 'Inside the GeoCities archive (2018)',
    src: 'youtu.be/8K9pJyc4-aw',
    in: '2:14', out: '2:31',
    dur: 17.0, sourceDur: '8:42',
    tint: '#2a1f18',
  },
  {
    n: 2, kind: 'local',
    label: 'screen_geocities_browse.mov',
    src: '~/clips/raw/geocities_screen.mov',
    in: '0:02', out: '0:14',
    dur: 12.0, sourceDur: '0:38',
    tint: '#1f2a38',
  },
  {
    n: 3, kind: 'image',
    label: 'wayback_machine_2001.png',
    src: '~/clips/raw/wayback_2001.png',
    motion: 'slide',          // 'static' | 'slide' | 'zoom-in' | 'zoom-out'
    motionLabel: 'Slow slide · left → right',
    dur: 6.0, sourceDur: 'still',
    tint: '#241830',
  },
  {
    n: 4, kind: 'yt',
    label: "The Wayback Machine's biggest day",
    src: 'youtu.be/qq4mBO78A2Q',
    in: '5:22', out: '5:25',
    dur: 3.0, sourceDur: '12:08',
    tint: '#2a1818',
  },
];

// Transitions between segments. Indexed by the "from" segment.
const TRANSITIONS = [
  { from: 1, to: 2, preset: 'Whip pan',          dur: '180ms', sfx: 'whoosh_short.wav' },
  { from: 2, to: 3, preset: 'Crossfade',         dur: '220ms', sfx: null },
  { from: 3, to: 4, preset: 'Hard cut',          dur: '0ms',   sfx: null },
];

const TRANSITION_PRESETS = ['Hard cut', 'Crossfade', 'Whip pan', 'Zoom punch', 'Flash white'];

// Spot SFX placed at timestamps in the final composition.
const SPOT_SFX = [
  { at: 1.8,  label: 'modem_dial.wav',     dur: '0.6s', gain: '−6dB' },
  { at: 14.2, label: 'keyboard_click.wav', dur: '0.2s', gain: '−10dB' },
  { at: 29.5, label: 'magical_chime.wav',  dur: '1.1s', gain: '−4dB' },
];

// Voiceover splits. User uploaded one file; system splits at silence + lets
// user nudge boundaries to align with segments.
const VOICE_SPLITS = [
  { n: 1, start: 0.0,  end: 17.0, snippet: "...the entire Geocities archive was 600 gigabytes..." },
  { n: 2, start: 17.0, end: 29.0, snippet: "...you could watch the page take twelve seconds to load..." },
  { n: 3, start: 29.0, end: 35.0, snippet: "...and the Wayback Machine archived almost all of it..." },
  { n: 4, start: 35.0, end: 38.0, snippet: "...almost." },
];
const VOICE_TOTAL = 38.2;

const SCRIPT_TEXT =
`The entire Geocities archive was 600 gigabytes.
That's smaller than the trailer for a modern action movie.

You could watch a page take twelve seconds to load —
and somehow it still felt fast.

The Wayback Machine archived almost all of it.

Almost.`;

const TOTAL = SEGMENTS.reduce((a, s) => a + s.dur, 0);
function cumStart(segs, idx) {
  let s = 0;
  for (let i = 0; i < idx; i++) s += segs[i].dur;
  return s;
}

// ────────────────────────────────────────────────────────────────────────
// Sub-tabs row
// ────────────────────────────────────────────────────────────────────────
function ComposeSubTabs({ active }) {
  const tabs = [
    { id: 'editor',  label: 'Editor' },
    { id: 'drafts',  label: 'Drafts',     count: 3 },
    { id: 'uploads', label: 'Uploaded',   count: 14 },
  ];
  return (
    <div style={{
      display: 'flex', gap: 4, marginTop: 12,
      borderBottom: `1px solid ${T.border}`, marginBottom: -1,
    }}>
      {tabs.map(t => {
        const isActive = t.id === active;
        return (
          <div key={t.id} style={{
            padding: '8px 12px', cursor: 'pointer',
            fontSize: 12, fontWeight: isActive ? 600 : 500,
            color: isActive ? T.text : T.textMuted,
            borderBottom: `2px solid ${isActive ? T.text : 'transparent'}`,
            marginBottom: -1,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            {t.label}
            {typeof t.count === 'number' && (
              <span style={{
                fontFamily: FONT_MONO, fontSize: 10, color: T.textDim,
              }}>{t.count}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Source-kind badge for a segment
// ────────────────────────────────────────────────────────────────────────
const KIND_META = {
  yt:    { label: 'YouTube', color: '#FF0033', glyph: '▶' },
  local: { label: 'Local',   color: '#0891b2', glyph: '◍' },
  image: { label: 'Image',   color: '#a855f7', glyph: '◧' },
};

function KindBadge({ kind }) {
  const m = KIND_META[kind];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontFamily: FONT_MONO, fontSize: 9, fontWeight: 600,
      color: m.color, background: `${m.color}18`,
      padding: '2px 5px', borderRadius: 3,
      letterSpacing: '0.04em', textTransform: 'uppercase',
    }}>
      <span style={{ fontSize: 10 }}>{m.glyph}</span>
      {m.label}
    </span>
  );
}

// Mini preview tile (variant per kind).
function SegmentTile({ seg, highlight }) {
  const m = KIND_META[seg.kind];
  const baseTile = {
    width: 30, height: 44, borderRadius: 3, flexShrink: 0,
    position: 'relative', overflow: 'hidden',
    boxShadow: highlight ? `0 0 0 2px ${T.accent}` : 'none',
    background: `linear-gradient(135deg, ${seg.tint} 0%, #0e0e10 100%)`,
  };
  if (seg.kind === 'image') {
    return (
      <div style={baseTile}>
        <svg width="100%" height="100%" viewBox="0 0 30 44" style={{ position: 'absolute', inset: 0 }}>
          <rect x="3" y="6" width="24" height="32" rx="2" fill="#3a2a4a" />
          <circle cx="11" cy="16" r="2.5" fill="#a855f7" opacity="0.6" />
          <path d="M5 30 L13 22 L19 28 L25 22 L25 35 L5 35 Z" fill="#5a4a6a"/>
        </svg>
      </div>
    );
  }
  return (
    <div style={baseTile}>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: 14, height: 10, borderRadius: 2,
          background: m.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="5" height="6" viewBox="0 0 5 6">
            <path d="M0 0 L5 3 L0 6 Z" fill="#fff"/>
          </svg>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Segment row — header always visible; expanded body shows the trim
// controls OR (for images) the motion preset.
// ────────────────────────────────────────────────────────────────────────
function SegmentRow({ seg, expanded, percent }) {
  return (
    <div style={{
      borderRadius: 7,
      background: expanded ? T.surface : 'transparent',
      boxShadow: expanded ? `inset 0 0 0 1px ${T.borderStrong}` : 'none',
      marginBottom: 0,
      position: 'relative',
    }}>
      {/* Header row */}
      <div style={{
        display: 'flex', gap: 10, padding: '10px 12px', cursor: 'pointer',
        alignItems: 'flex-start',
      }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          paddingTop: 2, color: T.textDim,
        }}>
          <svg width="10" height="14" viewBox="0 0 10 14">
            {[3,7,11].flatMap(y => [
              <circle key={`l${y}`} cx="3" cy={y} r="1" fill="currentColor"/>,
              <circle key={`r${y}`} cx="7" cy={y} r="1" fill="currentColor"/>,
            ])}
          </svg>
          <div style={{
            marginTop: 4, width: 18, height: 18, borderRadius: 4,
            background: expanded ? T.text : T.zinc200,
            color: expanded ? '#fff' : T.textMuted,
            fontFamily: FONT_MONO, fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{seg.n}</div>
        </div>

        <SegmentTile seg={seg} highlight={expanded} />

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3,
          }}>
            <KindBadge kind={seg.kind} />
          </div>
          <div style={{
            fontSize: 12, color: T.text, fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{seg.label}</div>
          <div style={{
            fontFamily: FONT_MONO, fontSize: 10, color: T.textMuted,
            marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {seg.src}
          </div>
          <div style={{
            marginTop: 5, display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: FONT_MONO, fontSize: 11,
          }}>
            {seg.kind === 'image' ? (
              <>
                <span style={{ color: T.accent, fontWeight: 600 }}>{seg.motionLabel}</span>
                <span style={{ color: T.textDim }}>·</span>
                <span style={{ color: T.text, fontWeight: 600 }}>{seg.dur.toFixed(1)}s</span>
              </>
            ) : (
              <>
                <span style={{ color: T.accent, fontWeight: 600 }}>{seg.in}</span>
                <span style={{ color: T.textDim }}>→</span>
                <span style={{ color: T.accent, fontWeight: 600 }}>{seg.out}</span>
                <span style={{ color: T.textDim }}>·</span>
                <span style={{ color: T.text, fontWeight: 600 }}>{seg.dur.toFixed(1)}s</span>
              </>
            )}
          </div>
        </div>

        <button style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: expanded ? T.text : T.textDim, padding: 4, display: 'flex',
          transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s',
        }}>{Icon.chevronRight(13)}</button>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{
          padding: '0 14px 14px', borderTop: `1px solid ${T.border}`, marginTop: 4,
        }}>
          {seg.kind === 'image'
            ? <ExpandedImage seg={seg} percent={percent} />
            : <ExpandedVideo seg={seg} percent={percent} />}
        </div>
      )}
    </div>
  );
}

// Expanded body for video-like segments (YouTube + local).
function ExpandedVideo({ seg, percent }) {
  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        paddingTop: 10, marginBottom: 6,
      }}>
        <div style={{
          fontSize: 10, fontFamily: FONT_MONO, color: T.textDim,
          textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600,
        }}>
          Trim {seg.kind === 'yt' ? 'YouTube source' : 'local file'}
        </div>
        <div style={{ fontSize: 10, fontFamily: FONT_MONO, color: T.textDim }}>
          source: {seg.sourceDur}
        </div>
      </div>

      <div style={{
        position: 'relative', height: 22, marginBottom: 8,
        background: T.zinc100, borderRadius: 4, overflow: 'hidden',
        border: `1px solid ${T.border}`,
      }}>
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, display: 'block' }}>
          <defs>
            <pattern id={`scrub-${seg.n}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="3" height="6" fill={T.zinc200}/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#scrub-${seg.n})`}/>
        </svg>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '26%', width: '4%', background: T.accent, opacity: 0.95 }} />
        <div style={{ position: 'absolute', top: -2, bottom: -2, left: '26%', width: 3, background: T.text, transform: 'translateX(-1.5px)', borderRadius: 1 }} />
        <div style={{ position: 'absolute', top: -2, bottom: -2, left: '30%', width: 3, background: T.text, transform: 'translateX(-1.5px)', borderRadius: 1 }} />
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        {['In', 'Out'].map((lbl, i) => (
          <div key={lbl} style={{ flex: 1 }}>
            <div style={{
              fontSize: 9, fontFamily: FONT_MONO, color: T.textDim,
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3,
            }}>{lbl}</div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <div style={{
                fontFamily: FONT_MONO, fontSize: 13, fontWeight: 600,
                color: T.text, flex: 1,
              }}>{i === 0 ? seg.in : seg.out}</div>
              <button className="row-btn" style={{ padding: '3px 6px', fontSize: 10 }}>−0.5s</button>
              <button className="row-btn" style={{ padding: '3px 6px', fontSize: 10 }}>+0.5s</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 8, fontSize: 10, fontFamily: FONT_MONO, color: T.textMuted,
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>Trimmed length <span style={{ color: T.text, fontWeight: 600 }}>{seg.dur.toFixed(1)}s</span></span>
        <span style={{ color: T.textDim }}>{percent.toFixed(0)}% of output</span>
      </div>
    </>
  );
}

// Expanded body for image segments: motion preset + duration.
function ExpandedImage({ seg, percent }) {
  const motions = [
    { id: 'static',   label: 'Static',         desc: 'no movement' },
    { id: 'slide',    label: 'Slow slide',     desc: 'pan left → right' },
    { id: 'zoom-in',  label: 'Slow zoom in',   desc: '100% → 115%' },
    { id: 'zoom-out', label: 'Slow zoom out',  desc: '115% → 100%' },
  ];
  return (
    <>
      <div style={{
        paddingTop: 10, marginBottom: 8,
        fontSize: 10, fontFamily: FONT_MONO, color: T.textDim,
        textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600,
      }}>
        Motion preset
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {motions.map(m => {
          const isActive = m.id === seg.motion;
          return (
            <div key={m.id} style={{
              padding: '8px 10px', borderRadius: 5, cursor: 'pointer',
              border: `1px solid ${isActive ? T.accent : T.border}`,
              background: isActive ? T.accentSoft : T.surface,
              position: 'relative',
            }}>
              {/* tiny motion glyph */}
              <div style={{ position: 'absolute', top: 6, right: 6 }}>
                <MotionGlyph id={m.id} />
              </div>
              <div style={{
                fontSize: 11, fontWeight: 600,
                color: isActive ? T.accent : T.text,
              }}>{m.label}</div>
              <div style={{
                fontSize: 9, color: T.textDim, fontFamily: FONT_MONO,
                marginTop: 2,
              }}>{m.desc}</div>
            </div>
          );
        })}
      </div>

      <div style={{
        marginTop: 12,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 9, fontFamily: FONT_MONO, color: T.textDim,
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3,
          }}>Display duration</div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <div style={{
              fontFamily: FONT_MONO, fontSize: 13, fontWeight: 600,
              color: T.text, flex: 1,
            }}>{seg.dur.toFixed(1)}s</div>
            <button className="row-btn" style={{ padding: '3px 6px', fontSize: 10 }}>−0.5s</button>
            <button className="row-btn" style={{ padding: '3px 6px', fontSize: 10 }}>+0.5s</button>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 9, fontFamily: FONT_MONO, color: T.textDim,
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3,
          }}>Speed</div>
          <div className="select-fake" style={{
            fontSize: 12, padding: '5px 22px 5px 8px',
            backgroundPosition: 'calc(100% - 10px) 10px, calc(100% - 6px) 10px',
          }}>Slow · 4% / sec</div>
        </div>
      </div>

      <div style={{
        marginTop: 8, fontSize: 10, fontFamily: FONT_MONO, color: T.textDim,
      }}>
        {percent.toFixed(0)}% of output · image rendered at 1920×1080 then panned
      </div>
    </>
  );
}

function MotionGlyph({ id }) {
  const c = T.textDim;
  if (id === 'static') return <svg width="20" height="14" viewBox="0 0 20 14"><rect x="3" y="2" width="14" height="10" fill="none" stroke={c} strokeWidth="1"/></svg>;
  if (id === 'slide')  return <svg width="20" height="14" viewBox="0 0 20 14"><rect x="1" y="2" width="14" height="10" fill="none" stroke={c} strokeWidth="1"/><path d="M11 7 L17 7 M14 4 L17 7 L14 10" stroke={c} strokeWidth="1.2" fill="none" strokeLinecap="round"/></svg>;
  if (id === 'zoom-in')  return <svg width="20" height="14" viewBox="0 0 20 14"><rect x="1" y="1" width="18" height="12" fill="none" stroke={c} strokeWidth="0.8" opacity="0.5"/><rect x="5" y="3" width="10" height="8" fill="none" stroke={c} strokeWidth="1"/></svg>;
  return <svg width="20" height="14" viewBox="0 0 20 14"><rect x="1" y="1" width="18" height="12" fill="none" stroke={c} strokeWidth="1"/><rect x="5" y="3" width="10" height="8" fill="none" stroke={c} strokeWidth="0.8" opacity="0.5"/></svg>;
}

// ────────────────────────────────────────────────────────────────────────
// Transition row — sits between two segment rows
// ────────────────────────────────────────────────────────────────────────
function TransitionRow({ trans }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 12px 6px 28px',
      position: 'relative',
      margin: '2px 0',
    }}>
      {/* connector */}
      <div style={{
        position: 'absolute', left: 32, top: 0, bottom: 0, width: 2,
        background: `repeating-linear-gradient(to bottom, ${T.borderStrong} 0 3px, transparent 3px 6px)`,
      }} />

      <div style={{
        background: T.amberSoft, color: T.amber,
        padding: '2px 6px', borderRadius: 3,
        fontFamily: FONT_MONO, fontSize: 9, fontWeight: 700,
        letterSpacing: '0.04em',
        zIndex: 1,
      }}>
        T{trans.from}→{trans.to}
      </div>

      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', gap: 8,
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 5, padding: '4px 8px',
      }}>
        <div className="select-fake" style={{
          flex: 1, fontSize: 11, padding: '3px 22px 3px 6px',
          border: 'none', backgroundColor: 'transparent',
          backgroundPosition: 'calc(100% - 10px) 9px, calc(100% - 6px) 9px',
        }}>{trans.preset} · {trans.dur}</div>

        <div style={{ width: 1, height: 16, background: T.border }} />

        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          minWidth: 0, flex: 1,
        }}>
          <span style={{
            fontFamily: FONT_MONO, fontSize: 9, color: T.textDim,
            textTransform: 'uppercase', letterSpacing: '0.04em',
            flexShrink: 0,
          }}>SFX</span>
          {trans.sfx ? (
            <span style={{
              fontFamily: FONT_MONO, fontSize: 11, color: T.text,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{trans.sfx}</span>
          ) : (
            <span style={{
              fontFamily: FONT_MONO, fontSize: 11, color: T.textDim,
              fontStyle: 'italic',
            }}>none</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Composition bar — segments + transition wedges + voiceover splits + SFX dots
// ────────────────────────────────────────────────────────────────────────
function CompositionBar({ segments, transitions, voiceSplits, spotSfx, totalSec, targetSec }) {
  const segColors = ['#0891b2', '#3b82f6', '#a855f7', '#ec4899'];
  return (
    <div style={{ width: '100%', maxWidth: 560 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 6,
        fontFamily: FONT_MONO, fontSize: 10, color: T.textDim,
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>
        <span>Composition</span>
        <span>
          <span style={{ color: T.text, fontWeight: 600 }}>{totalSec.toFixed(1)}s</span>
          <span style={{ color: T.textDim }}> / target {targetSec}s</span>
        </span>
      </div>

      {/* Segment bar */}
      <div style={{
        height: 32, borderRadius: 5, overflow: 'hidden',
        display: 'flex', background: T.zinc100,
        border: `1px solid ${T.border}`, position: 'relative',
      }}>
        {segments.map((s, i) => {
          const pct = (s.dur / totalSec) * 100;
          return (
            <div key={i} style={{
              width: `${pct}%`, height: '100%',
              background: segColors[i % segColors.length],
              borderRight: i < segments.length - 1 ? `2px solid ${T.surface}` : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontFamily: FONT_MONO, fontSize: 10, fontWeight: 600,
              letterSpacing: '0.04em',
              position: 'relative',
            }}>
              <span style={{ position: 'absolute', top: 3, left: 5, opacity: 0.8, fontSize: 8 }}>
                {KIND_META[s.kind].label.toUpperCase()}
              </span>
              SEG {s.n}
            </div>
          );
        })}

        {/* transition wedges */}
        {transitions.map((t, i) => {
          const segIdx = segments.findIndex(s => s.n === t.from);
          const boundary = (cumStart(segments, segIdx + 1) / totalSec) * 100;
          if (t.preset === 'Hard cut') return null;
          return (
            <div key={i} style={{
              position: 'absolute', top: 0, bottom: 0,
              left: `${boundary}%`, width: 18,
              transform: 'translateX(-50%)',
              background: `linear-gradient(90deg, transparent, ${T.amber}80, transparent)`,
              pointerEvents: 'none',
            }} />
          );
        })}
      </div>

      {/* Transition labels */}
      <div style={{
        position: 'relative', height: 14, marginTop: 4,
        fontFamily: FONT_MONO, fontSize: 9, color: T.amber,
      }}>
        {transitions.map((t, i) => {
          const segIdx = segments.findIndex(s => s.n === t.from);
          const boundary = (cumStart(segments, segIdx + 1) / totalSec) * 100;
          return (
            <div key={i} style={{
              position: 'absolute', left: `${boundary}%`,
              transform: 'translateX(-50%)',
              whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 3,
            }}>
              <span>{t.preset}</span>
              {t.sfx && <span style={{ color: T.textDim }}>+ ♪</span>}
            </div>
          );
        })}
      </div>

      {/* Hook track */}
      <TrackRow label="HOOK">
        <div style={{
          position: 'absolute', left: 0, top: -2, height: 5,
          width: `${(1.5 / totalSec) * 100}%`,
          background: T.amber, borderRadius: 1,
        }} />
      </TrackRow>

      {/* Voice track with split markers */}
      <TrackRow label="VOICE" subLabel="split into 4">
        <svg width="100%" height="14" viewBox="0 0 560 14" preserveAspectRatio="none"
             style={{ position: 'absolute', inset: 0 }}>
          {Array.from({ length: 140 }).map((_, i) => {
            const h = 2 + Math.abs(Math.sin(i * 0.5 + i * i * 0.001) * 4) + Math.abs(Math.cos(i * 0.7) * 3);
            return <rect key={i} x={i * 4} y={7 - h/2} width="2" height={h} fill={T.accent} opacity="0.5"/>;
          })}
          {/* split lines */}
          {voiceSplits.map((v, i) => i === 0 ? null : (
            <line key={i}
              x1={(v.start / totalSec) * 560} y1="-2"
              x2={(v.start / totalSec) * 560} y2="16"
              stroke={T.accent} strokeWidth="1.5" strokeDasharray="2 2" />
          ))}
        </svg>
      </TrackRow>

      {/* Music bed */}
      <TrackRow label="MUSIC">
        <svg width="100%" height="14" viewBox="0 0 560 14" preserveAspectRatio="none"
             style={{ position: 'absolute', inset: 0 }}>
          {Array.from({ length: 140 }).map((_, i) => {
            const h = 1 + Math.abs(Math.sin(i * 0.3) * 4) + Math.abs(Math.cos(i * 0.1) * 2);
            return <rect key={i} x={i * 4} y={7 - h/2} width="2" height={h} fill={T.borderStrong}/>;
          })}
        </svg>
      </TrackRow>

      {/* Spot SFX dots */}
      <TrackRow label="SFX" subLabel={`${spotSfx.length} placed`}>
        <div style={{ position: 'absolute', inset: 0 }}>
          {spotSfx.map((s, i) => {
            const pct = (s.at / totalSec) * 100;
            return (
              <div key={i} style={{
                position: 'absolute', left: `${pct}%`, top: '50%',
                transform: 'translate(-50%,-50%)',
                width: 12, height: 12, borderRadius: 6,
                background: T.green, border: `2px solid ${T.greenSoft}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontFamily: FONT_MONO, fontSize: 8, fontWeight: 700,
              }}>
                {i + 1}
              </div>
            );
          })}
        </div>
      </TrackRow>
    </div>
  );
}

function TrackRow({ label, subLabel, children }) {
  return (
    <div style={{
      marginTop: 6, display: 'flex', alignItems: 'center', gap: 8,
      fontFamily: FONT_MONO, fontSize: 10, color: T.textDim,
    }}>
      <span style={{ width: 72, flexShrink: 0 }}>
        {label}
        {subLabel && <span style={{ color: T.textDim, marginLeft: 5 }}>· {subLabel}</span>}
      </span>
      <div style={{
        flex: 1, position: 'relative', height: 14,
        background: T.bg, borderRadius: 2,
      }}>{children}</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Right-rail sections
// ────────────────────────────────────────────────────────────────────────
function GlobalSection({ title, badge, children, foot }) {
  return (
    <div style={{ padding: '16px 22px 14px', borderBottom: `1px solid ${T.border}` }}>
      <div style={{
        fontSize: 11, fontFamily: FONT_MONO, color: T.textDim,
        textTransform: 'uppercase', letterSpacing: '0.08em',
        marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontWeight: 600 }}>{title}</span>
        {badge && (
          <span style={{
            background: T.zinc200, color: T.textMuted, padding: '1px 5px',
            borderRadius: 3, fontSize: 9, letterSpacing: '0.04em',
          }}>{badge}</span>
        )}
      </div>
      {children}
      {foot && (
        <div style={{
          marginTop: 10, fontSize: 10, color: T.textDim, fontFamily: FONT_MONO,
          lineHeight: 1.5,
        }}>{foot}</div>
      )}
    </div>
  );
}

function FakeSelect({ value, hint, small }) {
  return (
    <div>
      <div className="select-fake" style={small ? {
        fontSize: 12, padding: '6px 22px 6px 8px',
        backgroundPosition: 'calc(100% - 10px) 11px, calc(100% - 6px) 11px',
      } : null}>{value}</div>
      {hint && (
        <div style={{
          marginTop: 4, fontSize: 10, color: T.textDim, fontFamily: FONT_MONO,
        }}>{hint}</div>
      )}
    </div>
  );
}

function MicroLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, fontFamily: FONT_MONO, color: T.textDim,
      textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5,
      marginTop: 10,
    }}>{children}</div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Voiceover section
// ────────────────────────────────────────────────────────────────────────

// Waveform with per-segment range bands. User can drag handles OR type
// in start/end timecodes. Range = which portion of the voiceover plays
// during which segment. Ranges may overlap, leave gaps, or skip segments.
function VoiceWaveformEditor({ activeSegN, onPickSeg }) {
  // Width is determined by parent; we use percentage positioning.
  const W = 320; // intrinsic SVG width for waveform pattern
  const segColors = ['#0891b2', '#3b82f6', '#a855f7', '#ec4899'];

  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 6, padding: '10px 10px 12px',
    }}>
      {/* timecode ruler */}
      <div style={{
        position: 'relative', height: 10, marginBottom: 4,
        fontFamily: FONT_MONO, fontSize: 9, color: T.textDim,
      }}>
        {[0, 10, 20, 30, 38.2].map(t => {
          const pct = (t / VOICE_TOTAL) * 100;
          return (
            <span key={t} style={{
              position: 'absolute', left: `${pct}%`,
              transform: pct > 95 ? 'translateX(-100%)' : (pct < 5 ? 'none' : 'translateX(-50%)'),
            }}>{t.toFixed(0)}s</span>
          );
        })}
      </div>

      {/* waveform */}
      <div style={{
        position: 'relative', height: 44, background: T.zinc100,
        borderRadius: 4, overflow: 'hidden',
      }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${W} 44`} preserveAspectRatio="none"
             style={{ display: 'block' }}>
          {Array.from({ length: 160 }).map((_, i) => {
            const h = 3 + Math.abs(Math.sin(i * 0.4 + i * i * 0.0008) * 14)
                       + Math.abs(Math.cos(i * 0.9) * 8);
            return <rect key={i} x={i * 2} y={22 - h/2} width="1.2" height={h} fill={T.borderStrong} />;
          })}
          {/* range bands as overlays */}
          {VOICE_SPLITS.map((v, i) => {
            const xStart = (v.start / VOICE_TOTAL) * W;
            const xEnd   = (v.end   / VOICE_TOTAL) * W;
            const isActive = v.n === activeSegN;
            const color = segColors[i % segColors.length];
            return (
              <g key={i}>
                <rect x={xStart} y={0} width={xEnd - xStart} height={44}
                      fill={color} opacity={isActive ? 0.28 : 0.16}
                      stroke={isActive ? color : 'transparent'} strokeWidth="1.5" />
              </g>
            );
          })}
        </svg>

        {/* range brackets with labels (HTML overlay for click targets) */}
        {VOICE_SPLITS.map((v, i) => {
          const left = (v.start / VOICE_TOTAL) * 100;
          const right = (v.end / VOICE_TOTAL) * 100;
          const isActive = v.n === activeSegN;
          const color = segColors[i % segColors.length];
          return (
            <React.Fragment key={i}>
              {/* range body — click-to-focus */}
              <div
                onClick={() => onPickSeg && onPickSeg(v.n)}
                style={{
                  position: 'absolute', top: 0, bottom: 0,
                  left: `${left}%`, width: `${right - left}%`,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'flex-end',
                  justifyContent: 'center', padding: 2,
                }}
              >
                <span style={{
                  fontFamily: FONT_MONO, fontSize: 9, fontWeight: 700,
                  color: '#fff', background: color,
                  padding: '0 4px', borderRadius: 2,
                  letterSpacing: '0.04em',
                  opacity: isActive ? 1 : 0.85,
                }}>SEG {v.n}</span>
              </div>
              {/* handles — IN */}
              <div style={{
                position: 'absolute', top: -3, bottom: -3,
                left: `${left}%`, width: 4,
                transform: 'translateX(-50%)',
                background: color, borderRadius: 2,
                cursor: 'ew-resize',
                boxShadow: isActive ? `0 0 0 2px ${color}40` : 'none',
              }} />
              {/* handles — OUT */}
              <div style={{
                position: 'absolute', top: -3, bottom: -3,
                left: `${right}%`, width: 4,
                transform: 'translateX(-50%)',
                background: color, borderRadius: 2,
                cursor: 'ew-resize',
                boxShadow: isActive ? `0 0 0 2px ${color}40` : 'none',
              }} />
            </React.Fragment>
          );
        })}
      </div>

      <div style={{
        marginTop: 6, fontSize: 10, fontFamily: FONT_MONO, color: T.textDim,
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>drag handles to set per-segment range</span>
        <span>click a band to nudge below</span>
      </div>
    </div>
  );
}

// Per-range editor — shown when a segment band is selected.
function VoiceRangeEditor({ split }) {
  return (
    <div style={{
      background: T.surfaceAlt, border: `1px solid ${T.borderStrong}`,
      borderRadius: 6, padding: '10px 12px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
      }}>
        <div style={{
          width: 22, height: 22, borderRadius: 4,
          background: '#a855f7', color: '#fff',
          fontFamily: FONT_MONO, fontSize: 11, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>{split.n}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>
            Range for Segment {split.n}
          </div>
          <div style={{
            fontFamily: FONT_MONO, fontSize: 10, color: T.textMuted, marginTop: 2,
          }}>
            length {(split.end - split.start).toFixed(1)}s
            · segment runs {SEGMENTS[split.n - 1]?.dur.toFixed(1)}s
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        {[
          { lbl: 'Start', val: split.start },
          { lbl: 'End',   val: split.end },
        ].map(f => (
          <div key={f.lbl} style={{ flex: 1 }}>
            <div style={{
              fontSize: 9, fontFamily: FONT_MONO, color: T.textDim,
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3,
            }}>{f.lbl}</div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <div style={{
                fontFamily: FONT_MONO, fontSize: 13, fontWeight: 600,
                color: T.text, flex: 1,
              }}>{f.val.toFixed(2)}s</div>
              <button className="row-btn" style={{ padding: '3px 6px', fontSize: 10 }}>−0.1</button>
              <button className="row-btn" style={{ padding: '3px 6px', fontSize: 10 }}>+0.1</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 8, padding: '6px 8px',
        background: T.surface, borderRadius: 4,
        fontFamily: FONT_MONO, fontSize: 11, color: T.textMuted,
        fontStyle: 'italic', lineHeight: 1.4,
        border: `1px solid ${T.border}`,
      }}>
        “{split.snippet}”
      </div>

      <div style={{
        marginTop: 8, display: 'flex', gap: 6, alignItems: 'center',
      }}>
        <button className="row-btn" style={{ padding: '5px 8px', fontSize: 11 }}>
          ▶ Preview range
        </button>
        <button className="row-btn" style={{ padding: '5px 8px', fontSize: 11 }}>
          Snap to silence
        </button>
        <span style={{
          marginLeft: 'auto',
          fontFamily: FONT_MONO, fontSize: 10, color: T.textDim,
        }}>
          retime ratio: <span style={{ color: T.text, fontWeight: 600 }}>1.00×</span>
        </span>
      </div>
    </div>
  );
}

function VoiceoverSection() {
  const activeSegN = 3; // the image segment is the focus elsewhere; sync here
  const activeSplit = VOICE_SPLITS.find(v => v.n === activeSegN);

  return (
    <GlobalSection title="Voiceover" badge="your audio">
      {/* file row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 10px', borderRadius: 5,
        background: T.zinc100, marginBottom: 10,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 4,
          background: T.text, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: FONT_MONO, fontSize: 9, fontWeight: 700,
          flexShrink: 0,
        }}>WAV</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 12, color: T.text, fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>narration_take_03.wav</div>
          <div style={{
            fontFamily: FONT_MONO, fontSize: 10, color: T.textDim, marginTop: 2,
          }}>{VOICE_TOTAL}s · 48kHz · mono</div>
        </div>
        <button className="row-btn" style={{ padding: '4px 8px', fontSize: 10 }}>Replace</button>
      </div>

      {/* Mode toggle: auto vs manual */}
      <MicroLabel>Split mode</MicroLabel>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4,
        background: T.zinc100, padding: 3, borderRadius: 5,
        marginBottom: 12,
      }}>
        {[
          { id: 'auto',   label: 'Auto · silence' },
          { id: 'manual', label: 'Manual ranges' },
        ].map(opt => {
          const isActive = opt.id === 'manual';
          return (
            <div key={opt.id} style={{
              padding: '6px 4px', borderRadius: 3, textAlign: 'center',
              fontSize: 11, fontWeight: isActive ? 600 : 500,
              background: isActive ? T.surface : 'transparent',
              color: isActive ? T.text : T.textMuted,
              boxShadow: isActive ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              {opt.label}
              {isActive && (
                <span style={{
                  background: T.amber, color: '#fff', padding: '1px 3px',
                  borderRadius: 2, fontFamily: FONT_MONO, fontSize: 8, fontWeight: 700,
                  letterSpacing: '0.04em',
                }}>NEW</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Waveform with per-segment range bands */}
      <VoiceWaveformEditor activeSegN={activeSegN} />

      {/* Active range editor */}
      <div style={{ marginTop: 10 }}>
        <VoiceRangeEditor split={activeSplit} />
      </div>

      {/* Compact list of all ranges (lets user jump between them) */}
      <MicroLabel>All ranges</MicroLabel>
      <div style={{
        border: `1px solid ${T.border}`, borderRadius: 5,
        background: T.surface, overflow: 'hidden',
      }}>
        {VOICE_SPLITS.map((v, i) => {
          const isActive = v.n === activeSegN;
          const segColors = ['#0891b2', '#3b82f6', '#a855f7', '#ec4899'];
          return (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: '16px 1fr 92px',
              alignItems: 'center', gap: 8,
              padding: '7px 10px',
              borderBottom: i < VOICE_SPLITS.length - 1 ? `1px solid ${T.border}` : 'none',
              background: isActive ? T.zinc100 : 'transparent',
              cursor: 'pointer',
            }}>
              <div style={{
                width: 14, height: 14, borderRadius: 3,
                background: segColors[i % segColors.length],
                color: '#fff', fontFamily: FONT_MONO, fontSize: 9, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{v.n}</div>
              <div style={{
                fontSize: 11, color: T.textMuted, fontStyle: 'italic',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>“{v.snippet}”</div>
              <div style={{
                fontFamily: FONT_MONO, fontSize: 10, color: T.text,
                textAlign: 'right',
              }}>{v.start.toFixed(1)}–{v.end.toFixed(1)}s</div>
            </div>
          );
        })}
      </div>

      <div style={{
        marginTop: 8, fontSize: 10, fontFamily: FONT_MONO, color: T.textDim,
        lineHeight: 1.5,
      }}>
        Ranges may overlap, leave gaps, or skip a segment entirely.
        Each chunk plays during its matched segment · retimes to fit.
      </div>
    </GlobalSection>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Captions section — source = your own script
// ────────────────────────────────────────────────────────────────────────
function CaptionsSection() {
  return (
    <GlobalSection title="Captions / subtitles" badge="your script">
      <MicroLabel>Source</MicroLabel>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4,
        background: T.zinc100, padding: 3, borderRadius: 5,
      }}>
        {['Auto-transcribe', 'My script', 'Upload .srt'].map((opt, i) => {
          const isActive = i === 1;
          return (
            <div key={opt} style={{
              padding: '6px 4px', borderRadius: 3, textAlign: 'center',
              fontSize: 11, fontWeight: isActive ? 600 : 500,
              background: isActive ? T.surface : 'transparent',
              color: isActive ? T.text : T.textMuted,
              boxShadow: isActive ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              cursor: 'pointer',
            }}>{opt}</div>
          );
        })}
      </div>

      <MicroLabel>Script · aligned to voiceover</MicroLabel>
      <textarea
        defaultValue={SCRIPT_TEXT}
        style={{
          width: '100%', minHeight: 120, padding: '10px 12px',
          fontFamily: FONT_MONO, fontSize: 11, color: T.text,
          border: `1px solid ${T.border}`, borderRadius: 6,
          background: T.surface, resize: 'vertical', outline: 'none',
          lineHeight: 1.55, letterSpacing: '0.005em',
        }}
      />

      <div style={{
        marginTop: 6, display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 10, fontFamily: FONT_MONO, color: T.textDim,
      }}>
        <span style={{ color: T.green, fontWeight: 600 }}>✓ aligned</span>
        <span>· word-level timing from voiceover · 4 paragraphs</span>
        <button className="row-btn" style={{
          marginLeft: 'auto', padding: '3px 8px', fontSize: 10,
        }}>Re-align</button>
      </div>

      <MicroLabel>Style preset</MicroLabel>
      <FakeSelect value="Bold yellow · word-by-word" small hint="6 presets · same as Clip" />
    </GlobalSection>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Spot SFX section
// ────────────────────────────────────────────────────────────────────────
function SpotSfxSection() {
  return (
    <GlobalSection title="Spot SFX" badge={`${SPOT_SFX.length} placed`}>
      <div style={{
        border: `1px solid ${T.border}`, borderRadius: 5,
        background: T.surface, overflow: 'hidden',
      }}>
        {SPOT_SFX.map((s, i) => (
          <div key={i} style={{
            display: 'grid',
            gridTemplateColumns: '22px 60px 1fr 56px 22px',
            alignItems: 'center', gap: 8,
            padding: '8px 10px',
            borderBottom: i < SPOT_SFX.length - 1 ? `1px solid ${T.border}` : 'none',
          }}>
            <div style={{
              width: 18, height: 18, borderRadius: 9,
              background: T.green, color: '#fff',
              fontFamily: FONT_MONO, fontSize: 9, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{i + 1}</div>
            <div style={{
              fontFamily: FONT_MONO, fontSize: 12, color: T.green, fontWeight: 600,
            }}>{s.at.toFixed(1)}s</div>
            <div style={{
              fontFamily: FONT_MONO, fontSize: 11, color: T.text,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{s.label}</div>
            <div style={{
              fontFamily: FONT_MONO, fontSize: 10, color: T.textMuted,
              textAlign: 'right',
            }}>{s.gain}</div>
            <button style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: T.textDim, padding: 0, display: 'flex',
            }}>{Icon.x(11)}</button>
          </div>
        ))}
      </div>

      <button className="row-btn" style={{
        marginTop: 8, width: '100%', padding: '7px',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        fontSize: 11,
      }}>
        {Icon.plus(12)} Add spot SFX at timestamp
      </button>

      <div style={{
        marginTop: 8, fontSize: 10, fontFamily: FONT_MONO, color: T.textDim,
        lineHeight: 1.5,
      }}>
        Library of 80+ one-shots · drop at any timestamp · ducks under voice automatically.
      </div>
    </GlobalSection>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Main screen
// ────────────────────────────────────────────────────────────────────────
function ComposeScreen() {
  const expandedIdx = 2; // image segment expanded so motion preset is visible

  return (
    <AppShell active="compose">
      {/* Header */}
      <div style={{
        padding: '20px 28px 18px',
        borderBottom: `1px solid ${T.border}`, background: T.surface,
      }}>
        {/* Breadcrumb back to Compose list */}
        <div style={{
          marginBottom: 8,
          display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: FONT_MONO, fontSize: 11, color: T.textMuted,
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            cursor: 'pointer', padding: '4px 6px', borderRadius: 4,
            color: T.textMuted,
          }}>
            {Icon.arrowLeft(11)} Compose
          </span>
          <span style={{ color: T.borderStrong }}>›</span>
          <span style={{ color: T.text, fontWeight: 600 }}>Editor</span>
        </div>

        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 16,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{
                fontFamily: FONT_MONO, fontSize: 10, color: T.amber,
                textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600,
              }}>
                Niche: {COMPOSITION.niche}
              </span>
              <StatusPill kind="draft" size="sm" />
            </div>
            <h1 style={{
              margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.015em',
              lineHeight: 1.2,
            }}>{COMPOSITION.title}</h1>
            <div style={{ marginTop: 4, fontSize: 13, color: T.textMuted }}>
              Stitch YouTube, local video, and images. Bring your own voiceover + script.
              Preset selection only — render happens headless.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <button className="row-btn" style={{
              padding: '9px 12px', fontSize: 12,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>Save draft</button>
            <button className="row-btn primary" style={{
              padding: '9px 14px', fontSize: 12,
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}>{Icon.refresh(13)} Render preview</button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* LEFT: segments + transitions */}
        <aside style={{
          width: 372, borderRight: `1px solid ${T.border}`,
          background: T.bg, display: 'flex', flexDirection: 'column',
          flexShrink: 0,
        }}>
          <div style={{
            padding: '14px 16px 8px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Segments</span>
            <span style={{
              fontFamily: FONT_MONO, fontSize: 10, color: T.textDim,
            }}>{SEGMENTS.length} · {TOTAL.toFixed(1)}s total · {TRANSITIONS.length} transitions</span>
          </div>

          <div style={{
            flex: 1, overflow: 'auto', padding: '4px 12px 12px',
          }} className="clipper-scroll">
            {SEGMENTS.map((s, i) => (
              <React.Fragment key={s.n}>
                <SegmentRow
                  seg={s}
                  expanded={i === expandedIdx}
                  percent={(s.dur / TOTAL) * 100}
                />
                {i < SEGMENTS.length - 1 && (
                  <TransitionRow trans={TRANSITIONS[i]} />
                )}
              </React.Fragment>
            ))}

            {/* Add segment (multi-kind) */}
            <div style={{
              marginTop: 8, padding: '12px 14px',
              border: `1.5px dashed ${T.borderStrong}`,
              borderRadius: 7, background: T.surfaceAlt,
            }}>
              <div style={{
                fontSize: 11, fontFamily: FONT_MONO, color: T.textDim,
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
                fontWeight: 600,
              }}>Add segment</div>

              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6,
                marginBottom: 8,
              }}>
                {[
                  { kind: 'yt',    label: 'YouTube' },
                  { kind: 'local', label: 'Local video' },
                  { kind: 'image', label: 'Image' },
                ].map(o => {
                  const m = KIND_META[o.kind];
                  return (
                    <div key={o.kind} style={{
                      padding: '8px 6px', borderRadius: 5, textAlign: 'center',
                      background: T.surface, border: `1px solid ${T.border}`,
                      cursor: 'pointer',
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', gap: 4,
                    }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: 3,
                        background: m.color, color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11,
                      }}>{m.glyph}</div>
                      <div style={{ fontSize: 11, color: T.text, fontWeight: 500 }}>{o.label}</div>
                    </div>
                  );
                })}
              </div>

              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: T.surface, padding: '7px 10px', borderRadius: 5,
                border: `1px solid ${T.border}`,
              }}>
                <span style={{ color: '#FF0033', fontSize: 11 }}>▶</span>
                <span style={{
                  flex: 1, fontFamily: FONT_MONO, fontSize: 12, color: T.textDim,
                }}>paste youtu.be/... or drop a file</span>
                <button className="row-btn primary" style={{
                  padding: '4px 10px', fontSize: 10,
                }}>Fetch</button>
              </div>
            </div>
          </div>
        </aside>

        {/* CENTER: preview + composition bar */}
        <section style={{
          flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
          background: T.bg, alignItems: 'center',
          padding: '20px 24px',
          overflow: 'auto',
        }} className="clipper-scroll">
          <VideoPreview
            height={384}
            timecode="0:00 / 0:38"
            withCaptions
            hookLabel={COMPOSITION.hookText}
            captionLabel="...the entire Geocities archive was 600 gigabytes"
          />

          <div style={{ marginTop: 18, width: '100%', display: 'flex', justifyContent: 'center' }}>
            <CompositionBar
              segments={SEGMENTS}
              transitions={TRANSITIONS}
              voiceSplits={VOICE_SPLITS}
              spotSfx={SPOT_SFX}
              totalSec={TOTAL}
              targetSec={COMPOSITION.targetSec}
            />
          </div>

          <div style={{
            marginTop: 14, fontFamily: FONT_MONO, fontSize: 10, color: T.textDim,
            textAlign: 'center', maxWidth: 520, lineHeight: 1.5,
          }}>
            Preview reflects the last render. Change any control on the right and click
            <span style={{ color: T.accent, fontWeight: 600 }}> Render preview</span> to rebuild.
          </div>
        </section>

        {/* RIGHT: globals */}
        <aside style={{
          width: 372, borderLeft: `1px solid ${T.border}`,
          background: T.surface, overflow: 'auto',
          flexShrink: 0,
          display: 'flex', flexDirection: 'column',
        }} className="clipper-scroll">

          <GlobalSection title="Output length">
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8,
            }}>
              <span style={{
                fontFamily: FONT_MONO, fontSize: 24, fontWeight: 600, color: T.text,
              }}>{COMPOSITION.targetSec}s</span>
              <span style={{
                fontFamily: FONT_MONO, fontSize: 11, color: T.textMuted,
              }}>target · current {TOTAL.toFixed(1)}s</span>
            </div>
            <div style={{
              position: 'relative', height: 6, background: T.zinc200,
              borderRadius: 3, marginTop: 12, marginBottom: 6,
            }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: '48%', background: T.text, borderRadius: 3,
              }} />
              <div style={{
                position: 'absolute', left: '48%', top: -6,
                width: 18, height: 18, borderRadius: 9,
                background: T.surface, border: `2px solid ${T.text}`,
                transform: 'translateX(-50%)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
              }} />
              {[15, 30, 45, 60, 90].map(t => {
                const pct = ((t - 5) / (90 - 5)) * 100;
                return (
                  <div key={t} style={{
                    position: 'absolute', left: `${pct}%`, bottom: -14,
                    transform: 'translateX(-50%)',
                    fontFamily: FONT_MONO, fontSize: 9, color: T.textDim,
                  }}>{t}s</div>
                );
              })}
            </div>
          </GlobalSection>

          <GlobalSection title="Hook" foot="Shown over the first ~1.5s. Selection-only animation.">
            <MicroLabel>Text</MicroLabel>
            <textarea
              defaultValue={COMPOSITION.hookText}
              style={{
                width: '100%', minHeight: 50, padding: '8px 10px',
                fontFamily: FONT_SANS, fontSize: 13, color: T.text,
                border: `1px solid ${T.border}`, borderRadius: 6,
                background: T.surface, resize: 'none', outline: 'none',
                lineHeight: 1.4,
              }}
            />
            <MicroLabel>Animation preset</MicroLabel>
            <FakeSelect value="Slide-in from top · 320ms" small hint="4 presets" />
          </GlobalSection>

          <VoiceoverSection />
          <CaptionsSection />

          <GlobalSection title="Bed music">
            <FakeSelect value="lofi_curiosity_03.mp3" small hint="library · 38 tracks" />
            <MicroLabel>Music gain</MicroLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                fontFamily: FONT_MONO, fontSize: 13, fontWeight: 600, color: T.text,
                minWidth: 56,
              }}>−14 dB</div>
              <div style={{
                flex: 1, height: 4, background: T.zinc200, borderRadius: 2,
                position: 'relative',
              }}>
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: '40%', background: T.text, borderRadius: 2,
                }} />
              </div>
            </div>
            <MicroLabel>Auto-duck under voice</MicroLabel>
            <FakeSelect value="On · −9 dB while voice active" small />
          </GlobalSection>

          <SpotSfxSection />

          <div style={{ flex: 1 }} />

          {/* Decision footer */}
          <div style={{
            padding: '14px 22px 18px',
            background: T.surfaceAlt,
            borderTop: `1px solid ${T.border}`,
            display: 'flex', gap: 8,
            position: 'sticky', bottom: 0,
          }}>
            <button className="row-btn" style={{
              padding: '10px 14px', fontSize: 12,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>{Icon.refresh(13)} Render</button>
            <button className="row-btn accent" style={{
              flex: 1, padding: '10px 14px', fontSize: 12,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>{Icon.upload(14)} Render & upload</button>
          </div>
        </aside>
      </div>

      <Legend />
    </AppShell>
  );
}

Object.assign(window, { ComposeScreen });
