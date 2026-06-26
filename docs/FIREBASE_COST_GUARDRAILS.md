# Firebase Cost Guardrails

Use these controls before and during the controlled release.

## Billing and quotas

1. Create Google Cloud budgets at 50%, 75%, 90%, and 100% of the release budget.
2. Route budget alerts to at least two monitored email addresses.
3. Set conservative Cloud Functions maximum instances for callable functions in
   Firebase/Google Cloud if traffic is expected to be very small.
4. Review Firestore reads, writes, Storage egress, Functions invocations, and
   Cloud Logging ingestion daily during the controlled release.
5. Enable App Check enforcement only after validating the TestFlight build with
   enforcement in monitor mode. The current callables do not enforce App Check.

Budgets alert; they do not automatically stop spend. If a hard stop is required,
use service quotas or an operational shutdown runbook.

## Application limits

- Home feed: 20 posts per fetch.
- Battles: 30 battles per fetch.
- Profile posts: at most 30 results per legacy author field.
- Like and vote markers: queried only for visible posts/battles.
- Post media: maximum 50 MB.
- Selected video duration: maximum 60 seconds.
- Battle votes and post likes: server-authoritative callable transactions.

## Artifact Registry cleanup

Cloud Functions deployments can leave container images in Artifact Registry.
In Google Cloud Console:

1. Open Artifact Registry for the production project.
2. Inspect repositories used by Cloud Functions in `us-central1`.
3. Add a cleanup policy that retains currently tagged images and a small number
   of recent untagged images.
4. Preview the policy before applying it.
5. Recheck storage after each functions deployment during release week.

Do not delete images referenced by active Cloud Run/Functions revisions.

## Incident controls

If spend or traffic is abnormal:

1. Disable new TestFlight invitations.
2. Inspect function invocation/error counts and Firestore operation metrics.
3. Temporarily reduce function maximum instances.
4. If necessary, disable the affected callable or roll rules back to the last
   tested version.
5. Preserve logs for the incident window, then reduce retention/noisy logs.
