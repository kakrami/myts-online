# myTS 6.20.118

Align event anchors, player Halo lookups and displayed event minutes to the selected half using absolute source timestamps. Legacy incomplete records use a labeled reported-clock fallback; missing clocks remain unknown. Carries source start timestamps into intermediate event records. No team/player/game exceptions.

Retains 6.20.117 historical aggregation and correction fixes. Source/engine queue versions remain unchanged: deployment does not recollect or automatically recalculate saved seasons. New calculations use the corrected clock. A separate offline replay applies corrected clock alignment to saved games through the timestamp-guarded cached importer, preserving stored manual corrections. Event-only changes are now imported even when minute results are unchanged. Scorers and minutes remain best-effort estimates.

Test: node clock-release/test.cjs from the retained audit workspace. Full saved-game replay, clock invariance, half isolation, unknown clocks, Halo alignment and unchanged browser code. Deploy the four included files with existing bindings and secrets.
