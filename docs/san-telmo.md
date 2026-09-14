# Universidad de San Telmo — reference dataset

The fictional institution served by the `synthetic` adapter. **Generated, not anonymised**: no real
person, no existing institution, no production system. Named after the patron saint of sailors,
which is why the campus sits on the coast.

This file is the **closed specification** produced by M0. The deterministic generator that expands it
is M1 code. Closed means: the numbers below are decided and are not re-litigated while building — if
a number has to change, it changes *here* first.

| | |
| :-- | :-- |
| **Adapter** | `synthetic` |
| **Locale** | `es-ES` |
| **Seed** | `san-telmo-2026` (fixed) |
| **Academic year** | 2026–2027 |
| **Capabilities declared** | rooms, timetable, deadlines, wayfinding, issues |

> **Determinism is a contract.** Same seed → same rooms, same timetables, same issue numbers. Whoever
> clones the repository gets exactly the answers in the video. The generator must be pure: no
> `Math.random()` without the seeded PRNG, no `new Date()` without the injected clock.

---

## 1. Buildings

Room numbering is `{floor}{nn}` — floor `2`, room `03` is room **203**, the one whose projector fails
in UC-05. Room codes are unique per building; the qualified form is `MEN-203`.

### Mendizábal (`MEN`) — teaching, central

Nineteenth-century block on the main square. Ground floor plus three.

| Floor | Rooms | Type | Capacity | Equipment |
| :-- | :-- | :-- | :-- | :-- |
| 0 | 001–004 | Lecture | 120, 120, 90, 90 | projector, screen, PA, lectern PC |
| 1 | 101–106 | Seminar | 40 × 6 | projector, whiteboard |
| 2 | 201–206 | Seminar | 35 × 6 | projector, whiteboard (**203** also has a document camera) |
| 3 | 301–302 | Study room | 60, 60 | whiteboard, power at every seat |

Opening hours: Mon–Fri 07:30–21:30 · Sat 09:00–14:00 · Sun closed.

### Santa Clara (`SCL`) — laboratories

Former convent, two cloisters, ground floor plus two. Thick walls, no lift in the west wing.

| Floor | Rooms | Type | Capacity | Equipment |
| :-- | :-- | :-- | :-- | :-- |
| 0 | 001–002 | Lecture | 80, 80 | projector, screen |
| 1 | 101–104 | Wet lab | 24 × 4 | fume hood, microscopes ×24, emergency shower |
| 2 | 201–203 | Computer lab | 30 × 3 | 30 workstations, projector |

Opening hours: Mon–Fri 08:00–20:00 · Sat–Sun closed.
Labs require a supervisor present: **never offered as a free room** by `campus.find_room`.

### El Faro (`FAR`) — new building, seafront

Built 2019 next to the old lighthouse. Ground floor plus one, fully accessible.

| Floor | Rooms | Type | Capacity | Equipment |
| :-- | :-- | :-- | :-- | :-- |
| 0 | 001 | Auditorium | 300 | projector ×2, PA, streaming rig, hearing loop |
| 0 | 002–003 | Lecture | 100 × 2 | projector, screen, PA |
| 1 | 101–105 | Seminar | 30 × 5 | touchscreen display, whiteboard |
| 1 | 106 | Study room | 80 | power at every seat, silent |

Opening hours: Mon–Fri 07:00–22:00 · Sat 09:00–18:00 · Sun 10:00–14:00.

**Totals** — 3 buildings, 36 rooms, 2 066 seats (Mendizábal 18/990, Santa Clara 9/346, El Faro 9/730).

### Distances (for `campus.wayfind`)

| From → To | On foot |
| :-- | :-- |
| Mendizábal → Santa Clara | 4 min, cross the cloister courtyard |
| Mendizábal → El Faro | 11 min, along the seafront promenade |
| Santa Clara → El Faro | 9 min |

Spoken directions must be sufficient on their own (UC-04). Floor plans are an improvement, not a
requirement.

---

## 2. Degree programmes

Six programmes, four years each, two semesters. Groups are `A`/`B` where enrolment justifies it.

| Code | Programme | Home building | Groups/year | Notes |
| :-- | :-- | :-- | :-- | :-- |
| `HAR` | Historia del Arte | Mendizábal | A | Small cohort |
| `INF` | Ingeniería Informática | Santa Clara | A, B | Needs computer labs |
| `ENF` | Enfermería | Santa Clara | A, B | Needs wet labs; placements from year 3 |
| `DER` | Derecho | Mendizábal | A, B | Largest cohort |
| `BMA` | Biología Marina | El Faro | A | Field work; the reason the campus is coastal |
| `TEI` | Traducción e Interpretación | El Faro | A | Exercises the locale story |

### Teaching slots

Morning `09:00–14:00`, afternoon `15:00–20:00`, in 1-hour blocks with a 10-minute changeover.

