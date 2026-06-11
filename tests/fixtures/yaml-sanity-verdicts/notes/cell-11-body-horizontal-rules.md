---
created: 2024-03-14
title: Body horizontal rules
---

# Body horizontal rules (the 72-false-positive class)

Prose section one without any key-like lines.

---

More prose between two horizontal rules. No YAML-like content here at all.

---

Closing prose. Expected verdict: OK — body-level `---` pairs without
YAML-key-like content between them are horizontal rules, not blocks.
