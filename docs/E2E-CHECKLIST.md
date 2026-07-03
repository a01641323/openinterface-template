# End-to-end checklist — the 10 original requirements

Run top to bottom against a deployed instance. Each item is a concrete manual
test. Automated coverage first: `cd app && npx vitest run` and
`node scripts/verify-template.mjs` must both pass.

## 1. Request a code with live status

Open `{vercelUrl}`, submit a name. ☐ Request appears under "My requests" as
`pending`. ☐ Open the page in a private window — the list is empty (cookie
scoping). ☐ Delete button removes the entry.

## 2. Admin lifecycle (approve / deny / revoke / delete)

Open `/admin`. ☐ Wrong password shows "Wrong password"; correct password shows
the dashboard. ☐ Approve the pending request with 5 minutes → an active code
appears with a ticking countdown; the visitor's landing page now shows the
code with the same countdown (±1s). ☐ Deny another request → visitor sees
`denied`. ☐ Revoke moves the code to Past codes; delete removes it.

## 3. Signed validation with lazy expiry

☐ `curl -s -X POST {vercelUrl}/api/validate -H 'Content-Type: application/json' -d '{"code":"<CODE>"}'`
returns `{token, name, expiresAt}`. ☐ An unknown code returns 401
`{"reason":"unknown"}`. ☐ After the timeout passes, the same call returns 401
`{"reason":"expired"}` and the admin table shows the code as expired.

## 4. curl install

☐ `curl -fsSL {vercelUrl}/install.sh | bash` prints a one-line success message
with usage. ☐ `~/.{commandName}/` contains `cli/ interface/ shared/
template.config.json install-key`. ☐ The `{commandName}` launcher is on PATH
(or the hint told you how).

## 5. CLI serves the interface; code entry is the only online step

☐ `{commandName}` starts the server and opens the browser at the code screen.
☐ Entering the approved code shows "Welcome [name]" with the LAN address and
three buttons. ☐ Entering a bogus code shows "invalid code"; an expired one
shows "code expired".

## 6. Refresh / reopen keeps the session — offline

**Turn wifi off now.** ☐ Refresh the page — still granted. ☐ Ctrl-C the CLI,
rerun `{commandName}` — still granted. No network at any point.

## 7. Timeout drops host AND guests — offline

With wifi still off and a guest connected (item 9): ☐ at the approved
timeout, the host page and every guest page fall to the code screen within a
second of each other, unprompted.

## 8. Revoke works when online

With wifi on and a session active: ☐ click Revoke in `/admin` → within 45
seconds the host and all guests drop to the code screen (opportunistic
revalidation poll).

## 9. LAN guests with realtime color sync

From a second device on the same wifi, open `http://{hostLanIP}:{port}`.
☐ Guest sees only "waiting for approval…"; host sees "Device {ip} wants to
join — Allow / Deny". ☐ Allow → guest gets a buttons-only view (no welcome
text, no IP, no LAN option). ☐ Tap buttons on either device — colors change on
both instantly, both directions. ☐ With no active host session, the guest URL
shows only "no active session".

## 10. Denied guest and disconnect fallback

☐ Deny a joining guest → that guest sees the code screen with "access denied".
☐ Kill the CLI while a guest is connected → the guest falls back to the code
screen on its own within seconds. ☐ Reconnecting guests always need a fresh
approval (nothing persists). ☐ `{commandName} update` reports up-to-date or
updates; offline it fails with a clear message.

## Bonus: clock-tamper defenses (see SECURITY-NOTES.md)

☐ Hand-edit any byte of `~/.{commandName}/session.json` → next check kills the
session. ☐ Roll the system clock back >90s while the CLI is stopped, restart →
session invalidated (high-water mark). ☐ Freeze/rewind tricks cannot extend
total runtime beyond the granted window (monotonic budget).
