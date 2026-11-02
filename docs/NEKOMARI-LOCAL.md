# Nekomari local SAO variant

This is a separate local variant of the MIT-licensed upstream
[Komari-Theme-SAO](https://github.com/WAOR/Komari-Theme-SAO), based on upstream
v1.3.4 commit `918fb899bb3a8b05fc9a555628841ccc35d372a2`. It is not an
official upstream release. Its independent short name `SAO-Nekomari` prevents
an upstream `SAO` market install from replacing the active local variant.

The quota and instance cycle fields use quality-marked Agent cycle counters,
not kernel boot totals. Unknown quality and invalid or missing required
directions remain unknown; a valid zero remains zero. The mini layout's
directional figures are also explicitly labelled Agent cycle totals; large and
compact cards label boot totals separately. The Agent's reset day, provider
accounting rules and time zone can differ: these numbers are not asserted to
match a provider bill. This variant does not change an Agent, reset a ledger
or modify any node.

The today-traffic path now validates backend series semantics before summing:
a direction only counts when the backend answers exactly one
`interval_delta_v2` stream whose points are complete, non-negative integer
per-interval amounts. `billing_cycle_cumulative` fallbacks, duplicate streams,
partial or invalid points remain unknown instead of zero, and boundary repair
never merges cumulative counters into validated interval buckets. Totals are
labelled as sampled, possibly-incomplete interval sums and are not asserted to
match a provider bill.

## Build and upgrade

Use Node 22 and the committed lockfile. Run `npm ci`, `npm test`,
`npm run typecheck`, `npm run lint`, and `npm run package`. Record the exact
commit and SHA-256 of the zip before deployment. Do not overwrite an upstream
SAO version or publish the zip under an official upstream name. Review future
upstream changes and rebase the local patch and tests before a replacement;
the panel's update and market actions are manual and may install another theme.

Theme settings are keyed by short name. Before switching to the local theme,
copy the current `SAO` settings to `SAO-Nekomari` through the authenticated
panel API, without printing private values, and verify equality. The separate
upstream `SAO` files and settings remain available. Before rollback, preserve
any settings changed under `SAO-Nekomari`; otherwise switching back to `SAO`
will use the prior `SAO` settings. Do not restore an old database, node list,
or Agent configuration as part of a theme rollback.

Changing the active theme can briefly affect new page loads. Keep the old
theme assets accessible during the browser cache lifetime, verify both themes
and the node identity immediately before and after a switch, and check health
and the public page. A live read-only browser check is not a substitute for
owner-session acceptance or independent-provider billing validation.
