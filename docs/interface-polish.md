# Recovery interface polish

The local Shotbase opening, onboarding, settings, and editor recordings were reviewed as a craft reference. Observed patterns: one focal action, motion around stable content, consistent control positions, consequences beside choices, compact overlays, and completion with a clear next step. The private recordings and account/desktop imagery are not included in this repository.

PwnMyFone keeps its own lavender/green visual identity. The recovery screen now presents the current stage and a single primary action. Device identity and raw engine output remain available in a disclosure. Animated background fields and a USB connection illustration add restrained motion; a reduced-motion media query removes transitions and animations.

Firmware preparation and automatic recovery remain non-erasing. Opening the final review does not start a restore. The native modal dialog contains the exact model and ECID, permanent-data-loss and Activation Lock consequences, and the required ERASE phrase. Escape cancels; dismissal returns focus to the review button. Disconnect or invalid prerequisites dismiss the review, and the backend rechecks the exact target before restoration.

A restore completion receipt is followed by a request to inspect the physical Hello setup screen. The app labels that check as user-confirmed rather than claiming the screen was detected. Failed or refused operations expose the real engine message and a relevant retry/manual-recovery path. Polling errors clear after a successful scan; late responses from before a new operation are discarded.

Manual recovery guidance follows Apple's [iPad recovery instructions](https://support.apple.com/en-us/108925) and [iPhone passcode reset instructions](https://support.apple.com/en-us/118430). These are fallback instructions, not a requirement when automatic recovery works.

The paid-value hypothesis is less manual device handling, understandable progress and errors, and dependable recovery. Visual polish alone does not establish that value or justify claims of proprietary unlocking. Destructive restoration, physical setup completion, and failure recovery still require an end-to-end device qualification before a public release.
