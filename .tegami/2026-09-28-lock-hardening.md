---
packages:
  npm:@aryasaatvik/upm:
    type: patch
---

### Harden npm v3 lock handling

Normalize scalar platform fields, preserve legacy engines, handle absent optional edges, and reject unsupported package sources before fetching. Cover nested shadows and scoped package paths.
