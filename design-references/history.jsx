// history.jsx — Screen 3 (iter 2): read-only history of every clip ever produced

const HISTORY = [
  { date: 'Today · May 20', items: [
    { title: "Carmack on why scale was enough",            source: "Pod 412 — Carmack on AGI",         time: "12:04",  status: 'built' },
    { title: "Morning routine for deep work",              source: "Pod 412 — Carmack on AGI",         time: "12:04",  status: 'uploaded' },
    { title: "AGI safety is not a coordination problem",   source: "Pod 412 — Carmack on AGI",         time: "12:04",  status: 'uploaded' },
    { title: "Why he left Meta — in one sentence",         source: "Pod 412 — Carmack on AGI",         time: "12:04",  status: 'rejected' },
    { title: "Doom, fast iteration, and taste",            source: "Pod 412 — Carmack on AGI",         time: "12:04",  status: 'uploaded' },
    { title: "Advice for self-taught programmers",         source: "Pod 412 — Carmack on AGI",         time: "12:04",  status: 'uploaded' },
  ]},
  { date: 'Yesterday · May 19', items: [
    { title: "TikTok ban explained in 38 seconds",         source: "All-In E172",                       time: "18:22", status: 'uploaded' },
    { title: "Why ByteDance won't sell",                   source: "All-In E172",                       time: "18:22", status: 'uploaded' },
    { title: "Chamath's hot take on First Amendment",      source: "All-In E172",                       time: "18:22", status: 'rejected', dup: true },
    { title: "Sacks: 'this is a Trojan Horse'",            source: "All-In E172",                       time: "18:22", status: 'uploaded' },
    { title: "Friedberg disagrees, calmly",                source: "All-In E172",                       time: "18:22", status: 'uploaded' },
    { title: "What happens to creators on day one",        source: "All-In E172",                       time: "18:22", status: 'uploaded' },
  ]},
  { date: 'Sat · May 17', items: [
    { title: "Why Costco only carries 4,000 SKUs",         source: "Acquired — Costco (part 2)",        time: "09:10", status: 'uploaded' },
    { title: "Sinegal's 14% rule",                         source: "Acquired — Costco (part 2)",        time: "09:10", status: 'uploaded' },
    { title: "The hot dog has not changed price since 1985", source: "Acquired — Costco (part 2)",     time: "09:10", status: 'uploaded' },
    { title: "How Kirkland actually works",                source: "Acquired — Costco (part 2)",        time: "09:10", status: 'uploaded' },
    { title: "Why they will never raise membership",       source: "Acquired — Costco (part 2)",        time: "09:10", status: 'built' },
    { title: "The treasure hunt theory of retail",         source: "Acquired — Costco (part 2)",        time: "09:10", status: 'uploaded' },
    { title: "Costco's only real competitor",              source: "Acquired — Costco (part 2)",        time: "09:10", status: 'rejected' },
  ]},
  { date: 'Wed · May 14', items: [
    { title: "Inflation isn't what you think",             source: "EconTalk — Inflation revisited",    time: "20:48", status: 'uploaded' },
    { title: "Why money supply matters again",             source: "EconTalk — Inflation revisited",    time: "20:48", status: 'uploaded' },
    { title: "The Phillips curve, gently mocked",          source: "EconTalk — Inflation revisited",    time: "20:48", status: 'uploaded' },
    { title: "What the Fed actually controls",             source: "EconTalk — Inflation revisited",    time: "20:48", status: 'uploaded' },
    { title: "A simple rule for personal savings",         source: "EconTalk — Inflation revisited",    time: "20:48", status: 'built' },
  ]},
];

