// compose-timeline.jsx — Iteration 4 variant of Compose with a read-only
// timeline strip at the bottom of the screen. Drag-to-reorder segment blocks
// is the ONLY edit action on the timeline; everything else is read-only with
// hover-scrub preview.
//
// This is a deliberate middle path: spatial intuition without an NLE.

const TL_TOTAL = TOTAL;            // composition duration, from compose.jsx
const HOVER_SEC = 14.2;            // frozen hover position for the mock

// ────────────────────────────────────────────────────────────────────────
// Timeline strip
// ────────────────────────────────────────────────────────────────────────

const TL_SEG_COLORS = ['#0891b2', '#3b82f6', '#a855f7', '#ec4899'];

function TimelineRuler({ totalSec, pxPerSec }) {
  const ticks = [];
  for (let t = 0; t <= totalSec; t += 1) ticks.push(t);
  return (
    <div style={{
      position: 'relative', height: 22, marginLeft: 80,
      borderBottom: `1px solid ${T.border}`,
    }}>
      {ticks.map(t => {
        const isBig = t % 5 === 0;
        const isMid = t % 1 === 0;
        return (
          <div key={t} style={{
            position: 'absolute', left: t * pxPerSec,
            top: 0, bottom: 0,
            display: 'flex', alignItems: 'flex-end',
          }}>
            <div style={{
              width: 1,
              height: isBig ? 10 : (isMid ? 5 : 3),
              background: isBig ? T.textMuted : T.borderStrong,
            }} />
            {isBig && (
              <span style={{
                position: 'absolute', bottom: 11, left: 4,
                fontFamily: FONT_MONO, fontSize: 10, color: T.textMuted,
                whiteSpace: 'nowrap',
              }}>{t}s</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TimelineTrackLabel({ children, sub }) {
  return (
    <div style={{
      width: 80, flexShrink: 0, padding: '0 10px',
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      borderRight: `1px solid ${T.border}`,
      fontFamily: FONT_MONO, fontSize: 10, color: T.textMuted,
      letterSpacing: '0.06em', textTransform: 'uppercase',
    }}>
      <span style={{ fontWeight: 600 }}>{children}</span>
      {sub && <span style={{
        color: T.textDim, fontSize: 9, marginTop: 2,
        textTransform: 'none', letterSpacing: 0,
      }}>{sub}</span>}
    </div>
  );
}

// Segment block on the timeline. "lifted" gives the visible drag state.
function TimelineSegment({ seg, x, w, color, lifted, dim }) {
  const m = KIND_META[seg.kind];
  return (
    <div style={{
      position: 'absolute',
      left: x, top: 4, bottom: 4, width: w,
      background: color, color: '#fff', borderRadius: 4,
      overflow: 'hidden',
      cursor: 'grab',
      transform: lifted ? 'translateY(-4px) scale(1.02)' : 'none',
      boxShadow: lifted
        ? `0 8px 18px rgba(0,0,0,0.25), 0 0 0 2px ${T.text}`
        : `0 1px 0 rgba(0,0,0,0.1)`,
      opacity: dim ? 0.45 : 1,
      transition: lifted ? 'none' : 'transform .15s, opacity .15s',
      zIndex: lifted ? 10 : 1,
      display: 'flex', flexDirection: 'column',
      padding: '4px 6px',
    }}>
      {/* drag grip */}
      <div style={{
        position: 'absolute', top: 4, right: 4,
        opacity: 0.5,
      }}>
        <svg width="8" height="12" viewBox="0 0 8 12">
          {[2, 6, 10].flatMap(y => [
            <circle key={`l${y}`} cx="2" cy={y} r="0.9" fill="#fff"/>,
            <circle key={`r${y}`} cx="6" cy={y} r="0.9" fill="#fff"/>,
          ])}
        </svg>
      </div>

      <div style={{
        fontFamily: FONT_MONO, fontSize: 8, fontWeight: 700,
        opacity: 0.85, letterSpacing: '0.04em',
      }}>
        {m.label.toUpperCase()} · SEG {seg.n}
      </div>
      <div style={{
        fontFamily: FONT_SANS, fontSize: 10, fontWeight: 500,
        marginTop: 1, lineHeight: 1.2,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {seg.label}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{
        fontFamily: FONT_MONO, fontSize: 9, opacity: 0.85,
      }}>
        {seg.dur.toFixed(1)}s
      </div>
    </div>
  );
}

function TimelineStrip() {
  // Layout math
  const trackWidth = 1248 - 80 - 22; // viewport minus label gutter + scroll allowance
  const pxPerSec = trackWidth / TL_TOTAL;

  // For the static mock, freeze the drag state on SEG 2 between SEG 3 and SEG 4
  const liftedSegN = 2;

  // Render order with the lifted segment offset so it appears between SEG 3 and SEG 4
  // (visual mock; data-model doesn't actually mutate)
  const liftedLeft = (cumStart(SEGMENTS, 2) + cumStart(SEGMENTS, 3)) / 2 / TL_TOTAL * (trackWidth);

  return (
    <div style={{
      background: T.surface, borderTop: `1px solid ${T.border}`,
      display: 'flex', flexDirection: 'column',
      flexShrink: 0,
      position: 'relative',
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 16px', borderBottom: `1px solid ${T.border}`,
      }}>
        <span style={{
          fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600,
          letterSpacing: '0.06em', textTransform: 'uppercase',
          color: T.text,
        }}>Timeline</span>
        <span style={{
          fontFamily: FONT_MONO, fontSize: 10, color: T.textDim,
        }}>last rendered · 4 segments · {TL_TOTAL.toFixed(1)}s</span>

        <span style={{
          background: T.amberSoft, color: T.amber,
          padding: '2px 6px', borderRadius: 3,
          fontFamily: FONT_MONO, fontSize: 9, fontWeight: 700,
          letterSpacing: '0.04em',
          marginLeft: 8,
        }}>IV · NEW</span>

        <div style={{ flex: 1 }} />

        {/* Hint */}
        <span style={{
          fontFamily: FONT_MONO, fontSize: 10, color: T.textDim,
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{ color: T.accent }}>↔</span>
          hover to scrub
          <span style={{ color: T.borderStrong, margin: '0 6px' }}>·</span>
          <span style={{ color: T.accent }}>⇆</span>
          drag a segment to reorder
        </span>

        <div style={{ width: 1, height: 16, background: T.border }} />

        {/* Zoom */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 2,
          fontFamily: FONT_MONO, fontSize: 10, color: T.textMuted,
        }}>
          <button className="row-btn" style={{ padding: '3px 7px', fontSize: 10 }}>−</button>
          <span style={{ padding: '0 6px' }}>fit · {pxPerSec.toFixed(0)} px/s</span>
          <button className="row-btn" style={{ padding: '3px 7px', fontSize: 10 }}>+</button>
        </div>
      </div>

      {/* Ruler */}
      <TimelineRuler totalSec={TL_TOTAL} pxPerSec={pxPerSec} />

      {/* The frame thumbnail preview that floats above the hover line.
          Positioned absolutely relative to the timeline so it can extend up. */}
      <div style={{
        position: 'absolute',
        left: 80 + HOVER_SEC * pxPerSec,
        top: -88, transform: 'translateX(-50%)',
        pointerEvents: 'none', zIndex: 50,
      }}>
        <div style={{
          width: 50, height: 88, borderRadius: 5,
          background: '#0e0e10', overflow: 'hidden',
          boxShadow: `0 6px 20px rgba(0,0,0,0.35), 0 0 0 2px ${T.text}`,
          position: 'relative',
        }}>
          <svg width="100%" height="100%" viewBox="0 0 9 16" preserveAspectRatio="none">
            <defs>
              <pattern id="hov-pv" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="1" height="2" fill="rgba(255,255,255,0.08)" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="#1f2a38" />
            <rect width="100%" height="100%" fill="url(#hov-pv)" />
          </svg>
          <div style={{
            position: 'absolute', bottom: 4, left: '50%',
            transform: 'translateX(-50%)',
            color: '#fef08a', fontFamily: FONT_SANS,
            fontSize: 6, fontWeight: 700, textAlign: 'center',
            textShadow: '0 1px 2px rgba(0,0,0,0.9)',
          }}>
            …take twelve seconds to load
          </div>
        </div>
        {/* timecode badge */}
        <div style={{
          marginTop: 4, padding: '2px 6px',
          background: T.text, color: '#fff',
          fontFamily: FONT_MONO, fontSize: 10, fontWeight: 600,
          borderRadius: 3, textAlign: 'center',
        }}>
          {HOVER_SEC.toFixed(1)}s
        </div>
      </div>

      {/* TRACKS */}
      <div style={{ position: 'relative', userSelect: 'none' }}>

        {/* Hover/playhead line across all tracks */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: 80 + HOVER_SEC * pxPerSec,
          width: 1, background: T.accent,
          zIndex: 20, pointerEvents: 'none',
          boxShadow: `0 0 0 1px ${T.accent}30`,
        }} />

        {/* Segments track */}
        <div style={{
          display: 'flex', alignItems: 'stretch',
          height: 56, borderBottom: `1px solid ${T.border}`,
          background: T.bg,
        }}>
          <TimelineTrackLabel sub="drag to reorder">Segments</TimelineTrackLabel>
          <div style={{ position: 'relative', flex: 1 }}>
            {SEGMENTS.map((s, i) => {
              if (s.n === liftedSegN) return null; // render lifted one separately
              const x = cumStart(SEGMENTS, i) * pxPerSec;
              const w = s.dur * pxPerSec - 2;
              return (
                <TimelineSegment key={s.n}
                  seg={s} x={x} w={w}
                  color={TL_SEG_COLORS[(s.n - 1) % TL_SEG_COLORS.length]}
                  dim={false}
                />
              );
            })}

            {/* drop-target indicator between SEG 3 and SEG 4 */}
            <div style={{
              position: 'absolute',
              left: (cumStart(SEGMENTS, 3)) * pxPerSec - 2,
              top: 0, bottom: 0, width: 4,
              background: T.text, borderRadius: 2,
              boxShadow: `0 0 0 2px ${T.zinc100}`,
              zIndex: 5,
            }} />

            {/* lifted segment (the one being dragged) */}
            {(() => {
              const lifted = SEGMENTS.find(s => s.n === liftedSegN);
              const w = lifted.dur * pxPerSec - 2;
              return (
                <TimelineSegment
                  seg={lifted}
                  x={liftedLeft - w / 2}
                  w={w}
                  color={TL_SEG_COLORS[(lifted.n - 1) % TL_SEG_COLORS.length]}
                  lifted
                />
              );
            })()}

            {/* transitions overlay */}
            {TRANSITIONS.map((t, i) => {
              if (t.preset === 'Hard cut') return null;
              if (t.from === liftedSegN || t.to === liftedSegN) return null;
              const segIdx = SEGMENTS.findIndex(s => s.n === t.from);
              const x = cumStart(SEGMENTS, segIdx + 1) * pxPerSec;
              return (
                <div key={i} style={{
                  position: 'absolute', top: 0, bottom: 0,
                  left: x - 9, width: 18,
                  background: `linear-gradient(90deg, transparent, ${T.amber}60, transparent)`,
                  pointerEvents: 'none', zIndex: 2,
                }} />
              );
            })}
          </div>
        </div>

        {/* Hook track */}
        <div style={{
          display: 'flex', alignItems: 'center',
          height: 22, borderBottom: `1px solid ${T.border}`,
          background: T.surface,
        }}>
          <TimelineTrackLabel>Hook</TimelineTrackLabel>
          <div style={{ position: 'relative', flex: 1, height: '100%' }}>
            <div style={{
              position: 'absolute', left: 0, top: 5, bottom: 5,
              width: 1.5 * pxPerSec,
              background: T.amber, borderRadius: 2,
              display: 'flex', alignItems: 'center', paddingLeft: 6,
              color: '#fff', fontFamily: FONT_MONO, fontSize: 9, fontWeight: 600,
              letterSpacing: '0.04em', overflow: 'hidden',
            }}>
              HOOK · 1.5s
            </div>
          </div>
        </div>

        {/* Voice track */}
        <div style={{
          display: 'flex', alignItems: 'center',
          height: 30, borderBottom: `1px solid ${T.border}`,
          background: T.surface,
        }}>
          <TimelineTrackLabel sub="from your wav">Voice</TimelineTrackLabel>
          <div style={{ position: 'relative', flex: 1, height: '100%' }}>
            <svg width="100%" height="100%" viewBox="0 0 1000 30" preserveAspectRatio="none"
                 style={{ position: 'absolute', inset: 0 }}>
              {Array.from({ length: 300 }).map((_, i) => {
                const h = 1.5 + Math.abs(Math.sin(i * 0.4 + i * i * 0.0008) * 9)
                              + Math.abs(Math.cos(i * 0.9) * 5);
                return <rect key={i} x={i * 3.33} y={15 - h/2} width="1.5" height={h} fill={T.accent} opacity="0.55"/>;
              })}
            </svg>
            {/* split markers */}
            {VOICE_SPLITS.map((v, i) => {
              if (i === 0) return null;
              const x = (v.start / TL_TOTAL) * trackWidth;
              return (
                <div key={i} style={{
                  position: 'absolute', left: x, top: 0, bottom: 0,
                  width: 0,
                  borderLeft: `1.5px dashed ${T.accent}`,
                }} />
              );
            })}
          </div>
        </div>

        {/* Music track */}
        <div style={{
          display: 'flex', alignItems: 'center',
          height: 24, borderBottom: `1px solid ${T.border}`,
          background: T.surface,
        }}>
          <TimelineTrackLabel>Music</TimelineTrackLabel>
          <div style={{ position: 'relative', flex: 1, height: '100%' }}>
            <svg width="100%" height="100%" viewBox="0 0 1000 24" preserveAspectRatio="none"
                 style={{ position: 'absolute', inset: 0 }}>
              {Array.from({ length: 300 }).map((_, i) => {
                const h = 1 + Math.abs(Math.sin(i * 0.3) * 6) + Math.abs(Math.cos(i * 0.1) * 3);
                return <rect key={i} x={i * 3.33} y={12 - h/2} width="1.5" height={h} fill={T.borderStrong}/>;
              })}
            </svg>
          </div>
        </div>

        {/* SFX track */}
        <div style={{
          display: 'flex', alignItems: 'center',
          height: 26,
          background: T.surface,
        }}>
          <TimelineTrackLabel sub={`${SPOT_SFX.length} placed`}>Sfx</TimelineTrackLabel>
          <div style={{ position: 'relative', flex: 1, height: '100%' }}>
            {SPOT_SFX.map((s, i) => {
              const x = (s.at / TL_TOTAL) * trackWidth;
              return (
                <div key={i} style={{
                  position: 'absolute', left: x, top: '50%',
                  transform: 'translate(-50%,-50%)',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  <div style={{
                    width: 14, height: 14, borderRadius: 7,
                    background: T.green, color: '#fff',
                    fontFamily: FONT_MONO, fontSize: 9, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: `2px solid ${T.greenSoft}`,
                  }}>{i + 1}</div>
                  <span style={{
                    fontFamily: FONT_MONO, fontSize: 9, color: T.textMuted,
                    whiteSpace: 'nowrap',
                  }}>{s.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Compose screen variant with timeline strip at the bottom.
// ────────────────────────────────────────────────────────────────────────
function ComposeTimelineScreen() {
  const expandedIdx = 2;

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
          <span style={{ color: T.borderStrong }}>·</span>
          <span style={{
            background: T.text, color: '#fff', padding: '1px 4px',
            borderRadius: 2, fontSize: 8, fontWeight: 700, letterSpacing: '0.04em',
          }}>IV · TIMELINE</span>
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
              Read-only timeline at the bottom. Hover to scrub the rendered preview.
              Drag a segment block to reorder. Everything else still happens in the rails.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <SaveActionDropdown />
            <button className="row-btn primary" style={{
              padding: '9px 14px', fontSize: 12,
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}>{Icon.refresh(13)} Render preview</button>
          </div>
        </div>
      </div>

      {/* Body — same three columns, just shorter to make room for timeline */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* LEFT: segments + transitions (unchanged but slightly compressed) */}
        <aside style={{
          width: 348, borderRight: `1px solid ${T.border}`,
          background: T.bg, display: 'flex', flexDirection: 'column',
          flexShrink: 0,
        }}>
          <div style={{
            padding: '12px 16px 6px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Segments</span>
            <span style={{
              fontFamily: FONT_MONO, fontSize: 10, color: T.textDim,
            }}>{SEGMENTS.length} · {TOTAL.toFixed(1)}s · {TRANSITIONS.length} transitions</span>
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
          </div>
        </aside>

        {/* CENTER: preview only — no comp diagram; timeline owns that now */}
        <section style={{
          flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
          background: T.bg, alignItems: 'center', justifyContent: 'center',
          padding: '16px 20px',
        }}>
          <VideoPreview
            height={324}
            timecode={`${HOVER_SEC.toFixed(1)}s / ${TL_TOTAL.toFixed(1)}s`}
            withCaptions
            hookLabel={COMPOSITION.hookText}
            captionLabel="...take twelve seconds to load"
          />

          <div style={{
            marginTop: 12, fontFamily: FONT_MONO, fontSize: 10, color: T.textDim,
            textAlign: 'center', maxWidth: 360, lineHeight: 1.5,
          }}>
            Frame at <span style={{ color: T.accent, fontWeight: 700 }}>
              {HOVER_SEC.toFixed(1)}s
            </span> · hovered from timeline below
          </div>

          {/* annotation explaining the model */}
          <div style={{
            marginTop: 16, padding: '10px 14px',
            background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: 7, maxWidth: 380,
            fontSize: 11, color: T.textMuted, lineHeight: 1.5,
          }}>
            <div style={{
              fontFamily: FONT_MONO, fontSize: 10, color: T.amber,
              fontWeight: 700, letterSpacing: '0.06em',
              textTransform: 'uppercase', marginBottom: 4,
            }}>Read-only timeline</div>
            Trim, transitions, voice ranges, captions, SFX — all still edited in the
            rails. The timeline below shows you the result and lets you reorder
            segments by drag. That's it.
          </div>
        </section>

        {/* RIGHT: full globals — same as artboard 04, just scrolls within the
            shorter rail height. No footer buttons; Render preview lives in the
            header now. */}
        <aside style={{
          width: 348, borderLeft: `1px solid ${T.border}`,
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
        </aside>
      </div>

      {/* Timeline strip at the bottom */}
      <TimelineStrip />

      <Legend />
    </AppShell>
  );
}

// ────────────────────────────────────────────────────────────────────────
// SaveActionDropdown
// Save-or-finalize split. Shown OPEN in the mock so both options are visible.
// Default action is Save draft; Finalize video is the ship-it action with an
// accent color so it reads as different in weight.
// ────────────────────────────────────────────────────────────────────────
function SaveActionDropdown() {
  const open = true; // mock state — show the menu opened so both options are visible

  return (
    <div style={{ position: 'relative' }}>
      {/* Button */}
      <button className="row-btn" style={{
        padding: '9px 8px 9px 12px', fontSize: 12,
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: open ? T.zinc100 : T.surface,
        boxShadow: open ? `0 0 0 1px ${T.borderStrong}` : 'none',
      }}>
        Save draft
        <span style={{
          display: 'inline-flex', alignItems: 'center',
          paddingLeft: 6, marginLeft: 2,
          borderLeft: `1px solid ${T.border}`,
          color: T.textMuted,
        }}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M2 4 L5 7 L8 4" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
        </span>
      </button>

      {/* Menu */}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 6,
          background: T.surface,
          border: `1px solid ${T.borderStrong}`,
          borderRadius: 8, padding: 5,
          minWidth: 232,
          boxShadow: '0 12px 32px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.06)',
          zIndex: 100,
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {/* Save draft */}
          <button style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '9px 10px', borderRadius: 5,
            background: T.zinc100, border: 'none', cursor: 'pointer',
            fontFamily: FONT_SANS, textAlign: 'left', width: '100%',
          }}>
            <span style={{
              width: 18, height: 18, marginTop: 1, flexShrink: 0,
              borderRadius: 4, background: T.text, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {Icon.check(12)}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{
                fontSize: 12, fontWeight: 600, color: T.text,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                Save draft
                <span style={{
                  fontFamily: FONT_MONO, fontSize: 9, fontWeight: 600,
                  background: T.zinc200, color: T.textMuted,
                  padding: '1px 4px', borderRadius: 2, letterSpacing: '0.04em',
                }}>DEFAULT</span>
              </div>
              <div style={{
                marginTop: 2, fontSize: 11, color: T.textMuted, lineHeight: 1.4,
              }}>
                Keep working on this composition. Stays in Drafts.
              </div>
            </div>
            <span style={{
              fontFamily: FONT_MONO, fontSize: 9, color: T.textDim,
              marginTop: 2, flexShrink: 0,
            }}>⌘S</span>
          </button>

          {/* Divider */}
          <div style={{
            height: 1, background: T.border, margin: '3px 8px',
          }} />

          {/* Finalize video */}
          <button style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '9px 10px', borderRadius: 5,
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontFamily: FONT_SANS, textAlign: 'left', width: '100%',
            transition: 'background .12s',
          }}>
            <span style={{
              width: 18, height: 18, marginTop: 1, flexShrink: 0,
              borderRadius: 4,
              background: T.green, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {Icon.upload(11)}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{
                fontSize: 12, fontWeight: 600, color: T.text,
              }}>
                Finalize video
              </div>
              <div style={{
                marginTop: 2, fontSize: 11, color: T.textMuted, lineHeight: 1.4,
              }}>
                Render final at 1080×1920 and move to Uploaded.
              </div>
            </div>
            <span style={{
              fontFamily: FONT_MONO, fontSize: 9, color: T.textDim,
              marginTop: 2, flexShrink: 0,
            }}>⇧⌘S</span>
          </button>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { ComposeTimelineScreen, SaveActionDropdown });
