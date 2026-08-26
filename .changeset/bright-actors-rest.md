---
"effect-encore": minor
---

Require Effect 4 RC and update the package to its current Cluster and Workflow APIs.

Route entity observation and rerun through the Client seam. Keep Workflow and Step methods as thin
delegates to upstream Effect where Effect supplies the full behavior.

Remove internal actor state registry operations from the package root. Applications must use the
state methods on an Entity Actor.
