// job-list.jsx — Screen 1: list of processing batches + new-job entry point

function AppShell({ active, children }) {
  return (
    <div className="clipper-app" style={{
      width: '100%', height: '100%', display: 'flex', background: T.bg,
    }}>
      {/* Left nav */}
      <nav style={{
        width: 188, background: T.surface, borderRight: `1px solid ${T.border}`,
        padding: '20px 14px', display: 'flex', flexDirection: 'column', gap: 4,
        flexShrink: 0,
      }}>
        <div style={{
          padding: '4px 6px 18px',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            width: 22, height: 22, borderRadius: 5,
            background: T.text, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: FONT_MONO, fontSize: 11, fontWeight: 700,
          }}>cl</div>
          <span style={{
            fontFamily: FONT_MONO, fontSize: 13, fontWeight: 600,
            letterSpacing: '-0.01em',
          }}>clipper</span>
        </div>

        {[
          { id: 'jobs', label: 'Jobs', count: 6 },
          { id: 'history', label: 'History', count: 247, iter2: true },
        ].map(n => {
          const isActive = n.id === active;
          return (
            <div key={n.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
              background: isActive ? T.zinc100 : 'transparent',
              color: isActive ? T.text : T.textMuted,
              fontWeight: isActive ? 600 : 500, fontSize: 13,
              position: 'relative',
            }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {n.label}
                {n.iter2 && (
                  <span style={{
                    fontFamily: FONT_MONO, fontSize: 8, fontWeight: 600,
                    background: T.text, color: '#fff', padding: '1px 3px',
                    borderRadius: 2, letterSpacing: '0.04em',
                  }}>II</span>
                )}
              </span>
              <span style={{
                fontFamily: FONT_MONO, fontSize: 11, color: T.textDim,
              }}>{n.count}</span>
            </div>
          );
        })}

        <div style={{ flex: 1 }} />

        <div style={{
          padding: '10px 8px', borderTop: `1px solid ${T.border}`,
          marginTop: 8,
        }}>
          <div style={{
            fontFamily: FONT_MONO, fontSize: 10, color: T.textDim,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: 3, background: T.green,
              boxShadow: `0 0 0 3px ${T.greenSoft}`,
            }} />
            worker · idle
          </div>
          <div style={{
            fontFamily: FONT_MONO, fontSize: 10, color: T.textDim, marginTop: 4,
          }}>
            disk · 184 GB free
          </div>
        </div>
      </nav>

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {children}
      </main>
    </div>
  );
}

function JobRow({ source, channel, status, meta, sub, age, primary, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 200px 130px 130px 28px',
        alignItems: 'center', gap: 18,
        padding: '14px 22px',
        borderBottom: `1px solid ${T.border}`,
        background: primary ? '#fbfbff' : T.surface,
        cursor: 'pointer', transition: 'background .12s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = primary ? '#f4f4ff' : T.surfaceAlt}
      onMouseLeave={e => e.currentTarget.style.background = primary ? '#fbfbff' : T.surface}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 500, color: T.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {source}
        </div>
        <div style={{
          fontSize: 12, color: T.textMuted, marginTop: 2,
          fontFamily: FONT_MONO,
        }}>
          {channel}
        </div>
      </div>

      <div><StatusPill kind={status} /></div>

      <div style={{ fontSize: 12, color: T.textMuted, fontFamily: FONT_MONO }}>
        {meta}
        {sub && <div style={{ color: T.textDim, marginTop: 2, fontSize: 11 }}>{sub}</div>}
      </div>

      <div style={{ fontSize: 12, color: T.textDim, fontFamily: FONT_MONO }}>
        {age}
      </div>

      <div style={{ color: T.textDim, display: 'flex', justifyContent: 'flex-end' }}>
        {Icon.chevronRight(14)}
      </div>
    </div>
  );
}

