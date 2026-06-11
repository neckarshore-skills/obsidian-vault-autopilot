---
created: 2024-03-14
title: Prose colon between body rules
---

# Decision log

---
Rationale: this colon-prefixed prose line between two body rules matches the YAML-key-like pattern.
---

Expected verdict: MULTIPLE_FRONTMATTER_BLOCKS — conservative by design.
Pattern 2 cannot distinguish prose `Word: text` lines from YAML keys, so it
flags the pair as a genuine block and the skill SKIPs with a Class-A finding
(false-positive skip, never a wrong write). Pinned here so any future
loosening of this heuristic shows up as an explicit truth-matrix change.
