# Avatar Analyzer V4.1 residual follow-up

## Scope

This follow-up preserves the validated BODY_BASIC/BODY_HANDS_BASIC profile matrix and applies only the residual production repairs found by run `76646eafbefd4640bcde3f87bf7215f9`.

## Implemented

- Hand camera bounds are calculated from a hand/finger focus proxy.
- Render context is restricted to the hand, wrist and distal forearm.
- Coverage auto-fit retains the 15% minimum, 90% maximum and two-retry ceiling.
- Finger rig mode is derived from verified geometric branches, not inherited labels.
- Low confidence and projection mismatch are normalized and counted separately.
- A mobile residual metrics panel exposes both categories and derived hand modes.
- A non-CASCADE migration stages removal of the temporary authorization table and `pg_net`.

## Production gates still required

The migration must not be applied until the active temporary Edge Function `avatar-analyzer-v41-ops` is removed. It currently reads and deactivates rows in `public.avatar_analyzer_ops_auth`.

The following gates remain after PR CI:

1. Deploy a new Blender Worker revision from the merged SHA.
2. Repeat the real run with the original source SHA.
3. Inspect all 14 hand PNGs and confirm 15–90% coverage without clipping.
4. Capture the deployed mobile Analyzer.
5. Remove the temporary Edge Function.
6. Apply the cleanup migration and run Supabase security/performance advisors.

The PR must remain unmerged until CI is green. Production cleanup remains intentionally unapplied in this branch.