// Inline progress bar for the "cutting" job
function ProgressMini({ done, total }) {
  const pct = Math.round((done / total) * 100);
  return (
    <div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: T.text }}>
        {done}/{total} clips
      </div>
      <div style={{
        marginTop: 4, height: 3, width: 100, background: T.zinc200, borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%', background: T.amber,
        }} />
      </div>
    </div>
  );
}

function JobListScreen({ onOpenBatch }) {
  return (
    <AppShell active="jobs">
      {/* Header */}
      <div style={{
        padding: '22px 28px 18px',
        borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        gap: 16, background: T.surface,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h1 style={{
              margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.015em',
            }}>Jobs</h1>
            <span style={{
              fontFamily: FONT_MONO, fontSize: 12, color: T.textDim,
            }}>6 active · 2 in queue</span>
          </div>
          <div style={{
            marginTop: 4, fontSize: 13, color: T.textMuted,
          }}>
            What's running now. Open a batch when it's ready for review.
          </div>
        </div>

        <button className="row-btn primary" style={{
          padding: '9px 14px', fontSize: 12,
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}>
          {Icon.plus(14)}
          New job · upload spec.yml
        </button>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 200px 130px 130px 28px',
        gap: 18, padding: '10px 22px',
        fontFamily: FONT_MONO, fontSize: 10,
        color: T.textDim, textTransform: 'uppercase', letterSpacing: '0.08em',
        borderBottom: `1px solid ${T.border}`, background: T.bg,
      }}>
        <div>Source</div>
        <div>Status</div>
        <div>Output</div>
        <div>Submitted</div>
        <div />
      </div>

      <div style={{ flex: 1, overflow: 'auto', background: T.surface }} className="clipper-scroll">
        <JobRow
          primary
          source="Pod 412 — Talk with John Carmack on AGI"
          channel="lex_fridman / 2h 41m source"
          status="ready"
          meta="8 clips · 0 reviewed"
          sub={null}
          age="12 min ago"
          onClick={onOpenBatch}
        />
        <JobRow
          source="Stratechery interview — The case for OpenAI search"
          channel="stratechery / 58m source"
          status="cutting"
          meta={<ProgressMini done={4} total={14} />}
          age="3 min ago"
        />
        <JobRow
          source="Lex Fridman #459 — David Sinclair on longevity"
          channel="lex_fridman / 3h 02m source"
          status="downloading"
          meta="~8 min remaining"
          age="just now"
        />
        <JobRow
          source="All-In E172 — The TikTok ban, explained"
          channel="all_in_pod / 1h 28m source"
          status="uploaded"
          meta="6 of 6 uploaded"
          age="yesterday"
        />
        <JobRow
          source="Acquired — Costco (part 2)"
          channel="acquired / 4h 12m source"
          status="uploaded"
          meta="7 of 7 uploaded"
          age="3 days ago"
        />
        <JobRow
          source="EconTalk — Inflation revisited"
          channel="econtalk / 1h 06m source"
          status="uploaded"
          meta="5 of 5 uploaded"
          age="last week"
        />
      </div>

      {/* Footer / legend */}
      <Legend />
    </AppShell>
  );
}

function Legend() {
  return (
    <div style={{
      padding: '10px 22px', borderTop: `1px solid ${T.border}`,
      background: T.bg, display: 'flex', alignItems: 'center', gap: 16,
      fontFamily: FONT_MONO, fontSize: 10, color: T.textDim,
      letterSpacing: '0.04em',
    }}>
      <span style={{ textTransform: 'uppercase' }}>Build order:</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 10, height: 10, border: `1px solid ${T.borderStrong}`, borderRadius: 2,
          background: T.surface,
        }} />
        Iteration 1 · core
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 10, height: 10, border: `1px dashed rgba(67,56,202,0.6)`, borderRadius: 2,
          background: T.surface,
        }} />
        Iteration 2 · added later (marked
        <span style={{
          background: T.text, color: '#fff', padding: '1px 3px',
          borderRadius: 2, fontWeight: 600,
        }}>II</span>
        )
      </span>
    </div>
  );
}

Object.assign(window, { JobListScreen, AppShell, Legend });
