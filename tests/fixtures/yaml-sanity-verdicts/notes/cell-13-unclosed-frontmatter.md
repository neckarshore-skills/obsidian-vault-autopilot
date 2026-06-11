---
created: 2024-03-14
title: Unclosed frontmatter

Body text. The frontmatter block above never closes — there is no second
`***` style marker and no closing dash line anywhere in this file.

Expected verdict: UNCLOSED_FRONTMATTER (Pattern 3). A skill treating this
as no-frontmatter and prepending a new block via recipe (c) would corrupt
the file further.
