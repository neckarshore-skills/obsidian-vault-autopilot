---
tags:
  - realtag
---

# Survival cases — the leading hash is a heading marker, not a tag

This sentence has a real #realtag in it.

A URL must survive: https://example.com/page#section and example.com/#ai stay byte-exact.

A wikilink must survive: [[Some Note #heading]] and [[Project]].

```bash
# this is a comment, and grep #ai file is code, not a tag
echo "#ai stays"
```

Inline code must survive: `run #ai now`.
