// clip-review.jsx — Screen 2: the hero. Review clips in a batch.

const CLIPS = [
  { idx: 1, title: "Why AGI safety isn't a coordination problem",
    start: '08:14', end: '08:52', dur: '0:38', status: 'approved' },
  { idx: 2, title: "Carmack's morning routine for deep work",
    start: '11:02', end: '11:26', dur: '0:24', status: 'approved' },
  { idx: 3, title: "The moment he realized scale was enough",
    start: '13:42', end: '14:18', dur: '0:36', status: 'needsReview', active: true },
  { idx: 4, title: "Why he left Meta — in one sentence",
    start: '22:51', end: '23:22', dur: '0:31', status: 'needsReview' },
  { idx: 5, title: "On Doom, fast iteration, and taste",
    start: '34:08', end: '35:03', dur: '0:55', status: 'needsReview' },
  { idx: 6, title: "What he'd build if he were 22 again",
    start: '47:21', end: '48:09', dur: '0:48', status: 'rejected' },
  { idx: 7, title: "His unpopular take on academia",
    start: '1:02:14', end: '1:02:47', dur: '0:33', status: 'needsReview' },
  { idx: 8, title: "Advice for self-taught programmers",
    start: '2:14:38', end: '2:15:29', dur: '0:51', status: 'approved' },
];

function ClipListItem({ clip, onClick }) {
  const isActive = clip.active;
  return (
    <div onClick={onClick} style={{
      display: 'flex', gap: 10, padding: '10px 12px',
      borderRadius: 7, cursor: 'pointer',
      background: isActive ? T.surface : 'transparent',
      boxShadow: isActive ? `inset 0 0 0 1px ${T.borderStrong}` : 'none',
      transition: 'background .12s',
      position: 'relative',
    }}>
      {isActive && (
        <div style={{
          position: 'absolute', left: -1, top: 8, bottom: 8, width: 2,
          background: T.accent, borderRadius: 2,
        }} />
      )}
      <MiniTile w={36} label={`l${clip.idx}`} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3,
        }}>
          <span style={{
            fontFamily: FONT_MONO, fontSize: 10, color: T.textDim,
          }}>
            {String(clip.idx).padStart(2, '0')}
          </span>
          <StatusPill kind={clip.status} dotOnly />
          <span style={{
            fontFamily: FONT_MONO, fontSize: 10, color: T.textMuted,
            marginLeft: 'auto',
          }}>
            {clip.dur}
          </span>
        </div>
        <div style={{
          fontSize: 12, lineHeight: 1.35, color: T.text,
          fontWeight: isActive ? 500 : 400,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {clip.title}
        </div>
      </div>
    </div>
  );
}

// Nudge button group: ±2s ±0.5s
function NudgeRow({ label, value, onChange }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 0',
    }}>
      <div style={{
        width: 38, fontSize: 11, fontFamily: FONT_MONO,
        color: T.textDim, textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>{label}</div>

      <div style={{
        fontFamily: FONT_MONO, fontSize: 16, fontWeight: 500,
        color: T.text, minWidth: 72,
      }}>{value}</div>

      <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
        <button className="row-btn" style={{ minWidth: 38 }}>−2s</button>
        <button className="row-btn" style={{ minWidth: 42 }}>−0.5s</button>
        <button className="row-btn" style={{ minWidth: 42 }}>+0.5s</button>
        <button className="row-btn" style={{ minWidth: 38 }}>+2s</button>
      </div>
    </div>
  );
}

function PresetSelect({ label, value, hint }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 11, fontFamily: FONT_MONO, color: T.textDim,
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6,
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>{label}</span>
        {hint && <span style={{ textTransform: 'none', letterSpacing: 0, color: T.textDim }}>{hint}</span>}
      </div>
      <div className="select-fake">{value}</div>
    </div>
  );
}

function SectionTitle({ children, iter2 }) {
  return (
    <div style={{
      fontSize: 11, fontFamily: FONT_MONO, color: T.textDim,
      textTransform: 'uppercase', letterSpacing: '0.08em',
      marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 8,
    }}>
      {children}
      {iter2 && (
        <span style={{
          background: T.text, color: '#fff', padding: '1px 3px',
          borderRadius: 2, fontWeight: 600, fontSize: 8, letterSpacing: '0.04em',
        }}>II</span>
      )}
    </div>
  );
}