Deliberate collisions, so `campus.find_room` has something real to solve:

- **16:00–18:00 Tue and Thu** — peak load. `DER` and `INF` both run large groups; Mendizábal floors
  1 and 2 are fully booked, and the only free rooms are in El Faro.
- **Wed 09:00–11:00** — `ENF` occupies every Santa Clara wet lab.
- **Fri afternoon** — near-empty campus. The easy case.

---

## 3. Academic calendar 2026–2027

Dates are live during the demo window (October 2026) on purpose: `campus.deadlines` must have real
answers, and UC-03 requires that a deadline not on record is reported as unknown rather than guessed.

| Event | Dates |
| :-- | :-- |
| Ordinary enrolment | 1 – 17 Jul 2026 |
| **Late enrolment and amendments** | **21 Sep – 2 Oct 2026** |
| Semester 1 teaching | 14 Sep 2026 – 22 Jan 2027 |
| **Credit-transfer applications** | **deadline 9 Oct 2026** |
| **Final-project submission, autumn sitting** | **deadline 30 Oct 2026** |
| Placement agreements (`ENF`, year 3+) | deadline 16 Oct 2026 |
| Semester 1 exams, first sitting | 26 Jan – 13 Feb 2027 |
| Semester 2 teaching | 16 Feb – 29 May 2027 |
| Resit sitting | 15 – 26 Jun 2027 |

**Public holidays** (campus closed): 12 Oct, 1 Nov, 6 Dec, 8 Dec 2026 · 1 Jan, 6 Jan 2027.
**Local holiday**: 13 Oct 2026 (San Telmo patron).

### The week when everything piles up

**5 – 9 October 2026.** Late enrolment closed on the 2nd, credit transfers close on the 9th,
placement agreements are open, and the 12th–13th is a long weekend. This is the week the demo should
ask about: several deadlines at once, and a holiday immediately after.

---

## 4. Identities

Enough to prove that `campus.timetable` resolves against the authenticated identity and never against
a name parameter (UC-02), and that `campus.issue_status` only returns what the asker filed (UC-06).

| Id | Role | Enrolment | Purpose |
| :-- | :-- | :-- | :-- |
| `est-0001` | Student | `DER` year 2, group A | Main student of the demo |
| `est-0002` | Student | `INF` year 2, group B | Different timetable: proves isolation |
| `est-0042` | Student | `TEI` year 3 + a second institution | **UC-07**, the exchange student |
| `doc-0007` | Lecturer | `DER`, teaches in MEN-203 | Files the UC-05 fault |
| `doc-0011` | Lecturer | `BMA`, El Faro | Second lecturer, different issue queue |
| `con-0001` | Porter's desk | — | Receives issues; does not talk to the agent |

Two different identities must get two different timetables, and **neither can obtain the other's even
by asking explicitly**. Names are generated, never real.

---

## 5. Issue queue

`campus.report_issue` writes here and `campus.issue_status` reads from it. Fault numbers are
`INC-{yyyy}-{nnnn}`, allocated sequentially from the seed so they are reproducible.

**Reportable equipment** is whatever the room declares in §1 — a room with no projector cannot have a
broken projector, which is what makes the multi-turn confirmation meaningful.

Seeded open issues, so UC-06 has something to answer on a clean clone:

| Number | Room | Equipment | Filed by | Status |
| :-- | :-- | :-- | :-- | :-- |
| `INC-2026-0031` | MEN-203 | Projector | `doc-0007` | open |
| `INC-2026-0028` | FAR-104 | Touchscreen display | `doc-0011` | in progress |
| `INC-2026-0019` | SCL-201 | Workstation 14 | `doc-0011` | resolved |

---

## 6. What this dataset has to prove

Each use case must be answerable from the data above alone:

| Case | What it needs from here |
| :-- | :-- |
| UC-01 | Occupancy per slot, opening hours, labs excluded from "free" |
| UC-02 | Two identities with genuinely different timetables |
| UC-03 | Live October deadlines, and a question with no answer on record |
| UC-04 | Building-to-building distances and floor/room location |
| UC-05 | Equipment per room, so confirmation can be checked against reality |
| UC-06 | Issues attributable to the identity that filed them |
| UC-07 | An identity enrolled at a second institution |

---

## 7. Open — the second institution (M2)

UC-07 needs somewhere for the exchange student to ask *about*, served by the `standards` adapter from
iCalendar, LDAP and CSV fixtures in **a different language** — the runbook's example is Spanish in
Madrid, English in Dublin.

That institution is **not specified here**: it belongs to M2, when the standards adapter lands, and
specifying it now would be the "abstraction eats the calendar" risk in miniature. What M0 fixes is
only the hook: `est-0042` is enrolled in San Telmo **and** in one other institution.
