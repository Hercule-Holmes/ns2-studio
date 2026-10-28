import { describe, expect, it } from "vitest";
import {
  buildLoginUrl,
  createPkce,
  parseRedirect,
  sessionTokenRequestBody,
} from "../src/main/nintendo/oauth";

describe("nintendo oauth helpers (S19)", () => {
  it("creates a PKCE pair with distinct verifier/challenge", () => {
    const a = createPkce();
    const b = createPkce();
    expect(a.verifier).not.toBe(a.challenge);
    expect(a.verifier.length).toBeGreaterThanOrEqual(43);
    expect(a.challenge).not.toBe(b.challenge);
    expect(a.state).not.toBe(b.state);
  });

  it("builds the authorize URL with the parental controls client id", () => {
    const url = buildLoginUrl({ verifier: "v".repeat(43), challenge: "c".repeat(43), state: "s1" });
    expect(url).toContain("https://accounts.nintendo.com/connect/1.0.0/authorize");
    expect(url).toContain("client_id=71b963c1b7b6d119");
    expect(url).toContain("response_type=session_token_code");
    expect(url).toContain("session_token_code_challenge_method=S256");
    expect(url).toContain("redirect_uri=npf71b963c1b7b6d119%3A%2F%2Fauth");
  });

  it("parses a valid redirect fragment", () => {
    const parsed = parseRedirect(
      "npf71b963c1b7b6d119://auth#session_token_code=ABC&state=s1",
      "s1",
    );
    expect(parsed.code).toBe("ABC");
    expect(parsed.state).toBe("s1");
  });

  it("rejects a redirect whose state mismatches", () => {
    expect(() =>
      parseRedirect("npf71b963c1b7b6d119://auth#session_token_code=ABC&state=evil", "s1"),
    ).toThrow(/state/);
  });

  it("reports error responses from the redirect", () => {
    expect(() =>
      parseRedirect("npf71b963c1b7b6d119://auth#error=access_denied", "s1"),
    ).toThrow(/access_denied/);
  });

  it("builds the session_token exchange body", () => {
    const body = sessionTokenRequestBody("CODE", "VER");
    expect(body.get("client_id")).toBe("71b963c1b7b6d119");
    expect(body.get("session_token_code")).toBe("CODE");
    expect(body.get("session_token_code_verifier")).toBe("VER");
  });
});
