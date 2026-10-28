// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { githubOAuth2, githubOAuth2Credential } from "./credential";

const base = { clientId: "id", clientSecret: "secret" };

describe("github.oauth2 credential", () => {
  it("uses github.com and default scopes", () => {
    assert.equal(githubOAuth2Credential.fields.strict().safeParse(base).success, true);
    assert.deepEqual(githubOAuth2(base), {
      authUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scopes: ["repo", "read:user"],
      authentication: "body",
      pkce: true,
    });
  });

  it("takes scopes separated by spaces or commas", () => {
    assert.deepEqual(githubOAuth2({ ...base, scope: "gist, user  workflow" })?.scopes, [
      "gist",
      "user",
      "workflow",
    ]);
  });

  it("uses the host of GitHub Enterprise Server", () => {
    const config = githubOAuth2({ ...base, server: "https://ghe.example.com/api/v3" });
    assert.equal(config?.authUrl, "https://ghe.example.com/login/oauth/authorize");
    assert.equal(config?.tokenUrl, "https://ghe.example.com/login/oauth/access_token");
  });

  it("rejects a server that is not a URL", () => {
    assert.equal(
      githubOAuth2Credential.fields.safeParse({ ...base, server: "nope" }).success,
      false,
    );
    assert.equal(githubOAuth2({ ...base, server: "nope" }), null);
  });

  it("keeps the token fields for the server", () => {
    assert.ok(githubOAuth2Credential.serverFields?.includes("refreshToken"));
    assert.equal(githubOAuth2Credential.oauth2, githubOAuth2);
  });
});
