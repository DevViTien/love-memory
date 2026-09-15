# Mobile and in-app audio verification

Use `/studio/spikes` with any non-sensitive local audio file. Do not upload that file; the page uses
a tab-scoped object URL.

| Environment                 | Version/device            | Play after tap | Pause   | Mute    | Rejected-play fallback | Background/resume | Result   |
| --------------------------- | ------------------------- | -------------- | ------- | ------- | ---------------------- | ----------------- | -------- |
| Chrome Windows              | 153 / current workstation | Pending manual | Pending | Pending | Unit-covered           | Pending           | Pending  |
| Safari iOS current          | TBD                       | Pending        | Pending | Pending | Pending                | Pending           | Deferred |
| Safari iOS oldest supported | TBD                       | Pending        | Pending | Pending | Pending                | Pending           | Deferred |
| Chrome Android              | TBD                       | Pending        | Pending | Pending | Pending                | Pending           | Deferred |
| Zalo in-app browser         | TBD                       | Pending        | Pending | Pending | Pending                | Pending           | Deferred |
| Messenger/Facebook in-app   | TBD                       | Pending        | Pending | Pending | Pending                | Pending           | Deferred |

For each environment:

1. Load on normal network, choose a local audio file and tap Play.
2. Reload and confirm there is no autoplay before a gesture.
3. Pause, resume, mute and unmute.
4. Background the browser for 20 seconds, then return.
5. Enable reduced motion and repeat.
6. Deny/interrupt playback where the browser permits and confirm the visible fallback.
7. Record browser version, device, observed behavior and screenshot only if it contains no private
   content or token.
