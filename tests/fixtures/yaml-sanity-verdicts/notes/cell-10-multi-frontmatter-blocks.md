---
created: 2024-03-14
title: First block
---

# Merged note (two frontmatter blocks)

Body text of the first note.

---
created: 2025-01-01
title: Second block accidentally appended
---

Body text of the second note. Typical append error during sync or import.

Expected verdict: MULTIPLE_FRONTMATTER_BLOCKS — the second `---` pair
encloses YAML-key-like lines, so it is a genuine second block.
