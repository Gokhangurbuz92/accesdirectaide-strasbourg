# SSRF Policy Evidence

The SSRF (Server-Side Request Forgery) protection policy is enforced across outbound fetch paths in AccesDirectAide, specifically targeting user-controlled or database-controlled URLs (such as `link-check.js` and `source-verification.js`).

## Validation Logic
The `validateUrlSafety` (in `official-sources.js`) and `isSafeUrl` (in `fetch.js`) functions block:
- Non-HTTP/HTTPS schemes (e.g. `file://`, `ftp://`, `gopher://`)
- Localhost access (`localhost`, `127.0.0.1`, `[::1]`)
- Private network ranges (`10.x.x.x`, `172.16.x.x`-`172.31.x.x`, `192.168.x.x`)
- Cloud metadata access (`169.254.x.x`)
- `0.0.0.0` address

## Enforcement Proof
1. **`source-verification.js`**: Before any HTTP HEAD/GET request, `validateUrlSafety(url)` is called. If it returns false, the request is aborted with `UNVERIFIED` / `reason`. This applies to the initial URL and any redirects followed.
2. **`link-check.js`**: Now uses the centralized `safeFetch` wrapper from `api/_utils/fetch.js`. `safeFetch` runs `isSafeUrl(url)` before executing the fetch. If it returns false, a `FetchError` is thrown, blocking network access and safely failing the link check (marked as broken in `SourceSnapshot`).

## Conclusion
Outbound fetches to potentially unsafe destinations are actively blocked before network execution.
