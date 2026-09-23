# Lodge — Use cases

Every case ends in a **checkable condition**. That condition is the contract test written in M1, and the priority marker decides what survives when a cut rule fires.

| ID | Case | Tools | Priority |
| :-- | :-- | :-- | :-- |
| UC-01 | A free room right now | `campus.find_room` | essential |
| UC-02 | What do I have tomorrow | `campus.timetable` | essential |
| UC-03 | An administrative deadline | `campus.deadlines` | essential |
| UC-04 | Finding the room | `campus.wayfind` | essential |
| UC-05 | Reporting a fault | `campus.report_issue` | essential |
| UC-06 | Chasing the report | `campus.issue_status` | improvement |
| UC-07 | The exchange student | the same tools, two adapters | essential |
| UC-08 | Is that room free | `campus.room_schedule` | improvement |
| UC-09 | Holding a meeting room | `campus.book_room` | improvement |

---

## UC-01 · A free room right now

- **Actor:** Student
- **Trigger:** Between classes, needs somewhere to work
- **Flow:** `campus.find_room` with building — or site, at an institution with more than one campus — and time window. The spoken answer offers two or three options; the card shows the occupancy grid.
- **Acceptance:** No occupied, booked or out-of-hours room is ever listed, and the answer lands inside the latency budget of **500 ms round trip** (the Alexa+ platform limit). Measured against the deployed server: **214 ms median from Spain, network included**. The suite additionally guards against an order-of-magnitude regression on every build, which is a different and weaker claim — a stopwatch running alongside twenty-one other test workers measures the scheduler as much as the adapter.
- **Priority:** essential

## UC-02 · What do I have tomorrow

- **Actor:** Student or lecturer
- **Trigger:** Planning the next day
- **Flow:** `campus.timetable` resolved against the authenticated identity, never against a name parameter.
- **Acceptance:** Two different identities get different timetables, and neither can obtain the other's even by asking explicitly.
- **Priority:** essential

## UC-03 · An administrative deadline

- **Actor:** Student
- **Trigger:** Unsure about enrolment, exam registration or a submission
- **Flow:** `campus.deadlines` returns the date and days remaining from the adapter's calendar.
- **Acceptance:** If the deadline is not on record the agent says so. It never infers or approximates a date.
- **Priority:** essential

## UC-04 · Finding the room

- **Actor:** Student
- **Trigger:** An exam in a building they do not know
- **Flow:** `campus.wayfind` gives spoken directions; where there is a screen, the floor plan as well.
- **Acceptance:** The spoken answer is sufficient to get there on its own — the plan is an improvement, not a requirement.
- **Priority:** essential

## UC-05 · Reporting a fault

- **Actor:** Lecturer
- **Trigger:** The room projector won't start and the class begins in five minutes
- **Flow:** `campus.report_issue` validates the room and its equipment, then returns the question to ask and files nothing. The agent asks it out loud; once the person says yes it calls again with `confirmed`, and the ticket is filed. Two tool calls, and the first one never writes (ADR-011).
- **Acceptance:** No ticket exists without confirmation, and the one created appears in the adapter's queue with its number spoken back.
- **Priority:** essential

## UC-06 · Chasing the report

- **Actor:** Lecturer
- **Trigger:** Filed something yesterday, wants to know whether it was picked up
- **Flow:** `campus.issue_status` over the tickets opened by that identity.
- **Acceptance:** Only returns tickets opened by the person asking.
- **Priority:** improvement

## UC-07 · The exchange student

- **Actor:** Student enrolled at two institutions
- **Trigger:** Asks the same question about their other university
- **Flow:** The active adapter is switched; the same tools resolve against a different data source and a different language.
- **Acceptance:** The same sentence returns the other institution's data, in its language, with no restart and no recompile.
- **Priority:** essential

> UC-07 justifies the whole architecture. If it stops working, this is one more campus server rather than a reference implementation.

---

UC-08 and UC-09 were added on 23-09-2026 by the third amendment to the frozen interface (ADR-020). They are `improvement`: they arrived after the freeze, the video does not depend on them, and they fall before anything above if a cut rule fires.

## UC-08 · Is that room free

- **Actor:** Lecturer or staff
- **Trigger:** Knows the room they want, and wants to know whether they can have it
- **Flow:** `campus.room_schedule` with the room. It reads the room's diary for the rest of the day on the institution's clock — teaching and bookings alike — and says whether it is free now and until when, or what it is taken by and when it frees up.
- **Acceptance:** A room taken by a class or by a booking is never called free; back-to-back slots are walked through rather than reported as a gap; a room not on record is said to be unknown, never free.
- **Priority:** improvement

## UC-09 · Holding a meeting room

- **Actor:** Lecturer or staff
- **Trigger:** Needs a room for a meeting this afternoon
- **Flow:** `campus.book_room` validates that the room exists and is free, then returns the question to ask and holds nothing. Once the person says yes it calls again with `confirmed`, and the booking is made. The same two turns as UC-05 (ADR-011).
- **Acceptance:** Nothing is held without confirmation; the booking made is spoken back with its reference and immediately disappears from `campus.find_room`; a taken room, a shut building, a supervised lab, a time already gone today and an unidentified caller are each refused with a reason — a past time is never quietly read as tomorrow. Only an institution that declares `room-booking` publishes the tool.
- **Priority:** improvement