function HistoryCard({ item }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      cursor: 'pointer', position: 'relative',
    }}>
      <div style={{ position: 'relative' }}>
        <div style={{
          aspectRatio: '9 / 16', width: '100%',
          background: '#1a1a1f', borderRadius: 6, overflow: 'hidden',
          position: 'relative',
        }}>
          <svg width="100%" height="100%" viewBox="0 0 9 16" preserveAspectRatio="none"
               style={{ position: 'absolute', inset: 0, display: 'block' }}>
            <defs>
              <pattern id={`hp-${item.title.length}-${item.time}`} width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="1" height="2" fill="rgba(255,255,255,0.07)" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="#1a1a1f" />
            <rect width="100%" height="100%" fill={`url(#hp-${item.title.length}-${item.time})`} />
          </svg>

          {/* status overlay */}
          <div style={{
            position: 'absolute', top: 6, left: 6,
          }}>
            <StatusPill kind={item.status} size="sm" />
          </div>

          {/* duplicate-warning indicator */}
          {item.dup && (
            <div style={{
              position: 'absolute', bottom: 6, left: 6, right: 6,
              background: 'rgba(180, 83, 9, 0.95)', color: '#fff',
              fontFamily: FONT_MONO, fontSize: 9, fontWeight: 600,
              padding: '3px 5px', borderRadius: 3,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}>
              ⚠ near-duplicate of prior clip
            </div>
          )}
        </div>
      </div>

      <div style={{
        fontSize: 12, lineHeight: 1.3, color: T.text, fontWeight: 500,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {item.title}
      </div>

      <div style={{
        fontSize: 10, color: T.textMuted, fontFamily: FONT_MONO,
        lineHeight: 1.4,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {item.source}
      </div>
    </div>
  );
}

function FilterChip({ label, value, active }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '6px 10px', borderRadius: 6,
      background: active ? T.surface : 'transparent',
      border: `1px solid ${active ? T.borderStrong : T.border}`,
      fontSize: 12, color: T.text, cursor: 'pointer',
    }}>
      <span style={{
        fontFamily: FONT_MONO, fontSize: 10, color: T.textDim,
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>{label}</span>
      <span>{value}</span>
      <span style={{ color: T.textDim, fontSize: 10 }}>▾</span>
    </div>
  );
}

function HistoryScreen({ onBack }) {
  return (
    <AppShell active="history">
      {/* Header */}
      <div style={{
        padding: '22px 28px 16px',
        borderBottom: `1px solid ${T.border}`, background: T.surface,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{
            margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.015em',
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            History
            <span style={{
              background: T.text, color: '#fff', padding: '2px 5px',
              borderRadius: 3, fontFamily: FONT_MONO, fontSize: 10, fontWeight: 600,
              letterSpacing: '0.04em',
            }}>II</span>
          </h1>
          <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: T.textDim }}>
            247 clips · from 38 source videos
          </span>
        </div>
        <div style={{ marginTop: 4, fontSize: 13, color: T.textMuted }}>
          Every clip ever produced. Quick scan to spot near-duplicates before re-clipping.
        </div>

        {/* Filters */}
        <div style={{
          marginTop: 16, display: 'flex', alignItems: 'center', gap: 8,
          flexWrap: 'wrap',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: T.zinc100, padding: '6px 10px', borderRadius: 6,
            flex: '0 0 240px',
            border: `1px solid transparent`,
          }}>
            <span style={{ color: T.textDim }}>{Icon.search(13)}</span>
            <input
              defaultValue=""
              placeholder="Search title or source..."
              style={{
                border: 'none', background: 'transparent', outline: 'none',
                fontSize: 12, color: T.text, flex: 1, fontFamily: FONT_SANS,
              }}
            />
          </div>
          <FilterChip label="source" value="any" active />
          <FilterChip label="status" value="any" active />
          <div style={{ flex: 1 }} />
          <span style={{
            fontFamily: FONT_MONO, fontSize: 10, color: T.textDim,
            textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>
            Sort: newest first
          </span>
        </div>
      </div>

      {/* Grid */}
      <div style={{
        flex: 1, overflow: 'auto', background: T.bg, padding: '20px 28px 40px',
      }} className="clipper-scroll">
        {HISTORY.map(group => (
          <div key={group.date} style={{ marginBottom: 28 }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12,
              paddingBottom: 6, borderBottom: `1px solid ${T.border}`,
            }}>
              <span style={{
                fontSize: 13, fontWeight: 600, color: T.text,
              }}>{group.date}</span>
              <span style={{
                fontFamily: FONT_MONO, fontSize: 10, color: T.textDim,
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                {group.items.length} clips
              </span>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 16,
            }}>
              {group.items.map((item, i) => (
                <HistoryCard key={i} item={item} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <Legend />
    </AppShell>
  );
}

Object.assign(window, { HistoryScreen });
