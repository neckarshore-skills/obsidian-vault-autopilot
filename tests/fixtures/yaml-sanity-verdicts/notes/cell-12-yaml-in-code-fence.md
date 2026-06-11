---
created: 2024-03-14
title: YAML inside code fence
---

# Frontmatter-shaped content inside a code fence

Documentation snippet that quotes a frontmatter block:

```yaml
---
created: 2025-01-01
title: This is documentation, not a real frontmatter block
---
```

Expected verdict: OK — `---` markers inside a code fence do not count
for multi-block detection.