function ClipReviewScreen({ onBack }) {
  const active = CLIPS.find(c => c.active);
  const approvedCount = CLIPS.filter(c => c.status === 'approved').length;
  const reviewedCount = CLIPS.filter(c => c.status !== 'needsReview').length;

  return (
    <AppShell active="jobs">
      {/* Header */}
      <div style={{
        padding: '16px 28px',
        borderBottom: `1px solid ${T.border}`, background: T.surface,
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: T.textMuted, display: 'inline-flex', alignItems: 'center',
          gap: 6, padding: '6px 8px', borderRadius: 5, fontSize: 12,
          fontFamily: FONT_MONO,
        }}>
          {Icon.arrowLeft(13)} jobs
        </button>

        <div style={{ width: 1, height: 22, background: T.border }} />

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            Pod 412 — Talk with John Carmack on AGI
          </div>
          <div style={{
            fontSize: 11, color: T.textMuted, fontFamily: FONT_MONO, marginTop: 2,
          }}>
            lex_fridman · 2h 41m source · batch built 12 min ago
          </div>
        </div>

        <div style={{
          fontSize: 12, color: T.textMuted, fontFamily: FONT_MONO,
          textAlign: 'right',
        }}>
          <div>{reviewedCount} of {CLIPS.length} reviewed</div>
          <div style={{ color: T.green, marginTop: 2 }}>{approvedCount} approved</div>
        </div>

        <button className="row-btn accent" style={{
          padding: '10px 14px', fontSize: 12,
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}>
          {Icon.upload(14)}
          Upload {approvedCount} approved
        </button>
      </div>

      {/* Body: 3 columns */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* LEFT: clip list */}
        <aside style={{
          width: 264, borderRight: `1px solid ${T.border}`,
          background: T.bg, display: 'flex', flexDirection: 'column',
          flexShrink: 0,
        }}>
          <div style={{
            padding: '14px 16px 10px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Clips</span>
            <span style={{
              fontFamily: FONT_MONO, fontSize: 10, color: T.textDim,
            }}>{CLIPS.length}</span>
          </div>
          <div style={{
            flex: 1, overflow: 'auto', padding: '0 10px 14px',
            display: 'flex', flexDirection: 'column', gap: 2,
          }} className="clipper-scroll">
            {CLIPS.map(c => <ClipListItem key={c.idx} clip={c} />)}
          </div>
        </aside>

        {/* CENTER: preview */}
        <section style={{
          flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
          background: T.bg, alignItems: 'center',
          padding: '24px 28px',
        }}>
          {/* Title row */}
          <div style={{
            width: '100%', maxWidth: 480, marginBottom: 16,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            gap: 12,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 10, fontFamily: FONT_MONO, color: T.textDim,
                textTransform: 'uppercase', letterSpacing: '0.08em',
                marginBottom: 4,
              }}>
                Clip 03 of 08
              </div>
              <div style={{
                fontSize: 17, fontWeight: 600, letterSpacing: '-0.015em',
                lineHeight: 1.25, color: T.text,
              }}>
                {active.title}
              </div>
              <div style={{
                marginTop: 6, display: 'flex', alignItems: 'center', gap: 10,
                fontFamily: FONT_MONO, fontSize: 11, color: T.textMuted,
              }}>
                <span>{active.start} → {active.end}</span>
                <span style={{ color: T.borderStrong }}>·</span>
                <span>{active.dur}</span>
                <span style={{ color: T.borderStrong }}>·</span>
                <StatusPill kind={active.status} size="sm" />
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="iter2-host" style={{ position: 'relative' }}>
            <VideoPreview
              height={488}
              timecode="0:00 / 0:36"
              withCaptions
              hookLabel="WHEN I SAW THE LOSS CURVE"
              captionLabel="...and I realized we didn't need a new idea, we just needed more compute."
            />
            {/* iter2 marker for the styled overlays */}
            <div style={{
              position: 'absolute', top: 6, left: -42,
              display: 'flex', flexDirection: 'column', gap: 6,
              alignItems: 'flex-end',
            }}>
              <div style={{
                fontFamily: FONT_MONO, fontSize: 8, fontWeight: 600,
                background: T.text, color: '#fff', padding: '2px 4px',
                borderRadius: 3, letterSpacing: '0.04em',
              }}>II</div>
              <div style={{
                fontFamily: FONT_MONO, fontSize: 9, color: T.textDim,
                writingMode: 'vertical-rl', transform: 'rotate(180deg)',
                whiteSpace: 'nowrap',
              }}>
                styled overlay preview
              </div>
            </div>
          </div>

          {/* Inline transport */}
          <div style={{
            marginTop: 14, display: 'flex', alignItems: 'center', gap: 10,
            fontFamily: FONT_MONO, fontSize: 11, color: T.textMuted,
          }}>
            <div style={{
              flex: 1, height: 3, background: T.zinc200, borderRadius: 2,
              position: 'relative', maxWidth: 220,
            }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: '0%', background: T.text, borderRadius: 2,
              }} />
            </div>
            <span>0:00 / 0:36</span>
          </div>
        </section>

        {/* RIGHT: controls */}
        <aside style={{
          width: 388, borderLeft: `1px solid ${T.border}`,
          background: T.surface, overflow: 'auto',
          flexShrink: 0,
          display: 'flex', flexDirection: 'column',
        }} className="clipper-scroll">

          {/* Boundary section */}
          <div style={{ padding: '18px 22px 14px' }}>
            <SectionTitle>Boundary</SectionTitle>

            <NudgeRow label="START" value={active.start} />
            <div style={{ height: 1, background: T.border }} />
            <NudgeRow label="END" value={active.end} />

            <button className="row-btn" style={{
              marginTop: 12, width: '100%', padding: '9px',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              gap: 8,
            }}>
              {Icon.refresh(13)}
              Regenerate clip with new boundary
            </button>
          </div>

          {/* Auto-suggestion (iter2) */}
          <div style={{ padding: '4px 22px 18px' }}>
            <div className="iter2" style={{
              background: T.accentSoft,
              border: `1px solid ${T.accent}25`,
              borderRadius: 8, padding: '12px 14px',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontFamily: FONT_MONO, fontSize: 10, color: T.accent,
                textTransform: 'uppercase', letterSpacing: '0.08em',
                fontWeight: 600, marginBottom: 6,
              }}>
                <span style={{ color: T.accent }}>{Icon.sparkle(11)}</span>
                Auto suggestion
              </div>
              <div style={{
                fontSize: 13, color: T.text, lineHeight: 1.45,
              }}>
                Shift end <span style={{ fontFamily: FONT_MONO, color: T.textMuted }}>14:18</span>
                {' → '}
                <span style={{ fontFamily: FONT_MONO, color: T.accent, fontWeight: 600 }}>14:21</span>
                {' '}to avoid cutting off the word "compute".
              </div>
              <div style={{
                marginTop: 10, display: 'flex', gap: 6,
              }}>
                <button className="row-btn" style={{
                  background: T.accent, color: '#fff', borderColor: T.accent,
                  fontSize: 11,
                }}>
                  Accept
                </button>
                <button className="row-btn" style={{ fontSize: 11 }}>Dismiss</button>
              </div>
            </div>
          </div>

          <div style={{ height: 1, background: T.border, margin: '0 22px' }} />

          {/* Style presets (iter2) */}
          <div style={{ padding: '18px 22px 14px' }} className="iter2">
            <SectionTitle iter2>Style</SectionTitle>
            <PresetSelect
              label="Caption preset"
              value="Bold yellow · centered low"
              hint="6 presets"
            />
            <PresetSelect
              label="Hook preset"
              value="All-caps · top-left · 1.2s hold"
              hint="4 presets"
            />
            <div style={{
              fontSize: 11, color: T.textDim, fontFamily: FONT_MONO,
              lineHeight: 1.5, marginTop: 4,
            }}>
              Changing a preset queues a regenerate.
              Style is preset selection only — no per-property editing.
            </div>
          </div>

          <div style={{ flex: 1 }} />

          {/* Decision */}
          <div style={{
            padding: '16px 22px 20px',
            borderTop: `1px solid ${T.border}`,
            background: T.surfaceAlt,
            display: 'flex', gap: 8,
          }}>
            <button className="row-btn danger-ghost" style={{
              flex: '0 0 auto', padding: '10px 16px', fontSize: 12,
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}>
              {Icon.x(13)} Reject
            </button>
            <button className="row-btn green" style={{
              flex: 1, padding: '10px 16px', fontSize: 12,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              {Icon.check(14)} Approve clip
            </button>
          </div>
        </aside>
      </div>

      <Legend />
    </AppShell>
  );
}

Object.assign(window, { ClipReviewScreen, CLIPS });
